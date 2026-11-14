import { describe, expect, test } from "bun:test";

import { deleteSite } from "../../src/actions/delete";
import { publishSite } from "../../src/actions/publish";
import { rollbackSite } from "../../src/actions/rollback";
import { getSite } from "../../src/actions/show";
import { made, makeWorld, OWNER, pages } from "./support/actions-fixture";

describe("rollbackSite", () => {
  // Drift: rollback is the undo of a bad publish; one that moved to a version whose files were dropped would serve nothing.
  test("a rollback goes to the previous kept version, again one further, `version` to the one named, and a publish after it is the next number", async () => {
    const world = await makeWorld();
    const id = await made(world, OWNER, "report", { access: "unlisted" });
    await publishSite(world.install, OWNER, { files: pages("report v2"), site: id });
    await publishSite(world.install, OWNER, { files: pages("report v3"), site: id });
    const keys = await world.keys();

    const steps = [
      await rollbackSite(world.install, OWNER, { site: id }),
      await rollbackSite(world.install, OWNER, { site: id }),
      await rollbackSite(world.install, OWNER, { site: id }),
      await rollbackSite(world.install, OWNER, { site: id, version: 3 }),
      await rollbackSite(world.install, OWNER, { site: id, version: 3 }),
      await rollbackSite(world.install, OWNER, { site: id, version: 4 }),
      await rollbackSite(world.install, OWNER, { site: id, version: 1.5 }),
      await rollbackSite(world.install, OWNER, { site: id, version: 2 }),
    ];
    const next = await publishSite(world.install, OWNER, { files: pages("report v4"), site: id });

    expect(steps).toMatchObject([
      { ok: true, site: { live_version: 2, access: "unlisted" } },
      { ok: true, site: { live_version: 1 } },
      { ok: false, code: "no_such_version" },
      { ok: true, site: { live_version: 3 } },
      { ok: true, site: { live_version: 3 } },
      { ok: false, code: "no_such_version" },
      { ok: false, code: "bad_argument", about: "version" },
      { ok: true, site: { live_version: 2, versions: [{ number: 1 }, { number: 2 }, { number: 3 }] } },
    ]);
    expect(next).toMatchObject({ ok: true, site: { live_version: 4, versions: [{ number: 2 }, { number: 3 }, { number: 4 }] } });
    expect(await world.audit()).toEqual(["create", "publish", "publish", "live_version", "live_version", "live_version", "live_version", "publish"]);
    expect((await world.keys()).length).toBe(keys.length);
  });

  // Drift: a site in the trash is not served; moving its live version there would change what a restore brings back.
  test("a site in the trash is not rolled back", async () => {
    const world = await makeWorld();
    const id = await made(world, OWNER, "report");
    await publishSite(world.install, OWNER, { files: pages("report v2"), site: id });
    await deleteSite(world.install, OWNER, { site: id });

    expect(await rollbackSite(world.install, OWNER, { site: id })).toEqual({ ok: false, code: "in_trash" });
    expect(await getSite(world.install, OWNER, id)).toMatchObject({ site: { live_version: 2 } });
  });
});
