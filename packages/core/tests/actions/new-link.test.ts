import { describe, expect, test } from "bun:test";

import { deleteSite } from "../../src/actions/delete";
import { newLink } from "../../src/actions/new-link";
import { getSite } from "../../src/actions/show";
import { ADMIN, made, makeWorld, OWNER } from "./support/actions-fixture";

describe("newLink", () => {
  // Drift: a new link is how a leaked address is taken back; an old id that still answered would leave the leak open.
  test("a new link gives a new id at once: the old reference finds nothing, and the public name and the files follow the site", async () => {
    const world = await makeWorld();
    const old = await made(world, OWNER, "report", { access: "public" });
    const keys = await world.keys();
    const renamed = await newLink(world.install, OWNER, `report--${old}`);
    if (!renamed.ok) throw new Error("the new link was refused");

    expect(renamed.site).toMatchObject({ label: `report--${renamed.site.id}`, public_name: "report", addresses: { site: `https://report--${renamed.site.id}-page.example.com` } });
    expect(renamed.site.id).not.toBe(old);
    expect([await getSite(world.install, OWNER, old), await getSite(world.install, ADMIN, `report--${old}`)]).toEqual([
      { ok: false, code: "not_found" },
      { ok: false, code: "not_found" },
    ]);
    expect(renamed.before).toMatchObject({ id: old, label: `report--${old}` });
    expect(await getSite(world.install, OWNER, "report")).toEqual({ ok: true, before: renamed.site, site: renamed.site });
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
