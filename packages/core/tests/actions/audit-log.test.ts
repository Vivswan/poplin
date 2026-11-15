// The count of the audit log an admin reads: what it counts under each narrowing, and who is refused.

import { describe, expect, test } from "bun:test";

import { countAudit } from "../../src/actions/audit-log";
import { changeConfig } from "../../src/actions/config";
import { updateSite } from "../../src/actions/set";
import { ADMIN, made, makeWorld, OWNER } from "./support/actions-fixture";

describe("countAudit", () => {
  // Drift: the Activity screen's total is this count under the screen's own filters; a kind counted by other actions than it lists by would show a total its pages never reach.
  test("an admin counts the log whole, by kind, and by a site's name; anyone else, and a key it does not take, is refused", async () => {
    const world = await makeWorld();
    const site = await made(world, ADMIN, "report");
    await changeConfig(world.install, ADMIN, { versions_kept: 10 });
    await updateSite(world.install, ADMIN, { site, access: "unlisted" });

    expect([
      await countAudit(world.install, ADMIN),
      await countAudit(world.install, ADMIN, { kind: "sites" }),
      await countAudit(world.install, ADMIN, { kind: "settings", site: "epo" }),
      await countAudit(world.install, ADMIN, { site: "epo" }),
      await countAudit(world.install, OWNER),
      await countAudit(world.install, ADMIN, { site: "" }),
      await countAudit(world.install, ADMIN, { limit: 5 } as never),
    ]).toEqual([
      { ok: true, count: 4, whole: true },
      { ok: true, count: 2, whole: true },
      { ok: true, count: 0, whole: true },
      { ok: true, count: 2, whole: true },
      { ok: false, code: "not_allowed" },
      { ok: false, code: "bad_argument", about: "site" },
      { ok: false, code: "bad_argument", about: "limit" },
    ]);
  });
});
