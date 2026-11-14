import { expect, test } from "bun:test";

import { updateSite } from "@poplin/core/src/actions/set";

import { openDashboard } from "../support/install";

const CHANGES = /action="\/sites\/[^/"]+\/([a-z-]+)"/g;

test("a live site's page offers every setting of the set action, rollback, a new link, and delete; one in the trash only restore and delete forever", async () => {
  const opened = await openDashboard();
  const live = await opened.publish("report");
  const trashed = await opened.publish("old");
  await opened.install.database.trashSite(trashed.id, { by: opened.owner, at: opened.clock.now });

  const livePage = await (await opened.get(`/sites/report--${live.id}`)).text();
  const trashPage = await (await opened.get(`/sites/old--${trashed.id}`)).text();

  expect(Array.from(livePage.matchAll(CHANGES), ([, change]) => change)).toEqual(["settings", "new-link", "delete"]);
  expect(Array.from(livePage.matchAll(/<input[^>]* name="([a-z_]+)"/g), ([, name]) => name).filter((name) => name !== "csrf")).toEqual(["access", "access", "access", "public_name", "title", "search_engines", "embeddable", "expires"]);
  expect(livePage).toContain("The current address stops working at once.");
  expect(livePage).toContain("Only one version is kept");
  expect(Array.from(trashPage.matchAll(CHANGES), ([, change]) => change)).toEqual(["restore", "delete-forever"]);
  expect(trashPage).toContain(`The label is <code>old--${trashed.id}</code>.`);
  expect(trashPage).toContain("<dt>In the trash until</dt>");
});

test("the form shows the site as it is stored: the access, the public name, the title, and both switches", async () => {
  const opened = await openDashboard();
  const site = await opened.publish("report");
  await updateSite(opened.install, { scope: "admin", holder: opened.owner }, { site: site.id, access: "public", public_name: "docs", title: "Q3", search_engines: true, embeddable: false, expires: "2030-01-01" });

  const page = await (await opened.get(`/sites/report--${site.id}`)).text();

  expect(page.match(/<input type="radio"[^>]*>/g)).toEqual([
    '<input type="radio" name="access" value="private">',
    '<input type="radio" name="access" value="unlisted">',
    '<input type="radio" name="access" value="public" checked>',
  ]);
  expect(page).toContain('name="public_name" value="docs"');
  expect(page).toContain('name="title" value="Q3"');
  expect(page).toContain('name="search_engines" value="on" checked>');
  expect(page).toContain('name="embeddable" value="on">');
  expect(page).toContain('<dd><a href="https://docs-page.example.com" rel="noreferrer">https://docs-page.example.com</a></dd>');
  expect(page).toContain('Now: <time datetime="2030-01-01T00:00:00.000Z">2030-01-01 00:00 UTC</time>.');
});

test("a site with more kept versions offers each of them but the live one to roll back to, and the one before only when a lower one is kept", async () => {
  const opened = await openDashboard();
  const site = await opened.publish("report");

  for (const bytes of [10, 20]) {
    const reserved = await opened.install.database.reserveVersion(site.id);
    if (reserved.kind !== "reserved") throw new Error("no version was reserved");

    await opened.install.database.addVersion(site.id, { number: reserved.number, keep: 3, bytes, files: 1 }, { by: opened.owner, at: opened.clock.now });
  }

  const page = await (await opened.get(`/sites/report--${site.id}`)).text();

  expect(page.match(/<option[^>]*>[^<]*/g)).toEqual(['<option value="previous">the one before v3', '<option value="1">v1', '<option value="2">v2']);
  expect(page).toContain("<dd>v1, v2, v3 (live)</dd>");

  await opened.install.database.setLiveVersion(site.id, 1, { by: opened.owner, at: opened.clock.now });
  const lowest = await (await opened.get(`/sites/report--${site.id}`)).text();

  expect(lowest.match(/<option[^>]*>[^<]*/g)).toEqual(['<option value="2">v2', '<option value="3">v3']);
});

test("a title with markup stays text in the page and inside the input's value", async () => {
  const opened = await openDashboard();
  const site = await opened.publish("report");
  await updateSite(opened.install, { scope: "admin", holder: opened.owner }, { site: site.id, title: `"><script>alert(1)</script>` });

  const page = await (await opened.get(`/sites/report--${site.id}`)).text();

  expect(page).toContain('name="title" value="&quot;&gt;&lt;script&gt;alert(1)&lt;/script&gt;"');
  expect(page).toContain("<dd>&quot;&gt;&lt;script&gt;alert(1)&lt;/script&gt;</dd>");
  expect(page).not.toContain("<script>");
});

test("an expiry no calendar holds, which the set action takes, is shown as its number and the page still renders", async () => {
  const opened = await openDashboard();
  const site = await opened.publish("report");
  await updateSite(opened.install, { scope: "admin", holder: opened.owner }, { site: site.id, expires: "100000000d" });

  const answer = await opened.get(`/sites/report--${site.id}`);

  expect(answer.status).toBe(200);
  expect(await answer.text()).toContain(`<dt>Expires</dt><dd>${opened.clock.now + 100_000_000 * 86_400_000}</dd>`);
});

test("a reference to no site answers 404 with the refusal's sentence, and the reference itself is not echoed", async () => {
  const opened = await openDashboard();
  const cases = [
    ["/sites/report--000000000000", "No site with that id or public name."],
    ["/sites/%3Cscript%3Ealert(1)%3C%2Fscript%3E", "The value of site is not one it takes."],
    ["/sites/%E0%A4%A", "The value of site is not one it takes."],
  ] as const;

  for (const [path, sentence] of cases) {
    const answer = await opened.get(path);
    const page = await answer.text();

    expect([path, answer.status]).toEqual([path, 404]);
    expect(page).toContain(`<p class="notice refused" role="status">${sentence}</p>`);
    expect(page).not.toContain("<script>");
  }
});
