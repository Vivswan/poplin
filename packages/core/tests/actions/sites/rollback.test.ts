import { describe, expect, test } from "bun:test";

import { deleteSite } from "../../../src/actions/sites/delete";
import { publishSite } from "../../../src/actions/publish/publish";
import { rollbackSite } from "../../../src/actions/sites/rollback";
import { getSite } from "../../../src/actions/sites/show";
import { made, makeWorld, OWNER, pages, rehearsedThenRun } from "../support/actions-fixture";

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

describe("rollbackSite with dry_run", () => {
  // Drift: a dry run picks the version a rollback would go to beside the statement that moves it; one that picked another would name a version the run does not make live.
  test("a dry run answers the version or the refusal the run after it answers, and writes no row", async () => {
    const world = await makeWorld();
    const site = await made(world, OWNER, "report");
    await publishSite(world.install, OWNER, { files: pages("report v2"), site });
    await publishSite(world.install, OWNER, { files: pages("report v3"), site });
    world.clock.now += 1000;
    const asked = [{}, {}, {}, { version: 3 }, { version: 3 }, { version: 4 }, { version: 1.5 }, { version: 1 }];
    const steps = [];
    for (const request of asked) steps.push(await rehearsedThenRun(world, (how) => rollbackSite(world.install, OWNER, { site, ...request, ...how })));

    await deleteSite(world.install, OWNER, { site });
    steps.push(await rehearsedThenRun(world, (how) => rollbackSite(world.install, OWNER, { site, ...how })));

    expect(steps.map((step) => [step.written, step.rehearsal])).toEqual(steps.map((step) => [0, step.run]));
    expect(steps.map((step) => (step.run.ok ? step.run.site.live_version : step.run.code))).toEqual([2, 1, "no_such_version", 3, 3, "no_such_version", "bad_argument", 1, "in_trash"]);
  });
});
