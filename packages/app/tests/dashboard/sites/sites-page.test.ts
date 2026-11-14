import { expect, test } from "bun:test";

import { updateSite } from "@poplin/core/src/actions/set";

import { openDashboard } from "../support/install";

const HOSTILE_TITLES = [
  ["<script>alert(1)</script>", "&lt;script&gt;alert(1)&lt;/script&gt;"],
  ['"><img src=x onerror=alert(1)>', "&quot;&gt;&lt;img src=x onerror=alert(1)&gt;"],
  ["' onmouseover='alert(1)", "&#39; onmouseover=&#39;alert(1)"],
  ["</td></tr></table><h1>mine</h1>", "&lt;/td&gt;&lt;/tr&gt;&lt;/table&gt;&lt;h1&gt;mine&lt;/h1&gt;"],
  ["Tom & Jerry &amp; co", "Tom &amp; Jerry &amp;amp; co"],
  ["javascript:alert(1)", "javascript:alert(1)"],
] as const;

test("a row shows the site's name, its address from the site object as a link, access, title, size, live version, and last change", async () => {
  const opened = await openDashboard();
  const admin = { scope: "admin", holder: opened.owner } as const;
  const site = await opened.publish("report");
  const reserved = await opened.install.database.reserveVersion(site.id);
  if (reserved.kind !== "reserved") throw new Error("no version was reserved");

  opened.clock.now += 60_000;
  await opened.install.database.addVersion(site.id, { number: reserved.number, keep: 3, bytes: 1_250_000, files: 14 }, { by: opened.owner, at: opened.clock.now });
  await updateSite(opened.install, admin, { site: site.id, access: "public", public_name: "docs", title: "Q3 sales" });

  const page = await (await opened.get("/")).text();
  const [row = ""] = page.match(/<tr>\s*<td>[\s\S]*?<\/tr>/) ?? [];
  const cells = Array.from(row.matchAll(/<td[^>]*>([\s\S]*?)<\/td>/g), ([, cell]) => cell);

  expect(cells).toEqual([
    `<a href="/sites/report--${site.id}">report</a>`,
    '<a href="https://docs-page.example.com" rel="noreferrer">docs-page.example.com</a>',
    "public",
    "Q3 sales",
    "1.3 MB, 14 files",
    "v2",
    '<time datetime="2023-11-14T22:14:20.000Z">2023-11-14 22:14 UTC</time>',
  ]);
});

test("a title from the database reaches the table escaped, whatever markup it holds", async () => {
  const opened = await openDashboard();
  const admin = { scope: "admin", holder: opened.owner } as const;

  for (const [index, [title, escaped]] of HOSTILE_TITLES.entries()) {
    const site = await opened.publish(`site-${index}`);
    await updateSite(opened.install, admin, { site: site.id, title });

    const page = await (await opened.get("/")).text();

    expect(page).toContain(`<td class="wrap">${escaped}</td>`);
    expect(page).not.toContain(title === "javascript:alert(1)" ? "href=\"javascript" : title);
  }
});

test("the switch shows the trash and only the trash, and the active list only what is outside it", async () => {
  const opened = await openDashboard();
  const kept = await opened.publish("kept");
  const gone = await opened.publish("gone");
  await opened.install.database.trashSite(gone.id, { by: opened.owner, at: opened.clock.now });

  const active = await (await opened.get("/")).text();
  const trash = await (await opened.get("/?view=trash")).text();

  expect([active.includes(`kept--${kept.id}`), active.includes(`gone--${gone.id}`)]).toEqual([true, false]);
  expect([trash.includes(`kept--${kept.id}`), trash.includes(`gone--${gone.id}`)]).toEqual([false, true]);
  expect(active).toContain('<a href="/" aria-current="page">Active</a>');
  expect(trash).toContain('<a href="/?view=trash" aria-current="page">Trash</a>');
  expect(await (await opened.get("/?view=trash&after=1-000000000000")).text()).toContain("The trash is empty.");
});

test("the next-page link follows the list action's cursor, so every site is on exactly one page of twenty-five at most", async () => {
  const opened = await openDashboard();
  const labels: string[] = [];

  for (let index = 0; index < 27; index += 1) {
    const site = await opened.publish(`draft-${index}`);
    labels.push(`draft-${index}--${site.id}`);
  }

  const pages: string[][] = [];
  let path: string | undefined = "/";

  while (path !== undefined) {
    const page: string = await (await opened.get(path)).text();
    pages.push(Array.from(page.matchAll(/<td><a href="\/sites\/([^"]+)">/g), ([, label = ""]) => label));
    path = /<a href="([^"]+)">Next page<\/a>/.exec(page)?.[1]?.replaceAll("&amp;", "&");
  }

  expect(pages.map((page) => page.length)).toEqual([25, 2]);
  expect(pages.flat().sort()).toEqual([...labels].sort());
});

test("a cursor the list action refuses shows the refusal's sentence and not the cursor", async () => {
  const opened = await openDashboard();
  await opened.publish("report");

  const refused = await (await opened.get("/?after=%3Cscript%3E")).text();

  expect(refused).toContain('<p class="notice refused" role="status">The value of after is not one it takes.</p>');
  expect(refused).not.toContain("<script>");
});
