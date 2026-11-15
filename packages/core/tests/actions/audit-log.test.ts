// The count of the audit log an admin reads, and the readings a file of the log is made from: what each holds under a narrowing, and who is refused.

import { describe, expect, test } from "bun:test";

import { countAudit, listAuditForFile, nextAuditFile } from "../../src/actions/audit-log";
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

describe("listAuditForFile", () => {
  // Drift: a file would hold the entries a filter of the screen leaves out, go on from the wrong place, or be read by a publisher's token.
  test("an admin reads the log for a file under the narrowing of a page and on from a place, and is told where the file after it goes on from; anyone else, and a key it does not take, is refused", async () => {
    const world = await makeWorld();
    const site = await made(world, ADMIN, "report");
    await changeConfig(world.install, ADMIN, { versions_kept: 10 });
    await updateSite(world.install, ADMIN, { site, access: "unlisted" });
    const told = async (query: Parameters<typeof listAuditForFile>[2]): Promise<unknown> => {
      const read = await listAuditForFile(world.install, ADMIN, query);

      return read.ok ? read.entries.map((entry) => entry.action) : read;
    };
    const next = (query: Parameters<typeof nextAuditFile>[2]): ReturnType<typeof nextAuditFile> => nextAuditFile(world.install, ADMIN, query);

    expect([await told({}), await told({ kind: "sites" }), await told({ site: "epo", after: 4 }), await told({ after: 2 }), await listAuditForFile(world.install, OWNER), await told({ limit: 5 } as never), await told({ dir: "asc" } as never)]).toEqual([
      ["access", "settings_changed", "create", "settings_set"],
      ["access", "create"],
      ["create"],
      ["settings_set"],
      { ok: false, code: "not_allowed" },
      { ok: false, code: "bad_argument", about: "limit" },
      { ok: false, code: "bad_argument", about: "dir" },
    ]);
    expect([
      await next({ entries: 3 }),
      await next({ entries: 4 }),
      await next({ entries: 1, kind: "sites" }),
      await next({ entries: 1, after: 2 }),
      await nextAuditFile(world.install, OWNER, { entries: 3 }),
      await next({ entries: 10_001 }),
      await next({} as never),
    ]).toEqual([
      { ok: true, after: 2 },
      { ok: true, after: null },
      { ok: true, after: 4 },
      { ok: true, after: null },
      { ok: false, code: "not_allowed" },
      { ok: false, code: "bad_argument", about: "entries" },
      { ok: false, code: "bad_argument", about: "entries" },
    ]);
  });
});
