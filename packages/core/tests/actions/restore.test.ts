import { describe, expect, test } from "bun:test";

import { deleteSite } from "../../src/actions/delete";
import { restoreSite } from "../../src/actions/restore";
import { getSite } from "../../src/actions/show";
import { sweepExpired } from "../../src/actions/sweep";
import type { SiteId } from "../../src/sites/ids";
import { ADMIN, DAY, made, makeWorld, NOW, OWNER, rehearsedThenRun } from "./support/actions-fixture";

describe("restoreSite", () => {
  // Drift: a restored site whose expiry had passed would answer live with a url yet be served to nobody, and the next sweep would trash it again; its owner could change no setting in the trash to stop that.
  test.each([
    ["an expiry that passed while the site sat in the trash is cleared", "1d", "never"],
    ["an expiry still ahead is kept", "5d", NOW + 5 * DAY],
  ] as const)("%s", async (_why, expires, kept) => {
    const world = await makeWorld();
    const id = (await made(world, OWNER, "report", { expires })) as SiteId;
    world.clock.now = NOW + 2 * DAY;
    const swept = await sweepExpired(world.install, ADMIN, { limit: 10 });
    await deleteSite(world.install, OWNER, { site: id });

    const restored = await restoreSite(world.install, OWNER, id);
    const again = await sweepExpired(world.install, ADMIN, { limit: 10 });

    expect([swept, restored, again]).toMatchObject([
      { ok: true, trashed: kept === "never" ? 1 : 0 },
      { ok: true, before: { state: "trash", expires: NOW + Number.parseInt(expires, 10) * DAY }, site: { state: "live", expires: kept, updated: NOW } },
      { ok: true, trashed: 0 },
    ]);
    expect([await world.install.database.findServed({ id }, world.clock.now), await getSite(world.install, OWNER, id)]).toMatchObject([{ site: { id, expires: kept } }, { site: { state: "live", expires: kept } }]);
  });
});

describe("restoreSite with dry_run", () => {
  // Drift: a restore clears an expiry that passed in the trash; a dry run that kept it would show a site that expires in the past where the run shows one that never does.
  test("a dry run answers the site or the refusal the run after it answers, an expiry that passed cleared and one ahead kept, and writes no row", async () => {
    const world = await makeWorld();
    const passed = await made(world, OWNER, "report", { expires: "2d" });
    const ahead = await made(world, OWNER, "notes", { expires: "30d" });
    const live = await made(world, OWNER, "docs");
    await deleteSite(world.install, OWNER, { site: passed });
    await deleteSite(world.install, OWNER, { site: ahead });
    world.clock.now += 3 * DAY;
    const steps = [];
    for (const site of [passed, ahead, live, passed]) steps.push(await rehearsedThenRun(world, (how) => restoreSite(world.install, OWNER, site, how)));

    expect(steps.map((step) => [step.written, step.rehearsal])).toEqual(steps.map((step) => [0, step.run]));
    expect(steps.map((step) => (step.run.ok ? step.run.site.expires : step.run.code))).toEqual(["never", NOW + 30 * DAY, "not_in_trash", "not_in_trash"]);
  });
});
