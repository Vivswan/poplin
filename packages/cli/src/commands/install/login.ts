// `poplin login`: ask the install for a login, show the person where to allow it, wait for the answer, and save the token.
//
//   POST /api/logins         the code to show, the address to open, the secret to keep
//   POST /api/logins/token   asked every few seconds: pending, denied, expired, or the token
//
// Nothing is saved before the token arrives, so a login that is stopped, denied, or runs out leaves the machine as it was.

import type * as v from "valibot";

import { BEGUN_LOGIN_ANSWER, plainComputerName, REDEEMED_LOGIN } from "../../../../core/src/actions/access/computer-logins";
import { type Client, createClient, type Failure } from "../../client/client";
import { isServer, parseLogin } from "../../local/login";
import { readLoginFile, saveLogin } from "../../local/login-file";
import { type Problem, problem, problemOf } from "../problems";
import type { Io, Outcome, RequestOf } from "../records";
import { columns, dayText } from "../text";

/** How many milliseconds a second holds: the install speaks of waits in seconds. */
const MS_PER_SECOND = 1000;

/** How many seconds a minute holds, for the time left as a person reads it. */
const SECONDS_PER_MINUTE = 60;

/** The fewest and the most seconds between two questions, whatever the install says. */
const INTERVAL_BOUNDS = { min: 1, max: 60 } as const;

/** How often a login the install asks to wait is begun again before the refusal stands. */
const BEGIN_RESTS = 5;

/** The variables that hold a login of their own, which every command uses before the saved one. */
const LOGIN_VARIABLES = ["POPLIN_SERVER", "POPLIN_TOKEN"];

/** What a login is told that asked for every right and was allowed its own sites only, in the words the dashboard has for the two choices. */
const ALLOWED_LESS = "the dashboard allowed Own sites only; for Everything, log in again and choose it there";

/** What an install answers a begun login with. */
type Begun = v.InferOutput<typeof BEGUN_LOGIN_ANSWER>;

/** What an install answers the terminal of an allowed login with: the token, once, and its record. */
type Collected = Extract<v.InferOutput<typeof REDEEMED_LOGIN>, { readonly state: "allowed" }>;

function refused(said: Problem): Outcome {
  return { ok: false, problem: said };
}

/** The install to log in to: the one `--server` names, else the one of the saved login. The environment names none: a login is saved in the file, which a shell that sets the variables does not read. */
async function serverOf(request: RequestOf<"login">, io: Io): Promise<string | Problem> {
  if (request.server !== undefined) return isServer(request.server) ? request.server : problem("bad_server");

  const saved = await readLoginFile(io.machine).catch(() => undefined);
  if (saved?.state === "saved") return saved.login.server;

  return problem("no_server");
}

/** The address to open, only when it is a page of the install that was asked: a browser is sent nowhere else. */
function pageOf(address: string, server: string): string | undefined {
  const page = URL.parse(address);
  if (page === null || page.origin !== server) return undefined;

  return page.href;
}

/** A failure a waiting login outlasts: the install was out of reach for a moment, or asked for a rest. */
function passes(failure: Failure): boolean {
  if (failure.kind === "unreachable" || failure.kind === "timeout") return true;

  return failure.kind === "refused" && failure.code === "too_many_requests";
}

/** The seconds to the next question after a failure that passes: the rest its answer asked for when that is longer than the pace. */
function restOf(failure: Failure, interval: number): number {
  const asked = "retryAfter" in failure ? failure.retryAfter : undefined;

  return Math.max(interval, asked ?? interval);
}

function clamped(seconds: number): number {
  if (!Number.isFinite(seconds)) return INTERVAL_BOUNDS.max;

  return Math.min(INTERVAL_BOUNDS.max, Math.max(INTERVAL_BOUNDS.min, seconds));
}

/**
 * Begin the login, and begin it again after each rest an install that is asked too often asks for, up to five rests.
 *
 * @returns the begun login, the refusal that stands, or `interrupted` once the person stops a rest
 */
async function begin(client: Client, asked: { readonly scope: "publisher" | "admin"; readonly computer: string }, io: Io): Promise<Begun | Problem> {
  for (let rests = 0; ; rests += 1) {
    const begun = await client.call(BEGUN_LOGIN_ANSWER, (api) => api.logins.$post({ json: asked }));
    if (begun.ok) return begun.value;

    const { failure } = begun;
    if (failure.kind !== "refused" || failure.code !== "too_many_requests" || rests === BEGIN_RESTS) return problemOf(failure);

    const seconds = clamped(failure.retryAfter ?? INTERVAL_BOUNDS.max);
    if (io.terminal.progress) io.screen.working(`the install asks for a pause: beginning the login in ${seconds} s (Ctrl-C stops)`);

    if ((await io.pause(seconds * MS_PER_SECOND)) === "interrupted") return problem("interrupted");
  }
}

/** Tell the person where to go: with `--json` one line an agent can pass on, otherwise the address and the code, each alone on a line. The page asks for the code's last letters, which only this output shows. */
function announce(page: string, begun: Begun, json: boolean, io: Io): void {
  if (json) {
    io.out(JSON.stringify({ verify_url: page, code: begun.code, expires_in: begun.expires_in }));

    return;
  }

  const minutes = Math.round(begun.expires_in / SECONDS_PER_MINUTE);
  io.screen.line("note", "open this address, and allow this login there:");
  io.screen.line("plain", `  ${page}`);
  io.screen.line("note", "the page asks for the last 4 letters of this code:");
  io.screen.line("plain", `  ${begun.code}`);
  io.screen.line("plain", `the code works for ${minutes} minutes`);
}

/** Ask for the token once: the token, the reason to stop, or the seconds to wait before the next question. */
async function ask(client: Client, secret: string, interval: number): Promise<Collected | Problem | number> {
  const asked = await client.call(REDEEMED_LOGIN, (api) => api.logins.token.$post({ json: { secret } }));
  if (!asked.ok) return passes(asked.failure) ? restOf(asked.failure, interval) : problemOf(asked.failure);

  const answer = asked.value;
  if (answer.state === "allowed") return answer;

  if (answer.state === "denied") return problem("login_denied");

  if (answer.state === "expired") return problem("login_expired");

  return interval;
}

/** Ask for the token until the login is decided, runs out, or the person stops the command. */
async function collect(client: Client, begun: Begun, io: Io): Promise<Collected | Problem> {
  const interval = clamped(begun.interval);
  let wait = interval;
  let left = begun.expires_in;

  while (left > 0) {
    if (io.terminal.progress) io.screen.working(`waiting to be allowed, ${Math.ceil(left / SECONDS_PER_MINUTE)} min left (Ctrl-C stops)`);

    if ((await io.pause(wait * MS_PER_SECOND)) === "interrupted") return problem("interrupted");

    left -= wait;
    const answer = await ask(client, begun.secret, interval);
    if (typeof answer !== "number") return answer;

    // A rest longer than the login has left ends with the login.
    wait = Math.min(answer, left);
  }

  return problem("login_expired");
}

/**
 * Say who the saved token is, that it may do less than was asked for where the dashboard allowed less, and which variables of this shell stand in the saved login's way.
 *
 * @param asked - the role the login asked for
 */
function saved(server: string, record: Collected["record"], asked: "publisher" | "admin", io: Io): Outcome {
  const facts = [
    ["install", server],
    ["role", record.scope],
    ["token", record.note === "" ? record.id : `${record.id} (${record.note})`],
    ["expires", record.expires === "never" ? "never" : dayText(record.expires)],
  ];
  const lines = [{ tone: "done", text: "logged in: the token is saved on this machine" } as const, ...columns(facts)];
  const less = asked === "admin" && record.scope === "publisher" ? [ALLOWED_LESS] : [];
  const shadowing = LOGIN_VARIABLES.filter((name) => (io.machine.env[name] ?? "") !== "");
  if (shadowing.length === 0) return { ok: true, value: { server, token: record }, lines, notes: less };

  const [verb, them] = shadowing.length === 1 ? ["is", "it"] : ["are", "both"];

  return { ok: true, value: { server, token: record }, lines, notes: [...less, `${shadowing.join(" and ")} ${verb} set in this shell: unset ${them} to use the saved login`] };
}

/**
 * Log this computer in.
 *
 * The address and the code are printed before the wait begins, and the browser is opened when there is one. The token is saved in the login file and printed nowhere.
 *
 * @returns who the saved token is, or the problem: no install to ask, a login that was denied, ran out, or was stopped, or an install that did not answer as one
 */
export async function logIn(request: RequestOf<"login">, io: Io): Promise<Outcome> {
  const server = await serverOf(request, io);
  if (typeof server !== "string") return refused(server);

  const client = createClient({ server, fetch: io.fetch, timeoutMs: io.timeoutMs, stopped: io.stopped, told: (line) => io.screen.aside("note", line), pause: io.pause });
  const computer = request.computer ?? plainComputerName(io.computer);
  const begun = await begin(client, { scope: request.publisher ? "publisher" : "admin", computer }, io);
  if (io.terminal.progress) io.screen.rest();

  if ("exit" in begun) return refused(begun);

  const page = pageOf(begun.verify_url, server);
  if (page === undefined) return refused(problem("unexpected_answer", "the address to open is not the install's"));

  announce(page, begun, request.json, io);
  if (request.browser) io.open(page);

  const collected = await collect(client, begun, io);
  if (io.terminal.progress) io.screen.rest();

  if ("code" in collected) return refused(collected);

  const login = parseLogin({ server, token: collected.token });
  if (!login.ok) return refused(problem("unexpected_answer", "the token is not one"));

  await saveLogin(login.login, io.machine);

  return saved(server, collected.record, request.publisher ? "publisher" : "admin", io);
}
