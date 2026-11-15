// A bench for the live checks: one install reached as a stranger, through the CLI, and through the MCP server, with every site the run made removed at the end.

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { createClient, type Fetch } from "../../packages/cli/src/client/client";
import type { Io } from "../../packages/cli/src/commands/records";
import type { ROUTES } from "../../packages/core/src/api/routes";
import { parseLogins } from "../../packages/core/src/auth/logins";
import { run } from "../../packages/cli/src/commands/run";
import { openSession } from "../../packages/cli/tests/mcp/support/session";
import type { Bench, Draft, LiveSite, Missing, Ran } from "./records";

/** What every site name a live run makes starts with, whatever the run: the sweep removes each such site. */
const SWEPT_PREFIX = "live-";

/** How long a stranger's request may take: a hostname with no Worker behind it answers slowly or never. */
const VISIT_TIMEOUT_MS = 30_000;

/** The most sites one page of a listing holds. */
const PAGE = 100;

/** The settings the suite counts on: a short trash, and room for its own requests inside one visitor's minute. */
const SETTINGS = { trash_days: 1, visitor_requests_per_minute: 120 };

/** When every site of a run moves to the trash by itself, so a run that was killed leaves nothing for good. */
const EXPIRES = "1d";

/** Where a listing goes on: the `next` of the page before, absent for the first page. */
type Cursor = NonNullable<(typeof ROUTES)["listSites"]["types"]>["done"]["next"];

/** What a bench is opened with. */
interface BenchParts {
  /** The domain every hostname of the install sits under. */
  readonly domain: string;

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

  /** How many files the folder of many small files holds. */
  readonly manyFiles: number;

  /** A login the install is told to let in, beside the settings the suite counts on; absent, the logins stay as they are. */
  readonly login?: string | undefined;
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

/**
 * Open a bench on one install.
 *
 * @returns the bench, its sweep, and its close; nothing is sent until a check asks
 */
export function openBench(parts: BenchParts): OpenBench {
  const admin = `https://poplin.${parts.domain}`;
  const scratch = mkdtempSync(join(tmpdir(), "poplin-live-"));
  const prefix = `${SWEPT_PREFIX}${parts.run}`;
  let made = 0;

  const io = (out: (line: string) => void): Io => ({
    out,
    err: () => undefined,
    status: () => undefined,
    fetch: parts.fetch,
    machine: {
      env: { POPLIN_CONFIG_DIR: join(scratch, "config"), POPLIN_SERVER: admin, POPLIN_TOKEN: parts.token },
      platform: process.platform,
      home: scratch,
    },
    terminal: { asks: false, progress: false },
    ask: async () => "",
    computer: "live-checks",
    open: () => undefined,
    pause: async () => "over",
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

  const publish = async (draft: Draft): Promise<LiveSite> => {
    const name = `${prefix}-${made + 1}`;
    const ran = await cli("publish", folder(draft.text), "--name", name, `--${draft.access}`, "--expires", EXPIRES);
    if (ran.code !== 0 || !isRecord(ran.value.site)) throw new Error(`publishing a ${draft.access} site exited ${ran.code}`);

    return ran.value.site as unknown as LiveSite;
  };

  const client = createClient({ server: admin, token: parts.token ?? "", fetch: parts.fetch });

  // Every site of a live run in one listing, read to its last page before any is removed.
  const liveSites = async (trash: boolean): Promise<string[]> => {
    const ids: string[] = [];
    let after: Cursor;

    do {
      const listed = await client.call("listSites", { trash, limit: PAGE, after });
      if (!listed.ok) throw new Error(`the sweep could not list the sites: ${listed.failure.kind}`);

      ids.push(...listed.value.sites.filter((site) => site.name.startsWith(SWEPT_PREFIX)).map((site) => site.id));
      after = listed.value.next;
    } while (after !== undefined);

    return ids;
  };

  const sweep = async (): Promise<void> => {
    if (parts.token === undefined) return;

    for (const id of [...(await liveSites(false)), ...(await liveSites(true))]) {
      const removed = await client.call("deleteSite", { site: id, forever: true });
      if (!removed.ok) throw new Error(`the sweep could not remove a site: ${removed.failure.kind}`);

      if (removed.value.left.length > 0) throw new Error("the sweep removed a site and the install kept some of its files");
    }
  };

  const settle = async (): Promise<void> => {
    if (parts.token === undefined) return;

    const logins = parts.login === undefined ? undefined : parseLogins([parts.login]);
    if (logins?.ok === false) throw new Error("the login the suite was given is no email address");

    const changed = await client.call("changeConfig", undefined, logins === undefined ? SETTINGS : { ...SETTINGS, logins: [...logins.value] });
    if (!changed.ok) throw new Error(`the install refused the suite's settings: ${changed.failure.kind}`);
  };

  return {
    bench: {
      domain: parts.domain,
      admin,
      prefix,
      missing: parts.missing,
      visit: (address, init = {}) => parts.fetch(address, { redirect: "manual", signal: AbortSignal.timeout(VISIT_TIMEOUT_MS), ...init }),
      cli,
      mcp,
      folder,
      manyFiles,
      publish,
      scratchFile: (name) => join(scratch, name),
      pause: parts.pause,
    },
    settle,
    sweep,
    close: () => rmSync(scratch, { recursive: true, force: true }),
  };
}
