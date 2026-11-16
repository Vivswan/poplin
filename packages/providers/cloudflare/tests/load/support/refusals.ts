// The refusals a load meets: each is provoked on purpose, and every request past the limit must answer that refusal, in its own words.

import type { SettingValues } from "@poplin/core/src/records/settings";
import { BYTE_SHA256, filePath } from "../../shared/worker/support/budget-seeds";
import { adminToken, apiOf, get, type Measured, type Stage, unmeasured } from "../../shared/worker/support/budget-stage";
import { OWNER } from "../../shared/worker/support/install";
import { FILLED, fillInstall } from "./fill";
import type { Scenario, Turn } from "./measure";
import { visitorOf } from "./scenarios-serve";

/** How many requests each limit below lets through before it refuses. */
const LET_THROUGH = 2;

/** How many uploads one holder may leave unfinished. */
const UNFINISHED = 20;

/** How many checks of a login's secret one visitor is answered in a minute. */
const SECRETS_A_MINUTE = 25;

/** The one file a made-up publish declares. */
const ONE_FILE = [{ path: filePath(0), size: 1, content_type: "text/html", sha256: BYTE_SHA256 }];

/** A secret of a computer's login in the form of one, which no login holds. */
const NO_LOGIN = `poplin_login_${"0".repeat(16)}_${"0".repeat(64)}`;

/** Change settings of the stage's install as its owner. */
async function settle(stage: Stage, changes: Partial<SettingValues>): Promise<void> {
  await stage.install.database.changeSettings(changes, { as: "person", by: OWNER, at: stage.w.clock.now });
}

/** The refusals. */
export const REFUSAL_SCENARIOS: readonly Scenario[] = [
  {
    name: "refusal: one visitor past its requests of a minute",
    axis: "users",
    flat: true,
    open: true,
    status: 200,
    refusal: { status: 429, words: "Too many requests. Try again in ", after: LET_THROUGH },
    arrange: async (stage, fill) => {
      await fillInstall(stage, fill);
      await settle(stage, { visitor_requests_per_minute: LET_THROUGH });
      const headers = visitorOf(7, fill);

      return (measured) => get(measured, `${FILLED.public}/`, headers);
    },
  },
  {
    name: "refusal: a publish past the most sites an install may hold",
    axis: "users",
    flat: true,
    status: 200,
    refusal: { status: 409, words: '"code":"too_many_sites","message":"the install holds as many sites as it may"', after: LET_THROUGH },
    arrange: async (stage, fill) => {
      await fillInstall(stage, fill);
      await settle(stage, { max_sites: Math.max(3, fill.sites) + LET_THROUGH });
      const token = await adminToken(stage);

      return (measured, turn) => apiOf(measured, token).uploads.$post({ query: {}, json: { name: `load-${turn}`, files: ONE_FILE } });
    },
  },
  {
    name: "refusal: one holder past its unfinished uploads",
    axis: "users",
    flat: true,
    status: 200,
    refusal: { status: 413, words: '"code":"too_large","message":"a size limit is passed","about":"max_pending_uploads"', after: LET_THROUGH },
    arrange: async (stage, fill) => {
      await fillInstall(stage, fill);
      const token = await adminToken(stage);
      const begin = (measured: Measured, name: string): ReturnType<Turn> => apiOf(measured, token).uploads.$post({ query: {}, json: { name, files: ONE_FILE } });
      // The holder has all but two of its unfinished uploads already, so the limit is met inside a short row.
      for (let begun = 0; begun < UNFINISHED - LET_THROUGH; begun += 1) await begin(unmeasured(stage), `begun-${begun}`);

      return (measured, turn) => begin(measured, `load-${turn}`);
    },
  },
  {
    name: "refusal: one visitor past its checks of a login's secret of a minute",
    axis: "users",
    flat: true,
    open: true,
    status: 200,
    refusal: { status: 429, words: '"code":"too_many_requests","message":"the install is asked too often: wait, then ask again"', after: LET_THROUGH },
    arrange: async (stage, fill) => {
      await fillInstall(stage, fill);
      const headers = visitorOf(8, fill);
      const check = (measured: Measured): ReturnType<Turn> => apiOf(measured, null).logins.token.$post({ query: {}, json: { secret: NO_LOGIN } }, { headers });
      // The visitor has spent all but two of its minute already, so the limit is met inside a short row.
      for (let spent = 0; spent < SECRETS_A_MINUTE - LET_THROUGH; spent += 1) await check(unmeasured(stage));

      return check;
    },
  },
];
