// The one table of sentences the dashboard says after a change: what was done, or why it was refused.
//
//   POST, done      ->  303 /sites/report--k3f9x2ab71qz?done=saved
//   POST, refused   ->  303 /sites/report--k3f9x2ab71qz?refused=bad_argument&about=expires
//
// The address carries a code, never a sentence, so a crafted link can only show a line of this table.

import type { abandonPublish } from "@poplin/core/src/actions/abandon-publish";
import type { listAudit } from "@poplin/core/src/actions/audit-log";
import type { decideLogin, showLogin } from "@poplin/core/src/actions/computer-logins";
import type { changeConfig, readConfig } from "@poplin/core/src/actions/config";
import type { deleteSite } from "@poplin/core/src/actions/delete";
import type { duplicateSite } from "@poplin/core/src/actions/duplicate";
import type { listSites } from "@poplin/core/src/actions/list";
import type { listTokens } from "@poplin/core/src/actions/manage-tokens";
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
  bad_name: "The name breaks the rules: 3 to 40 characters, lowercase letters, digits, and single dashes inside.",
  reserved_name: "That public name is reserved.",
  no_such_version: "That version is not kept.",
  bad_argument: "The value of {about} is not one it takes.",
  bad_path: "A file of the site has a path no copy can hold.",
  no_index: "The site has no index.html to copy.",
  too_many_sites: "The install holds as many sites as it may, so no copy was made.",
  missing_files: "A file of the copy did not arrive. Duplicate the site again.",
  upload_finished: "The copy is finished already: it is a site of its own now, in the list of sites.",
  stale_version: "A newer publish went live first.",
  id_taken: "A site here already has that id.",
  wrong_confirmation: "The typed label did not match, so nothing was deleted.",
  not_confirmed: "The box was not ticked, so nothing was changed.",
  missing_field: "The form was incomplete, so nothing was changed.",
  not_a_form: "The request was not a form, so nothing was changed.",
  too_large: "The form was too large, so nothing was changed.",
  not_from_here: "The request did not come from this page, or the page was open for too long. Reload the page and try again.",
  no_page: "There is no such page.",
  bad_method: "The dashboard does not answer that kind of request.",
  too_many_tries: "Too many tries. Wait a minute.",
  no_such_login: "No login waits under that code. It was allowed or denied already, or its 10 minutes ran out. Run poplin login again.",
  no_working_login: "Your own email has to stay in the logins, so nothing was changed. Another admin can take it out.",
  no_such_token: "No token has that id. It may be revoked already.",
};

/** What a code says when what it is about gives it another meaning: `too_large` is a form's own refusal, and about a limit a copy that does not fit it; `not_found` is a site, and about an upload a copy. `other` stands for any limit not named. */
const ABOUT_REFUSALS: Readonly<Record<string, Readonly<Record<string, string>>>> = {
  too_large: {
    max_total_size: "The copy does not fit under max_total_size, which bounds all sites together, the trash and unfinished copies included. No copy was made.",
    max_site_size: "The copy does not fit under max_site_size: the site is larger than one site may be now. No copy was made.",
    max_pending_uploads: "Too many copies and uploads are unfinished at once. Finish or cancel one; an unfinished one is removed about a day after it began. No copy was made.",
    other: "The copy does not fit a limit of the install: {about}. No copy was made.",
  },
  not_found: {
    upload: "That copy can no longer be gone on with: it was cancelled, or its day to finish ran out. Unless the list of sites shows it, duplicate the site again.",
  },
};

/** What each finished change says. */
const DONE = {
  saved: "Saved.",
  saved_logins: "Saved. One more step: open the Domain tab, paste a token, and press Repair. Until then the login page lets in only the emails it had before.",
  rolled_back: "Rolled back.",
  new_link: "The site has a new link. The address with the old id stopped working.",
  trashed: "Moved to the trash.",
  restored: "Restored from the trash.",
  duplicated: "This is the copy: a new private site with its own address. The site it was copied from is unchanged.",
  copying: "The copy is not finished. Press Keep copying until it is.",
  copy_cancelled: "The copy was cancelled and its files removed. No site was made.",
  copy_cancelled_files_left: "The copy was cancelled, and no site was made. Its remaining files are being removed from the bucket.",
  deleted: "Deleted forever.",
  deleted_files_left: "Deleted forever. Its remaining files are being removed from the bucket.",
  allowed: "Allowed. The computer collects its token within a few seconds.",
  denied: "Denied. The computer was not logged in.",
  revoked: "Revoked. The token works nowhere now.",
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
  | CodeOf<typeof duplicateSite>
  | CodeOf<typeof abandonPublish>
  | CodeOf<typeof readConfig>
  | CodeOf<typeof changeConfig>
  | CodeOf<typeof listAudit>
  | CodeOf<typeof listTokens>
  | CodeOf<typeof showLogin>
  | CodeOf<typeof decideLogin>
  | CodeOf<typeof signEveryoneOut>;

/** The codes of the dashboard's own refusals: a form it cannot take, or a request it does not answer. */
type OwnCode = "wrong_confirmation" | "not_confirmed" | "missing_field" | "not_a_form" | "too_large" | "not_from_here" | "no_page" | "bad_method" | "too_many_tries" | "no_such_token";

/** A change that was done, or a refusal with what it is about. */
type Result = { readonly done: keyof typeof DONE } | { readonly refused: string; readonly about?: string };

/** A sentence to show above a page, and whether it reports a change or a refusal. */
export interface Notice {
  readonly kind: "done" | "refused";
  readonly text: string;
}

/** The sentence of a code whose meaning hangs on what it is about; none for a code that has one meaning, or is about nothing. */
function sentenceAbout(code: string, about: string | undefined): string | undefined {
  if (about === undefined || !Object.hasOwn(ABOUT_REFUSALS, code)) return undefined;

  const sentences = ABOUT_REFUSALS[code] ?? {};

  return Object.hasOwn(sentences, about) ? sentences[about] : sentences["other"];
}

/**
 * The sentence of a refusal code.
 *
 * @param about - the field, setting, or limit the code is about; anything that is no plain name is left out
 * @returns the table's sentence, the one for what the code is about where that changes its meaning, or one general sentence for a code the table does not hold
 */
export function refusalSentence(code: string, about?: string): string {
  if (!Object.hasOwn(REFUSALS, code)) return UNKNOWN_REFUSAL;

  const named = about !== undefined && ABOUT_PATTERN.test(about) ? about : undefined;
  const sentence = sentenceAbout(code, named) ?? REFUSALS[code as keyof typeof REFUSALS];

  return sentence.replace("{about}", named ?? NO_ABOUT);
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
