import { expect, test } from "bun:test";

import { publishSite } from "@poplin/core/src/actions/publish";
import { updateSite } from "@poplin/core/src/actions/set";
import { getSite } from "@poplin/core/src/actions/show";
import { mintToken } from "@poplin/core/src/auth/tokens";

import { type Opened, openDashboard } from "../support/install";
import { attributesOf, textsOf } from "../support/markup";

const PAGE = { path: "index.html", size: 4, contentType: "text/html", open: (): ReadableStream<Uint8Array> => new Blob(["page"]).stream() };

/** The changes the forms of a page's panel post, each as the last part of its form's address. */
async function changesOf(page: string): Promise<string[]> {
  return (await attributesOf(page, ".panel form", "action")).map((action) => action.replace(/^.*\//, ""));
}

async function pageOf(opened: Opened, path: string): Promise<string> {
  return (await opened.get(path)).text();
}

// Drift: the panel is the only place a site's changes are made from; a form dropped from it leaves a change with no button.
test("a live site's panel offers a more private access, a copy, every other setting, and delete; one in the trash only restore and delete forever; its views are worded as estimates", async () => {
  const opened = await openDashboard();
  const live = await opened.publish("report", "unlisted");
  const trashed = await opened.publish("old");
  await opened.install.database.trashSite(trashed.id, { by: opened.owner, at: opened.clock.now });

  await opened.install.database.addRequests({ day: "2023-11-14", site: live.id, requests: 40, views: 37 });
  await opened.install.database.addRequests({ day: "2023-11-12", site: live.id, requests: 9, views: 5 });

  const livePage = await pageOf(opened, `/sites/report--${live.id}`);
  const trashPage = await pageOf(opened, `/sites/old--${trashed.id}`);

  expect(await changesOf(livePage)).toEqual(["access", "settings", "delete"]);
  expect((await attributesOf(livePage, ".panel input", "name")).filter((name) => name !== "csrf")).toEqual(["access", "access", "title", "search_engines", "embeddable", "expires"]);
  expect(await textsOf(livePage, ".panel .facts dd")).toContain("about 37 today, about 42 in 7 days");
  expect(await changesOf(trashPage)).toEqual(["restore", "delete-forever"]);
  expect(await textsOf(trashPage, 'label[for="confirm"] code')).toEqual(["old"]);
  expect(await textsOf(trashPage, ".panel")).not.toContainEqual(expect.stringContaining(trashed.id));
  expect(await textsOf(trashPage, ".panel .facts dt")).toContain("Gone for good");
});

// Drift: opening a site to more people, a new name, and a new link each cost something; a button that did it at once, with no question, would do it on a slip.
test("a less private access, a rename, a copy, and a new link are each asked about first: the question shows only when the address asks for it, and holds the form", async () => {
  const opened = await openDashboard();
  const site = await opened.publish("report", "private");
  const path = `/sites/report--${site.id}`;
  const forms = async (ask: string): Promise<string[]> => changesOf(await pageOf(opened, `${path}${ask}`));

  expect(await forms("")).toEqual(["settings", "delete"]);
  expect(await forms("?ask=unlisted")).toEqual(["access", "settings", "delete"]);
  expect(await forms("?ask=public")).toEqual(["access", "settings", "delete"]);
  expect(await forms("?ask=private")).toEqual(["settings", "delete"]);
  expect(await forms("?ask=rename")).toEqual(["rename", "settings", "delete"]);
  expect(await forms("?ask=duplicate")).toEqual(["settings", "delete", "duplicate"]);
  expect(await forms("?ask=new-link")).toEqual(["settings", "delete", "new-link"]);
  expect(await attributesOf(await pageOf(opened, path), ".panel a.txt", "href")).toEqual([`${path}?ask=duplicate`, `${path}?ask=new-link`]);
  expect(await attributesOf(await pageOf(opened, `${path}?ask=public`), '#ask input[name="public_name"]', "placeholder")).toEqual(["report"]);
});

// Drift: a refused name sent back to an empty field is typed again, and its reason at the far corner of the page is missed.
test("a refused rename comes back with the typed name in its field and the reason beside it, said once", async () => {
  const opened = await openDashboard();
  const site = await opened.publish("report", "private");
  const refused = await opened.post(`/sites/report--${site.id}/rename`, { name: "No Such <i>" });
  const page = await pageOf(opened, refused.headers.get("Location") ?? "");

  expect(await attributesOf(page, '#ask input[name="name"]', "value")).toEqual(["No Such <i>"]);
  expect(await textsOf(page, ".panel .hint.bad")).toEqual(["The name breaks the rules: 3 to 40 characters, lowercase letters, digits, and single dashes inside."]);
  expect(await textsOf(page, "body > .notice")).toEqual([]);
  expect(page).not.toContain("<i>");

  // A site trashed meanwhile has no rename field to say the reason at: the page's own line says it.
  await opened.install.database.trashSite(site.id, { by: opened.owner, at: opened.clock.now });
  const late = await opened.post(`/sites/report--${site.id}/rename`, { name: "notes" });

  expect(await textsOf(await pageOf(opened, late.headers.get("Location") ?? ""), "body > .notice")).toEqual(["The site sits in the trash. Restore it first."]);
});

// Drift: a version is published by a login or by a token; a token is stored by its id, which says nothing to a person.
test("a version a token published shows the token's name, and one a person published their email", async () => {
  const opened = await openDashboard();
  const site = await opened.publish("report");
  const { record } = await mintToken({ scope: "publisher", note: "work laptop", now: opened.clock.now });
  await opened.install.database.addToken(record, { by: opened.owner, at: opened.clock.now });
  const reserved = await opened.install.database.reserveVersion(site.id);
  if (reserved.kind !== "reserved") throw new Error("no version was reserved");

  await opened.install.database.addVersion(site.id, { number: reserved.number, keep: 3, bytes: 1, files: 1 }, { by: record.id, at: opened.clock.now });
  const page = await pageOf(opened, `/sites/report--${site.id}`);

  expect((await textsOf(page, ".ver > .soft")).map((line) => line.replace(/^.*UTC, /, ""))).toEqual(["work laptop", opened.owner]);
});

test("the panel shows the site as it is stored: the access it has, the short link and its name, the title, and both switches", async () => {
  const opened = await openDashboard();
  const site = await opened.publish("report");
  await updateSite(opened.install, { scope: "admin", holder: opened.owner }, { site: site.id, access: "public", public_name: "docs", title: "Q3", search_engines: true, embeddable: false, expires: "2030-01-01" });

  const page = await pageOf(opened, `/sites/report--${site.id}`);
  const value = async (name: string): Promise<string[]> => attributesOf(page, `.panel details input[name="${name}"]`, "value");

  expect(await textsOf(page, '.panel .seg [aria-current="true"]')).toEqual(["Public"]);
  expect([await value("access"), await value("public_name"), await value("title")]).toEqual([["public"], ["docs"], ["Q3"]]);
  expect(await attributesOf(page, ".panel input[checked]", "name")).toEqual(["search_engines"]);
  expect(await textsOf(page, ".panel .line .lk")).toEqual(["docs-page.example.com"]);
  expect(await attributesOf(page, ".panel button[data-copy]", "data-copy")).toEqual(["https://docs-page.example.com"]);
  expect(await textsOf(page, ".panel details time")).toEqual(["2030-01-01 00:00 UTC"]);
});

// Drift: an unlisted site's id is the key to it; shown in full in the table or at the top of the panel, a glance at the screen gives the site away.
test("an unlisted site's id is left out of its link in the table and in the panel until the whole link is asked for, and the copy button still gives all of it", async () => {
  const opened = await openDashboard();
  const site = await opened.publish("report", "unlisted");
  const page = await pageOf(opened, `/sites/report--${site.id}`);
  const address = `report--${site.id}-u-poplin.example.com`;

  expect(await textsOf(page, ".sites .lk")).toEqual(["report--******-u-poplin.example.com"]);
  expect(await textsOf(page, ".panel .line .lk")).toEqual(["report--******-u-poplin.example.com"]);
  expect(await textsOf(page, ".panel details .lk")).toEqual([address]);
  expect(await attributesOf(page, "button[data-copy]", "data-copy")).toEqual([`https://${address}`, `https://${address}`]);
});

test("a site with more kept versions offers each of them but the live one to go back to, the newest first", async () => {
  const opened = await openDashboard();
  const site = await opened.publish("report");

  for (const bytes of [10, 20]) {
    const reserved = await opened.install.database.reserveVersion(site.id);
    if (reserved.kind !== "reserved") throw new Error("no version was reserved");

    await opened.install.database.addVersion(site.id, { number: reserved.number, keep: 3, bytes, files: 1 }, { by: opened.owner, at: opened.clock.now });
  }

  const versions = async (): Promise<string[][]> => {
    const page = await pageOf(opened, `/sites/report--${site.id}`);

    return [await textsOf(page, ".ver b"), await textsOf(page, ".ver .live"), await attributesOf(page, '.ver input[name="version"]', "value")];
  };

  expect(await versions()).toEqual([
    ["v3", "v2", "v1"],
    ["live", "", ""],
    ["2", "1"],
  ]);

  await opened.install.database.setLiveVersion(site.id, 1, { by: opened.owner, at: opened.clock.now });

  expect(await versions()).toEqual([
    ["v3", "v2", "v1"],
    ["", "", "live"],
    ["3", "2"],
  ]);
});

// Drift: the form posts every field it shows; a title field filled with the page's own title would turn it into a typed one on any save.
test("a site with no typed title shows its page's title and an empty title field, so saving another setting leaves the title untyped", async () => {
  const opened = await openDashboard();
  const admin = { scope: "admin", holder: opened.owner } as const;
  const made = await publishSite(opened.install, admin, { name: "report", page_title: "Field notes", files: [PAGE] });
  if (!made.ok) throw new Error(`the fixture site was refused: ${made.code}`);

  const path = `/sites/${made.site.label}`;
  const page = await pageOf(opened, path);
  const [title = "missing"] = await attributesOf(page, '.panel input[name="title"]', "value");
  const saved = await opened.post(`${path}/settings`, { access: "private", title, search_engines: "on", expires: "" });
  const after = await getSite(opened.install, admin, made.site.id);

  expect(await textsOf(page, ".panel .facts dd")).toContain("Field notes");
  expect(title).toBe("");
  expect(saved.headers.get("Location")).toBe(`${path}?done=saved`);
  expect(after).toMatchObject({ ok: true, site: { title: "Field notes", title_typed: false, search_engines: true } });
});

test("a title with markup stays text in the panel and inside the input's value", async () => {
  const opened = await openDashboard();
  const site = await opened.publish("report");
  const title = `"><script>alert(1)</script>`;
  await updateSite(opened.install, { scope: "admin", holder: opened.owner }, { site: site.id, title });

  const page = await pageOf(opened, `/sites/report--${site.id}`);

  expect(await attributesOf(page, '.panel input[name="title"]', "value")).toEqual([title]);
  expect(await textsOf(page, ".panel .facts dd")).toContain(title);
  expect(page).not.toContain("<script>alert");
});

test("an expiry no calendar holds, which the database keeps though the set action refuses it, is shown as its number and the page still renders", async () => {
  const opened = await openDashboard();
  const site = await opened.publish("report");
  await opened.install.database.changeDetails(site.id, { expires: opened.clock.now + 100_000_000 * 86_400_000 }, { by: opened.owner, at: opened.clock.now });

  const answer = await opened.get(`/sites/report--${site.id}`);

  expect(answer.status).toBe(200);
  expect(await textsOf(await answer.text(), ".panel .facts dd")).toContain(String(opened.clock.now + 100_000_000 * 86_400_000));
});

test("a reference to no site answers 404 with the refusal's sentence, and the reference itself is not echoed", async () => {
  const opened = await openDashboard();
  const cases = [
    ["/sites/report--000000000000", "No site is at this address. It may have been deleted, or the link is an old one."],
    ["/sites/%3Cscript%3Ealert(1)%3C%2Fscript%3E", "The value of site is not one it takes."],
    ["/sites/%E0%A4%A", "The value of site is not one it takes."],
  ] as const;

  for (const [path, sentence] of cases) {
    const answer = await opened.get(path);
    const page = await answer.text();

    expect([path, answer.status]).toEqual([path, 404]);
    expect(await textsOf(page, "p.notice.refused")).toEqual([sentence]);
    expect(page).not.toContain("<script>alert");
  }
});
