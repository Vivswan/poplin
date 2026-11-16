// The one table of what can go wrong: every code a command ends in, its sentence for a person, the hint that goes with it, and how the command exits.

import type { Failure } from "../client/client";
import type { Ending } from "./exit-codes";

/** How a command that went wrong exits. */
type Exit = Exclude<Ending["kind"], "done" | "version" | "help">;

/** One row of the table: the sentence, what to do about it when that is known, and the exit. */
interface Row {
  readonly sentence: string;
  readonly hint?: string;
  readonly exit: Exit;
}

/** The codes the API refuses with, in the API's own spelling. */
const API_ROWS = {
  not_logged_in: { sentence: "no token was sent, or it expired", hint: "to log in again: poplin login", exit: "failed" },
  not_allowed: { sentence: "this token may not do that", hint: "a publisher's token manages only the sites it published; poplin whoami shows the token", exit: "failed" },
  not_found: { sentence: "no site with that id or public name", hint: "poplin list shows every site", exit: "failed" },
  no_such_version: { sentence: "the site keeps no such version", hint: "poplin show <site> lists the versions", exit: "failed" },
  method_not_allowed: { sentence: "the install does not take that request", hint: "the install may be of another version than this poplin", exit: "failed" },
  unsupported_media_type: { sentence: "the install does not take that request", hint: "the install may be of another version than this poplin", exit: "failed" },
  bad_argument: { sentence: "an argument is missing, unknown, or of the wrong form", exit: "failed" },
  bad_name: { sentence: "the name breaks the rules of a name", hint: "a name holds lowercase letters, digits, and single dashes, 3 to 40 characters", exit: "failed" },
  reserved_name: { sentence: "the install keeps that public name for itself", hint: "to pick another: --public-name <public name>", exit: "failed" },
  bad_path: { sentence: "a file's path is one no site can serve", hint: "rename or remove the file", exit: "failed" },
  no_index: { sentence: "a site needs an index.html at its top", exit: "failed" },
  size_mismatch: { sentence: "a file changed while it was sent", hint: "publish again once the folder is still", exit: "failed" },
  hash_mismatch: { sentence: "a file changed after it was read, or was damaged on its way", hint: "publish again once the folder is still", exit: "failed" },
  name_taken: { sentence: "another site holds that public name", hint: "to pick another: poplin set <site> --public --public-name <public name>", exit: "failed" },
  in_trash: { sentence: "the site sits in the trash", hint: "to take it back: poplin restore <site>", exit: "failed" },
  id_taken: { sentence: "a site of the install already has that id", hint: "the site is already there: poplin show <site> shows it", exit: "failed" },
  backup_too_new: { sentence: "the backup was made by a newer poplin than the install runs", hint: "update the install, then import again", exit: "failed" },
  not_in_trash: { sentence: "the site is not in the trash", exit: "failed" },
  stale_version: { sentence: "a newer publish of the site went live first", hint: "publish again", exit: "failed" },
  missing_files: { sentence: "a file of the publish did not arrive", hint: "publish again", exit: "failed" },
  upload_finished: { sentence: "the publish is already live", exit: "failed" },
  too_many_sites: { sentence: "the install holds as many sites as it may", hint: "poplin config max_sites shows the limit; poplin list --trash shows what still counts", exit: "failed" },
  not_set_up: { sentence: "the install has stored no settings", hint: "the install stores them when it starts: try again, and if this stays, deploy the install again", exit: "failed" },
  no_working_login: {
    sentence: "the change would leave no login that works",
    hint: "keep an email that is a login now: a new one gets in only after a Repair on the dashboard's Domain tab",
    exit: "failed",
  },
  already_a_login: { sentence: "that email is a login already", hint: "poplin config logins shows the logins", exit: "failed" },
  not_a_login: { sentence: "that email is no login", hint: "poplin config logins shows the logins", exit: "failed" },
  no_update: { sentence: "there is no newer version the install can take", hint: "poplin update --check says which version the install runs", exit: "failed" },
  update_unreachable: { sentence: "the install's host did not answer the update", hint: "the update may be in all the same: wait a minute, then poplin update --check", exit: "failed" },
  no_key: { sentence: "the install holds no key of its host, so it cannot update itself", hint: "open Domain on the dashboard and press Repair", exit: "failed" },
  key_refused: { sentence: "the install's host no longer takes the install's key", hint: "open Domain on the dashboard and press Repair", exit: "failed" },
  lacks_right: { sentence: "the install's key lacks this right at its host", hint: "open Domain on the dashboard and press Repair: it makes a key with the right", exit: "failed" },
  release_refused: { sentence: "the release cannot be taken, and nothing was changed, for this reason", hint: "try again in a few minutes", exit: "failed" },
  version_refused: { sentence: "the install's host refused the new version, so the install runs the version it ran before", hint: "try again; if it comes back, report it", exit: "failed" },
  logins_not_ended: { sentence: "the install's provider did not end the dashboard's logins, or gave no answer", hint: "the dashboard's Domain screen has Repair, which gives the install its key", exit: "failed" },
  too_large: { sentence: "a size limit is passed", hint: "poplin config shows the limits", exit: "failed" },
  too_many_requests: { sentence: "the install is asked too often", hint: "wait a minute, then try again", exit: "failed" },
  internal: { sentence: "the install failed to do that", hint: "try again; poplin doctor reports on the install", exit: "failed" },
  allowance_spent: { sentence: "a day's allowance of the install is used up until 00:00 UTC", hint: "wait until then: asking again sooner is refused the same way", exit: "failed" },
} as const satisfies Readonly<Record<string, Row>>;

/** The codes of what goes wrong on this machine, or between it and the install. */
const LOCAL_ROWS = {
  no_login: { sentence: "not logged in", hint: "to log in: poplin login --server <the install's address>", exit: "no-install" },
  no_server: { sentence: "login needs the address of the install", hint: "poplin login --server https://<the install's address>", exit: "no-install" },
  login_denied: { sentence: "the login was denied on the dashboard", hint: "nothing was saved on this machine", exit: "failed" },
  login_expired: { sentence: "nobody allowed the login before it ran out", hint: "nothing was saved on this machine; to ask again: poplin login", exit: "failed" },
  interrupted: { sentence: "the login was stopped", hint: "nothing was saved on this machine", exit: "failed" },
  bad_login: { sentence: "the login cannot be used", exit: "no-install" },
  bad_server: { sentence: "--server takes an https:// address with nothing after the host", hint: "for example: --server https://poplin.example.com", exit: "usage-error" },
  wrong_server: {
    sentence: "there is no token for that install",
    hint: "a token is sent only to the install it was saved for; to log in to the other one: poplin login --server <its address>",
    exit: "no-install",
  },
  unreadable: { sentence: "nothing can be published", exit: "failed" },
  no_name: { sentence: "the path gives the site no name", exit: "failed" },
  root_links: {
    sentence: 'this install has no domain, so a link that starts with "/" would not open',
    hint: "nothing was sent; write the link from its own page, as css/site.css or ../css/site.css, or give the install a domain",
    exit: "failed",
  },
  not_confirmed: { sentence: "what was typed is not the site's label, so nothing was deleted", exit: "failed" },
  no_terminal: {
    sentence: "delete --forever asks for the site's label to be typed, and there is no terminal to ask on",
    hint: "without --forever the site goes to the trash, and is gone for good when its days there are over",
    exit: "failed",
  },
  no_setup_server: { sentence: "setup needs the address of the install", hint: "poplin setup --server https://<the install's address>", exit: "no-install" },
  no_setup_token: { sentence: "setup needs an account token of the install's provider, and POPLIN_SETUP_TOKEN holds none", hint: "the install page lists the rights it needs; put it in POPLIN_SETUP_TOKEN for this one command", exit: "failed" },
  setup_token_refused: { sentence: "the account token was refused, or it is not of the install's own account", hint: "make an account token with the rights the install page lists, in the account the install runs in", exit: "failed" },
  setup_provider_silent: { sentence: "the install got no answer from its provider", hint: "try again", exit: "unreachable" },
  setup_no_domain: { sentence: "the account token shows no such domain", hint: "--domain takes a domain that is active at the provider, in the account the token is of", exit: "failed" },
  setup_bad_domain: { sentence: "--domain takes a domain alone", hint: "for example: --domain example.com", exit: "failed" },
  setup_bad_login: { sentence: "--login takes an email address", hint: "an install with nothing set yet needs both: --domain <domain> --login <email>", exit: "failed" },
  setup_closed: {
    sentence: "nothing at that address takes a setup",
    hint: "an install's setup closes for good once somebody has logged in: from then on its dashboard's Domain tab checks and repairs",
    exit: "failed",
  },
  file_exists: { sentence: "a file is already there", hint: "to replace it: --overwrite; to write another: --out <file>", exit: "failed" },
  unwritable: { sentence: "the backup cannot be written", exit: "failed" },
  other_format: { sentence: "the install's backups are of a format this poplin does not write", hint: "update poplin", exit: "failed" },
  site_changed: { sentence: "a version's files are not the ones its site's record counts", hint: "export again", exit: "failed" },
  bad_backup: { sentence: "the file is not a backup", hint: "nothing was sent to the install", exit: "failed" },
  no_settings: { sentence: "the backup holds no settings: it is the backup of one site", hint: "import it without --settings", exit: "failed" },
  not_in_backup: { sentence: "the backup holds no such site", hint: "poplin import <zip> --dry-run lists its sites", exit: "failed" },
  unreachable: { sentence: "the install could not be reached", hint: "check the address and the network; poplin whoami shows the address", exit: "unreachable" },
  timeout: { sentence: "the install took too long to answer", hint: "try again", exit: "unreachable" },
  not_json: { sentence: "the answer is not the install's", hint: "is the address the one of your poplin install? poplin whoami shows it", exit: "unreachable" },
  unexpected_answer: {
    sentence: "the install answered in a form this poplin does not know",
    hint: "a login page in front of the install answers this way, and so does an install of another version",
    exit: "unreachable",
  },
  stopped: { sentence: "the command was stopped", exit: "failed" },
  crashed: { sentence: "poplin failed in a way it has no word for", exit: "failed" },
} as const satisfies Readonly<Record<string, Row>>;

/** Every row, by its code. */
const ROWS: Readonly<Record<string, Row>> = { ...API_ROWS, ...LOCAL_ROWS };

/** What goes with a change whose answer never came: the install may have made it. */
const MAY_HAVE_CHANGED = "the answer was lost, so the change may have been made all the same; poplin list shows the sites as they are";

/** The code of each failure of a call that is no refusal. */
const FAILURE_CODES = { unreachable: "unreachable", timeout: "timeout", "not-json": "not_json", unexpected: "unexpected_answer" } as const;

/** A code of the table. */
type Code = keyof typeof API_ROWS | keyof typeof LOCAL_ROWS;

/**
 * Why a command did not do what was asked.
 *
 * `message` is the code's sentence, and `about` what the code is about: an argument, a limit, a path, or a reason in words. `exit` is the ending the command exits with.
 */
export interface Problem {
  readonly code: string;
  readonly message: string;
  readonly about?: string;
  readonly hint?: string;
  readonly exit: Exit;
}

function build(code: string, row: Row, about: string | undefined, hint: string | undefined): Problem {
  const problem: { -readonly [Key in keyof Problem]: Problem[Key] } = { code, message: row.sentence, exit: row.exit };
  if (about !== undefined) problem.about = about;

  const said = hint ?? row.hint;
  if (said !== undefined) problem.hint = said;

  return problem;
}

/**
 * Build the problem of one code of the table.
 *
 * @param about - what the code is about, when that is known
 * @param hint - a hint in place of the table's own
 */
export function problem(code: Code, about?: string, hint?: string): Problem {
  return build(code, ROWS[code] as Row, about, hint);
}

/**
 * Turn the failure of a call into a problem.
 *
 * @param call - `changes` for a call that asks the install to change something: without an answer, the hint says the change may have been made
 * @returns the table's row for the API's code. A code the table does not hold keeps the API's own sentence
 */
export function problemOf(failure: Failure, call: "reads" | "changes" = "reads"): Problem {
  const hint = call === "changes" ? MAY_HAVE_CHANGED : undefined;

  if (failure.kind === "timeout") return problem("timeout", `${failure.seconds} seconds`, hint);

  if (failure.kind === "unreachable") return problem("unreachable", undefined, hint);

  if (failure.kind === "stopped") return problem("stopped", undefined, hint);

  // An answer in plain text says in its own words what is wrong, as an install that cannot start does: the words are shown, and the address is not put in doubt.
  if (failure.kind === "not-json" && failure.said !== undefined) return build("not_json", { sentence: `the answer is plain text, status ${failure.status}`, exit: LOCAL_ROWS.not_json.exit }, failure.said, hint);

  if (failure.kind !== "refused") return problem(FAILURE_CODES[failure.kind], `status ${failure.status}`, hint);

  const rows: Readonly<Record<string, Row>> = API_ROWS;
  const row = Object.hasOwn(rows, failure.code) ? rows[failure.code] : undefined;

  return build(failure.code, row ?? { sentence: failure.message, exit: "failed" }, failure.about, undefined);
}

/**
 * Word a problem for a person.
 *
 * @returns the sentence with what it is about, then the hint when there is one, a line each
 */
export function problemLines(said: Problem): string[] {
  const sentence = said.about === undefined ? said.message : `${said.message}: ${said.about}`;
  if (said.hint === undefined) return [sentence];

  return [sentence, said.hint];
}
