// Run one command line: read it, find who to talk to, run the command, print what it came to, and choose the exit code.

import { createClient } from "../client/client";
import { currentLogin } from "../local/current-login";
import { isServer } from "../local/login";
import type { Host } from "../mcp/records";
import { type Pipes, serveOnPipes } from "../mcp/stdio";
import { VERSION } from "../poplin";
import { exitCode } from "./exit-codes";
import { runExport } from "./export";
import { helpText } from "./help";
import { runImport } from "./import";
import { runInstallCommand } from "./install-commands";
import { logIn } from "./login";
import { parseCommand } from "./parse-command";
import { type Problem, problem, problemLines } from "./problems";
import { planPublish, previewPublish, sendPublish } from "./publish";
import { runSetup } from "./setup";
import type { Io, Outcome, RequestOf, Session } from "./records";
import type { Request, TypedRequest } from "./requests";
import { runSiteCommand } from "./site-commands";
import { runUpdate } from "./update";
import { readByInstall } from "./wire";

/** How long each call may take that a stopped command gives its upload up with, in milliseconds: 4 seconds. */
export const AFTER_STOP_TIMEOUT_MS = 4000;

/** What stands where a token would have been printed. */
const HIDDEN = "[token]";

/** The commands about the login and the install that this build runs. */
const INSTALL_COMMANDS = ["whoami", "logout", "config", "doctor"] as const;

/** The commands about sites, but for `publish`. */
const SITE_COMMANDS = ["set", "show", "list", "rollback", "new-link", "duplicate", "delete", "restore"] as const;

/** A command that talks to an install. */
type OnlineRequest = RequestOf<"publish" | "export" | "import" | "update" | (typeof INSTALL_COMMANDS)[number] | (typeof SITE_COMMANDS)[number]>;

/** A command whose site, when it names one, is read. */
type Command = Exclude<Request, { readonly kind: "mcp" }>;

/** A command as it runs, or the address it names that only its install can read, with the way to put the site the address reads as in its place. */
type Split = { readonly request: Command } | { readonly address: Parameters<typeof readByInstall>[0]; readonly read: (site: RequestOf<"show">["site"]) => Command };

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

/** The same ends, with every token taken out of what a command writes while it runs: a line on stderr, the progress line, and a question. */
function guarded(io: Io, tokens: ReadonlySet<string>): Io {
  return { ...io, err: (line) => io.err(hide(line, tokens)), status: (text) => io.status(hide(text, tokens)), ask: (question) => io.ask(hide(question, tokens)) };
}

/**
 * The tokens this machine holds: the two the environment may hold, the login's and the one `poplin setup` sends, and the one of the saved login, whichever the command uses.
 *
 * A login that cannot be read gives no token here, and is refused where the command looks for it.
 */
async function knownTokens(io: Io): Promise<ReadonlySet<string>> {
  const tokens = new Set<string>();
  for (const variable of ["POPLIN_TOKEN", "POPLIN_SETUP_TOKEN"]) {
    const inEnvironment = io.machine.env[variable];
    if (inEnvironment !== undefined && inEnvironment !== "") tokens.add(inEnvironment);
  }

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
async function connect(request: { readonly server?: string }, io: Io): Promise<Session | Problem | "logged-out"> {
  if (request.server !== undefined && !isServer(request.server)) return problem("bad_server");

  const current = await currentLogin(io.machine);
  if (current.state === "logged-out") return "logged-out";

  if (current.state === "refused") return problem("bad_login", current.message);

  const { server, token } = current.login;

  if (request.server !== undefined && request.server !== server) return problem("wrong_server", request.server);

  const install = { server, token, fetch: io.fetch };
  const client = createClient({ ...install, timeoutMs: io.timeoutMs, stopped: io.stopped, told: io.err });
  const afterStop = createClient({ ...install, timeoutMs: Math.min(io.timeoutMs ?? AFTER_STOP_TIMEOUT_MS, AFTER_STOP_TIMEOUT_MS) });

  return { client, afterStop, io, server, source: current.source };
}

/** The site a command names, when it names one: its own, or the one a publish updates. */
function namedSite(request: OnlineRequest): RequestOf<"show">["site"] | undefined {
  if (request.kind === "publish") return request.target.kind === "update" ? request.target.site : undefined;

  return "site" in request ? request.site : undefined;
}

/**
 * Run a command against the install it talks to.
 *
 * @param reached - the session the install already read the command's site in: the command runs on it, and nothing is asked twice
 */
async function online(request: OnlineRequest, io: Io, run: (session: Session) => Promise<Outcome>, reached?: Session): Promise<Outcome> {
  if (reached !== undefined) return run(reached);

  const session = await connect(request, io);

  if (session === "logged-out" && request.kind === "logout") return { ok: true, value: { revoked: false }, lines: ["no login is saved on this machine"] };

  if (session === "logged-out") return refused(problem("no_login"));

  if ("code" in session) return refused(session);

  const site = namedSite(request);
  const read = site === undefined ? undefined : await readByInstall(site, session);
  if (read !== undefined && "code" in read) return refused(read);

  return run(session);
}

async function publish(request: RequestOf<"publish">, io: Io, reached?: Session): Promise<Outcome> {
  const planned = await planPublish(request, io.stopped);
  if (!planned.ok) return planned;

  if (request.dryRun) return previewPublish(planned.plan, reached !== undefined);

  return online(request, io, (session) => sendPublish(planned.plan, session), reached);
}

/** Tell the requests of some commands from the rest. */
function asks<Kind extends Request["kind"]>(request: Request, kinds: readonly Kind[]): request is RequestOf<Kind> {
  return kinds.some((kind) => kind === request.kind);
}

/**
 * Tell a command that can run as it was read from one whose site only its install can read.
 *
 * @returns the command, or the address it names with the way to put the site the address reads as in its place
 */
function split(request: Exclude<TypedRequest, { readonly kind: "mcp" }>): Split {
  if (request.kind === "publish") {
    const { target } = request;
    if (target.kind === "create") return { request: { ...request, target } };

    const { site } = target;
    if (site.kind !== "address") return { request: { ...request, target: { kind: "update", site } } };

    return { address: site, read: (read) => ({ ...request, target: { kind: "update", site: read } }) };
  }

  if (request.kind === "export" || request.kind === "import") {
    const { site, ...rest } = request;
    if (site === undefined) return { request: rest };

    return site.kind === "address" ? { address: site, read: (read) => ({ ...rest, site: read }) } : { request: { ...rest, site } };
  }

  if (!("site" in request)) return { request };

  const { site, ...rest } = request;
  if (site.kind !== "address") return { request: { ...rest, site } };

  return { address: site, read: (read) => ({ ...rest, site: read }) };
}

/**
 * Run a command whose site is read.
 *
 * @param reached - the session the install read the site's address in, when it was asked: the command goes on in it, and a dry run says that the install was asked
 */
async function dispatch(request: Command, io: Io, reached?: Session): Promise<Outcome> {
  if (asks(request, ["publish"])) return publish(request, io, reached);

  if (asks(request, ["login"])) return logIn(request, io);

  if (asks(request, ["setup"])) return runSetup(request, io);

  if (asks(request, INSTALL_COMMANDS)) return online(request, io, (session) => runInstallCommand(request, session));

  if (asks(request, SITE_COMMANDS)) return online(request, io, (session) => runSiteCommand(request, session), reached);

  if (asks(request, ["export"])) return online(request, io, (session) => runExport(request, session), reached);

  if (asks(request, ["update"])) return online(request, io, (session) => runUpdate(request, session));

  return runImport(request, (send) => online(request, io, send, reached), reached !== undefined);
}

/**
 * Run a command. One whose site only its install can read asks the install first, a dry run too: the address is read by no one else.
 */
async function execute(typed: Exclude<TypedRequest, { readonly kind: "mcp" }>, io: Io): Promise<Outcome> {
  const command = split(typed);
  if ("request" in command) return dispatch(command.request, io);

  const session = await connect(typed, io);
  if (session === "logged-out") return refused(problem("no_login"));

  if ("code" in session) return refused(session);

  const site = await readByInstall(command.address, session);
  if ("code" in site) return refused(site);

  return dispatch(command.read(site), io, session);
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

/** A copy of a value with every token taken out of its texts. Its keys stay as they are: the keys of a protocol message are the protocol's. */
function textsHidden<Value>(value: Value, tokens: ReadonlySet<string>): Value {
  return JSON.parse(JSON.stringify(value, (_key, item: unknown) => (typeof item === "string" ? hide(item, tokens) : item)));
}

/** What the MCP server works through: no terminal, no line on stdout, and the login read anew for every tool call. */
function mcpHost(io: Io): Host {
  const quiet: Io = { ...io, out: io.err, status: () => undefined, terminal: { asks: false, progress: false } };

  return {
    session: async () => connect({}, guarded(quiet, await knownTokens(io))),
    stopped: io.stopped,
    withoutTokens: async (value) => textsHidden(value, await knownTokens(io)),
    log: io.err,
  };
}

/**
 * Run the words after `poplin`.
 *
 * @param io - the machine's ends: where to print, how to send, where the login is, and whether a person is there to ask
 * @param pipes - the two ends `poplin mcp` speaks its protocol on, which no other command touches; this process's stdin and stdout unless given
 * @returns the exit code. Nothing throws: a failure nothing foresaw is printed as one line, without its stack
 */
export async function run(argv: readonly string[], io: Io, pipes: Pipes = { input: process.stdin, output: process.stdout }): Promise<number> {
  const parsed = parseCommand(argv);

  if (parsed.kind === "version") {
    io.out(VERSION);

    return exitCode(parsed);
  }

  if (parsed.kind === "help") {
    (parsed.asked ? io.out : io.err)(helpText(parsed.topic));

    return exitCode(parsed);
  }

  if (parsed.kind === "mcp") return serveOnPipes(mcpHost(io), pipes);

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
