import { describe, expect, test } from "bun:test";

import { deleteSite } from "../../src/actions/delete";
import { restoreSite } from "../../src/actions/restore";
import { getSite } from "../../src/actions/show";
import { sweepExpired } from "../../src/actions/sweep";
import type { SiteId } from "../../src/sites/ids";
import { ADMIN, DAY, made, makeWorld, NOW, OWNER } from "./support/actions-fixture";

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
    expect([await world.install.database.findServed({ id }, world.clock.now), await getSite(world.install, OWNER, id)]).toMatchObject([{ id, expires: kept }, { site: { state: "live", expires: kept } }]);
  });
});
