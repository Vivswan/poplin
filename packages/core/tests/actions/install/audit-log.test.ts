// The count of the audit log an admin reads, and the readings a file of the log is made from: what each holds under a narrowing, and who is refused.

import { describe, expect, test } from "bun:test";

import { countAudit, listAudit, listAuditForFile, listAuditForScreen, nextAuditFile } from "../../../src/actions/install/audit-log";
import { changeConfig } from "../../../src/actions/install/config";
import { signedBy } from "../../../src/actions/access/reach";
import { updateSite } from "../../../src/actions/sites/set";
import { AUDIT_WINDOW } from "../../../src/database/database";
import { ADMIN, made, makeWorld, NOW, OWNER } from "../support/actions-fixture";

describe("countAudit", () => {
  // Drift: the Activity screen's total is this count under the screen's own filters; a kind counted by other actions than it lists by would show a total its pages never reach.
  test("an admin counts the log whole, by kind, by a site's name, and by a site's id; anyone else, a key it does not take, and a name beside an id is refused, and a reading of the API takes no id", async () => {
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
      await countAudit(world.install, ADMIN, { of: site }),
      await countAudit(world.install, ADMIN, { of: "report" }),
      await countAudit(world.install, ADMIN, { of: site, site: "epo" }),
      await listAuditForScreen(world.install, ADMIN, { limit: 1, of: site, site: "epo" }),
      await listAuditForFile(world.install, ADMIN, { of: site, site: "epo" }),
      await nextAuditFile(world.install, ADMIN, { entries: 3, of: site, site: "epo" }),
      await listAudit(world.install, ADMIN, { of: site } as never),
    ]).toEqual([
      { ok: true, count: 4, whole: true },
      { ok: true, count: 2, whole: true },
      { ok: true, count: 0, whole: true },
      { ok: true, count: 2, whole: true },
      { ok: false, code: "not_allowed" },
      { ok: false, code: "bad_argument", about: "site" },
      { ok: false, code: "bad_argument", about: "limit" },
      { ok: true, count: 2, whole: true },
      ...Array.from({ length: 6 }, () => ({ ok: false as const, code: "bad_argument" as const, about: "of" })),
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

      return read.ok ? read.entries.map(({ entry }) => entry.action) : read;
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
      { ok: true, from: 5, after: 2 },
      { ok: true, from: 5, after: null },
      { ok: true, from: 5, after: 4 },
      { ok: true, from: 2, after: null },
      { ok: false, code: "not_allowed" },
      { ok: false, code: "bad_argument", about: "entries" },
      { ok: false, code: "bad_argument", about: "entries" },
    ]);
  });
});

describe("a narrowed reading of a log longer than its window", () => {
  // Drift: the first file of a narrowed download would begin at the log's newest entry again: where a window holds no entry of it, that file is one note and no entry, while the screen, searched further, shows them.
  test("a narrowed file begins past the windows of the log that hold no entry of it, where the reading from the newest entry stops short with none", async () => {
    const world = await makeWorld();
    await made(world, ADMIN, "report");
    for (let count = 0; count < 2 * AUDIT_WINDOW + 5; count += 1) await world.install.database.appendAudit({ action: "login", detail: {} }, signedBy(ADMIN, NOW));
    const told = async (after?: number): Promise<unknown> => {
      const read = await listAuditForFile(world.install, ADMIN, after === undefined ? { site: "report" } : { site: "report", after });

      return read.ok ? [read.entries.map(({ entry }) => entry.site?.name), read.stopped_at !== undefined] : read;
    };
    const next = await nextAuditFile(world.install, ADMIN, { entries: 2000, site: "report" });

    expect([await told(), next.ok && next.after, next.ok && (await told(next.from))]).toEqual([[[], true], null, [["report"], false]]);
  });

  // Drift: the screen, a file of the log and the API all go on from `stopped_at`. Left out, a rare site's history would end at the window; set on a full page or at the log's end, it would offer a search with nothing behind it.
  test("answers what its window holds and where it stopped, the count and the file's end stop with it, and the screen's reading takes a page of 201", async () => {
    const world = await makeWorld();
    await made(world, ADMIN, "report");
    for (let count = 0; count < AUDIT_WINDOW + 5; count += 1) await world.install.database.appendAudit({ action: "login", detail: {} }, signedBy(ADMIN, NOW));
    await made(world, ADMIN, "docs");
    const told = (read: Awaited<ReturnType<typeof listAudit>>): unknown => (read.ok ? [read.entries.map((entry) => entry.site?.name ?? entry.action), Object.keys(read)] : read);
    const toldOfFile = (read: Awaited<ReturnType<typeof listAuditForFile>>): unknown => told(read.ok ? { ...read, entries: read.entries.map(({ entry }) => entry) } : read);
    const screen = await listAuditForScreen(world.install, ADMIN, { limit: 201, kind: "access" });

    expect([
      told(await listAudit(world.install, ADMIN, { site: "o", limit: 2 })),
      told(await listAudit(world.install, ADMIN, { site: "o", after: 9 })),
      told(await listAudit(world.install, ADMIN, { site: "o", limit: 1 })),
      told(await listAudit(world.install, ADMIN, { site: "nowhere" })),
      told(await listAudit(world.install, ADMIN, { limit: 1 })),
      toldOfFile(await listAuditForFile(world.install, ADMIN, { site: "o" })),
      await countAudit(world.install, ADMIN, { site: "o" }),
      await countAudit(world.install, ADMIN),
      await nextAuditFile(world.install, ADMIN, { entries: 2000, site: "o" }),
      await nextAuditFile(world.install, ADMIN, { entries: 2000, site: "o", after: 9 }),
      await nextAuditFile(world.install, ADMIN, { entries: 2000, kind: "access" }),
      screen.ok && screen.entries.length,
      await listAuditForScreen(world.install, ADMIN, { limit: 202 }),
      await listAuditForScreen(world.install, OWNER, { limit: 1 }),
    ]).toEqual([
      [["docs"], ["ok", "entries", "stopped_at"]],
      [["report"], ["ok", "entries"]],
      [["docs"], ["ok", "entries"]],
      [[], ["ok", "entries", "stopped_at"]],
      [["docs"], ["ok", "entries"]],
      [["docs"], ["ok", "entries", "stopped_at"]],
      { ok: true, count: 1, whole: false },
      { ok: true, count: AUDIT_WINDOW + 8, whole: true },
      { ok: true, from: AUDIT_WINDOW + 9, after: 9 },
      { ok: true, from: 9, after: null },
      { ok: true, from: AUDIT_WINDOW + 9, after: AUDIT_WINDOW - 1992 },
      201,
      { ok: false, code: "bad_argument", about: "limit" },
      { ok: false, code: "not_allowed" },
    ]);
  });
});
