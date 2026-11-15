// Put the owner's test install back to the repository's sample sites and the demo: after every run of the live checks, and at midnight UTC.
//
//   a token for the reset -> every site but the demo removed for good -> the trash emptied -> the samples of demo/samples published
//     -> the demo built and published at the public name `demo` -> waiting logins and every token removed
//
// The demo's site is updated where it stands, so its address always answers. The logins, the settings, and the install itself stay.
// Every request is one site or one page of a listing, sent one after another, and an answer of "too many requests" is waited out as the CLI waits.
// The bucket writes and lists it asks for are counted, and a reset that would pass their ceiling stops red.
// The token is made in memory and never written to a file or a step output. Its row goes with every other token when the reset ends, however it ends.

import { mkdtempDisposableSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DELETED_SITE } from "@poplin/core/src/actions/delete";
import { LISTED_SITES } from "@poplin/core/src/actions/list";
import type * as v from "valibot";

import { type Client, createClient, type Failure, type Fetch } from "../../../cli/src/client/client";
import type { Io } from "../../../cli/src/commands/records";
import { run as runCli } from "../../../cli/src/commands/run";
import { callUnhurried } from "../../../cli/src/commands/upload";
import { buildDemo } from "../../../demo/scripts/build";
import { CEILINGS, meterBucket } from "./budget";
import { findDatabase, runSql, seedToken } from "./tokens";
import { findInstall, isStop, openRun, type Run, reportStop, type Stop } from "./util";

/** The folder that holds one folder per sample site. */
const SAMPLES = join(import.meta.dir, "..", "..", "..", "..", "demo", "samples");

/** The name and the public name of the site that holds the demo: its address is `demo-<public word>.<domain>`. */
const DEMO = "demo";

/** The most sites one page of a listing holds. */
const PAGE = 100;

/** Removes every login of a computer that waits: pending, or allowed and not collected yet. */
const FORGET_LOGINS = "DELETE FROM logins";

/** Removes every token, the reset's own among them. */
const FORGET_TOKENS = "DELETE FROM tokens";

/** What a scheduled reset says on an account that holds no test install. */
const NO_INSTALL = "There is no test install yet: nothing was put back.";

/** What a reset is made with: the install as a token holder reaches it, and its database. */
interface ResetEnds {
  /** The origin the install's API answers on. */
  readonly server: string;

  /** An admin's token of the install. */
  readonly token: string;

  /** What sends every request. */
  readonly fetch: Fetch;

  /** Waits so many milliseconds. */
  readonly pause: (ms: number) => Promise<void>;

  /** Runs one statement on the install's database, and answers why it did not run. */
  readonly sql: (statement: string) => Promise<Stop | undefined>;

  /** The folder that holds one folder per sample site. */
  readonly samples: string;

  /** Writes the demo's static files into a new folder. */
  readonly buildDemo: (out: string) => Promise<void>;

  /** The most bucket writes and lists the reset may ask the install for. */
  readonly ceiling: number;
}

/** What a reset did: the sites it removed outside the trash and inside it, the samples it published, whether the demo's site was made or updated, and the bucket writes and lists it asked for. */
interface Tally {
  readonly removed: number;
  readonly trashed: number;
  readonly published: readonly string[];
  readonly demo: "published" | "updated";
  readonly operations: number;
}

/** One page of a listing. */
type Sites = v.InferOutput<typeof LISTED_SITES>["sites"];

/** Why a call got no answer to use, in words that quote nothing the install said. */
function told(failure: Failure): string {
  if (failure.kind === "refused") return `refused with status ${failure.status} and code ${failure.code}`;

  return "status" in failure ? `${failure.kind} with status ${failure.status}` : failure.kind;
}

/** The ends the CLI runs with: the token in its environment, nothing printed, and no file of this machine read. */
function ioOf(ends: ResetEnds, scratch: string): Io {
  return {
    out: () => undefined,
    err: () => undefined,
    status: () => undefined,
    fetch: ends.fetch,
    machine: { env: { POPLIN_CONFIG_DIR: join(scratch, "config"), POPLIN_SERVER: ends.server, POPLIN_TOKEN: ends.token }, platform: process.platform, home: scratch },
    terminal: { asks: false, progress: false },
    ask: async () => "",
    computer: "live-reset",
    open: () => undefined,
    pause: async (ms) => {
      await ends.pause(ms);

      return "over";
    },
    stopped: new AbortController().signal,
  };
}

/** The first page of the sites outside the trash, or of the ones inside it. */
async function firstPage(client: Client, io: Io, trash: boolean): Promise<Sites | Stop> {
  const listed = await callUnhurried(io, () => client.call(LISTED_SITES, (api) => api.sites.$get({ query: { trash: String(trash), limit: String(PAGE) } })));
  if (!listed.ok) return { kind: "failed", what: `the install did not list its sites (${told(listed.failure)})` };

  return listed.value.sites;
}

/** Remove the sites of one listing for good, a page at a time: the first page is read anew until it holds nothing to remove. Outside the trash the demo's site stays. */
async function removeSites(client: Client, io: Io, trash: boolean): Promise<number | Stop> {
  let removed = 0;

  for (;;) {
    const sites = await firstPage(client, io, trash);
    if ("kind" in sites) return sites;

    const doomed = sites.filter((site) => trash || site.public_name !== DEMO);
    if (doomed.length === 0) return removed;

    for (const site of doomed) {
      const gone = await callUnhurried(io, () => client.call(DELETED_SITE, (api) => api.sites[":site"].$delete({ param: { site: site.id }, query: { forever: "true" } })));
      if (!gone.ok) return { kind: "failed", what: `the install did not remove a site (${told(gone.failure)})` };

      removed += 1;
    }
  }
}

/** Publish every sample through the CLI, each under its folder's name. */
async function publishSamples(samples: string, io: Io): Promise<readonly string[] | Stop> {
  const folders = readdirSync(samples, { withFileTypes: true }).filter((entry) => entry.isDirectory());
  const names = folders.map((entry) => entry.name).sort();

  for (const name of names) {
    const code = await runCli(["publish", join(samples, name), "--name", name, "--json"], io);
    if (code !== 0) return { kind: "failed", what: `publishing the sample ${name} exited ${code}` };
  }

  return names;
}

/** Build the demo and publish it onto the site that holds it, or as a new public site when no site does. */
async function publishDemo(ends: ResetEnds, client: Client, io: Io, scratch: string): Promise<Tally["demo"] | Stop> {
  const out = join(scratch, DEMO);
  const built = await ends.buildDemo(out).then(
    () => true,
    () => false,
  );
  if (!built) return { kind: "failed", what: "the demo did not build" };

  const sites = await firstPage(client, io, false);
  if ("kind" in sites) return sites;

  const held = sites.some((site) => site.public_name === DEMO);
  const target = held ? ["--site", DEMO] : ["--name", DEMO, "--public", "--public-name", DEMO];
  // A demo's site that ran out, or one made under a default expiry, would answer 404 at its address.
  const code = await runCli(["publish", out, ...target, "--expires", "never", "--json"], io);
  if (code !== 0) return { kind: "failed", what: `publishing the demo exited ${code}` };

  return held ? "updated" : "published";
}

/** Say what the install holds that a reset must not leave: a site that is neither a sample nor the demo, or one of them missing. */
async function checkSites(client: Client, io: Io, samples: readonly string[]): Promise<Stop | undefined> {
  const sites = await firstPage(client, io, false);
  if ("kind" in sites) return sites;

  const wanted = [...samples, DEMO].sort();
  const names = sites.map((site) => (site.public_name === DEMO ? DEMO : site.name)).sort();
  if (names.join("\n") === wanted.join("\n")) return undefined;

  return { kind: "failed", what: `the install holds ${names.length} sites after the reset, not the ${samples.length} samples and the demo alone` };
}

/** Every step that needs the token, in order. */
async function putBack(ends: ResetEnds, scratch: string): Promise<Omit<Tally, "operations"> | Stop> {
  const io = ioOf(ends, scratch);
  const client = createClient({ server: ends.server, token: ends.token, fetch: ends.fetch });

  const removed = await removeSites(client, io, false);
  if (typeof removed !== "number") return removed;

  const trashed = await removeSites(client, io, true);
  if (typeof trashed !== "number") return trashed;

  const published = await publishSamples(ends.samples, io);
  if ("kind" in published) return published;

  const demo = await publishDemo(ends, client, io, scratch);
  if (typeof demo !== "string") return demo;

  return (await checkSites(client, io, published)) ?? { removed, trashed, published, demo };
}

/** Remove the waiting logins, then every token. The tokens go whatever became of the logins. */
async function forget(ends: ResetEnds): Promise<Stop | undefined> {
  const logins = await ends.sql(FORGET_LOGINS);
  const tokens = await ends.sql(FORGET_TOKENS);

  return tokens ?? logins;
}

/**
 * Put an install back to the sample sites and the demo.
 *
 * @returns what was removed and published, or what stopped the reset, the ceiling before any other stop; the waiting logins and every token are removed either way
 */
export async function resetInstall(ends: ResetEnds): Promise<Tally | Stop> {
  using scratch = mkdtempDisposableSync(join(tmpdir(), "poplin-live-reset-"));
  const meter = meterBucket(ends.fetch, ends.ceiling);
  let ended: Tally | Stop = { kind: "failed", what: "the reset broke off" };

  try {
    const put = await putBack({ ...ends, fetch: meter.fetch }, scratch.path);
    ended = isStop(put) ? put : { ...put, operations: meter.spent() };
  } finally {
    const forgotten = await forget(ends);
    if (!isStop(ended) && forgotten !== undefined) ended = forgotten;
  }

  const stopped = meter.stopped();

  return stopped === undefined ? ended : { kind: "failed", what: `the reset ${stopped}` };
}

/** Reset the owner's test install with a token made for the reset; answers `undefined` for an account that holds no install. */
async function resetTestInstall(run: Run): Promise<Tally | Stop | undefined> {
  const found = await findInstall(run);
  if (isStop(found)) return found;

  const database = await findDatabase(run);
  if (typeof database !== "string") return database;

  const token = await seedToken(run, database, Date.now());
  if (typeof token !== "string") return token;

  return resetInstall({
    server: `https://${found.layout.adminHostname}`,
    token,
    fetch: (input, init) => fetch(input, init),
    pause: (ms) => Bun.sleep(ms),
    sql: (statement) => runSql(run, database, statement, []),
    samples: SAMPLES,
    buildDemo: async (out) => {
      await buildDemo({ out });
    },
    ceiling: CEILINGS.reset,
  });
}

/** Tell the log and the step summary what came of a reset, and answer the exit code: 0 for a reset that ran to its end, and for an account with no install. */
function tell(run: Run, ended: Tally | Stop | undefined): number {
  if (ended === undefined) {
    run.annotate("notice", NO_INSTALL);
    run.summarize(`### The reset\n\n${NO_INSTALL}\n`);

    return 0;
  }

  if (isStop(ended)) return reportStop(run, ended, "The test install could not be put back to the sample sites and the demo");

  const rows = [
    ["Sites removed for good", String(ended.removed)],
    ["Sites removed from the trash", String(ended.trashed)],
    ["Sample sites published", ended.published.join(", ")],
    ["The demo's site", ended.demo],
    ["Bucket writes and lists", `${ended.operations} of at most ${CEILINGS.reset}`],
    ["Waiting logins and tokens", "removed"],
  ];
  for (const [what, result] of rows) run.say(`${what}: ${result}`);

  run.say("The test install holds the sample sites and the demo alone.");
  run.summarize(["### The reset", "", "| Step | Result |", "| --- | --- |", ...rows.map(([what, result]) => `| ${what} | ${result} |`), ""].join("\n"));

  return 0;
}

/**
 * Reset the owner's test install, and tell the log and the step summary what came of it.
 *
 * @returns the exit code
 */
export async function runReset(run: Run): Promise<number> {
  return tell(run, await resetTestInstall(run));
}

if (import.meta.main) process.exitCode = await runReset(openRun());
