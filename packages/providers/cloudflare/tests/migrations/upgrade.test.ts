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
import { createSelfUpdate } from "../../src/shared/release/update/self-update";
import { COMMIT, freshAccount, type harnessOf as HarnessOf, harnessOf } from "../live/support/harness-world";
import { catchStep } from "../live/support/step";

/** The version the older build says: below the one a test publishes as this commit's. */
const OLDER = "0.3.0";

/** Every step of the build a test publishes as this commit's: the product's, then the later step. */
const BUILD: readonly Step[] = [...STEPS, laterStep(OLDER)];

/** The later step, as a line writes it: the older build's version, then its name. */
const LATER = `${OLDER}/upgrade-proof`;

/** How core reads the marks of the applied steps. */
const MARKS_READ = `SELECT * FROM ${LEDGER_TABLE} ORDER BY step`;

/** A line of an upgrade that says something is wrong: a check that failed, or the error a run ends with. */
const WRONG = /FAILED|^::error::/;

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

/** One upgrade on an account in memory: its exit code and what it said after the older build's own install. */
interface Ran {
  readonly code: number;
  readonly lines: readonly string[];
  readonly uploads: number;
}

/** What goes wrong in one upgrade, where anything does. */
interface Fault {
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
function ownReach(harness: Awaited<ReturnType<typeof HarnessOf>>): Awaited<ReturnType<typeof HarnessOf>>["world"]["ends"] {
  const { ends } = harness.world;
  const fetch: typeof ends.reach.fetch = async (input, init) => {
    const answered = await ends.reach.fetch(input, init);
    if (typeof init?.body !== "string" || !init.body.includes(MARKS_READ) || !answered.ok) return answered;

    const told: { readonly result: readonly { readonly results: readonly { readonly step: number }[] }[] } = await answered.json();
    const result = told.result.map((statement) => ({ ...statement, results: statement.results.filter((mark) => mark.step <= STEPS.length) }));

    return Response.json({ ...told, result }, { status: answered.status });
  };

  return { ...ends, reach: { ...ends.reach, fetch } };
}

/** Upgrade an install on a fresh account in memory, with this commit's own code as the older build. */
async function upgrade(kind: Found["kind"], fault: Fault = {}): Promise<Ran> {
  using _step = catchStep();
  const harness = await harnessOf(freshAccount(), kind);
  const env = { POPLIN_LIVE_INSTALL: kind };
  let installed = 0;
  const older: Older = {
    version: OLDER,
    install: async () => {
      const code = fault.install ?? (await convergeInstall(harness.run, { ...env, POPLIN_LIVE_START_OVER: "true" }, harness.world));
      installed = harness.lines.length;

      return code;
    },
    seedToken,
    openBench,
    liveAddresses,
    take: (given) => takeWith({ startUpdate, SqlDatabase, apiDriver, createSelfUpdate }, given),
  };
  const code = await upgradeInstall(harness.run, { env, older, release: harness.world.release, steps: fault.bare === true ? STEPS : BUILD, ends: ownReach(harness), fetch: installOf(harness, fault) });

  return { code, lines: harness.lines.slice(installed), uploads: harness.account.uploads.length };
}

describe.each(["domain", "account address"] as const)("the live upgrade of an install on its %s, on a fake account in memory", (kind) => {
  // Drift: a step that moved, a check that reads the wrong answer, or a request with no price in rows would first show on the test account.
  test("an install the older build made and filled takes this commit's build, and every check holds, within the mode's own ceilings", async () => {
    const ran = await upgrade(kind);

    expect(ran).toEqual({ code: 0, lines: HELD, uploads: 2 });
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
