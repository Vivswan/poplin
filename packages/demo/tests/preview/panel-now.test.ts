import { expect, test } from "bun:test";

import { deleteSite } from "../../../core/src/actions/delete";
import { publishSite } from "../../../core/src/actions/publish";
import { updateSite } from "../../../core/src/actions/set";
import { file } from "../../../core/tests/actions/support/actions-fixture";
import { SqlJsDriver } from "../../src/browser/sqljs-driver";
import { panelNow } from "../../src/preview/panel-now";
import { openWorld, type World } from "../../src/preview/world";
import { SQLITE } from "../browser/support/sqlite";

/** An id of the right form that no site of a test has. */
const GONE = "000000000000";

/** Publish a one-page site under a name, and answer its label. */
async function publish(world: World, name: string): Promise<string> {
  const published = await publishSite(world.install, world.admin, { files: [file("index.html", "<!doctype html>\n<title>A page</title>\n")], name });
  if (!published.ok) throw new Error(`the publish of ${name} was refused`);

  return published.site.label;
}

// Drift: a page loaded again after the sample data was made anew stays on "No site is at this address", though the site it showed is in the list under another id.
test("a panel's address with an id no site has leads to the one site of that name, and every other address is left alone", async () => {
  const world = await openWorld(new SqlJsDriver(SQLITE));
  const report = await publish(world, "report");
  const renamed = await publish(world, "notes");
  await updateSite(world.install, world.admin, { site: renamed, name: "minutes" });
  const notes = await publish(world, "notes");
  const trashed = await publish(world, "draft");
  await deleteSite(world.install, world.admin, { site: trashed });
  const draft = await publish(world, "draft");
  await publish(world, "twice");
  const second = await publish(world, "twice");

  const asked = [`/sites/report--${GONE}`, `/sites/notes--${GONE}`, `/sites/draft--${GONE}`, `/sites/${report}`, `/sites/${renamed}`, `/sites/${trashed}`, `/sites/${second}`];
  const elsewhere = [`/sites/twice--${GONE}`, `/sites/absent--${GONE}`, "/sites/report", `/data/sites/report--${GONE}`, "/activity"];
  const led = await Promise.all([...asked, ...elsewhere].map((path) => panelNow(world, path)));

  expect(led).toEqual([`/sites/${report}`, `/sites/${notes}`, `/sites/${draft}`, ...Array.from({ length: 9 }, () => undefined)]);
});
