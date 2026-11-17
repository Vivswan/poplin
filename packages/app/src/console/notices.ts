// The one table of sentences the dashboard says when it refuses a change: the client shows the sentence it is sent, so the words live here alone.

import type { abandonPublish } from "@poplin/core/src/actions/abandon-publish";
import type { listAudit } from "@poplin/core/src/actions/audit-log";
import type { decideLogin, showLogin } from "@poplin/core/src/actions/computer-logins";
import type { changeConfig, readConfig } from "@poplin/core/src/actions/config";
import type { deleteSite } from "@poplin/core/src/actions/delete";
import type { duplicateSite } from "@poplin/core/src/actions/duplicate";
import type { listSitesWithNames } from "@poplin/core/src/actions/list";
import type { addLogin, removeLogin } from "@poplin/core/src/actions/logins";
import type { listTokens } from "@poplin/core/src/actions/manage-tokens";
import type { newLink } from "@poplin/core/src/actions/new-link";
import type { restoreSite } from "@poplin/core/src/actions/restore";
import type { rollbackSite } from "@poplin/core/src/actions/rollback";
import type { updateSite } from "@poplin/core/src/actions/set";
import type { getSite } from "@poplin/core/src/actions/show";
import type { signEveryoneOut } from "@poplin/core/src/actions/sign-out";
import { type startUpdate, TAKEN_BY_REPAIR } from "@poplin/core/src/actions/start-update";

import type { DomainReading } from "./domain/records";

/** What each refusal code says. `{about}` is the field or setting the code is about. A code of an action missing here does not compile. */
const REFUSALS: Readonly<Record<ActionCode | OwnCode, string>> = {
  not_set_up: "This install is not set up yet.",
  not_allowed: "This login may not do that.",
  not_found: "No site is at this address. It may have been deleted, or the link is an old one.",
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
  not_confirmed: "Those are not the last letters of this login's code.",
  not_json: "The request was not sent as JSON, so nothing was changed.",
  too_large: "The request was too large, so nothing was changed.",
  no_page: "There is no such page.",
  too_many_tries: "Too many tries. Wait a minute.",
  no_such_login: "That login is no longer waiting. It was allowed or denied already, or its 10 minutes ran out. Run poplin login again.",
  no_working_login: "Your own email has to stay in the logins, so nothing was changed. Another admin can take it out.",
  token_gone: "That token is gone already.",
  already_a_login: "That email can log in already.",
  not_a_login: "That email is not in the list. It may have been removed already.",
  allowance_spent: "The storage takes no more writes today: max_storage_writes_per_day is reached. It works again after midnight UTC.",
  no_more_writing: "The database takes no more changes today: its free allowance for writing is used up. Changes work again after midnight UTC.",
  no_more_reading: "The dashboard is paused: the free allowance of the database for reading is used up for today. It is back after midnight UTC.",
  token: "Account token refused: paste the whole account token.",
  unreachable: "No answer from the provider. Try again.",
  no_update: "No newer version is known, so no update was started.",
  too_many_requests: "An update was tried in this minute already. Wait a minute.",
  no_key: "poplin holds no key, so it cannot update itself. Open Domain and press Repair.",
  key_refused: "The host no longer takes poplin's key, so nothing was updated. Open Domain and press Repair.",
  lacks_right: "poplin's key may not replace the install's code, so nothing was updated. Open Domain and press Repair: it makes a key that may.",
  release_refused: "The release could not be taken. Nothing was changed.",
  version_refused: "The host refused the new version, so the install runs the version it ran before.",
  logins_not_ended: "This install has no way to end logins, so nobody was signed out.",
  update_unreachable: "The host did not answer. The update may be in all the same: reload in a minute.",
};

/** What a code says when what it is about gives it another meaning: `too_large` about a limit is a copy that does not fit it, `not_found` about an upload a copy, `logins_not_ended` the reason. `other` stands for any limit not named. */
const ABOUT_REFUSALS: Readonly<Record<string, Readonly<Record<string, string>>>> = {
  too_large: {
    max_total_size: "The copy does not fit under max_total_size, which bounds all sites together, the trash and unfinished copies included. No copy was made.",
    max_site_size: "The copy does not fit under max_site_size: the site is larger than one site may be now. No copy was made.",
    max_files_per_publish: "The site holds more files than max_files_per_publish lets one copy hold. No copy was made.",
    max_files_per_day: "The copy does not fit under max_files_per_day: the publishes and copies begun today left too few files of the day. No copy was made.",
    max_pending_uploads: "Too many copies and uploads are unfinished at once. Finish or cancel one; an unfinished one is removed about a day after it began. No copy was made.",
    other: "The copy does not fit a limit of the install: {about}. No copy was made.",
  },
  bad_argument: {
    expires: "Pick a day that is still ahead.",
    title: "Use one line of 200 characters at most.",
    default_expires: "Use a whole number, 1 or more.",
    default_search_engines: "Use on or off.",
    versions_kept: "Use a whole number, 1 or more.",
    trash_days: "Use a whole number, 1 or more.",
    logins: "Use whole email addresses, each one once.",
    login: "Type an email address, such as name@example.com.",
    max_total_size: "Use a whole number, 1 or more.",
    max_site_size: "Use a whole number, 1 or more.",
    max_sites: "Use a whole number, 1 or more, or leave it empty for no limit.",
    max_files_per_publish: "Use a whole number from 1 to 10,000.",
    max_files_per_day: "Use a whole number, 1 or more.",
    max_storage_writes_per_day: "Use a whole number, 1 or more.",
    requests_per_day: "Use a whole number, 1 or more.",
    site_share_of_day: "Use a whole number from 1 to 100.",
    site_requests_per_minute: "Use a whole number, 1 or more.",
    visitor_requests_per_minute: "Use a whole number, 1 or more.",
    update_check: "Use on or off.",
    auto_update: "Use on or off.",
    outside_pages: "Use blocked or allowed.",
    search_engines_allowed: "Use on or off.",
    block_bots: "Use auto, on, or off.",
  },
  logins_not_ended: {
    no_key: "poplin holds no key for the provider, so nobody was signed out. Repair makes one: open Domain and press Repair.",
    key_refused: "The provider refused poplin's key, so nobody was signed out. Open Domain and press Repair.",
    lacks_right: "poplin's key may not end logins at the provider, so nobody was signed out. Open Domain and press Repair.",
    unreachable: "No answer from the provider, so the logins may not have ended. Try again.",
    not_made: "The login in front of the dashboard is missing at the provider, so nobody was signed out. Open Domain and press Repair.",
  },
  not_found: {
    upload: "The copy stopped. If the site is not under All sites, duplicate it again.",
  },
  release_refused: {
    no_digest: "No built files are published for that version, so poplin cannot take it by itself. Nothing was changed.",
    unreachable: "The release could not be fetched. Nothing was changed. Try again in a few minutes.",
    digest_differs: "The files fetched for the release are not the files poplin published. Nothing was changed. Try again; if it says this again, tell the project.",
    other_version: "The files published for the release say they are of another version. Nothing was changed. Tell the project.",
    database: "That release changes the database, and the version asked for cannot read it. Nothing was changed.",
    needs_hand: `Nothing was changed. ${TAKEN_BY_REPAIR}`,
    host: "The host did not answer before anything was sent. Nothing was changed. Try again in a few minutes.",
  },
  version_refused: {
    code: "The host refused the new version: its code stops as it starts. The install runs the version it ran before. Tell the project.",
  },
};

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
  | CodeOf<typeof listSitesWithNames>
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
  | CodeOf<typeof addLogin>
  | CodeOf<typeof removeLogin>
  | CodeOf<typeof showLogin>
  | CodeOf<typeof decideLogin>
  | CodeOf<typeof signEveryoneOut>
  | CodeOf<typeof startUpdate>;

/** Why a run of the domain plug read no table. */
type RunRefusal = Extract<DomainReading, { readonly ok: false }>["refusal"];

/** The codes of the dashboard's own refusals: a request it cannot take, or one it does not answer. */
type OwnCode = "not_json" | "too_large" | "no_page" | "too_many_tries" | "no_more_writing" | "no_more_reading" | AccessCode | RunRefusal;

/** The code of the Access screen's own refusal: a token that is gone. */
type AccessCode = "token_gone";

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
