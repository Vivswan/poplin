import { expect, test } from "bun:test";

import { deleteSite } from "@poplin/core/src/actions/delete";
import { newLink } from "@poplin/core/src/actions/new-link";
import { updateSite } from "@poplin/core/src/actions/set";

import { openDashboard } from "../support/install";

const ROW = /<tr><td>(?:<time[^>]*>)?([^<]*)(?:<\/time>)?<\/td><td>([^<]*)<\/td><td>([^<]*)<\/td><td>(.*?)<\/td><\/tr>/g;

test("the log shows when, who, what, and which site, the newest first; a site is a link only while the id its entry names is still a site", async () => {
  const opened = await openDashboard();
  const admin = { scope: "admin", holder: opened.owner } as const;
  const kept = await opened.publish("kept");
  const gone = await opened.publish("gone");

  opened.clock.now += 60_000;
  await updateSite(opened.install, admin, { site: kept.id, access: "private" });
  const relinked = await newLink(opened.install, admin, kept.id);
  await deleteSite(opened.install, admin, { site: gone.id, forever: true });
  if (!relinked.ok) throw new Error("the site got no new link");

  const page = await (await opened.get("/activity")).text();
  const link = `<a href="/sites/${relinked.site.label}">kept</a>`;

  expect(Array.from(page.matchAll(ROW), (row) => row.slice(1))).toEqual([
    ["2023-11-14 22:14 UTC", "owner@example.com", "deleted forever", "gone"],
    ["2023-11-14 22:14 UTC", "owner@example.com", "made a new link", link],
    ["2023-11-14 22:14 UTC", "owner@example.com", "changed the access", "kept"],
    ["2023-11-14 22:13 UTC", "owner@example.com", "made the site", "gone"],
    ["2023-11-14 22:13 UTC", "owner@example.com", "made the site", "kept"],
    ["2023-11-14 22:13 UTC", "owner@example.com", "set the first settings", ""],
  ]);
});

test("the older link follows the log's own sequence, so every entry is on exactly one page of fifty at most", async () => {
  const opened = await openDashboard();
  const site = await opened.publish("report");

  for (let index = 0; index < 60; index += 1) {
    await opened.install.database.changeDetails(site.id, { title: `title ${index}` }, { by: opened.owner, at: opened.clock.now });
  }

  const first = await (await opened.get("/activity")).text();
  const [, older = ""] = /<a href="([^"]+)">Older<\/a>/.exec(first) ?? [];
  const second = await (await opened.get(older)).text();

  expect(older).toBe("/activity?before=13");
  expect([first.match(/<tr><td>/g)?.length, second.match(/<tr><td>/g)?.length]).toEqual([50, 12]);
  expect([first.includes(">Newest<"), second.includes(">Newest<"), second.includes(">Older<")]).toEqual([false, true, false]);
});

test("a place the audit action refuses shows the refusal's sentence and not the place", async () => {
  const opened = await openDashboard();
  const page = await (await opened.get("/activity?before=%3Cscript%3E")).text();

  expect(page).toContain('<p class="notice refused" role="status">The value of before is not one it takes.</p>');
  expect(page).not.toContain("<script>");
});

test("a run on the domain is told truthfully from its entry: a check, a repair, and a repair that stopped with the row it stopped at", async () => {
  const opened = await openDashboard();
  const runs = [
    [{ run: "check", from: "dashboard", missing: ["DNS record: poplin.example.com"] }, "checked the domain"],
    [{ run: "repair", from: "setup", created: ["DNS record: poplin.example.com"] }, "repaired the domain"],
    [{ run: "repair", from: "dashboard", created: ["DNS record: poplin.example.com"], failed: ["Route: poplin.example.com/*: refused with status 403"] }, "repair stopped at Route"],
  ] as const;

  for (const [index, [detail]] of runs.entries()) await opened.install.database.appendAudit({ action: "domain_synced", detail }, { by: opened.owner, at: opened.clock.now + index });

  const page = await (await opened.get("/activity")).text();
  const told = [...page.matchAll(/<td>([^<]*the domain|repair stopped[^<]*)<\/td>/g)].map((match) => match[1]);

  expect(told).toEqual(runs.map(([, words]) => words).reverse());
});
