import { expect, test } from "bun:test";

import { deleteSite } from "../../../core/src/actions/delete";
import { publishSite } from "../../../core/src/actions/publish";
import { updateSite } from "../../../core/src/actions/set";
import { file } from "../../../core/tests/actions/support/actions-fixture";
import { SqlJsDriver } from "../../src/browser/sqljs-driver";
import { addressNow } from "../../src/preview/address-now";
import { kindOf } from "../../src/preview/kind";
import { openWorld, type World } from "../../src/preview/world";
import { SQLITE } from "../browser/support/sqlite";

/** The origin the preview is asked at. */
const ORIGIN = "http://127.0.0.1:4400";

/** An id of the right form that no site of a test has. */
const GONE = "000000000000";

/** Publish a one-page site under a name, and answer its label. */
async function publish(world: World, name: string): Promise<string> {
  const published = await publishSite(world.install, world.admin, { files: [file("index.html", "<!doctype html>\n<title>A page</title>\n")], name });
  if (!published.ok) throw new Error(`the publish of ${name} was refused`);

  return published.site.label;
}

// Drift: a page loaded again after the sample data was made anew stays on "No site is at this address", though the site it showed is in the list under another id.
// Drift: a sample site open in a tab of its own, loaded again or left by a link after that, ends on Not found, though the site is served under another id.
test("an address of a panel or of a served site with an id no site has leads to the one site of that name, and every other address is left alone", async () => {
  const world = await openWorld(new SqlJsDriver(SQLITE), kindOf());
  const report = await publish(world, "report");
  const renamed = await publish(world, "notes");
  await updateSite(world.install, world.admin, { site: renamed, name: "minutes" });
  const notes = await publish(world, "notes");
  await updateSite(world.install, world.admin, { site: notes, access: "unlisted" });
  const trashed = await publish(world, "draft");
  await deleteSite(world.install, world.admin, { site: trashed });
  const draft = await publish(world, "draft");
  await publish(world, "twice");
  const second = await publish(world, "twice");

  const panels = [`/sites/report--${GONE}`, `/sites/notes--${GONE}`, `/sites/draft--${GONE}`];
  const served = [`/served/report--${GONE}-p-poplin/`, `/served/report--${GONE}-u-poplin/a/b.html`, `/served/notes--${GONE}-p-poplin/`, `/served/draft--${GONE}-p-poplin/`];
  const live = [`/sites/${report}`, `/sites/${renamed}`, `/sites/${trashed}`, `/sites/${second}`, `/served/${report}-p-poplin/`, `/served/${trashed}-p-poplin/`];
  const elsewhere = [`/sites/twice--${GONE}`, `/sites/absent--${GONE}`, "/sites/report", `/data/sites/report--${GONE}`, "/activity", `/served/twice--${GONE}-p-poplin/`, `/served/${GONE}-p-poplin/`, "/served/report-poplin/"];
  // A site's address without its closing slash is no site's yet: the preview adds the slash first.
  const slashless = [`/served/draft--${GONE}-p-poplin`];
  const led = await Promise.all([...panels, ...served, ...live, ...elsewhere, ...slashless].map((path) => addressNow(world, new URL(path, ORIGIN))));

  const now = [`/sites/${report}`, `/sites/${notes}`, `/sites/${draft}`, `/served/${report}-p-poplin/`, `/served/${report}-p-poplin/a/b.html`, `/served/${notes}-u-poplin/`, `/served/${draft}-p-poplin/`];
  expect(led).toEqual([...now, ...Array.from({ length: live.length + elsewhere.length + slashless.length }, () => undefined)]);
});
