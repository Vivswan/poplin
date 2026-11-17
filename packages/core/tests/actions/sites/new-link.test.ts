import { describe, expect, test } from "bun:test";

import { deleteSite } from "../../../src/actions/sites/delete";
import { newLink } from "../../../src/actions/sites/new-link";
import { getSite } from "../../../src/actions/sites/show";
import { ADMIN, made, makeWorld, OWNER, rehearsedThenRun, STRANGER } from "../support/actions-fixture";

describe("newLink", () => {
  // Drift: a new link is how a leaked address is taken back; an old id that still answered would leave the leak open.
  test("a new link gives a new id at once: the old reference finds nothing, and the public name and the files follow the site", async () => {
    const world = await makeWorld();
    const old = await made(world, OWNER, "report", { access: "public" });
    const keys = await world.keys();
    const renamed = await newLink(world.install, OWNER, `report--${old}`);
    if (!renamed.ok) throw new Error("the new link was refused");

    expect(renamed.site).toMatchObject({ label: `report--${renamed.site.id}`, public_name: "report", addresses: { site: `https://report--${renamed.site.id}-u-poplin.example.com` } });
    expect(renamed.site.id).not.toBe(old);
    expect([await getSite(world.install, OWNER, old), await getSite(world.install, ADMIN, `report--${old}`)]).toEqual([
      { ok: false, code: "not_found" },
      { ok: false, code: "not_found" },
    ]);
    expect(renamed.before).toMatchObject({ id: old, label: `report--${old}` });
    const shown = { ...renamed.site, views: { today: 0, week: 0 } };

    expect(await getSite(world.install, OWNER, "report")).toEqual({ ok: true, before: shown, site: shown });
    expect([await world.keys(), await world.audit()]).toEqual([keys, ["create", "new_id"]]);
  });

  // Drift: a site in the trash has no address to renew; a new id there would restore to a link nobody was told.
  test("a site in the trash gets no new link", async () => {
    const world = await makeWorld();
    const id = await made(world, OWNER, "report");
    await deleteSite(world.install, OWNER, { site: id });

    expect(await newLink(world.install, OWNER, id)).toEqual({ ok: false, code: "in_trash" });
    expect(await world.audit()).toEqual(["create", "trash"]);
  });
});

describe("newLink with dry_run", () => {
  // Drift: a dry run that drew an id, or that passed a site the run refuses, would say an address stops that never does.
  test("a dry run answers the site as it is where the run after it gives a new id, the refusal where it refuses, and writes no row", async () => {
    const world = await makeWorld();
    const site = await made(world, OWNER, "report", { access: "unlisted" });
    const trashed = await made(world, OWNER, "old");
    await deleteSite(world.install, OWNER, { site: trashed });

    const linked = await rehearsedThenRun(world, (how) => newLink(world.install, OWNER, site, how));
    const refused = [
      await rehearsedThenRun(world, (how) => newLink(world.install, OWNER, trashed, how)),
      await rehearsedThenRun(world, (how) => newLink(world.install, STRANGER, linked.run.ok ? linked.run.site.id : "", how)),
      await rehearsedThenRun(world, (how) => newLink(world.install, OWNER, site, how)),
    ];

    expect(linked).toMatchObject({ written: 0, rehearsal: { ok: true, before: { id: site }, site: { id: site } }, run: { ok: true, before: { id: site } } });
    expect<unknown>(linked.rehearsal).toEqual({ ...linked.run, site: linked.run.ok ? linked.run.before : null });
    expect(refused.map((step) => [step.written, step.rehearsal])).toEqual(refused.map((step) => [0, step.run]));
    expect(refused.map((step) => step.run)).toMatchObject([{ code: "in_trash" }, { code: "not_found" }, { code: "not_found" }]);
  });
});
