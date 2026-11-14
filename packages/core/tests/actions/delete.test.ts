import { describe, expect, test } from "bun:test";

import { deleteSite } from "../../src/actions/delete";
import { publishSite } from "../../src/actions/publish";
import { restoreSite } from "../../src/actions/restore";
import { getSite } from "../../src/actions/show";
import { ADMIN, DAY, made, makeWorld, NOW, OWNER, pages } from "./support/actions-fixture";

describe("deleteSite", () => {
  // Drift: the trash is the one undo of a delete; a delete that removed files, or a restore that lost the public name, would make it no undo at all.
  test("a delete moves the site to the trash with its files and says when it goes for good; a restore brings it back as it was", async () => {
    const world = await makeWorld({ trash_days: 3 });
    const id = await made(world, OWNER, "report", { access: "public" });
    const [before, keys] = [await getSite(world.install, OWNER, id), await world.keys()];
    world.clock.now = NOW + DAY;

    const steps = [
      await deleteSite(world.install, OWNER, { site: id }),
      await deleteSite(world.install, OWNER, { site: id }),
      await restoreSite(world.install, OWNER, id),
      await restoreSite(world.install, OWNER, id),
    ];

    expect(steps).toMatchObject([
      { ok: true, left: [], before: { state: "live" }, site: { id, state: "trash", gone_on: NOW + 4 * DAY, public_name: "report" } },
      { ok: false, code: "in_trash" },
      { ok: true, before: { state: "trash" }, site: before.ok ? { ...before.site, updated: NOW + DAY, views: null } : {} },
      { ok: false, code: "not_in_trash" },
    ]);
    expect([await world.keys(), await world.audit()]).toEqual([keys, ["create", "trash", "restore"]]);
  });

  // Drift: delete forever is the way out when a secret was published; a file left in the bucket, or a public name still held, would keep it around.
  test("a delete forever removes the row and every file of every version, from the trash or not, and frees the public name", async () => {
    const world = await makeWorld();
    const kept = await made(world, OWNER, "budget");
    const live = await made(world, OWNER, "report", { access: "public" });
    await publishSite(world.install, OWNER, { files: pages("report v2"), site: live });
    const trashed = await made(world, OWNER, "notes");
    await deleteSite(world.install, OWNER, { site: trashed });

    const gone = [await deleteSite(world.install, OWNER, { site: live, forever: true }), await deleteSite(world.install, ADMIN, { site: trashed, forever: true })];
    const folders = new Set((await world.keys()).map((key) => key.split("/")[0]));

    expect(gone).toMatchObject([
      { ok: true, left: [], before: { id: live, name: "report", state: "live" }, site: null },
      { ok: true, left: [], before: { id: trashed, name: "notes", state: "trash" }, site: null },
    ]);
    expect([await getSite(world.install, ADMIN, live), await getSite(world.install, ADMIN, "report"), await getSite(world.install, ADMIN, trashed)]).toEqual([
      { ok: false, code: "not_found" },
      { ok: false, code: "not_found" },
      { ok: false, code: "not_found" },
    ]);
    expect([folders.size, (await world.keys()).length]).toEqual([1, 2]);
    expect(await getSite(world.install, OWNER, kept)).toMatchObject({ ok: true });
    expect(await publishSite(world.install, OWNER, { files: pages("x"), name: "other", access: "public", public_name: "report" })).toMatchObject({ ok: true });
    expect(await world.audit()).toEqual(["create", "create", "publish", "create", "trash", "delete", "delete", "create"]);
  });

  // Drift: the row goes first, so files that cannot be removed are garbage nothing serves; the answer must name them, and the folder must stay a leftover, or they are never found again.
  test("a delete forever whose files cannot be removed still removes the row, names the prefix that is left, and keeps the folder as a leftover until its files are gone", async () => {
    const world = await makeWorld();
    const id = await made(world, OWNER, "report");
    const folder = (await world.keys())[0]?.split("/")[0];
    const emptied = await made(world, OWNER, "notes");
    await deleteSite(world.install, OWNER, { site: emptied, forever: true });
    world.faults.failRemoval = true;

    expect(await deleteSite(world.install, OWNER, { site: id, forever: true })).toMatchObject({ ok: true, left: [`${folder}/`] });
    expect(await getSite(world.install, ADMIN, id)).toEqual({ ok: false, code: "not_found" });
    expect(await world.install.database.listLeftovers({ limit: 10 })).toEqual({ folders: [folder] } as never);
  });
});
