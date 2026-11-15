import { expect, test } from "bun:test";

import { updateSite } from "@poplin/core/src/actions/set";

import { openDashboard } from "../support/install";
import { attributesOf, textsOf } from "../support/markup";

/** The rows of the table that hold a site. */
const ROWS = ".sites > li:not(.th)";

test("a row shows four things at rest: the site's name as the way into its panel, who can open it, its link from the site object, and its last change; the copy button and the menu sit at its end", async () => {
  const opened = await openDashboard();
  const admin = { scope: "admin", holder: opened.owner } as const;
  const site = await opened.publish("report");
  const reserved = await opened.install.database.reserveVersion(site.id);
  if (reserved.kind !== "reserved") throw new Error("no version was reserved");

  opened.clock.now += 60_000;
  await opened.install.database.addVersion(site.id, { number: reserved.number, keep: 3, bytes: 1_250_000, files: 14 }, { by: opened.owner, at: opened.clock.now });
  await updateSite(opened.install, admin, { site: site.id, access: "public", public_name: "docs", title: "Q3 sales" });

  const page = await (await opened.get("/")).text();
  const path = `/sites/report--${site.id}`;

  expect(await textsOf(page, `${ROWS} > span:not(.acts)`)).toEqual(["reportPublic", "Who can open it: Public", "Link: docs-page.example.com", "Updated: 2023-11-14 22:14 UTC"]);
  expect(await attributesOf(page, `${ROWS} .name a`, "href")).toEqual([path]);
  expect(await attributesOf(page, `${ROWS} .acts button[hidden]`, "data-copy")).toEqual(["https://docs-page.example.com"]);
  expect(await attributesOf(page, `${ROWS} .acts .pop a`, "href")).toEqual(["https://docs-page.example.com", `${path}?ask=rename`, `${path}?ask=duplicate`, `${path}?ask=new-link`]);
  expect(await attributesOf(page, `${ROWS} .acts form`, "action")).toEqual([`${path}/delete?from=list`]);
  expect(await attributesOf(await (await opened.get("/?access=public&q=rep")).text(), `${ROWS} .acts form`, "action")).toEqual([`${path}/delete?from=list&access=public&q=rep`]);
});

// Drift: the search box and the filter are plain links and one GET form; a row link or a filter that dropped the other would undo it on the next press.
test("the filter narrows the table to one access and the search to the names that hold the text; each keeps the other, and a row's link keeps both", async () => {
  const opened = await openDashboard();
  const report = await opened.publish("sales-report", "private");
  await opened.publish("report-draft", "unlisted");
  await opened.publish("notes", "private");
  const names = async (path: string): Promise<string[]> => textsOf(await (await opened.get(path)).text(), `${ROWS} .name a`);

  expect((await names("/")).sort()).toEqual(["notes", "report-draft", "sales-report"]);
  expect((await names("/?access=private")).sort()).toEqual(["notes", "sales-report"]);
  expect((await names("/?q=report")).sort()).toEqual(["report-draft", "sales-report"]);
  expect(await names("/?access=private&q=Report")).toEqual(["sales-report"]);
  expect(await names("/?access=nobody")).toHaveLength(3);
  // A search longer than any name matches nothing: cut to fit, it would find a site that does not hold it.
  expect(await names(`/?q=${"sales-report".padEnd(41, "x")}`)).toEqual([]);

  const narrowed = await (await opened.get("/?access=private&q=report")).text();

  expect(await attributesOf(narrowed, `${ROWS} .name a`, "href")).toEqual([`/sites/sales-report--${report.id}?access=private&q=report`]);
  expect(await attributesOf(narrowed, ".filter .pop a", "href")).toEqual(["/?q=report", "/?access=private&q=report", "/?access=unlisted&q=report", "/?access=public&q=report", "/?view=trash&q=report"]);
  expect(await textsOf(narrowed, '.filter .pop a[aria-current="true"]')).toEqual(["Private"]);
  expect(await attributesOf(narrowed, ".find input", "name")).toEqual(["access", "q"]);
  expect(await attributesOf(narrowed, ".find input", "value")).toEqual(["private", "report"]);
  expect(await attributesOf(narrowed, ".find a", "href")).toEqual(["/?access=private"]);
  expect(await textsOf(await (await opened.get("/?q=%3Cscript%3E")).text(), ".empty")).toEqual(['No sites match "<script>".']);
});

// Drift: the panel sits beside the table it came from; a panel that reset the table, or a close link that forgot the filter or the page, would lose the place.
test("a site's panel opens beside the table as it was shown, marks its row, and closes back to the same table on the same page", async () => {
  const opened = await openDashboard();
  const report = await opened.publish("report", "private");
  await opened.publish("notes", "private");
  const place = "access=private&after=1800000000000-zzzzzzzzzzzz";
  const page = await (await opened.get(`/sites/report--${report.id}?${place}`)).text();

  expect(await textsOf(page, `${ROWS} .name a`)).toHaveLength(2);
  expect(await attributesOf(page, ".sites > li.sel .name a", "href")).toEqual([`/?${place}`]);
  expect(await attributesOf(page, ".panel a.close", "href")).toEqual([`/?${place}`]);
  expect(await attributesOf(page, "h1 a", "href")).toEqual([`/?${place}`]);
  expect(await attributesOf(page, "div.app", "class")).toEqual(["app has-panel"]);
});

test("the trash filter shows the trash and only the trash, with a restore button in each row, and the other filters only what is outside it", async () => {
  const opened = await openDashboard();
  await opened.publish("kept");
  const gone = await opened.publish("gone");
  await opened.install.database.trashSite(gone.id, { by: opened.owner, at: opened.clock.now });

  const active = await (await opened.get("/")).text();
  const trash = await (await opened.get("/?view=trash")).text();
  const current = '.filter .pop a[aria-current="true"]';

  expect([await textsOf(active, `${ROWS} .name a`), await textsOf(trash, `${ROWS} .name a`)]).toEqual([["kept"], ["gone"]]);
  expect([await textsOf(active, current), await textsOf(trash, current)]).toEqual([["All sites"], ["Trash"]]);
  expect(await attributesOf(trash, `${ROWS} form`, "action")).toEqual([`/sites/gone--${gone.id}/restore`]);
  expect(await textsOf(await (await opened.get("/?view=trash&after=1-000000000000")).text(), ".empty")).toEqual(["The trash is empty."]);
});

test("the next-page link follows the list action's cursor, so every site is on exactly one page of twenty-five at most", async () => {
  const opened = await openDashboard();
  const names: string[] = [];

  for (let index = 0; index < 27; index += 1) {
    await opened.publish(`draft-${index}`);
    names.push(`draft-${index}`);
  }

  const pages: string[][] = [];
  let path: string | undefined = "/";

  while (path !== undefined) {
    const page: string = await (await opened.get(path)).text();
    pages.push(await textsOf(page, `${ROWS} .name a`));
    [path] = await attributesOf(page, '.foot a[rel="next"]', "href");
  }

  expect(pages.map((page) => page.length)).toEqual([25, 2]);
  expect(pages.flat().sort()).toEqual([...names].sort());
});

test("a cursor the list action refuses shows the refusal's sentence and not the cursor", async () => {
  const opened = await openDashboard();
  await opened.publish("report");

  const refused = await (await opened.get("/?after=%3Cscript%3E")).text();

  expect(await textsOf(refused, "p.notice.refused")).toEqual(["The value of after is not one it takes."]);
  expect(refused).not.toContain("<script>alert");
});
