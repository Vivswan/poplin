// The live upgrade: an install the older build made and filled takes this commit's build as an update, and is asked again for everything it held.
//
//   a test account alone -> the older build's own `poplin uninstall` and `poplin install` -> its database is one this commit takes over
//   -> the older build's command line fills it, with a token of its making -> every answer written down
//   -> the older build's own start of an update, fed this commit's build as a release -> the install says this commit's version, twelve answers in a row
//   -> one line a check -> the settings put back, and the sites, the token's row, and the older build's folder removed
//
// The start runs in this process, with the run's token where the kept key stands: a deployed Worker reads releases from the project's website alone, which names no build of a commit.
// Every request to the install passes the meters of bucket writes and of rows. No line names an address, a site, a login, or the value of a setting.
// Argument: the folder older-build.ts put the older build in.

import { rmSync } from "node:fs";
import { parseLogin } from "@poplin/core/src/auth/logins";
import * as v from "valibot";

import type { Fetch } from "../../../../cli/src/client/client";
import { type LiveInstall, liveAddresses } from "../../live/addresses";
import { openBench } from "../../live/bench";
import { CEILINGS, meterBucket } from "../live/budget";
import { command, type Ends, type Published, placeWords, publish, reachOf, readBuilt } from "../live/commands";
import { meterRows, ROW_CEILINGS } from "../live/rows";
import { sendLive } from "../live/send";
import { holdsOwnSchema, readStanding } from "../live/shape";
import { refuseOtherAccount } from "../live/test-account";
import { findDatabase, removeTokens } from "../live/tokens";
import { type Found, findInstall, isStop, liveLogin, openRun, type Run, reportStop, type Stop } from "../live/util";
import { type Older, openOlder } from "./older";
import { type Desk, fill, logFaults, putBack, type Reading, readInstall, settingFaults, settingsOf, siteFaults } from "./record";

/** The login an install with no login of a person starts with: nobody can log in as it. */
const NOBODY = "owner@example.com";

/** What the install says of its version and of the version it can go back to, as far as an upgrade reads it: the older build's answer and this commit's both hold it. */
const STATE = v.object({ version: v.string(), back: v.nullable(v.object({ to: v.string() })) });

/** What the wait for this commit's build must show: how many answers in a row that name its version, over how long at least, in milliseconds. */
const ROW_NEEDED = { answers: 12, overMs: 30_000 } as const;

/** How often the install is asked, how long one answer may take, and how long after the wait began the last request may start, in milliseconds. */
const PACE = { everyMs: 3_000, answerMs: 5_000, withinMs: 180_000 } as const;

/** What a dry run of a repair says of a piece it would not touch: one that is as it should be, and one the install works without. */
const UNTOUCHED: ReadonlySet<string> = new Set(["leave", "leave-out"]);

/** How often a repair is asked what it would change, and the pause between two askings, in milliseconds: the login list follows the settings that were put back within seconds, by the install's own key. */
const REPAIR_ASKS = { times: 4, everyMs: 10_000 } as const;

/** What an upgrade is made with, beside the account. */
export interface Upgrade {
  /** The variables the kind of install and the login are read from. */
  readonly env: Readonly<Record<string, string | undefined>>;

  /** The older build. */
  readonly older: Older;

  /** This commit's build as a release the project published. */
  readonly release: Published;

  /** What this commit's commands and the older build's update reach the world through, and rest by. */
  readonly ends: Ends;

  /** What sends a request to the install. */
  readonly fetch: Fetch;
}

/** One line of the upgrade: what was checked, and what is wrong with it. */
interface Checked {
  readonly check: string;
  readonly holds: string;
  readonly faults: readonly string[];
}

/** The install between its filling and its last check: what is asked of it, and with what. */
interface Standing {
  /** Where the install answers, by its kind. */
  readonly found: Found;

  /** The database the install is bound to. */
  readonly database: string;

  /** An admin's token, of the older build's making. */
  readonly token: string;

  /** The origin the install's API answers on. */
  readonly server: string;

  /** Whether the older build's database held every schema step of this commit, so the update changes no table. */
  readonly sameSchema: boolean;
}

/** Where an install answers, as the live checks name it. */
function installOf(found: Found): LiveInstall {
  return found.kind === "domain" ? { kind: "domain", domain: found.layout.domain } : { kind: "account address", account: found.layout.account };
}

/** Ask the install which version it runs and which it can go back to; `undefined` for no answer that can be read. */
async function stateOf(fetch: Fetch, standing: Pick<Standing, "server" | "token">): Promise<v.InferOutput<typeof STATE> | undefined> {
  const init = { headers: { Authorization: `Bearer ${standing.token}` }, redirect: "manual", keepalive: false, signal: AbortSignal.timeout(PACE.answerMs) } as const;
  const answer = await fetch(`${standing.server}/api/update`, init).catch(() => undefined);
  const state = v.safeParse(STATE, await answer?.json().catch(() => undefined));

  return answer?.status === 200 && state.success ? state.output : undefined;
}

/**
 * Wait until the install says a version twelve times in a row, so that no check after it meets an instance of the build before.
 *
 * @returns what stopped the wait, or `undefined` once the row is full
 */
export async function awaitVersion(wanted: string, asking: () => Promise<string | undefined>, ends: Ends): Promise<Stop | undefined> {
  const began = ends.reach.now();
  let row = { answers: 0, since: began };
  let last: string | undefined;

  for (let next = began; next - began <= PACE.withinMs; next = ends.reach.now() + PACE.everyMs) {
    if (next > began) await ends.sleep(PACE.everyMs);

    last = await asking();
    const at = ends.reach.now();
    row = last === wanted ? { answers: row.answers + 1, since: row.answers === 0 ? at : row.since } : { answers: 0, since: at };

    if (row.answers >= ROW_NEEDED.answers && at - row.since >= ROW_NEEDED.overMs) return undefined;
  }

  return { kind: "failed", what: `the install did not say the version ${wanted} ${ROW_NEEDED.answers} times in a row within ${PACE.withinMs / 1000} seconds (it last said ${last ?? "nothing"})` };
}

/** Have the older build make the test install from nothing, and find the database and a token of that build's making. */
async function makeOlder(run: Run, given: Upgrade): Promise<Standing | Stop> {
  const found = await findInstall(run, given.env);
  if (isStop(found)) return found;

  const refused = await refuseOtherAccount(run, found.zone);
  if (refused !== undefined) return refused;

  const code = await given.older.install();
  if (code !== 0) return { kind: "failed", what: `the older build's own install ended with exit code ${code}` };

  const made = await readStanding(run);
  if (isStop(made)) return made;

  if (made.drift !== undefined) return { kind: "failed", what: `this commit does not take over what the older build made: ${made.drift}` };

  const database = await findDatabase(run);
  if (typeof database !== "string") return database ?? { kind: "failed", what: "the account holds no database of the install the older build made" };

  const token = await given.older.seedToken(run, database, Date.now());
  if (typeof token !== "string") return token;

  run.say(`Older install: made by the older build's own poplin install, which says the version ${given.older.version}`);

  return { found, database, token, server: `https://${found.adminHost}`, sameSchema: made.current };
}

/** Start the update with the older build's own code, and wait until the install says this commit's version on a database at this commit's schema. */
async function takeUpdate(run: Run, given: Upgrade, standing: Standing, fetch: Fetch): Promise<Stop | undefined> {
  const holder = parseLogin(liveLogin(run, given.env) ?? NOBODY);
  if (!holder.ok) return { kind: "failed", what: "the login of the run is no email address" };

  const running = (await stateOf(fetch, standing))?.version;
  if (running === undefined) return { kind: "failed", what: "the older install did not say which version it runs" };

  const { reach } = given.ends;
  const took = await given.older.take({ run, databaseId: standing.database, holder: holder.value, running, feed: (url, init) => reach.fetch(url, init), now: reach.now });
  if (!took.ok) return { kind: "failed", what: `the older build did not take this commit's build (${took.code}${took.about === undefined ? "" : `, ${took.about}`})` };

  run.say(`Update: the older build took ${took.to} over ${took.from}, by its own start of an update`);
  const arrived = await awaitVersion(given.release.version, async () => (await stateOf(fetch, standing))?.version, given.ends);
  if (arrived !== undefined) return arrived;

  const holds = await holdsOwnSchema(run, standing.database);
  if (holds === true) return undefined;

  return holds === false ? { kind: "failed", what: "the install says this commit's version, and its database does not hold this commit's schema" } : holds;
}

/** Ask what a repair would change, and answer the pieces it would touch, each with what it would do. */
async function wouldRepair(run: Run, given: Upgrade, found: Found): Promise<string[]> {
  const dry = await command(run, "repair", ["--repair", "--dry-run", ...placeWords(run, found), "--yes", "--json"], given.ends);
  if (dry.kind !== "rows") return [dry.kind === "stopped" ? `it stopped (${dry.problem})` : `it printed no value a run can read (exit ${dry.code})`];

  return dry.rows.filter((row) => !UNTOUCHED.has(row.state)).map((row) => `${row.object}: ${row.state}`);
}

/** Ask a repair what it would change until it would change nothing, a few times at most, and answer what the last asking named. */
async function repairFaults(run: Run, given: Upgrade, found: Found): Promise<string[]> {
  for (let asked = 1; ; asked += 1) {
    const faults = await wouldRepair(run, given, found);
    if (faults.length === 0 || asked === REPAIR_ASKS.times) return faults;

    await given.ends.sleep(REPAIR_ASKS.everyMs);
  }
}

/** What is wrong with the way back the install offers. */
function backFaults(state: v.InferOutput<typeof STATE> | undefined, wanted: string | undefined): string[] {
  if (state === undefined) return ["the install did not say which version it can go back to"];

  const to = state.back?.to;

  return to === wanted ? [] : [`the install offers ${to ?? "no version"}, where ${wanted ?? "none"} is the way back`];
}

/** Every check of the install under this commit's build, against what was written down under the older one. */
async function checksOf(run: Run, given: Upgrade, standing: Standing, read: { readonly before: Reading; readonly after: Reading; readonly fetch: Fetch }): Promise<Checked[]> {
  const { before, after } = read;
  const [from, to] = [given.older.version, given.release.version];
  const state = await stateOf(read.fetch, standing);
  const wanted = standing.sameSchema ? from : undefined;
  const offered = standing.sameSchema ? `offered, to ${from}` : "not offered: the update changed the database, which the version before cannot read";

  return [
    { check: "Version", holds: `runs ${to}, and ran ${from}`, faults: [] },
    { check: "Sites", holds: `${before.sites.length} are shown, answered to a stranger, and stored in every version as before the update, byte for byte`, faults: siteFaults(before, after) },
    { check: "Token", holds: "the one made before the update read every site, the settings, and the log", faults: [] },
    { check: "Settings", holds: `${Object.keys(before.settings).length} as before the update, the changed one and the added user among them`, faults: settingFaults(before, after) },
    { check: "Activity", holds: `the ${before.log.length} entries from before the update, and the entry of the update`, faults: logFaults(before, after, { from, to }) },
    { check: "Database", holds: "every schema step of this commit, as this commit applies them", faults: [] },
    { check: "Doctor", holds: "a repair would change nothing, once the two settings were put back", faults: await repairFaults(run, given, standing.found) },
    { check: "Going back", holds: offered, faults: backFaults(state, wanted) },
  ];
}

/** A bench whose scratch folder is removed when it leaves its scope. */
function closing<Opened extends { readonly close: () => void }>(opened: Opened): Opened & Disposable {
  return { ...opened, [Symbol.dispose]: opened.close };
}

/**
 * Fill the older install, update it, and check it; the benches are closed, the settings put back, and the sites removed whatever came of it.
 *
 * @param left - told what of the upgrade's own could not be taken off the install again
 */
async function fillAndCheck(run: Run, given: Upgrade, standing: Standing, fetch: Fetch, left: string[]): Promise<Checked[] | Stop> {
  const parts = { token: standing.token, run: run.id, missing: {}, fetch, pause: given.ends.sleep, now: given.ends.reach.now, say: run.say, manyFiles: 0, largeCopy: 0 };
  using older = closing(given.older.openBench({ ...parts, addresses: given.older.liveAddresses(installOf(standing.found)) }));
  using own = closing(openBench({ ...parts, addresses: liveAddresses(installOf(standing.found)) }));
  let changed: Awaited<ReturnType<typeof settingsOf>> | undefined;

  try {
    const desk: Desk = older.bench;
    changed = await settingsOf(desk);
    const sites = await fill(desk, changed);
    const before = await readInstall(desk, standing.token, sites);
    run.say(`Older install: filled with ${sites.length} sites, a second version, a setting, and a user`);

    const stopped = await takeUpdate(run, given, standing, fetch);
    if (stopped !== undefined) return stopped;

    const after = await readInstall(own.bench, standing.token, sites);
    await putBack(own.bench, changed);
    changed = undefined;

    return await checksOf(run, given, standing, { before, after, fetch });
  } finally {
    if (changed !== undefined) await putBack(own.bench, changed).catch(() => void left.push("the two settings were not put back"));

    await own.sweep().catch(() => void left.push("the sites were not removed"));
  }
}

/** Every step in order: the checks, or what stopped the run before them. What the upgrade could not take off the install again fails a check of its own. */
async function upgrade(run: Run, given: Upgrade): Promise<Checked[] | Stop> {
  const standing = await makeOlder(run, given);
  if (isStop(standing)) return standing;

  const bucket = meterBucket(given.fetch, CEILINGS.upgrade);
  const rows = meterRows(bucket.fetch, ROW_CEILINGS.upgrade);
  const left: string[] = [];
  const checked = await fillAndCheck(run, given, standing, rows.fetch, left).catch((error: unknown): Stop => ({ kind: "failed", what: error instanceof Error ? error.message : "a step threw" }));
  if ((await removeTokens(run, standing.database, Date.now())) !== undefined) left.push("the row of the token was not removed");

  run.say(`Bucket writes and lists the upgrade asked for: ${bucket.spent()} of at most ${CEILINGS.upgrade}`);
  run.say(`Rows written this run: ${rows.written()} of at most ${ROW_CEILINGS.upgrade}`);
  const held = bucket.stopped() ?? rows.stopped();
  if (held !== undefined) return { kind: "failed", what: `the upgrade ${held}` };

  if (!isStop(checked)) return [...checked, { check: "Cleanup", holds: "the two settings put back, the sites and the token's row removed", faults: left }];

  if (left.length > 0) run.annotate("warning", `The upgrade left its own on the install: ${left.join("; ")}.`);

  return checked;
}

/**
 * Upgrade an install of the older build to this commit's, and tell the log and the step summary what each check came to.
 *
 * @returns the exit code: 0 only once every check holds
 */
export async function upgradeInstall(run: Run, given: Upgrade): Promise<number> {
  const checked = await upgrade(run, given);
  if (isStop(checked)) return reportStop(run, checked, "The upgrade could not be checked");

  for (const { check, holds, faults } of checked) run.say(faults.length === 0 ? `${check}: ${holds}` : `${check}: FAILED: ${faults.join("; ")}`);

  const rows = checked.map(({ check, holds, faults }) => `| ${check} | ${faults.length === 0 ? holds : `**failed**: ${faults.join("; ")}`} |`);
  run.summarize(["### The upgrade", "", "| Check | Result |", "| --- | --- |", ...rows, ""].join("\n"));
  const failed = checked.filter(({ faults }) => faults.length > 0).map(({ check }) => check);
  if (failed.length === 0) return 0;

  run.annotate("error", `The upgrade left the install changed: ${failed.join(", ")}.`);

  return 1;
}

if (import.meta.main) {
  const [folder] = process.argv.slice(2);
  if (folder === undefined) throw new Error("name the folder the older build is in");

  try {
    const release = await publish(await readBuilt());
    const older = await openOlder(folder, process.env);
    process.exitCode = await upgradeInstall(openRun(), { env: process.env, older, release, ends: { reach: reachOf(release, fetch), sleep: Bun.sleep }, fetch: sendLive });
  } finally {
    rmSync(folder, { recursive: true, force: true });
  }
}
