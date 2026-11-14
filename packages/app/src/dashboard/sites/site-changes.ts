// The changes the forms of a site's page ask for. Each calls one action and answers the page to show next, with the result in its address.

import { deleteSite } from "@poplin/core/src/actions/delete";
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

async function moveToTrash(visit: Visit, reference: string): Promise<string> {
  const trashed = await deleteSite(visit.install, visit.actor, { site: reference });
  if (!trashed.ok) return refused(reference, trashed);

  return withNotice(sitePath(trashed.before?.label ?? reference), { done: "trashed" });
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

  if (fields.confirm !== shown.site.label) return refused(reference, { code: "wrong_confirmation" });

  const deleted = await deleteSite(visit.install, visit.actor, { site: shown.site.label, forever: true });
  if (!deleted.ok) return refused(reference, deleted);

  return withNotice("/?view=trash", { done: deleted.left.length === 0 ? "deleted" : "deleted_files_left" });
}

/** Every change of a site, by the last part of the address its form posts to. The subject is the site's label from that address. */
export const SITE_CHANGES: Readonly<Record<string, Change<[string]>>> = {
  settings: saveSettings,
  rollback: rollBack,
  "new-link": makeNewLink,
  delete: moveToTrash,
  restore,
  "delete-forever": deleteForever,
};
