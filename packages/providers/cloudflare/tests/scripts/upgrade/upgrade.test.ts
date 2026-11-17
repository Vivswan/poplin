// The live upgrade runs against a fake Cloudflare account in memory: this commit's own code stands where the older build's does, and the real API answers from a database the product's own install made.
// Without it the steps of an upgrade, their order, and what each check reads are first run on a test account, where a mistake costs a day's rows.

import { describe, expect, test } from "bun:test";
import { startUpdate } from "@poplin/core/src/actions/start-update";
import { SqlDatabase } from "@poplin/core/src/database/sql-database";

import type { Fetch } from "../../../../../cli/src/client/client";
import { liveAddresses } from "../../../live/addresses";
import { openBench } from "../../../live/bench";
import { convergeInstall } from "../../../scripts/live/converge";
import { seedToken } from "../../../scripts/live/tokens";
import type { Found } from "../../../scripts/live/util";
import { type Older, takeWith } from "../../../scripts/upgrade/older";
import { awaitVersion, upgradeInstall } from "../../../scripts/upgrade/upgrade";
import { apiDriver } from "../../../src/shared/database/api-driver";
import { createSelfUpdate } from "../../../src/shared/release/update/self-update";
import { COMMIT, freshAccount, type harnessOf as HarnessOf, harnessOf } from "../../live/support/harness-world";
import { catchStep } from "../../live/support/step";

/** The version the older build says: below the one a test publishes as this commit's. */
const OLDER = "0.3.0";

/** What an upgrade that stopped says before its error: what it asked of the bucket and of the database. */
const SPENT = /^(Bucket writes and lists the upgrade asked for|Rows written this run): \d+ of at most \d+$/;

/** Every line of an upgrade whose checks all hold, after the older build's own install. The two counts are what the upgrade costs an install: a request that grows moves them. */
const HELD = [
  "Older install: made by the older build's own poplin install, which says the version 0.3.0",
  "Older install: filled with 3 sites, a second version, a setting, and a user",
  "Update: the older build took 0.4.0 over 0.3.0, by its own start of an update",
  "Bucket writes and lists the upgrade asked for: 19 of at most 40",
  "Rows written this run: 144 of at most 300",
  "Version: runs 0.4.0, and ran 0.3.0",
  "Sites: 3 are shown, answered to a stranger, and stored in every version as before the update, byte for byte",
  "Token: the one made before the update read every site, the settings, and the log",
  "Settings: 20 as before the update, the changed one and the added user among them",
  "Activity: the 8 entries from before the update, and the entry of the update",
  "Database: every schema step of this commit, as this commit applies them",
  "Doctor: a repair would change nothing, once the two settings were put back",
  "Going back: offered, to 0.3.0",
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

  /** Whether the updated install offers no way back. */
  readonly noBack?: true;

  /** The exit code of the older build's own install, where it fails. */
  readonly install?: number;

  /** The status the install answers a removal of a site with, where it refuses one. */
  readonly removal?: number;
}

/** What an install says of its version and its way back: the older build's before the Worker's second upload, and after it what that upload put in place. */
function stateOf(updated: boolean, fault: Fault): { readonly version: string; readonly back: { readonly to: string } | null } {
  if (!updated) return { version: OLDER, back: null };

  return { version: fault.says ?? COMMIT, back: fault.noBack === true ? null : { to: OLDER } };
}

/** The install of a harness as an upgrade reaches it. The fake's API says one version for good, so its answer is given the state the Worker's uploads leave. */
function installOf(harness: Awaited<ReturnType<typeof HarnessOf>>, fault: Fault): Fetch {
  return async (input, init) => {
    if (fault.removal !== undefined && init.method === "DELETE") return new Response("", { status: fault.removal });

    const answered = await harness.world.fetch(input, init);
    if (new URL(input).pathname !== "/api/update" || answered.status !== 200) return answered;

    return Response.json({ ...(await answered.json()), ...stateOf(harness.account.uploads.length > 1, fault) });
  };
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
  const code = await upgradeInstall(harness.run, { env, older, release: harness.world.release, ends: harness.world.ends, fetch: installOf(harness, fault) });

  return { code, lines: harness.lines.slice(installed), uploads: harness.account.uploads.length };
}

describe.each(["domain", "account address"] as const)("the live upgrade of an install on its %s, on a fake account in memory", (kind) => {
  // Drift: a step that moved, a check that reads the wrong answer, or a request with no price in rows would first show on the test account.
  test("an install the older build made and filled takes this commit's build, and every check holds, within the mode's own ceilings", async () => {
    const ran = await upgrade(kind);

    expect(ran).toEqual({ code: 0, lines: HELD, uploads: 2 });
  });

  // Drift: an upgrade that ended green on an install that never took the build, offers no way back, or was never made would prove nothing.
  test.each([
    ["an install that goes on saying the older version stops the run", { says: OLDER }, 2, [`::error::The upgrade could not be checked: the install did not say the version ${COMMIT} 12 times in a row within 180 seconds (it last said ${OLDER}).`]],
    [
      "an install that offers no way back fails that check alone",
      { noBack: true },
      2,
      [`Going back: FAILED: the install offers no version, where ${OLDER} is the way back`, "Cleanup: the two settings put back, the sites and the token's row removed", "::error::The upgrade left the install changed: Going back."],
    ],
    ["a site the upgrade cannot remove again fails the cleanup", { removal: 500 }, 2, ["Cleanup: FAILED: the sites were not removed", "::error::The upgrade left the install changed: Cleanup."]],
    ["an older build whose own install fails stops the run before anything is filled", { install: 3 }, 0, ["::error::The upgrade could not be checked: the older build's own install ended with exit code 3."]],
  ] as const)("%s", async (_what, fault, uploads, last) => {
    const ran = await upgrade(kind, fault);

    expect([ran.code, ran.uploads, ran.lines.filter((line) => !SPENT.test(line)).slice(-last.length)]).toEqual([1, uploads, [...last]]);
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
