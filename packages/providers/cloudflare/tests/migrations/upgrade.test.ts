// The live upgrade runs against a fake Cloudflare account in memory: this commit's own code stands where the older build's does, and the real API answers from a database the product's own install made.
// The Worker that starts after the update is core's own runner, given the product's steps and the later step: it applies that step to the filled database, through the provider's driver.
// Without it the steps of an upgrade, their order, and what each check reads are first run on a test account, where a mistake costs a day's rows.

import { describe, expect, test } from "bun:test";
import { startUpdate } from "@poplin/core/src/actions/start-update";
import { SqlDatabase } from "@poplin/core/src/database/sql-database";

import type { Fetch } from "../../../../cli/src/client/client";
import { LEDGER_TABLE, migrate, type Step } from "../../../../core/src/migrations/migrate";
import { STEPS } from "../../../../core/src/migrations/registry";
import { liveAddresses } from "../../live/addresses";
import { openBench } from "../../live/bench";
import { convergeInstall } from "../../scripts/live/converge";
import { findDatabase, seedToken } from "../../scripts/live/tokens";
import type { Found } from "../../scripts/live/util";
import { LATER_NAMES, laterStep } from "../../migrations/later-step";
import { type Older, takeWith } from "../../migrations/older";
import { awaitVersion, upgradeInstall } from "../../migrations/upgrade";
import { apiDriver } from "../../src/shared/database/api-driver";
import { INSTALL_OBJECTS } from "../../src/shared/install/install-objects";
import { createSelfUpdate } from "../../src/shared/release/update/self-update";
import { COMMIT, freshAccount, type harnessOf as HarnessOf, harnessOf } from "../live/support/harness-world";
import { catchStep } from "../live/support/step";
import { ACCOUNT } from "../shared/install/support/fake-install";

/** The version the older build says: below the one a test publishes as this commit's. */
const OLDER = "0.3.0";

/** Every step of the build a test publishes as this commit's: the product's, then the later step. */
const BUILD: readonly Step[] = [...STEPS, laterStep(OLDER)];

/** The later step, as a line writes it: the older build's version, then its name. */
const LATER = `${OLDER}/upgrade-proof`;

/** The id of the login method of the account's own members, as the fake account comes with it. */
const OWN_METHOD = "method-cloudflare";

/** The pause between two askings of a repair while the install's own repair is waited for, in milliseconds. */
const LONG_WAIT_MS = 30_000;

/** What a run says before it waits for the install's own repair of the guarded application. */
const WAITING = "Doctor: waiting for the install's own repair after the update, up to 18 min (Access application: change)";

/** How core reads the marks of the applied steps. */
const MARKS_READ = `SELECT * FROM ${LEDGER_TABLE} ORDER BY step`;

/** A line of an upgrade that says something is wrong: a check that failed, or the error a run ends with. */
const WRONG = /FAILED|^::error::/;

/** The call that makes the install's bucket. */
const BUCKET_CREATE = `POST /accounts/${ACCOUNT}/r2/buckets`;

/** How the line of a rest before the older build's install is run again starts. */
const NAME_HELD = "Older install: the bucket's name is still held";

/** What an upgrade says before it removes what stands. */
const START_OVER = "Start over: the older build makes the install from nothing";

/** The row the last release's install ended on where Cloudflare still held the name of a bucket that was removed. */
const HELD_ROW = "R2 bucket: failed (refused with status 409 and codes 10073)";

/** An account that holds nothing of an install: the bucket that marks a test account, and no database or Worker. */
const NO_INSTALL = { buckets: ["poplin-live-sites"], databases: 0, worker: false };

/** Every line of an upgrade whose checks all hold, after the older build's own install. The two counts are what the upgrade costs an install: a request that grows moves them, and so does a statement of the later step. */
const HELD = [
  "Older install: made by the older build's own poplin install, which says the version 0.3.0",
  "Older install: filled with 3 sites, a second version, a setting, and a user",
  "Update: the older build took 0.4.0 over 0.3.0, by its own start of an update",
  "Bucket writes and lists the upgrade asked for: 23 of at most 40",
  "Rows written this run: 212 of at most 300, 22 of them for the later step",
  "Version: runs 0.4.0, and ran 0.3.0",
  "Sites: 3 are shown, answered to a stranger, and stored in every version as before the update, byte for byte",
  "Token: the one made before the update read every site, the settings, and the log",
  "Settings: 22 as before the update, the changed one and the added user among them",
  "Activity: the 8 entries from before the update, and the entry of the update",
  `Database: the ${BUILD.length} schema steps of this commit's build are marked as it applies them, step ${LATER} among them`,
  `Later step: the table, the column, and the index of step ${LATER} are there, and the 3 sites hold what it filled from them`,
  "Publish: a site published after the update is shown to its holder, answered to a stranger as the one from before, and stored with its files",
  "Doctor: a repair would change nothing, once the two settings were put back",
  "Going back: not offered: the update changed the database, which the version before cannot read",
  "Cleanup: the two settings put back, the sites and the token's row removed",
];

/**
 * One upgrade on an account in memory: its exit code, what its removal said, how many removals it sent, what the account held of an install when the older build's install first ran, how often that install ran,
 * each line between two of its runs, the clock between two of its launches and each rest the upgrade asked for after the last, in milliseconds, what the upgrade said after the last, and the Worker's uploads.
 */
interface Ran {
  readonly code: number;
  readonly removal: readonly string[];
  readonly deleted: number;
  readonly handed: { readonly buckets: readonly unknown[]; readonly databases: number; readonly worker: boolean } | undefined;
  readonly installs: number;
  readonly waits: readonly string[];
  readonly gaps: readonly number[];
  readonly restsAfter: readonly number[];
  readonly lines: readonly string[];
  readonly uploads: number;
}

/** What goes wrong in one upgrade, where anything does. */
interface Fault {
  /** Whether an install of this commit's build stands on the account before the upgrade. */
  readonly standing?: true;

  /** Whether Cloudflare refuses every question to the database of the install that stands. */
  readonly unread?: true;

  /** How many runs of the older build's own install end on the row of a bucket name Cloudflare still holds, before one that goes through. */
  readonly held?: number;

  /** The code Cloudflare refuses every create of the bucket with, under status 409. */
  readonly refused?: number;

  /** The version the install says once it was updated, where it is not the one it took. */
  readonly says?: string;

  /** Whether the updated install offers a way back, which an update that changed the database never has. */
  readonly back?: true;

  /** Whether this commit's build is published with the product's steps alone, as a checkout nobody gave the later step is. */
  readonly bare?: true;

  /** Whether the Worker that starts after the update applies no step, as a build without the later step would. */
  readonly noStep?: true;

  /** A statement run on the database once the later step was applied: what a step that did less would have left. */
  readonly undo?: string;

  /** The exit code of the older build's own install, where it fails. */
  readonly install?: number;

  /** The status the install answers a removal of a site with, where it refuses one. */
  readonly removal?: number;

  /** The update leaves the guarded application without the account's own login method, as a build that offered fewer methods made it. The install's own repair puts it back after so many of the long waits; never, where left out. */
  readonly fewerMethods?: { readonly repairedAfter?: number };

  /** The update leaves the account without its budget alert, which the install's own login repair never makes. */
  readonly noAlert?: true;

  /** The account loses its budget alert after so many of the long waits. */
  readonly alertGoneAfter?: number;
}

/** What an install says of its version and its way back: the older build's before the Worker's second upload, and after it what that upload put in place. */
function stateOf(updated: boolean, fault: Fault): { readonly version: string; readonly back: { readonly to: string } | null } {
  if (!updated) return { version: OLDER, back: null };

  return { version: fault.says ?? COMMIT, back: fault.back === true ? { to: OLDER } : null };
}

/**
 * Start the Worker of this commit's build on the install's database: core's runner applies the later step through the provider's driver, at the moment of the run's clock.
 *
 * @throws {Error} the step did not run
 */
async function startBuild(harness: Awaited<ReturnType<typeof HarnessOf>>, fault: Fault): Promise<void> {
  const databaseId = await findDatabase(harness.run);
  if (typeof databaseId !== "string") throw new Error("the account holds no database of the install");

  const driver = apiDriver(harness.run.connection, { accountId: harness.run.accountId, databaseId });
  const started = await migrate(driver, BUILD, harness.world.ends.reach.now());
  if (started.kind !== "current") throw new Error(`the later step did not run: ${started.kind}`);

  if (fault.undo !== undefined) await driver.batch([{ sql: fault.undo, params: [] }]);

  if (fault.fewerMethods !== undefined) offer(harness, (method) => method !== OWN_METHOD);

  if (fault.noAlert === true) harness.account.alerts.length = 0;
}

/** Make the guarded application of a harness offer the login methods that pass, of all the account has. */
function offer(harness: Awaited<ReturnType<typeof HarnessOf>>, passes: (id: unknown) => boolean): void {
  const guarded = harness.account.applications.find((application) => application.name === INSTALL_OBJECTS.accessApplication);
  Object.assign(guarded ?? {}, { allowed_idps: harness.account.methods.map((method) => method.id).filter(passes) });
}

/** The install of a harness as an upgrade reaches it. The fake's API says one version for good, so its answer is given the state the Worker's uploads leave, and the second upload's Worker starts at its first request. */
function installOf(harness: Awaited<ReturnType<typeof HarnessOf>>, fault: Fault): Fetch {
  let started = false;

  return async (input, init) => {
    if (fault.removal !== undefined && init.method === "DELETE") return new Response("", { status: fault.removal });

    if (!started && harness.account.uploads.length > 1) {
      started = true;
      if (fault.noStep !== true) await startBuild(harness, fault);
    }

    const answered = await harness.world.fetch(input, init);
    if (new URL(input).pathname !== "/api/update" || answered.status !== 200) return answered;

    return Response.json({ ...(await answered.json()), ...stateOf(harness.account.uploads.length > 1, fault) });
  };
}

/**
 * What this process's command line reaches the world through. Its code holds the product's steps alone, where the command line of a live run holds the later step too: so its reading of the marks is answered the steps it knows.
 */
function ownReach(harness: Awaited<ReturnType<typeof HarnessOf>>, fault: Fault): Awaited<ReturnType<typeof HarnessOf>>["world"]["ends"] {
  const { ends } = harness.world;
  let long = 0;
  const sleep: typeof ends.sleep = async (milliseconds) => {
    if (milliseconds === LONG_WAIT_MS) long += 1;

    if (long === fault.fewerMethods?.repairedAfter) offer(harness, () => true);

    if (long === fault.alertGoneAfter) harness.account.alerts.length = 0;

    await ends.sleep(milliseconds);
  };
  const fetch: typeof ends.reach.fetch = async (input, init) => {
    const answered = await ends.reach.fetch(input, init);
    if (typeof init?.body !== "string" || !init.body.includes(MARKS_READ) || !answered.ok) return answered;

    const told: { readonly result: readonly { readonly results: readonly { readonly step: number }[] }[] } = await answered.json();
    const result = told.result.map((statement) => ({ ...statement, results: statement.results.filter((mark) => mark.step <= STEPS.length) }));

    return Response.json({ ...told, result }, { status: answered.status });
  };

  return { ...ends, sleep, reach: { ...ends.reach, fetch } };
}

/** Upgrade an install on an account in memory, with this commit's own code as the older build. */
async function upgrade(kind: Found["kind"], fault: Fault = {}): Promise<Ran> {
  using _step = catchStep();
  const harness = await harnessOf(freshAccount(), kind);
  const env = { POPLIN_LIVE_INSTALL: kind };
  if (fault.standing === true) await convergeInstall(harness.run, env, harness.world);

  if (fault.refused !== undefined) Object.assign(harness.account, { refuse: BUCKET_CREATE, refuseAs: { status: 409, code: fault.refused } });

  if (fault.unread === true) Object.assign(harness.account, { refuse: `POST /accounts/${ACCOUNT}/d1/database/*`, refuseAs: { status: 400, code: 7500 } });

  const own = ownReach(harness, fault);
  const slept: number[] = [];
  const sleep = async (milliseconds: number): Promise<void> => {
    slept.push(milliseconds);
    await own.sleep(milliseconds);
  };
  const [began, asked] = [harness.lines.length, harness.asked.length];
  const runs: { readonly lines: number; readonly at: number; readonly slept: number }[] = [];
  let [installed, handed]: [number, Ran["handed"]] = [began, undefined];
  const older: Older = {
    version: OLDER,
    install: async () => {
      runs.push({ lines: harness.lines.length, at: own.reach.now(), slept: slept.length });
      handed ??= { buckets: harness.account.buckets.map((bucket) => bucket.name), databases: harness.account.databases.length, worker: harness.account.noWorker !== true };
      if (runs.length <= (fault.held ?? 0)) return { code: 1, said: ["Install: none found, so poplin install ran", HELD_ROW] };

      const code = fault.install ?? (await convergeInstall(harness.run, env, harness.world));
      installed = harness.lines.length;

      return { code, said: harness.lines.slice(runs.at(-1)?.lines) };
    },
    seedToken,
    openBench,
    liveAddresses,
    take: (given) => takeWith({ startUpdate, SqlDatabase, apiDriver, createSelfUpdate }, given),
  };
  const code = await upgradeInstall(harness.run, { env, older, release: harness.world.release, steps: fault.bare === true ? STEPS : BUILD, ends: { ...own, sleep }, fetch: installOf(harness, fault) });
  const waits = harness.lines.filter((line) => line.startsWith(NAME_HELD));
  const gaps = runs.slice(1).map((run, before) => run.at - (runs[before]?.at ?? 0));
  const told = { removal: harness.lines.slice(began, runs[0]?.lines ?? began), waits, lines: harness.lines.slice(installed) };
  const deleted = harness.asked.slice(asked).filter((call) => call.method === "DELETE").length;

  return { code, ...told, deleted, handed, installs: runs.length, gaps, restsAfter: slept.slice(runs.at(-1)?.slept ?? 0), uploads: harness.account.uploads.length };
}

describe.each(["domain", "account address"] as const)("the live upgrade of an install on its %s, on a fake account in memory", (kind) => {
  // Drift: a step that moved, a check that reads the wrong answer, or a request with no price in rows would first show on the test account.
  test("an install the older build made and filled takes this commit's build, and every check holds, within the mode's own ceilings", async () => {
    const ran = await upgrade(kind);
    const removal = [START_OVER, "This account has no install. Nothing changed.", "Removal: nothing of an install is there"];

    expect(ran).toMatchObject({ code: 0, removal, handed: NO_INSTALL, installs: 1, waits: [], gaps: [], lines: HELD, uploads: 2 });
  });

  // Drift: the older build read what stood before it removed it, and went no further where Cloudflare would not read the database.
  // A removal with no such read first would take the install on a day nothing can be made in its place.
  test("an install whose database Cloudflare will not read stops the upgrade before anything is removed, and the older build's install never runs", async () => {
    const ran = await upgrade(kind, { standing: true, unread: true });

    expect([ran.code, ran.deleted, ran.installs, ran.lines]).toEqual([1, 0, 0, ["::error::The upgrade could not be checked: Cloudflare refused with status 400 and codes 7500."]]);
  });

  // Incident: the older build removed the install and made its own right after, by its own code, and Cloudflare still held the bucket's name. An older build's removal is none this commit can mend.
  // Drift: with no removal first, an older build that is told nothing would mend the install that stands, and the upgrade would start from a database another build made.
  test("an install that stands is removed by this commit's own poplin uninstall, the files and the database with it, before the older build's install runs once, on an account that holds none", async () => {
    const ran = await upgrade(kind, { standing: true, install: 3 });
    const removed = ran.removal.filter((line) => line.endsWith(": removed") || line.includes(": removed ("));

    expect([ran.removal[0], ran.removal.at(-1), removed.slice(-2), ran.handed]).toEqual([START_OVER, `Removal: ${removed.length} kinds in 0 seconds`, ["R2 bucket: removed (0 in it)", "D1 database: removed (0 in it)"], NO_INSTALL]);
    expect([ran.code, ran.installs, ran.lines]).toEqual([1, 1, ["::error::The upgrade could not be checked: the older build's own install ended with exit code 3."]]);
  });

  // Incident: Cloudflare held the name of a removed bucket, and the last release's install, which waits for no name, ended on the row of that refusal.
  test.each([
    ["twice is run a third time, and the upgrade goes on", 2, { code: 0, installs: 3, uploads: 2 }, []],
    [
      "at every run is run 8 times, and the upgrade stops with no rest after the last",
      8,
      { code: 1, installs: 8, uploads: 0 },
      ["::error::The upgrade could not be checked: the older build's own install ended with exit code 1: Cloudflare still held the bucket's name after 8 runs."],
    ],
  ] as const)("an older build's install that ends on the row of a held name %s: 30 s lie between two launches, each with its line", async (_what, held, ended, wrong) => {
    const ran = await upgrade(kind, { held });
    const waits = Array.from({ length: ended.installs - 1 }, (_, rest) => `${NAME_HELD}, trying again in 30 s (${rest + 2} of 8)`);

    expect([{ code: ran.code, installs: ran.installs, uploads: ran.uploads }, ran.waits, ran.gaps, ran.lines.filter((line) => WRONG.test(line))]).toEqual([ended, waits, waits.map(() => 30_000), [...wrong]]);
    // An upgrade that goes on rests again for its own later waits.
    if (ended.code !== 0) expect(ran.restsAfter).toEqual([]);
  });

  // Drift: the row the upgrade reads is the one this commit's own install ends on where every create is refused so. Worded another way here, the release after this one would stop at its first run.
  test.each([
    [
      "as a held name ends on the row the upgrade reads, and is run to the last of 8 runs",
      10073,
      8,
      "::error::The upgrade could not be checked: the older build's own install ended with exit code 1: Cloudflare still held the bucket's name after 8 runs.",
    ],
    ["with another code ends on another row, and is never run again", 10004, 1, "::error::The upgrade could not be checked: the older build's own install ended with exit code 1."],
  ] as const)("this commit's own install, as the older build's, whose bucket is refused %s", async (_what, refused, installs, wrong) => {
    const ran = await upgrade(kind, { refused });

    expect([ran.code, ran.installs, ran.waits.length, ran.lines.filter((line) => WRONG.test(line)), ran.uploads]).toEqual([1, installs, installs - 1, [wrong], 0]);
  });

  // Drift: a version may expect another login than the one before made, and the install repairs it by itself on a scheduled run. A check that called that a fault at once would fail every such upgrade;
  // one that waited for any piece would hide a piece only a person's repair makes, and one that waited for good would never end.
  test("a login the version before left another way is waited for and holds once the install repaired it; left so it fails after the wait, and a piece of another kind fails at once, before the wait or in it", async () => {
    const repaired = await upgrade(kind, { fewerMethods: { repairedAfter: 3 } });
    const left = await upgrade(kind, { fewerMethods: {} });
    const other = await upgrade(kind, { fewerMethods: { repairedAfter: 1 }, noAlert: true });
    const later = await upgrade(kind, { fewerMethods: { repairedAfter: 5 }, alertGoneAfter: 2 });
    const told = (ran: Ran): string[] => ran.lines.filter((line) => line.startsWith("Doctor") || WRONG.test(line));
    const alerts = kind === "domain" ? "Budget alert: make; Certificate alert: make" : "Budget alert: make";

    expect([repaired.code, told(repaired)]).toEqual([0, [WAITING, "Doctor: a repair would change nothing, once the two settings were put back"]]);
    expect([left.code, told(left)]).toEqual([1, [WAITING, "Doctor: FAILED: Access application: change", "::error::The upgrade left the install changed: Doctor."]]);
    expect([other.code, told(other)]).toEqual([1, [`Doctor: FAILED: Access application: change; ${alerts}`, "::error::The upgrade left the install changed: Doctor."]]);
    // The login would stand three waits later: a wait that went on would name the alert alone.
    expect([later.code, told(later)]).toEqual([1, [WAITING, `Doctor: FAILED: Access application: change; ${alerts}`, "::error::The upgrade left the install changed: Doctor."]]);
  });

  // Drift: an upgrade that ended green on an install that never took the build, never ran the step, kept half of it, or was never made would prove nothing.
  test.each([
    ["an install that goes on saying the older version stops the run", { says: OLDER }, 2, [`::error::The upgrade could not be checked: the install did not say the version ${COMMIT} 12 times in a row within 180 seconds (it last said ${OLDER}).`]],
    [
      "a Worker that started without the later step fails the two checks of the database",
      { noStep: true },
      2,
      [
        `Database: FAILED: the database holds ${STEPS.length} of the ${BUILD.length} schema steps of this commit's build`,
        "Later step: FAILED: the step's table is not there; the step's column is not among those of the sites; the step's index is not there, over the sites",
        "::error::The upgrade left the install changed: Database, Later step.",
      ],
    ],
    [
      "a step that left no index fails its check alone",
      { undo: `DROP INDEX ${LATER_NAMES.index}` },
      2,
      ["Later step: FAILED: the step's index is not there, over the sites", "::error::The upgrade left the install changed: Later step."],
    ],
    [
      "a step that filled no site fails its check, a line a site",
      { undo: `UPDATE sites SET ${LATER_NAMES.column} = ''` },
      2,
      [
        `Later step: FAILED: ${["1 (private)", "2 (unlisted)", "3 (public)"].map((site) => `site ${site}: its column does not hold what the step fills it with`).join("; ")}`,
        "::error::The upgrade left the install changed: Later step.",
      ],
    ],
    [
      "a step that left a site out of its table fails its check for that site",
      { undo: `DELETE FROM ${LATER_NAMES.table} WHERE versions = 2` },
      2,
      ["Later step: FAILED: site 1 (private): its row of the step's table is not the one the step fills", "::error::The upgrade left the install changed: Later step."],
    ],
    [
      "a site published after the update that holds a row of the step's table fails its check",
      { undo: `CREATE TRIGGER later_sites_are_filled AFTER INSERT ON sites BEGIN INSERT INTO ${LATER_NAMES.table} (folder, label, versions) VALUES (NEW.folder, '', 1); END` },
      2,
      ["Later step: FAILED: the site published after the update does not hold the column's default alone", "::error::The upgrade left the install changed: Later step."],
    ],
    [
      "an install that offers a way back from an update that changed the database fails that check alone",
      { back: true },
      2,
      [`Going back: FAILED: the install offers ${OLDER}, where the update changed the database and there is no way back`, "::error::The upgrade left the install changed: Going back."],
    ],
    ["a site the upgrade cannot remove again fails the cleanup", { removal: 500 }, 2, ["Cleanup: FAILED: the sites were not removed", "::error::The upgrade left the install changed: Cleanup."]],
    [
      "a build that holds no later step stops the run before the install is removed",
      { bare: true },
      0,
      ["::error::The upgrade could not be checked: this commit's build holds no later step: `live:upgrade-builds` gives the checkout one, before the Worker is built."],
    ],
    ["an older build whose own install fails stops the run before anything is filled", { install: 3 }, 0, ["::error::The upgrade could not be checked: the older build's own install ended with exit code 3."]],
  ] as const)("%s", async (_what, fault, uploads, wrong) => {
    const ran = await upgrade(kind, fault);

    expect([ran.code, ran.uploads, ran.lines.filter((line) => WRONG.test(line))]).toEqual([1, uploads, [...wrong]]);
  });
});

describe("the wait for this commit's version", () => {
  // Drift: a wait that ended on the first answer would let a check meet an instance of the build before.
  test.each([
    ["twelve answers in a row end it", (): string => COMMIT, undefined, 12],
    ["an answer of the build before starts the row over", (nth: number): string => (nth === 5 ? OLDER : COMMIT), undefined, 18],
    ["a build before that never stops answering fails it", (): string => OLDER, { kind: "failed", what: `the install did not say the version ${COMMIT} 12 times in a row within 180 seconds (it last said ${OLDER})` }, 61],
  ] as const)("%s", async (_what, says, ended, requests) => {
    let [now, asked] = [0, 0];
    const sleep = async (ms: number): Promise<void> => {
      now += ms;
    };
    const asking = async (): Promise<string> => {
      asked += 1;

      return says(asked - 1);
    };

    expect([await awaitVersion(COMMIT, asking, { reach: { fetch: async () => new Response(), now: () => now, sleep }, sleep }), asked]).toEqual([ended, requests]);
  });
});
