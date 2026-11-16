// A bench for the live checks: one install reached as a stranger, through the CLI, and through the MCP server, with every site the run made removed at the end.

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { createClient, type Fetch } from "../../../cli/src/client/client";
import type { Io } from "../../../cli/src/commands/records";
import { DELETED_SITE } from "../../../core/src/actions/delete";
import { LISTED_SITES } from "../../../core/src/actions/list";
import { SETTINGS_ANSWER } from "../../../core/src/actions/store-settings";
import { parseLogins } from "../../../core/src/auth/logins";
import { run } from "../../../cli/src/commands/run";
import { openSession } from "../../../cli/tests/mcp/support/session";
import type { JobRun } from "../scripts/live/job-run";
import type { LiveAddresses } from "./addresses";
import type { Bench, Draft, LiveSite, Missing, Ran, Shared } from "./records";

/** What every site name a live run makes starts with, whatever the run: the sweep removes each such site. */
const SWEPT_PREFIX = "live-";

/** How long a stranger's request may take: a hostname with no Worker behind it answers slowly or never. */
const VISIT_TIMEOUT_MS = 30_000;

/** The code of a request whose connection was closed before any answer came. */
const CONNECTION_RESET = "ECONNRESET";

/** Where the API answers: a request there that is no read may count against a minute's allowance, so it is never sent twice. */
const API = "/api/";

/** What a run says when it sends a stranger's request a second time. */
const SENT_AGAIN = "a stranger's request was cut off before any answer, and was sent once more";

/** The most sites one page of a listing holds. */
const PAGE = 100;

/** The settings the suite counts on: a short trash, and room for its own requests inside one visitor's minute. */
const SETTINGS = { trash_days: 1, visitor_requests_per_minute: 120 };

/** When every site of a run moves to the trash by itself, so a run that was killed leaves nothing for good. */
const EXPIRES = "1d";

/** The file a site the checks only read holds beside its page, in a folder of its own: a page's relative link to it stays inside the site only where the site's address ends in a slash. */
const BESIDE = { folder: "notes", file: "note.txt", text: "a file beside the page\n" } as const;

/** Where a listing goes on, as an address holds it: the `next` of the page before a key a part, and no key for the first page. */
type Cursor = Readonly<Partial<Record<"after_updated_at" | "after_id" | "after_name" | "after_access", string>>>;

/** What a bench is opened with. */
interface BenchParts {
  /** Every address of the install as a stranger types it. */
  readonly addresses: LiveAddresses;

  /** The token the CLI and the MCP server present; absent, every command answers that there is no login. */
  readonly token: string | undefined;

  /** What tells this run's sites from another's: lowercase letters, digits, and single dashes. */
  readonly run: string;

  /** What the install lacks, with the reason. */
  readonly missing: Missing;

  /** What sends every request. */
  readonly fetch: Fetch;

  /** Waits so many milliseconds. */
  readonly pause: (ms: number) => Promise<void>;

  /** The time a pause moves on, in milliseconds. */
  readonly now: () => number;

  /** Prints one line of what a check that passed met. */
  readonly say: (line: string) => void;

  /** How many files the folder of many small files holds. */
  readonly manyFiles: number;

  /** How many files a site holds that one request of a copy does not take. */
  readonly largeCopy: number;

  /** Reads how the job of one upload went, at the provider itself; absent on a run with no key of the provider. */
  readonly jobRun?: ((upload: string) => Promise<JobRun>) | undefined;

  /** A login the install is told to let in, beside the settings the suite counts on; absent, the logins stay as they are. */
  readonly login?: string | undefined;

  /** Reads the emails the login in front of the install lets in, at the provider itself; absent on a run with no key of the provider. */
  readonly loginList?: (() => Promise<readonly string[]>) | undefined;
}

/** A bench and the means to end it. */
interface OpenBench {
  /** What the checks run on. */
  readonly bench: Bench;

  /** Gives the install the settings the suite counts on. A bench with no token changes nothing. */
  readonly settle: () => Promise<void>;

  /** Removes every site a live run left on the install, for good. A bench with no token removes nothing. */
  readonly sweep: () => Promise<void>;

  /** Removes the scratch folder. */
  readonly close: () => void;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** The one JSON value a command printed on stdout. */
function printed(lines: readonly string[]): Record<string, unknown> {
  const value: unknown = lines.length === 1 ? JSON.parse(lines[0] ?? "") : undefined;
  if (!isRecord(value)) throw new Error(`a command printed ${lines.length} lines on stdout, not one JSON object`);

  return value;
}

/** Whether a request failed because its connection was closed before any answer: it says nothing of what the edge or the install would answer. */
function isReset(error: unknown): boolean {
  return error instanceof Error && "code" in error && error.code === CONNECTION_RESET;
}

/** Whether a stranger's request is safe to send twice: a read, or any method to an address outside the API, where an install takes reads alone and changes nothing. */
function isRepeatable(address: string, init: RequestInit): boolean {
  return (init.method ?? "GET") === "GET" || !new URL(address).pathname.startsWith(API);
}

/**
 * Open a bench on one install.
 *
 * @returns the bench, its sweep, and its close; nothing is sent until a check asks
 */
export function openBench(parts: BenchParts): OpenBench {
  const { admin } = parts.addresses;
  const scratch = mkdtempSync(join(tmpdir(), "poplin-live-"));
  const prefix = `${SWEPT_PREFIX}${parts.run}`;
  let made = 0;
  let asked = 0;
  const files = { install: 0, away: 0 };
  const counted: Fetch = (input, init) => {
    asked += 1;
    // The one thing a command sends by PUT is a file of an upload.
    if (init.method === "PUT") files[new URL(input).origin === admin ? "install" : "away"] += 1;

    return parts.fetch(input, init);
  };

  const io = (out: (line: string) => void): Io => ({
    out,
    err: () => undefined,
    status: () => undefined,
    fetch: counted,
    machine: {
      env: { POPLIN_CONFIG_DIR: join(scratch, "config"), POPLIN_SERVER: admin, POPLIN_TOKEN: parts.token },
      platform: process.platform,
      home: scratch,
    },
    terminal: { asks: false, progress: false },
    ask: async () => "",
    computer: "live-checks",
    open: () => undefined,
    // A command that waits between two asks waits as long here: an install that copies by itself would else be asked without a rest.
    pause: async (ms) => {
      await parts.pause(ms);

      return "over";
    },
    stopped: new AbortController().signal,
  });

  const cli = async (...words: readonly string[]): Promise<Ran> => {
    const lines: string[] = [];
    const code = await run(
      [...words, "--json"],
      io((line) => lines.push(line)),
    );

    return { code, value: printed(lines) };
  };

  const mcp = async (tool: string, input: Record<string, unknown>): Promise<Record<string, unknown>> => {
    const session = await openSession(io(() => undefined));

    try {
      const result = await session.client.callTool({ name: tool, arguments: input });
      if (result.isError === true || !isRecord(result.structuredContent)) throw new Error(`the MCP tool ${tool} answered an error`);

      return result.structuredContent;
    } finally {
      await session.close();
    }
  };

  const folder = (text: string): string => {
    made += 1;
    const path = join(scratch, `page-${made}`);
    mkdirSync(path);
    writeFileSync(join(path, "index.html"), text);

    return path;
  };

  const manyFiles = (): string => {
    const path = folder("<p>many files</p>");
    mkdirSync(join(path, "files"));
    for (let file = 1; file < parts.manyFiles; file += 1) writeFileSync(join(path, "files", `${file}.txt`), `file ${file}\n`);

    return path;
  };

  const publishFolder = async (path: string, access: Draft["access"]): Promise<LiveSite> => {
    const name = `${prefix}-${made}`;
    const ran = await cli("publish", path, "--name", name, `--${access}`, "--expires", EXPIRES);
    if (ran.code !== 0 || !isRecord(ran.value.site)) throw new Error(`publishing a ${access} site exited ${ran.code}`);

    return ran.value.site as unknown as LiveSite;
  };

  const publish = (draft: Draft): Promise<LiveSite> => publishFolder(folder(draft.text), draft.access);

  // Each publish and its removal writes some 35 rows to the install's database, so the checks that change nothing read one site between them.
  const read = new Map<Draft["access"], Shared>();
  const shared: Bench["shared"] = async (access) => {
    const held = read.get(access);
    if (held !== undefined) return held;

    const text = `<p>a ${access} page the checks read</p>`;
    const path = folder(text);
    mkdirSync(join(path, BESIDE.folder));
    writeFileSync(join(path, BESIDE.folder, BESIDE.file), BESIDE.text);
    const made = { site: await publishFolder(path, access), text, beside: { path: `${BESIDE.folder}/${BESIDE.file}`, text: BESIDE.text } };
    read.set(access, made);

    return made;
  };

  // A request that was cut off and is safe to repeat is sent again: once, and the second answer is the one a check reads.
  const visit: Bench["visit"] = async (address, init = {}) => {
    const send = (): Promise<Response> => parts.fetch(address, { redirect: "manual", signal: AbortSignal.timeout(VISIT_TIMEOUT_MS), ...init });

    try {
      return await send();
    } catch (error) {
      if (!isReset(error) || !isRepeatable(address, init)) throw error;

      parts.say(SENT_AGAIN);

      return send();
    }
  };

  const client = createClient({ server: admin, token: parts.token ?? "", fetch: parts.fetch });

  // Every site of a live run in one listing, read to its last page before any is removed.
  const liveSites = async (trash: boolean): Promise<string[]> => {
    const ids: string[] = [];
    let after: Cursor = {};

    for (;;) {
      const query = { trash: String(trash), limit: String(PAGE), ...after };
      const listed = await client.call(LISTED_SITES, (api) => api.sites.$get({ query }));
      if (!listed.ok) throw new Error(`the sweep could not list the sites: ${listed.failure.kind}`);

      ids.push(...listed.value.sites.filter((site) => site.name.startsWith(SWEPT_PREFIX)).map((site) => site.id));

      const { next } = listed.value;
      if (next === undefined) return ids;

      after = { after_updated_at: String(next.updated_at), after_id: next.id, after_name: next.name, after_access: next.access };
    }
  };

  const sweep = async (): Promise<void> => {
    if (parts.token === undefined) return;

    for (const id of [...(await liveSites(false)), ...(await liveSites(true))]) {
      const removed = await client.call(DELETED_SITE, (api) => api.sites[":site"].$delete({ param: { site: id }, query: { no_trash: "true" } }));
      if (!removed.ok) throw new Error(`the sweep could not remove a site: ${removed.failure.kind}`);

      if (removed.value.left.length > 0) throw new Error("the sweep removed a site and the install kept some of its files");
    }
  };

  const settle = async (): Promise<void> => {
    if (parts.token === undefined) return;

    const logins = parts.login === undefined ? undefined : parseLogins([parts.login]);
    if (logins?.ok === false) throw new Error("the login the suite was given is no email address");

    const settings = logins === undefined ? SETTINGS : { ...SETTINGS, logins: [...logins.value] };
    const changed = await client.call(SETTINGS_ANSWER, (api) => api.config.$patch({ query: {}, json: settings }));
    if (!changed.ok) throw new Error(`the install refused the suite's settings: ${changed.failure.kind}`);
  };

  return {
    bench: {
      addresses: parts.addresses,
      admin,
      prefix,
      missing: parts.missing,
      visit,
      loginList: parts.loginList ?? (async () => Promise.reject(new Error("the run holds no key to read the provider's login list with"))),
      cli,
      asked: () => asked,
      sentFiles: () => ({ ...files }),
      mcp,
      folder,
      manyFiles,
      largeCopy: parts.largeCopy,
      jobRun: parts.jobRun ?? (async () => Promise.reject(new Error("the run holds no key to read the provider's jobs with"))),
      publish,
      shared,
      scratchFile: (name) => join(scratch, name),
      pause: parts.pause,
      now: parts.now,
      say: parts.say,
    },
    settle,
    sweep,
    close: () => rmSync(scratch, { recursive: true, force: true }),
  };
}
