// Run one command line: read it, find who to talk to, run the command, print what it came to, and choose the exit code.

import { WHOAMI_ANSWER } from "../../../core/src/actions/access/manage-tokens";
import type { AddressLayout } from "../../../core/src/sites/address-layout";
import { type Client, createClient } from "../client/client";
import { currentLogin, TOKEN_VARIABLES } from "../local/current-login";
import { pasted, runnerOf } from "../local/invoked";
import { foldedText, PLAIN_LOOK } from "../local/screen";
import { isServer } from "../local/login";
import type { Host } from "../mcp/records";
import { type Pipes, serveOnPipes } from "../mcp/stdio";
import { VERSION } from "../poplin";
import { processEnds } from "../install/ends";
import { runInstall } from "../install/first/install";
import { runUninstall } from "../install/remove/uninstall";
import { runRepair } from "../install/repair/repair";
import type { InstallEnds } from "../install/records";
import type { CommandName } from "./command-table";
import { exitCode } from "./exit-codes";
import { fullHelp } from "./line/full-help";
import { runExport } from "../backup/export";
import { helpText } from "./line/help";
import { runImport } from "../backup/import";
import { runInstallCommand } from "./install/install-commands";
import { logIn } from "./install/login";
import { type ProviderCommand, parseCommand } from "./line/parse-command";
import { type Problem, problem, problemLines } from "./problems";
import { planPublish, previewPublish, sendPublish } from "./sites/publish";
import type { Io, Outcome, RequestOf, Session } from "./records";
import type { Request, TypedRequest } from "./line/requests";
import { runSiteCommand } from "./sites/site-commands";
import { showLine } from "./text";
import { runUpdate } from "./install/update";
import { guardedScreen, hide, written } from "./line/util";
import { readByInstall } from "./sites/wire";

/** How long each call may take that a stopped command gives its upload up with, in milliseconds: 4 seconds. */
export const AFTER_STOP_TIMEOUT_MS = 4000;

/** How a note starts that says what to run about the note before it: it is shown with no mark, as the hint under an error is. */
const LEAD = /^(?:Fix|See|Next): /;

/** The commands about the login and the install that this build runs. */
const INSTALL_COMMANDS = ["whoami", "logout", "config", "doctor"] as const;

/** What runs each command that works at a provider, from the words after it. */
const PROVIDER_RUNS: Readonly<Record<ProviderCommand, (words: readonly string[], io: Io, ends: InstallEnds) => Promise<number>>> = { install: runInstall, uninstall: runUninstall, repair: runRepair };

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

/** The same ends, with every token taken out of what a command shows: each line, what is being worked on, and each question. */
function guarded(io: Io, tokens: ReadonlySet<string>): Io {
  return { ...io, screen: guardedScreen(io.screen, tokens) };
}

/**
 * The tokens this machine holds: the ones the environment may hold, the login's and the account token `poplin install` takes, and the one of the saved login, whichever the command uses.
 *
 * A login that cannot be read gives no token here, and is refused where the command looks for it.
 */
async function knownTokens(io: Io): Promise<ReadonlySet<string>> {
  const tokens = new Set<string>();
  for (const variable of Object.values(TOKEN_VARIABLES)) {
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

/** Ask an install for its address layout, and keep the answer: a session asks once, whichever of its steps needs it first. */
function layoutAskedOnce(client: Client): Session["layout"] {
  let kept: AddressLayout | undefined;

  return async () => {
    if (kept !== undefined) return { ok: true, value: kept };

    const answered = await client.call(WHOAMI_ANSWER, (api) => api.whoami.$get());
    if (!answered.ok) return answered;

    kept = answered.value.layout;

    return { ok: true, value: kept };
  };
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

  if (current.state === "refused") return problem("bad_login", `${current.message}. ${current.fix}`);

  const { server, token } = current.login;

  if (request.server !== undefined && request.server !== server) return problem("wrong_server", request.server);

  const install = { server, token, fetch: io.fetch };
  const client = createClient({ ...install, timeoutMs: io.timeoutMs, stopped: io.stopped, told: (line) => io.screen.aside("note", line), pause: io.pause });
  const afterStop = createClient({ ...install, timeoutMs: Math.min(io.timeoutMs ?? AFTER_STOP_TIMEOUT_MS, AFTER_STOP_TIMEOUT_MS) });

  return { client, afterStop, io, server, layout: layoutAskedOnce(client), source: current.source };
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

  if (session === "logged-out" && request.kind === "logout") {
    const none = "Not logged in";

    return request.dryRun ? { ok: true, value: { dry_run: true, revoked: false }, lines: [none, "Dry run: no request was sent"] } : { ok: true, value: { revoked: false }, lines: [none] };
  }

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

/**
 * Print what a command came to: with `--json` one JSON value on stdout and nothing else there, and whatever is no result on stderr. No token is printed.
 *
 * @param io - the ends whose screen hides every token
 */
function print(outcome: Outcome, json: boolean, { out, screen }: Io, tokens: ReadonlySet<string>): number {
  if (!outcome.ok) {
    const { exit, ...error } = outcome.problem;
    const [sentence = "", ...hints] = problemLines(outcome.problem);
    screen.aside("error", sentence);
    for (const hint of hints) screen.aside("plain", hint);

    if (json) out(written({ error }, tokens));

    return exitCode({ kind: exit });
  }

  for (const note of outcome.notes ?? []) screen.aside(LEAD.test(note) ? "plain" : "note", note);

  if (json) {
    out(written(outcome.value, tokens));
  } else {
    for (const line of [...outcome.lines, ...(outcome.steps ?? [])]) showLine(screen, line);
  }

  return exitCode({ kind: outcome.found ?? "done" });
}

/** A copy of a value with every token taken out of its texts. Its keys stay as they are: the keys of a protocol message are the protocol's. */
function textsHidden<Value>(value: Value, tokens: ReadonlySet<string>): Value {
  return JSON.parse(JSON.stringify(value, (_key, item: unknown) => (typeof item === "string" ? hide(item, tokens) : item)));
}

/** What the MCP server works through: no terminal, no line on stdout, and the login read anew for every tool call. */
function mcpHost(io: Io): Host {
  const log = (line: string): void => io.screen.aside("plain", line);
  const quiet: Io = { ...io, out: log, screen: { ...io.screen, line: io.screen.aside }, terminal: { asks: false, progress: false } };

  return {
    session: async () => connect({}, guarded(quiet, await knownTokens(io))),
    stopped: io.stopped,
    withoutTokens: async (value) => textsHidden(value, await knownTokens(io)),
    log,
  };
}

/** Show a help text as its stream shows it: the one that was asked for on stdout, and the one an empty command line gets on stderr. The help of every command reads the providers first. */
async function showHelp(parsed: { readonly topic?: CommandName; readonly asked: boolean; readonly full?: true }, io: Io, ends: () => InstallEnds): Promise<void> {
  const looks = io.looks ?? { out: PLAIN_LOOK, err: PLAIN_LOOK };
  const look = parsed.asked ? looks.out : looks.err;
  const help = parsed.full === true ? fullHelp(await ends().providers(), look) : helpText(parsed.topic, look);
  const text = foldedText(pasted(help, runnerOf(io.machine.env)), look.width);

  if (parsed.asked) io.out(text);
  else io.screen.aside("laid", text);
}

/**
 * Run the words after `poplin`.
 *
 * @param io - the machine's ends: where to print, how to send, where the login is, and whether a person is there to ask
 * @param pipes - the two ends `poplin mcp` speaks its protocol on, which no other command touches; this process's stdin and stdout unless given
 * @param installEnds - what `poplin install`, `poplin uninstall`, and `poplin doctor --repair` reach beside `io`, made when one of them runs; this process's own unless given
 * @returns the exit code. Nothing throws: a failure nothing foresaw is printed as one line, without its stack
 */
export async function run(
  argv: readonly string[],
  io: Io,
  pipes: Pipes = { input: process.stdin, output: process.stdout },
  installEnds: (io: Io) => InstallEnds = processEnds,
): Promise<number> {
  const parsed = parseCommand(argv);

  if (parsed.kind === "provider") return PROVIDER_RUNS[parsed.command](parsed.words, io, installEnds(io));

  if (parsed.kind === "version") {
    io.out(VERSION);

    return exitCode(parsed);
  }

  if (parsed.kind === "help") {
    await showHelp(parsed, io, () => installEnds(io));

    return exitCode(parsed);
  }

  if (parsed.kind === "mcp") return serveOnPipes(mcpHost(io), pipes);

  const tokens = await knownTokens(io);

  if (parsed.kind === "usage-error") {
    const { kind, ...error } = parsed;
    const { screen } = guarded(io, tokens);
    screen.aside("error", parsed.message);
    if (parsed.hint !== undefined) screen.aside("plain", parsed.hint);

    if (asksJson(argv)) io.out(written({ error: { code: kind, ...error } }, tokens));

    return exitCode(parsed);
  }

  const json = "json" in parsed && parsed.json;

  const safe = guarded(io, tokens);

  try {
    return print(await execute(parsed, safe), json, safe, tokens);
  } catch (error) {
    const what = error instanceof Error ? `${error.name}: ${error.message}` : "unknown failure";

    return print(refused(problem("crashed", what)), json, safe, tokens);
  }
}
