// Run one command line: read it, find who to talk to, run the command, print what it came to, and choose the exit code.

import { createClient } from "../client/client";
import { currentLogin } from "../local/current-login";
import { parseLogin } from "../local/login";
import { VERSION } from "../poplin";
import { exitCode } from "./exit-codes";
import { helpText } from "./help";
import { runInstallCommand } from "./install-commands";
import { parseCommand } from "./parse-command";
import { type Problem, problem, problemLines } from "./problems";
import { planPublish, previewPublish, sendPublish } from "./publish";
import type { Io, Outcome, RequestOf, Session } from "./records";
import type { Request } from "./requests";
import { runSiteCommand } from "./site-commands";

/** What stands where a token would have been printed. */
const HIDDEN = "[token]";

/** A token that passes the form of one, to check `--server` with the rule a login is checked by. */
const ANY_TOKEN = "token";

/** The commands this build cannot do, each with what to do in its place when there is such a thing. */
const IN_ITS_PLACE: Readonly<Record<string, string>> = {
  login: "set POPLIN_SERVER to the install's address and POPLIN_TOKEN to a token from its dashboard",
};

/** The commands about the login and the install that this build runs. */
const INSTALL_COMMANDS = ["whoami", "logout", "config", "doctor"] as const;

/** The commands about sites, but for `publish`. */
const SITE_COMMANDS = ["set", "show", "list", "rollback", "new-link", "delete", "restore"] as const;

/** A command that talks to an install. */
type OnlineRequest = RequestOf<"publish" | (typeof INSTALL_COMMANDS)[number] | (typeof SITE_COMMANDS)[number]>;

function refused(said: Problem): Outcome {
  return { ok: false, problem: said };
}

/** Take every token out of a text: a token reaches the install and nothing else. */
function hide(text: string, tokens: ReadonlySet<string>): string {
  return [...tokens].reduce((safe, token) => safe.replaceAll(token, HIDDEN), text);
}

/** Write a value as JSON with every token taken out of its texts and its keys as they are written, so that what is written stays JSON however deep the value goes. */
function written(value: unknown, tokens: ReadonlySet<string>): string {
  return JSON.stringify(value, (_key, item: unknown) => {
    if (typeof item === "string") return hide(item, tokens);

    if (typeof item !== "object" || item === null || Array.isArray(item)) return item;

    return Object.fromEntries(Object.entries(item).map(([key, held]) => [hide(key, tokens), held]));
  });
}

/** The same ends, with every token taken out of the progress line and of a question. */
function guarded(io: Io, tokens: ReadonlySet<string>): Io {
  return { ...io, status: (text) => io.status(hide(text, tokens)), ask: (question) => io.ask(hide(question, tokens)) };
}

/**
 * The tokens this machine holds: the one in the environment and the one of the saved login, whichever the command uses.
 *
 * A login that cannot be read gives no token here, and is refused where the command looks for it.
 */
async function knownTokens(io: Io): Promise<ReadonlySet<string>> {
  const tokens = new Set<string>();
  const inEnvironment = io.machine.env.POPLIN_TOKEN;
  if (inEnvironment !== undefined && inEnvironment !== "") tokens.add(inEnvironment);

  const saved = await currentLogin({ ...io.machine, env: { ...io.machine.env, POPLIN_SERVER: undefined, POPLIN_TOKEN: undefined } }).catch(() => undefined);
  if (saved?.state === "logged-in") tokens.add(saved.login.token);

  return tokens;
}

/** Whether a command line asks for JSON, read from the words alone: a line the parser refused has no request to ask. */
function asksJson(argv: readonly string[]): boolean {
  const end = argv.indexOf("--");

  return argv.slice(0, end === -1 ? argv.length : end).includes("--json");
}

/**
 * Find the install a command talks to and the token it presents.
 *
 * `--server` picks the install, and must be the one the login is for: a token is sent to no other address.
 */
async function connect(request: OnlineRequest, io: Io): Promise<Session | Problem | "logged-out"> {
  if (request.server !== undefined && !parseLogin({ server: request.server, token: ANY_TOKEN }).ok) return problem("bad_server");

  const current = await currentLogin(io.machine);
  if (current.state === "logged-out") return "logged-out";

  if (current.state === "refused") return problem("bad_login", current.message);

  const { server, token } = current.login;

  if (request.server !== undefined && request.server !== server) return problem("wrong_server", request.server);

  return { client: createClient({ server, token, fetch: io.fetch, timeoutMs: io.timeoutMs }), io, server, source: current.source };
}

async function online(request: OnlineRequest, io: Io, run: (session: Session) => Promise<Outcome>): Promise<Outcome> {
  const session = await connect(request, io);

  if (session === "logged-out" && request.kind === "logout") return { ok: true, value: { revoked: false }, lines: ["no login is saved on this machine"] };

  if (session === "logged-out") return refused(problem("no_login"));

  if ("code" in session) return refused(session);

  return run(session);
}

async function publish(request: RequestOf<"publish">, io: Io): Promise<Outcome> {
  const planned = await planPublish(request);
  if (!planned.ok) return planned;

  if (request.dryRun) return previewPublish(planned.plan);

  return online(request, io, (session) => sendPublish(planned.plan, session));
}

/** Tell the requests of some commands from the rest. */
function asks<Kind extends Request["kind"]>(request: Request, kinds: readonly Kind[]): request is RequestOf<Kind> {
  return kinds.some((kind) => kind === request.kind);
}

async function execute(request: Request, io: Io): Promise<Outcome> {
  if (asks(request, ["publish"])) return publish(request, io);

  if (asks(request, INSTALL_COMMANDS)) return online(request, io, (session) => runInstallCommand(request, session));

  if (asks(request, SITE_COMMANDS)) return online(request, io, (session) => runSiteCommand(request, session));

  return refused(problem("not_available", `poplin ${request.kind}`, IN_ITS_PLACE[request.kind]));
}

/** Print what a command came to: with `--json` one JSON value on stdout and nothing else there, and whatever is no result on stderr. No token is printed. */
function print(outcome: Outcome, json: boolean, io: Io, tokens: ReadonlySet<string>): number {
  if (!outcome.ok) {
    const { exit, ...error } = outcome.problem;
    for (const line of problemLines(outcome.problem)) io.err(hide(line, tokens));

    if (json) io.out(written({ error }, tokens));

    return exitCode({ kind: exit });
  }

  for (const note of outcome.notes ?? []) io.err(hide(note, tokens));

  if (json) {
    io.out(written(outcome.value, tokens));
  } else {
    for (const line of outcome.lines) io.out(hide(line, tokens));
  }

  return exitCode({ kind: outcome.found ?? "done" });
}

/**
 * Run the words after `poplin`.
 *
 * @param io - the machine's ends: where to print, how to send, where the login is, and whether a person is there to ask
 * @returns the exit code. Nothing throws: a failure nothing foresaw is printed as one line, without its stack
 */
export async function run(argv: readonly string[], io: Io): Promise<number> {
  const parsed = parseCommand(argv);

  if (parsed.kind === "version") {
    io.out(VERSION);

    return exitCode(parsed);
  }

  if (parsed.kind === "help") {
    (parsed.asked ? io.out : io.err)(helpText(parsed.topic));

    return exitCode(parsed);
  }

  const tokens = await knownTokens(io);

  if (parsed.kind === "usage-error") {
    const { kind, ...error } = parsed;
    io.err(hide(parsed.message, tokens));
    if (parsed.hint !== undefined) io.err(hide(parsed.hint, tokens));

    if (asksJson(argv)) io.out(written({ error: { code: kind, ...error } }, tokens));

    return exitCode(parsed);
  }

  const json = "json" in parsed && parsed.json;

  try {
    return print(await execute(parsed, guarded(io, tokens)), json, io, tokens);
  } catch (error) {
    const what = error instanceof Error ? `${error.name}: ${error.message}` : "an unknown failure";

    return print(refused(problem("crashed", what)), json, io, tokens);
  }
}
