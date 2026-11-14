// The one table of sentences the dashboard says after a change: what was done, or why it was refused.
//
//   POST, done      ->  303 /sites/report--k3f9x2ab71qz?done=saved
//   POST, refused   ->  303 /sites/report--k3f9x2ab71qz?refused=bad_argument&about=expires
//
// The address carries a code, never a sentence, so a crafted link can only show a line of this table.

import type { listAudit } from "@poplin/core/src/actions/audit-log";
import type { changeConfig, readConfig } from "@poplin/core/src/actions/config";
import type { deleteSite } from "@poplin/core/src/actions/delete";
import type { listSites } from "@poplin/core/src/actions/list";
import type { newLink } from "@poplin/core/src/actions/new-link";
import type { restoreSite } from "@poplin/core/src/actions/restore";
import type { rollbackSite } from "@poplin/core/src/actions/rollback";
import type { updateSite } from "@poplin/core/src/actions/set";
import type { getSite } from "@poplin/core/src/actions/show";
import type { signEveryoneOut } from "@poplin/core/src/actions/sign-out";

/** What each refusal code says. `{about}` is the field or setting the code is about. A code of an action missing here does not compile. */
const REFUSALS: Readonly<Record<ActionCode | OwnCode, string>> = {
  not_set_up: "This install is not set up yet.",
  not_allowed: "This login may not do that.",
  not_found: "No site with that id or public name.",
  in_trash: "The site sits in the trash. Restore it first.",
  not_in_trash: "The site is not in the trash.",
  name_taken: "Another site holds that public name. Choose another.",
  bad_name: "The public name breaks the rules: 3 to 40 characters, lowercase letters, digits, and single dashes inside.",
  reserved_name: "That public name is reserved.",
  no_such_version: "That version is not kept.",
  bad_argument: "The value of {about} is not one it takes.",
  wrong_confirmation: "The typed label did not match, so nothing was deleted.",
  not_confirmed: "The box was not ticked, so nothing was changed.",
  missing_field: "The form was incomplete, so nothing was changed.",
  not_a_form: "The request was not a form, so nothing was changed.",
  too_large: "The form was too large, so nothing was changed.",
  not_from_here: "The request did not come from this page, or the page was open for too long. Reload the page and try again.",
  no_page: "There is no such page.",
  bad_method: "The dashboard does not answer that kind of request.",
  too_many_tries: "Too many tries. Wait a minute.",
};

/** What each finished change says. */
const DONE = {
  saved: "Saved.",
  rolled_back: "Rolled back.",
  new_link: "The site has a new link. The address with the old id stopped working.",
  trashed: "Moved to the trash.",
  restored: "Restored from the trash.",
  deleted: "Deleted forever.",
  deleted_files_left: "Deleted forever, but some of its files could not be removed from the bucket.",
} as const;

/** The sentence for a code this table does not hold. */
const UNKNOWN_REFUSAL = "The request was refused.";

/** What `{about}` says when a refusal names nothing. */
const NO_ABOUT = "a field";

/** A name of a field or a setting: nothing else is shown from an address. */
const ABOUT_PATTERN = /^[a-z][a-z0-9_.-]{0,39}$/;

/** The codes an action refuses with. */
type CodeOf<Action extends (...asked: never[]) => Promise<unknown>> = Extract<Awaited<ReturnType<Action>>, { readonly ok: false }>["code"];

/** Every code the actions the dashboard calls may refuse with. */
type ActionCode =
  | CodeOf<typeof listSites>
  | CodeOf<typeof getSite>
  | CodeOf<typeof updateSite>
  | CodeOf<typeof rollbackSite>
  | CodeOf<typeof newLink>
  | CodeOf<typeof deleteSite>
  | CodeOf<typeof restoreSite>
  | CodeOf<typeof readConfig>
  | CodeOf<typeof changeConfig>
  | CodeOf<typeof listAudit>
  | CodeOf<typeof signEveryoneOut>;

/** The codes of the dashboard's own refusals: a form it cannot take, or a request it does not answer. */
type OwnCode = "wrong_confirmation" | "not_confirmed" | "missing_field" | "not_a_form" | "too_large" | "not_from_here" | "no_page" | "bad_method" | "too_many_tries";

/** A change that was done, or a refusal with what it is about. */
type Result = { readonly done: keyof typeof DONE } | { readonly refused: string; readonly about?: string };

/** A sentence to show above a page, and whether it reports a change or a refusal. */
export interface Notice {
  readonly kind: "done" | "refused";
  readonly text: string;
}

/**
 * The sentence of a refusal code.
 *
 * @param about - the field or setting the code is about; anything that is no plain name is left out
 * @returns the table's sentence, or one general sentence for a code the table does not hold
 */
export function refusalSentence(code: string, about?: string): string {
  if (!Object.hasOwn(REFUSALS, code)) return UNKNOWN_REFUSAL;

  const sentence = REFUSALS[code as keyof typeof REFUSALS];

  const named = about !== undefined && ABOUT_PATTERN.test(about) ? about : NO_ABOUT;

  return sentence.replace("{about}", named);
}

/**
 * Read the result an address carries.
 *
 * @returns the sentence to show, or `undefined` when the address carries no result this table holds
 */
export function noticeIn(url: URL): Notice | undefined {
  const done = url.searchParams.get("done");
  if (done !== null && Object.hasOwn(DONE, done)) return { kind: "done", text: DONE[done as keyof typeof DONE] };

  const refused = url.searchParams.get("refused");
  if (refused === null) return undefined;

  return { kind: "refused", text: refusalSentence(refused, url.searchParams.get("about") ?? undefined) };
}

/**
 * Write a result into a dashboard path.
 *
 * @param path - a dashboard path, with or without a query of its own
 * @returns the path with the result's code added; `noticeIn` reads it back
 */
export function withNotice(path: string, result: Result): string {
  const query = new URLSearchParams();
  if ("done" in result) query.set("done", result.done);

  if ("refused" in result) {
    query.set("refused", result.refused);
    if (result.about !== undefined) query.set("about", result.about);
  }

  return `${path}${path.includes("?") ? "&" : "?"}${query}`;
}
