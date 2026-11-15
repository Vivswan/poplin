import { expect, test } from "bun:test";

import { publishSite } from "@poplin/core/src/actions/publish";
import { getSite } from "@poplin/core/src/actions/show";
import { settingsToText } from "@poplin/core/src/records/settings";
import type { Site } from "@poplin/core/src/records/site";

import { landing, ORIGIN, type Opened, openDashboard } from "../support/install";
import { attributesOf } from "../support/markup";

const NOTICE = /<p class="notice (done|refused)" role="status">([^<]*)<\/p>/;

async function addVersion(opened: Opened, site: Site): Promise<void> {
  const reserved = await opened.install.database.reserveVersion(site.id);
  if (reserved.kind !== "reserved") throw new Error("no version was reserved");

  await opened.install.database.addVersion(site.id, { number: reserved.number, keep: 3, bytes: 1, files: 1 }, { by: opened.owner, at: opened.clock.now });
}

async function shown(opened: Opened, reference: string): Promise<Extract<Awaited<ReturnType<typeof getSite>>, { ok: true }>["site"] | string> {
  const answer = await getSite(opened.install, { scope: "admin", holder: opened.owner }, reference);

  return answer.ok ? answer.site : answer.code;
}

/** The files of a site that one request does not copy whole. */
function twentyPages(): { path: string; size: number; contentType: string; open: () => ReadableStream<Uint8Array> }[] {
  return Array.from({ length: 20 }, (_page, at) => {
    const bytes = new TextEncoder().encode(`<p>${at}</p>`);

    return { path: at === 0 ? "index.html" : `pages/${at}.html`, size: bytes.length, contentType: "text/html", open: () => new Blob([bytes]).stream() };
  });
}

// Drift: the settings form posts the name with every save; one that renamed on every save, or lost the page it lands on after a rename, would leave the owner on a dead address.
test("the settings form renames a site when its name field changes, lands on the page under the new label, and leaves the id and the public name", async () => {
  const opened = await openDashboard();
  const site = await opened.publish("report", "public");
  const path = `/sites/report--${site.id}`;

  const same = await opened.post(`${path}/settings`, { name: "report", access: "public", public_name: "report", title: "", embeddable: "on" });
  const renamed = await opened.post(`${path}/settings`, { name: "q3-report", access: "public", public_name: "report", title: "", embeddable: "on" });

  expect([same.headers.get("Location"), renamed.headers.get("Location")]).toEqual([`${path}?done=saved`, `/sites/q3-report--${site.id}?done=saved`]);
  expect(await shown(opened, site.id)).toMatchObject({ id: site.id, name: "q3-report", label: `q3-report--${site.id}`, public_name: "report" });
  expect((await opened.install.database.listAudit({ limit: 10 })).map((entry) => entry.action).filter((action) => action === "details")).toHaveLength(1);
});

// Drift: one request copies 15 files of a small site; a form that showed a half copy as a site, or lost the upload between requests, would leave a broken site or a copy nobody can finish.
test("the duplicate form makes a private copy and lands on it; a site of more files than one request copies comes back to its own page until the copy is whole", async () => {
  const opened = await openDashboard();
  const published = await publishSite(opened.install, { scope: "admin", holder: opened.owner }, { name: "report", access: "public", files: twentyPages() });
  if (!published.ok) throw new Error(`the fixture site was refused: ${published.code}`);

  const { site } = published;
  const path = `/sites/report--${site.id}`;

  const begun = await opened.post(`${path}/duplicate`, { name: "report-draft" });
  const [, upload = ""] = new RegExp(`^${path}\\?done=copying&copy=([0-9a-z]{16})&copied=15&files=20$`).exec(begun.headers.get("Location") ?? "") ?? [];
  const waiting = await landing(opened, begun);
  const sitesMeanwhile = (await opened.install.database.readTotals()).sites;
  const finished = await opened.post(`${path}/duplicate`, { upload });
  const [, label = ""] = /^\/sites\/(report-draft--[0-9a-z]{12})\?done=duplicated$/.exec(finished.headers.get("Location") ?? "") ?? [];

  expect(upload).not.toBe("");
  expect([NOTICE.exec(waiting)?.[2], waiting.includes(`name="upload" value="${upload}"`), sitesMeanwhile]).toEqual(["The copy is not finished. Press Keep copying until it is.", true, 1]);
  expect(waiting).toContain("<p>Copied 15 of 20 files: 5 are left. Keep copying copies up to 15 more. The new site appears when every file is copied.</p>");
  expect(waiting).toContain(`cancel this copy and run <code>poplin duplicate report--${site.id}</code> in a terminal`);
  expect(NOTICE.exec(await landing(opened, finished))?.[2]).toBe("This is the copy: a new private site with its own link. The site it was copied from is unchanged.");
  expect([await shown(opened, label), await shown(opened, site.id)]).toMatchObject([
    { name: "report-draft", access: "private", public_name: null, files: 20, live_version: 1 },
    { id: site.id, access: "public", public_name: "report" },
  ]);
  expect((await opened.audit()).slice(0, 2).map((entry) => entry.action)).toEqual(["duplicate", "create"]);
});

// Drift: a copy that is not finished holds a place under the limits for a day; a page that offers no way to give it up leaves a copy begun by mistake to count until then.
test("the page of a copy in progress offers to cancel it: the copy's files go, no site is made, and the copy cannot be gone on with", async () => {
  const opened = await openDashboard();
  const published = await publishSite(opened.install, { scope: "admin", holder: opened.owner }, { name: "report", files: twentyPages() });
  if (!published.ok) throw new Error(`the fixture site was refused: ${published.code}`);

  const path = `/sites/report--${published.site.id}`;
  const keys = await opened.install.store.list({ prefix: "" });
  const begun = await opened.post(`${path}/duplicate`, {});
  const upload = new URL(begun.headers.get("Location") ?? "", ORIGIN).searchParams.get("copy") ?? "";
  const waiting = await landing(opened, begun);

  const cancelled = await opened.post(`${path}/cancel-copy`, { upload });
  const again = await opened.post(`${path}/duplicate`, { upload });
  const twice = await opened.post(`${path}/cancel-copy`, { upload });

  expect(waiting).toContain(`<form method="post" action="${path}/cancel-copy">`);
  expect([cancelled.headers.get("Location"), NOTICE.exec(await landing(opened, cancelled))?.[2]]).toEqual([`${path}?done=copy_cancelled`, "The copy was cancelled and its files removed. No site was made."]);
  expect([again.headers.get("Location"), twice.headers.get("Location")]).toEqual([`${path}?refused=not_found&about=upload`, `${path}?done=copy_cancelled`]);
  expect([(await opened.install.store.list({ prefix: "" })).objects.length, (await opened.install.database.readTotals()).sites]).toEqual([keys.objects.length, 1]);
});

// Drift: both refusals reach the page as a code another refusal shares; worded by the code alone, a copy over a limit read as a form that was too large, and a copy that ran out as a site that is not there.
test("a copy the install has no room for names the limit it does not fit, and a copy gone on with after its day says that it cannot be", async () => {
  const opened = await openDashboard();
  const published = await publishSite(opened.install, { scope: "admin", holder: opened.owner }, { name: "report", files: twentyPages() });
  if (!published.ok) throw new Error(`the fixture site was refused: ${published.code}`);

  const path = `/sites/report--${published.site.id}`;
  const begun = await opened.post(`${path}/duplicate`, {});
  const upload = new URL(begun.headers.get("Location") ?? "", ORIGIN).searchParams.get("copy") ?? "";
  opened.clock.now += 25 * 3_600_000;
  const late = await opened.post(`${path}/duplicate`, { upload });

  const stored = await opened.install.database.readSettings();
  if (stored === undefined) throw new Error("the settings are not stored");

  await opened.post("/settings/save", { ...settingsToText(stored), max_total_size: `${published.site.bytes + 1}B` });
  const full = await opened.post(`${path}/duplicate`, {});

  expect([late.headers.get("Location"), NOTICE.exec(await landing(opened, late))?.[2]]).toEqual([
    `${path}?refused=not_found&about=upload`,
    "That copy can no longer be gone on with: it was cancelled, or its day to finish ran out. Unless the list of sites shows it, duplicate the site again.",
  ]);
  expect([full.headers.get("Location"), NOTICE.exec(await landing(opened, full))?.[2]]).toEqual([
    `${path}?ask=duplicate&refused=too_large&about=max_total_size`,
    "The copy does not fit under max_total_size, which bounds all sites together, the trash and unfinished copies included. No copy was made.",
  ]);
});

test("each form of a live site does its change through the action, writes the action's audit entry, and lands on a page that says so", async () => {
  const opened = await openDashboard();
  const site = await opened.publish("report");
  const path = `/sites/report--${site.id}`;
  await addVersion(opened, site);

  const saved = await opened.post(`${path}/settings`, { access: "public", public_name: "docs", title: " Q3 sales ", search_engines: "on", expires: "7d", unknown: "ignored" });

  expect([saved.status, saved.headers.get("Location")]).toEqual([303, `${path}?done=saved`]);
  expect(NOTICE.exec(await landing(opened, saved))?.slice(1)).toEqual(["done", "Saved."]);
  expect(await shown(opened, site.id)).toMatchObject({ access: "public", public_name: "docs", url: "https://docs-page.example.com", title: " Q3 sales ", search_engines: true, embeddable: false, expires: opened.clock.now + 7 * 86_400_000 });

  const kept = await opened.post(`${path}/settings`, { access: "public", public_name: "docs", title: "", embeddable: "on", expires: "" });

  expect(kept.headers.get("Location")).toBe(`${path}?done=saved`);
  expect(await shown(opened, site.id)).toMatchObject({ access: "public", public_name: "docs", title: null, search_engines: false, embeddable: true, expires: opened.clock.now + 7 * 86_400_000 });

  const rolled = await opened.post(`${path}/rollback`, { version: "previous" });

  expect(rolled.headers.get("Location")).toBe(`${path}?done=rolled_back`);
  expect(NOTICE.exec(await landing(opened, rolled))?.slice(1)).toEqual(["done", "That version is live now."]);
  expect(await shown(opened, site.id)).toMatchObject({ live_version: 1 });

  const forward = await opened.post(`${path}/rollback`, { version: "2" });

  expect(forward.headers.get("Location")).toBe(`${path}?done=rolled_back`);
  expect(await shown(opened, site.id)).toMatchObject({ live_version: 2 });

  const relinked = await opened.post(`${path}/new-link`, {});
  const [, label = ""] = /^\/sites\/(report--[0-9a-z]{12})\?done=new_link$/.exec(relinked.headers.get("Location") ?? "") ?? [];

  expect(label).not.toBe(`report--${site.id}`);
  expect(NOTICE.exec(await landing(opened, relinked))?.slice(1)).toEqual(["done", "The site has a new link. The old link stopped working."]);
  expect([await shown(opened, site.id), await shown(opened, label)]).toMatchObject(["not_found", { label, public_name: "docs" }]);

  const trashed = await opened.post(`/sites/${label}/delete`, {});

  expect(trashed.headers.get("Location")).toBe(`/?done=trashed&site=${label}`);
  expect(await attributesOf(await landing(opened, trashed), ".result form", "action")).toEqual([`/sites/${label}/restore`]);
  expect(NOTICE.exec(await landing(opened, trashed))?.slice(1)).toEqual(["done", "Moved to the trash."]);
  expect(await shown(opened, label)).toMatchObject({ state: "trash" });

  const restored = await opened.post(`/sites/${label}/restore`, {});

  expect(restored.headers.get("Location")).toBe(`/sites/${label}?done=restored`);
  expect(NOTICE.exec(await landing(opened, restored))?.slice(1)).toEqual(["done", "Restored from the trash."]);
  expect(await shown(opened, label)).toMatchObject({ state: "live" });
  expect((await opened.audit()).map((entry) => entry.action).reverse().slice(2)).toEqual(["publish", "access", "details", "details", "live_version", "live_version", "new_id", "trash", "restore"]);
});

// Drift: the panel's switch and its rename send one field each; a handler that also wrote the fields it was not sent would wipe a title or a switch on every press.
test("the access form sets who can open the site and nothing else, the rename form its name and nothing else, and a delete from a row's menu lands back on the table", async () => {
  const opened = await openDashboard();
  const admin = { scope: "admin", holder: opened.owner } as const;
  const site = await opened.publish("report", "private");
  const path = `/sites/report--${site.id}`;
  const typed = await opened.post(`${path}/settings`, { access: "private", title: "Q3", search_engines: "on", expires: "7d" });

  expect(typed.headers.get("Location")).toBe(`${path}?done=saved`);

  const kept = { title: "Q3", search_engines: true, embeddable: false, expires: opened.clock.now + 7 * 86_400_000 };
  const unlisted = await opened.post(`${path}/access`, { access: "unlisted" });

  expect(unlisted.headers.get("Location")).toBe(`${path}?done=made_unlisted`);
  expect(NOTICE.exec(await landing(opened, unlisted))?.slice(1)).toEqual(["done", "Unlisted now. Anyone with the link opens it."]);
  expect(await shown(opened, site.id)).toMatchObject({ access: "unlisted", public_name: null, ...kept });

  const named = await opened.post(`${path}/access`, { access: "public", public_name: "docs" });
  const own = await opened.post(`${path}/access`, { access: "private", public_name: "ignored" });
  const again = await opened.post(`${path}/access`, { access: "public", public_name: "" });

  expect([named, own, again].map((answer) => answer.headers.get("Location"))).toEqual([`${path}?done=made_public`, `${path}?done=made_private`, `${path}?done=made_public`]);
  expect(await shown(opened, site.id)).toMatchObject({ access: "public", public_name: "report", ...kept });
  expect((await opened.post(`${path}/access`, { access: "everyone" })).headers.get("Location")).toBe(`${path}?ask=everyone&refused=bad_argument&about=access`);
  expect((await opened.post(`${path}/access`, {})).headers.get("Location")).toBe(`${path}?refused=missing_field`);

  const renamed = await opened.post(`${path}/rename`, { name: "notes" });

  expect(renamed.headers.get("Location")).toBe(`/sites/notes--${site.id}?done=renamed`);
  expect(NOTICE.exec(await landing(opened, renamed))?.slice(1)).toEqual(["done", "Renamed. The link took the new name. The old link keeps working."]);
  expect(await shown(opened, site.id)).toMatchObject({ name: "notes", access: "public", public_name: "report", ...kept });
  expect((await opened.post(`/sites/notes--${site.id}/rename`, { name: "No Such Name" })).headers.get("Location")).toBe(`/sites/notes--${site.id}?ask=rename&name=No+Such+Name&refused=bad_name&about=name`);

  const fromRow = await opened.post(`/sites/notes--${site.id}/delete?from=list&access=public&q=no&after=1-000000000000`, {});

  expect(fromRow.headers.get("Location")).toBe(`/?access=public&q=no&done=trashed&site=notes--${site.id}`);
  expect(await getSite(opened.install, admin, site.id)).toMatchObject({ ok: true, site: { state: "trash" } });
});

// Drift: the label holds the id, which is an unlisted site's key; a page that showed it to be typed back showed the key in the clear.
test("delete forever needs the site's name typed exactly, checked on the server; anything else, its label included, deletes nothing", async () => {
  const opened = await openDashboard();
  const site = await opened.publish("report");
  const label = `report--${site.id}`;
  await opened.install.database.trashSite(site.id, { by: opened.owner, at: opened.clock.now });
  const before = (await opened.audit()).length;

  for (const confirm of ["", label, site.id, "REPORT", "reportx", " report", "yes"]) {
    const answer = await opened.post(`/sites/${label}/delete-forever`, { confirm });

    expect([confirm, answer.headers.get("Location")]).toEqual([confirm, `/sites/${label}?refused=wrong_confirmation`]);
    expect(NOTICE.exec(await landing(opened, answer))?.slice(1)).toEqual(["refused", "The typed text did not match, so nothing was deleted."]);
  }

  const missing = await opened.post(`/sites/${label}/delete-forever`, {});

  expect(missing.headers.get("Location")).toBe(`/sites/${label}?refused=missing_field`);
  expect([await shown(opened, site.id), (await opened.audit()).length]).toMatchObject([{ state: "trash" }, before]);

  const deleted = await opened.post(`/sites/${label}/delete-forever`, { confirm: "report" });

  expect(deleted.headers.get("Location")).toBe("/?view=trash&done=deleted");
  expect(NOTICE.exec(await landing(opened, deleted))?.slice(1)).toEqual(["done", "Deleted for good."]);
  expect([await shown(opened, site.id), (await opened.audit())[0]?.action]).toEqual(["not_found", "delete"]);
});

test("every refusal of an action comes back as its code in the address and its sentence on the page, and changes nothing", async () => {
  const opened = await openDashboard();
  const site = await opened.publish("report");
  const other = await opened.publish("docs", "public");
  const trashed = await opened.publish("old");
  await opened.install.database.trashSite(trashed.id, { by: opened.owner, at: opened.clock.now });
  const path = `/sites/report--${site.id}`;
  const inTrash = `/sites/old--${trashed.id}`;
  const before = JSON.stringify([await shown(opened, site.id), await shown(opened, other.id), await shown(opened, trashed.id), await opened.audit()]);
  const refusals = [
    [`${path}/settings`, { access: "public", public_name: "docs", title: "" }, `${path}?refused=name_taken&about=public_name`, "Another site holds that public name. Choose another."],
    [`${path}/settings`, { access: "public", public_name: "No Good", title: "" }, `${path}?refused=bad_name&about=public_name`, "The name breaks the rules: 3 to 40 characters, lowercase letters, digits, and single dashes inside."],
    [`${path}/settings`, { access: "private", name: "No Good", title: "" }, `${path}?refused=bad_name&about=name`, "The name breaks the rules: 3 to 40 characters, lowercase letters, digits, and single dashes inside."],
    [`${path}/settings`, { access: "everyone", title: "" }, `${path}?refused=bad_argument&about=access`, "The value of access is not one it takes."],
    [`${path}/settings`, { access: "private", title: "", expires: "yesterday" }, `${path}?refused=bad_argument&about=expires`, "Deletes itself takes never, a span such as 7d, or a day such as 2026-12-01."],
    [`${path}/settings`, { access: "private", title: "", expires: "0d" }, `${path}?refused=bad_argument&about=expires`, "Deletes itself takes never, a span such as 7d, or a day such as 2026-12-01."],
    [`${path}/settings`, { access: "private" }, `${path}?refused=missing_field`, "The form was incomplete, so nothing was changed."],
    [`${path}/settings`, { title: "x" }, `${path}?refused=missing_field`, "The form was incomplete, so nothing was changed."],
    [`${path}/rollback`, {}, `${path}?refused=missing_field`, "The form was incomplete, so nothing was changed."],
    [`${path}/rollback`, { version: "previous" }, `${path}?refused=no_such_version`, "That version is not kept."],
    [`${path}/rollback`, { version: "7" }, `${path}?refused=no_such_version`, "That version is not kept."],
    [`${path}/rollback`, { version: "1000000000" }, `${path}?refused=no_such_version`, "That version is not kept."],
    [`${path}/rollback`, { version: "9".repeat(400) }, `${path}?refused=bad_argument&about=version`, "The value of version is not one it takes."],
    [`${path}/rollback`, { version: "1e3" }, `${path}?refused=bad_argument&about=version`, "The value of version is not one it takes."],
    [`${path}/rollback`, { version: "-1" }, `${path}?refused=bad_argument&about=version`, "The value of version is not one it takes."],
    [`${path}/restore`, {}, `${path}?refused=not_in_trash`, "The site is not in the trash."],
    [`${inTrash}/settings`, { access: "private", title: "" }, `${inTrash}?refused=in_trash`, "The site sits in the trash. Restore it first."],
    [`${inTrash}/rollback`, { version: "previous" }, `${inTrash}?refused=in_trash`, "The site sits in the trash. Restore it first."],
    [`${inTrash}/new-link`, {}, `${inTrash}?refused=in_trash`, "The site sits in the trash. Restore it first."],
    [`${inTrash}/delete`, {}, `${inTrash}?refused=in_trash`, "The site sits in the trash. Restore it first."],
    ["/sites/report--000000000000/delete", {}, "/sites/report--000000000000?refused=not_found", "No site is at this address. It may have been deleted, or the link is an old one."],
    ["/sites/Not%20A%20Site/new-link", {}, "/sites/Not%20A%20Site?refused=bad_argument&about=site", "The value of site is not one it takes."],
  ] as const;

  for (const [target, fields, location, sentence] of refusals) {
    const answer = await opened.post(target, fields);

    expect([target, fields, answer.status, answer.headers.get("Location")]).toEqual([target, fields, 303, location]);
    expect(NOTICE.exec(await landing(opened, answer))?.slice(1)).toEqual(["refused", sentence]);
  }

  expect(JSON.stringify([await shown(opened, site.id), await shown(opened, other.id), await shown(opened, trashed.id), await opened.audit()])).toBe(before);
});
