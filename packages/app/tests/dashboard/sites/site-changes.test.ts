import { expect, test } from "bun:test";

import { getSite } from "@poplin/core/src/actions/show";
import type { Site } from "@poplin/core/src/records/site";

import { landing, type Opened, openDashboard } from "../support/install";

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
  expect(NOTICE.exec(await landing(opened, rolled))?.slice(1)).toEqual(["done", "Rolled back."]);
  expect(await shown(opened, site.id)).toMatchObject({ live_version: 1 });

  const forward = await opened.post(`${path}/rollback`, { version: "2" });

  expect(forward.headers.get("Location")).toBe(`${path}?done=rolled_back`);
  expect(await shown(opened, site.id)).toMatchObject({ live_version: 2 });

  const relinked = await opened.post(`${path}/new-link`, {});
  const [, label = ""] = /^\/sites\/(report--[0-9a-z]{12})\?done=new_link$/.exec(relinked.headers.get("Location") ?? "") ?? [];

  expect(label).not.toBe(`report--${site.id}`);
  expect(NOTICE.exec(await landing(opened, relinked))?.slice(1)).toEqual(["done", "The site has a new link. The address with the old id stopped working."]);
  expect([await shown(opened, site.id), await shown(opened, label)]).toMatchObject(["not_found", { label, public_name: "docs" }]);

  const trashed = await opened.post(`/sites/${label}/delete`, {});

  expect(trashed.headers.get("Location")).toBe(`/sites/${label}?done=trashed`);
  expect(NOTICE.exec(await landing(opened, trashed))?.slice(1)).toEqual(["done", "Moved to the trash."]);
  expect(await shown(opened, label)).toMatchObject({ state: "trash" });

  const restored = await opened.post(`/sites/${label}/restore`, {});

  expect(restored.headers.get("Location")).toBe(`/sites/${label}?done=restored`);
  expect(NOTICE.exec(await landing(opened, restored))?.slice(1)).toEqual(["done", "Restored from the trash."]);
  expect(await shown(opened, label)).toMatchObject({ state: "live" });
  expect((await opened.audit()).map((entry) => entry.action).reverse().slice(2)).toEqual(["publish", "access", "details", "details", "live_version", "live_version", "new_id", "trash", "restore"]);
});

test("delete forever needs the site's label typed exactly, checked on the server; anything else deletes nothing", async () => {
  const opened = await openDashboard();
  const site = await opened.publish("report");
  const label = `report--${site.id}`;
  await opened.install.database.trashSite(site.id, { by: opened.owner, at: opened.clock.now });
  const before = (await opened.audit()).length;

  for (const confirm of ["", "report", site.id, label.toUpperCase(), `${label}x`, ` ${label}`, "yes"]) {
    const answer = await opened.post(`/sites/${label}/delete-forever`, { confirm });

    expect([confirm, answer.headers.get("Location")]).toEqual([confirm, `/sites/${label}?refused=wrong_confirmation`]);
    expect(NOTICE.exec(await landing(opened, answer))?.slice(1)).toEqual(["refused", "The typed label did not match, so nothing was deleted."]);
  }

  const missing = await opened.post(`/sites/${label}/delete-forever`, {});

  expect(missing.headers.get("Location")).toBe(`/sites/${label}?refused=missing_field`);
  expect([await shown(opened, site.id), (await opened.audit()).length]).toMatchObject([{ state: "trash" }, before]);

  const deleted = await opened.post(`/sites/${label}/delete-forever`, { confirm: label });

  expect(deleted.headers.get("Location")).toBe("/?view=trash&done=deleted");
  expect(NOTICE.exec(await landing(opened, deleted))?.slice(1)).toEqual(["done", "Deleted forever."]);
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
    [`${path}/settings`, { access: "public", public_name: "No Good", title: "" }, `${path}?refused=bad_name&about=public_name`, "The public name breaks the rules: 3 to 40 characters, lowercase letters, digits, and single dashes inside."],
    [`${path}/settings`, { access: "public", public_name: "gallery", title: "" }, `${path}?refused=reserved_name&about=public_name`, "That public name is reserved."],
    [`${path}/settings`, { access: "everyone", title: "" }, `${path}?refused=bad_argument&about=access`, "The value of access is not one it takes."],
    [`${path}/settings`, { access: "private", title: "", expires: "yesterday" }, `${path}?refused=bad_argument&about=expires`, "The value of expires is not one it takes."],
    [`${path}/settings`, { access: "private", title: "", expires: "0d" }, `${path}?refused=bad_argument&about=expires`, "The value of expires is not one it takes."],
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
    ["/sites/report--000000000000/delete", {}, "/sites/report--000000000000?refused=not_found", "No site with that id or public name."],
    ["/sites/Not%20A%20Site/new-link", {}, "/sites/Not%20A%20Site?refused=bad_argument&about=site", "The value of site is not one it takes."],
  ] as const;

  for (const [target, fields, location, sentence] of refusals) {
    const answer = await opened.post(target, fields);

    expect([target, fields, answer.status, answer.headers.get("Location")]).toEqual([target, fields, 303, location]);
    expect(NOTICE.exec(await landing(opened, answer))?.slice(1)).toEqual(["refused", sentence]);
  }

  expect(JSON.stringify([await shown(opened, site.id), await shown(opened, other.id), await shown(opened, trashed.id), await opened.audit()])).toBe(before);
});
