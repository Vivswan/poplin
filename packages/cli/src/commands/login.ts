// `poplin login`: ask the install for a login, show the person where to allow it, wait for the answer, and save the token.
//
//   POST /api/logins         the code to show, the address to open, the secret to keep
//   POST /api/logins/token   asked every few seconds: pending, slow_down, denied, expired, or the token
//
// Nothing is saved before the token arrives, so a login that is stopped, denied, or runs out leaves the machine as it was.

import type { ROUTES } from "../../../core/src/api/routes";
import { type Client, createClient, type Failure } from "../client/client";
import { isServer, parseLogin } from "../local/login";
import { readLoginFile, saveLogin } from "../local/login-file";
import { type Problem, problem, problemOf } from "./problems";
import type { Io, Outcome, RequestOf } from "./records";
import { columns, dayText } from "./text";

/** How many milliseconds a second holds: the install speaks of waits in seconds. */
const MS_PER_SECOND = 1000;

/** How many seconds a minute holds, for the time left as a person reads it. */
const SECONDS_PER_MINUTE = 60;

/** The fewest and the most seconds between two questions, whatever the install says. */
const INTERVAL_BOUNDS = { min: 1, max: 60 } as const;

/** How many seconds are added to the wait when the install says to slow down. */
const SLOW_DOWN_SECONDS = 5;

/** The longest name a computer gives itself, in characters. */
const MAX_COMPUTER_LENGTH = 100;

/** A control character, which no name on one line holds. */
const CONTROL = /\p{Cc}/gu;

/** The variables that hold a login of their own, which every command uses before the saved one. */
const LOGIN_VARIABLES = ["POPLIN_SERVER", "POPLIN_TOKEN"];

/** What an install answers a begun login with. */
type Begun = NonNullable<(typeof ROUTES)["beginLogin"]["types"]>["done"];

/** What an install answers the terminal of an allowed login with: the token, once, and its record. */
type Collected = Extract<NonNullable<(typeof ROUTES)["redeemLogin"]["types"]>["done"], { readonly state: "allowed" }>;

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

/** A failure a waiting login outlasts: the install was out of reach for a moment, or said to ask less often. */
function passes(failure: Failure): boolean {
  if (failure.kind === "unreachable" || failure.kind === "timeout") return true;

  return failure.kind === "refused" && failure.code === "too_many_requests";
}

function clamped(seconds: number): number {
  if (!Number.isFinite(seconds)) return INTERVAL_BOUNDS.max;

  return Math.min(INTERVAL_BOUNDS.max, Math.max(INTERVAL_BOUNDS.min, seconds));
}

/** Tell the person where to go: with `--json` one line an agent can pass on, otherwise the address and the code, each alone on a line. */
function announce(page: string, begun: Begun, json: boolean, io: Io): void {
  if (json) {
    io.out(JSON.stringify({ verify_url: page, code: begun.code, expires_in: begun.expires_in }));

    return;
  }

  const minutes = Math.round(begun.expires_in / SECONDS_PER_MINUTE);
  for (const line of ["open this address, and allow this computer there:", `  ${page}`, "allow it only if the page shows this code:", `  ${begun.code}`, `the code works for ${minutes} minutes`]) io.out(line);
}

/** Ask for the token once: the token, the reason to stop, or whether to go on at the same pace or a slower one. */
async function ask(client: Client, secret: string): Promise<Collected | Problem | "wait" | "slow_down"> {
  const asked = await client.call("redeemLogin", undefined, { secret });
  if (!asked.ok) return passes(asked.failure) ? "slow_down" : problemOf(asked.failure);

  const answer = asked.value;
  if (answer.state === "allowed") return answer;

  if (answer.state === "denied") return problem("login_denied");

  if (answer.state === "expired") return problem("login_expired");

  return answer.state === "slow_down" ? "slow_down" : "wait";
}

/** Ask for the token until the login is decided, runs out, or the person stops the command. */
async function collect(client: Client, begun: Begun, io: Io): Promise<Collected | Problem> {
  let interval = clamped(begun.interval);
  let left = begun.expires_in;

  while (left > 0) {
    if (io.terminal.progress) io.status(`waiting to be allowed, ${Math.ceil(left / SECONDS_PER_MINUTE)} min left (Ctrl-C stops)`);

    if ((await io.pause(interval * MS_PER_SECOND)) === "interrupted") return problem("interrupted");

    left -= interval;
    const answer = await ask(client, begun.secret);
    if (typeof answer !== "string") return answer;

    if (answer === "slow_down") interval = clamped(interval + SLOW_DOWN_SECONDS);
  }

  return problem("login_expired");
}

/** Say who the saved token is, and which variables of this shell stand in the saved login's way. */
function saved(server: string, record: Collected["record"], io: Io): Outcome {
  const facts = [
    ["install", server],
    ["role", record.scope],
    ["token", record.note === "" ? record.id : `${record.id} (${record.note})`],
    ["expires", record.expires === "never" ? "never" : dayText(record.expires)],
  ];
  const lines = ["logged in: the token is saved on this machine", ...columns(facts)];
  const shadowing = LOGIN_VARIABLES.filter((name) => (io.machine.env[name] ?? "") !== "");
  if (shadowing.length === 0) return { ok: true, value: { server, token: record }, lines };

  const [verb, them] = shadowing.length === 1 ? ["is", "it"] : ["are", "both"];

  return { ok: true, value: { server, token: record }, lines, notes: [`${shadowing.join(" and ")} ${verb} set in this shell: unset ${them} to use the saved login`] };
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

  const client = createClient({ server, fetch: io.fetch, timeoutMs: io.timeoutMs });
  const computer = request.computer ?? io.computer.replace(CONTROL, "").slice(0, MAX_COMPUTER_LENGTH);
  const begun = await client.call("beginLogin", undefined, { scope: request.publisher ? "publisher" : "admin", computer });
  if (!begun.ok) return refused(problemOf(begun.failure));

  const page = pageOf(begun.value.verify_url, server);
  if (page === undefined) return refused(problem("unexpected_answer", "the address to open is not the install's"));

  announce(page, begun.value, request.json, io);
  if (request.browser) io.open(page);

  const collected = await collect(client, begun.value, io);
  if (io.terminal.progress) io.status("");

  if ("code" in collected) return refused(collected);

  const login = parseLogin({ server, token: collected.token });
  if (!login.ok) return refused(problem("unexpected_answer", "the token is not one"));

  await saveLogin(login.login, io.machine);

  return saved(server, collected.record, io);
}
