// The changes the forms of a site's page ask for. Each calls one action and answers the page to show next, with the result in its address.

import { abandonPublish } from "@poplin/core/src/actions/abandon-publish";
import { deleteSite } from "@poplin/core/src/actions/delete";
import { duplicateSite } from "@poplin/core/src/actions/duplicate";
import { newLink } from "@poplin/core/src/actions/new-link";
import { restoreSite } from "@poplin/core/src/actions/restore";
import { rollbackSite } from "@poplin/core/src/actions/rollback";
import { updateSite } from "@poplin/core/src/actions/set";
import { getSite } from "@poplin/core/src/actions/show";

import { withNotice } from "../page/notices";
import type { Change, Form, Visit } from "../records";
import { requireFields } from "../security/form";

/** A version number as the roll back form sends it. */
const VERSION_PATTERN = /^[1-9][0-9]*$/;

/** What is said once a site's access is set, by the access it then has. */
const ACCESS_DONE = { private: "made_private", unlisted: "made_unlisted", public: "made_public" } as const;

/** The keys of an address that name the table's filter and its search. */
const LIST_KEYS = ["access", "q"];

/** What the set action is asked. */
type Asked = Parameters<typeof updateSite>[2];

/** A refusal of an action. */
interface Refusal {
  readonly code: string;
  readonly about?: string;
}

function sitePath(reference: string): string {
  return `/sites/${encodeURIComponent(reference)}`;
}

/** The path of the table under the filter and the search a form's address carries. */
function tablePath(url: URL): string {
  const kept = new URLSearchParams(LIST_KEYS.flatMap((key) => (url.searchParams.has(key) ? [[key, url.searchParams.get(key) ?? ""]] : [])));

  return kept.size === 0 ? "/" : `/?${kept}`;
}

function refused(reference: string, refusal: Refusal): string {
  return withNotice(sitePath(reference), { refused: refusal.code, about: refusal.about });
}

function askedOf(form: Form, fields: Record<"access" | "title", string>, reference: string): Asked {
  // The action checks the access, so the word goes to it as it was sent.
  const asked: { -readonly [Key in keyof Asked]: Asked[Key] } = {
    site: reference,
    access: fields.access as Asked["access"],
    title: fields.title,
    search_engines: form.has("search_engines"),
    embeddable: form.has("embeddable"),
  };

  const name = form.get("name") ?? "";
  if (name !== "") asked.name = name;

  const publicName = form.get("public_name") ?? "";
  if (fields.access === "public" && publicName !== "") asked.public_name = publicName;

  const expires = form.get("expires") ?? "";
  if (expires !== "") asked.expires = expires;

  return asked;
}

async function saveSettings(visit: Visit, reference: string, form: Form): Promise<string> {
  const fields = requireFields(form, ["access", "title"]);
  if (fields === undefined) return refused(reference, { code: "missing_field" });

  const saved = await updateSite(visit.install, visit.actor, askedOf(form, fields, reference));
  if (!saved.ok) return refused(reference, saved);

  return withNotice(sitePath(saved.site.label), { done: "saved" });
}

/** Set who can open the site, and nothing else of it. A site going public may name its short link. */
async function changeAccess(visit: Visit, reference: string, form: Form): Promise<string> {
  const fields = requireFields(form, ["access"]);
  if (fields === undefined) return refused(reference, { code: "missing_field" });

  const publicName = form.get("public_name") ?? "";
  // The action checks the access, so the word goes to it as it was sent.
  const asked = { site: reference, access: fields.access as Asked["access"], ...(fields.access === "public" && publicName !== "" ? { public_name: publicName } : {}) };
  const saved = await updateSite(visit.install, visit.actor, asked);
  // A refused access comes back to the question it was asked in, so it can be answered again.
  if (!saved.ok) return withNotice(`${sitePath(reference)}?${new URLSearchParams({ ask: fields.access })}`, { refused: saved.code, about: saved.about });

  return withNotice(sitePath(saved.site.label), { done: ACCESS_DONE[saved.site.access] });
}

async function rename(visit: Visit, reference: string, form: Form): Promise<string> {
  const fields = requireFields(form, ["name"]);
  if (fields === undefined) return refused(reference, { code: "missing_field" });

  const saved = await updateSite(visit.install, visit.actor, { site: reference, name: fields.name });
  // A refused name comes back into its field, so it is corrected and not typed again.
  if (!saved.ok) return withNotice(`${sitePath(reference)}?${new URLSearchParams({ ask: "rename", name: fields.name })}`, { refused: saved.code, about: saved.about });

  return withNotice(sitePath(saved.site.label), { done: "renamed" });
}

async function rollBack(visit: Visit, reference: string, form: Form): Promise<string> {
  const fields = requireFields(form, ["version"]);
  if (fields === undefined) return refused(reference, { code: "missing_field" });

  if (fields.version !== "previous" && !VERSION_PATTERN.test(fields.version)) return refused(reference, { code: "bad_argument", about: "version" });

  const request = fields.version === "previous" ? { site: reference } : { site: reference, version: Number(fields.version) };
  const moved = await rollbackSite(visit.install, visit.actor, request);
  if (!moved.ok) return refused(reference, moved);

  return withNotice(sitePath(moved.site.label), { done: "rolled_back" });
}

async function makeNewLink(visit: Visit, reference: string): Promise<string> {
  const renamed = await newLink(visit.install, visit.actor, reference);
  if (!renamed.ok) return refused(reference, renamed);

  return withNotice(sitePath(renamed.site.label), { done: "new_link" });
}

/** Begin a copy of the site, or go on with the one the form names. A copy that needs more requests comes back to the source's page, which shows how far it is. */
async function duplicate(visit: Visit, reference: string, form: Form): Promise<string> {
  const upload = form.get("upload") ?? "";
  const name = form.get("name") ?? "";
  const first = name === "" ? { site: reference } : { site: reference, name };
  const copied = await duplicateSite(visit.install, visit.actor, upload === "" ? first : { site: reference, upload });
  // A copy refused before it began comes back to its question, where another name can be typed.
  if (!copied.ok) return withNotice(upload === "" ? `${sitePath(reference)}?ask=duplicate` : sitePath(reference), { refused: copied.code, about: copied.about });

  if (copied.site !== null) return withNotice(sitePath(copied.site.label), { done: "duplicated" });

  const progress = new URLSearchParams({ copy: copied.copy.upload, copied: String(copied.copy.copied), files: String(copied.copy.files) });

  return `${withNotice(sitePath(reference), { done: "copying" })}&${progress}`;
}

/** Give up the copy in progress that the form names, and remove its files as far as one request goes. The site it was copied from is not changed. */
async function cancelCopy(visit: Visit, reference: string, form: Form): Promise<string> {
  const fields = requireFields(form, ["upload"]);
  if (fields === undefined) return refused(reference, { code: "missing_field" });

  const given = await abandonPublish(visit.install, visit.actor, fields.upload);
  if (!given.ok) return refused(reference, given);

  return withNotice(sitePath(reference), { done: given.left.length === 0 ? "copy_cancelled" : "copy_cancelled_files_left" });
}

async function moveToTrash(visit: Visit, reference: string): Promise<string> {
  const trashed = await deleteSite(visit.install, visit.actor, { site: reference });
  if (!trashed.ok) return refused(reference, trashed);

  // Back to the table under the filter and the search it had, with the one press that takes the delete back.
  return withNotice(tablePath(visit.url), { done: "trashed", site: trashed.before?.label ?? reference });
}

async function restore(visit: Visit, reference: string): Promise<string> {
  const restored = await restoreSite(visit.install, visit.actor, reference);
  if (!restored.ok) return refused(reference, restored);

  return withNotice(sitePath(restored.site.label), { done: "restored" });
}

async function deleteForever(visit: Visit, reference: string, form: Form): Promise<string> {
  const fields = requireFields(form, ["confirm"]);
  if (fields === undefined) return refused(reference, { code: "missing_field" });

  const shown = await getSite(visit.install, visit.actor, reference);
  if (!shown.ok) return refused(reference, shown);

  // The name is what is typed: a label holds the id, which for an unlisted site is the key to it, and is not shown to be copied.
  if (fields.confirm !== shown.site.name) return refused(reference, { code: "wrong_confirmation" });

  const deleted = await deleteSite(visit.install, visit.actor, { site: shown.site.label, forever: true });
  if (!deleted.ok) return refused(reference, deleted);

  return withNotice("/?view=trash", { done: deleted.left.length === 0 ? "deleted" : "deleted_files_left" });
}

/** Every change of a site, by the last part of the address its form posts to. The subject is the site's label from that address. */
export const SITE_CHANGES: Readonly<Record<string, Change<[string]>>> = {
  settings: saveSettings,
  access: changeAccess,
  rename,
  rollback: rollBack,
  "new-link": makeNewLink,
  duplicate,
  "cancel-copy": cancelCopy,
  delete: moveToTrash,
  restore,
  "delete-forever": deleteForever,
};
