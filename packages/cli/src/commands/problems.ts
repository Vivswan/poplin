// The one table of what can go wrong: every code a command ends in, its sentence for a person, the hint that goes with it, and how the command exits.

import { TAKEN_BY_REPAIR } from "../../../core/src/actions/start-update";
import manifest from "../../package.json" with { type: "json" };
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

/** Where the project takes a report, as the package itself names it. */
const ISSUES: string = manifest.bugs.url;

/** The codes the API refuses with, in the API's own spelling. */
const API_ROWS = {
  not_logged_in: { sentence: "The token is missing or expired", hint: "Fix: poplin login", exit: "failed" },
  not_allowed: { sentence: "The token's role does not allow this", hint: "See: poplin whoami (a publisher token manages only the sites it published)", exit: "failed" },
  not_found: { sentence: "Site not found", hint: "See: poplin list", exit: "failed" },
  no_such_version: { sentence: "Version not found", hint: "See: poplin show <site>", exit: "failed" },
  method_not_allowed: { sentence: "The install rejected the request", hint: "See: poplin doctor (the install may be of another version than this CLI)", exit: "failed" },
  unsupported_media_type: { sentence: "The install rejected the request", hint: "See: poplin doctor (the install may be of another version than this CLI)", exit: "failed" },
  bad_argument: { sentence: "Invalid argument", exit: "failed" },
  bad_name: { sentence: "Invalid name", hint: "Fix: use 3 to 40 characters: lowercase letters, digits, and single dashes", exit: "failed" },
  reserved_name: { sentence: "The public name is reserved by the install", hint: "Fix: use --public-name <public name>", exit: "failed" },
  bad_path: { sentence: "The file path cannot be served", hint: "Fix: rename or remove the file", exit: "failed" },
  no_index: { sentence: "No index.html at the site root", exit: "failed" },
  size_mismatch: { sentence: "A file changed during the upload", hint: "Fix: publish again once the files stop changing", exit: "failed" },
  hash_mismatch: { sentence: "A file changed after it was read, or was corrupted in transit", hint: "Fix: publish again once the files stop changing", exit: "failed" },
  name_taken: { sentence: "The public name is taken", hint: "Fix: poplin set <site> --public --public-name <public name>", exit: "failed" },
  in_trash: { sentence: "The site is in the trash", hint: "Fix: poplin restore <site>", exit: "failed" },
  id_taken: { sentence: "The site id already exists on the install", hint: "See: poplin show <site>", exit: "failed" },
  backup_too_new: { sentence: "The backup format is newer than the install supports", hint: "Fix: poplin update, then import again", exit: "failed" },
  not_in_trash: { sentence: "The site is not in the trash", exit: "failed" },
  stale_version: { sentence: "A newer version went live first", hint: "Fix: publish again", exit: "failed" },
  missing_files: { sentence: "The upload is missing a file", hint: "Fix: publish again", exit: "failed" },
  upload_finished: { sentence: "The upload is already published", exit: "failed" },
  too_many_sites: { sentence: "The site limit is reached", hint: "See: poplin config max_sites and poplin list --trash (trashed sites count)", exit: "failed" },
  not_set_up: { sentence: "The install has no stored settings", hint: "Fix: retry. If it persists: poplin doctor --repair", exit: "failed" },
  no_working_login: { sentence: "The change would leave no user who can log in", hint: "Fix: keep one current user in the list", exit: "failed" },
  needs_update_check: {
    sentence: "auto_update requires update_check",
    hint: "Fix: set update_check on first, or auto_update off first",
    exit: "failed",
  },
  already_a_login: { sentence: "The email is already a user", hint: "See: poplin config logins", exit: "failed" },
  not_a_login: { sentence: "The email is not a user", hint: "See: poplin config logins", exit: "failed" },
  no_update: { sentence: "No version to update to", hint: "See: poplin update --dry-run", exit: "failed" },
  update_unreachable: { sentence: "The provider did not respond to the update", hint: "See: poplin update --dry-run in a minute (the update may still have applied)", exit: "failed" },
  no_key: { sentence: "The install has no key, so it cannot update itself", hint: "Fix: open Domain on the dashboard and press Repair", exit: "failed" },
  key_refused: { sentence: "The provider rejected the install's key", hint: "Fix: open Domain on the dashboard and press Repair", exit: "failed" },
  lacks_right: { sentence: "The install's key lacks a permission", hint: "Fix: open Domain on the dashboard and press Repair to create a key that has it", exit: "failed" },
  release_refused: { sentence: "The release was rejected and nothing changed", hint: "See: poplin update --dry-run", exit: "failed" },
  version_refused: { sentence: "The provider rejected the new version and the install runs the previous one", hint: `Fix: retry. If it recurs, report it at ${ISSUES}`, exit: "failed" },
  logins_not_ended: { sentence: "The provider did not end the dashboard sessions, or did not respond", hint: "Fix: open Domain on the dashboard and press Repair", exit: "failed" },
  too_large: { sentence: "The size limit is exceeded", hint: "See: poplin config", exit: "failed" },
  too_many_requests: { sentence: "Rate limited by the install", hint: "Fix: retry in a minute", exit: "failed" },
  internal: { sentence: "Internal error on the install", hint: "Fix: retry. If it persists: poplin doctor", exit: "failed" },
  allowance_spent: { sentence: "The install's daily quota is exhausted", hint: "Fix: retry after 00:00 UTC", exit: "failed" },
} as const satisfies Readonly<Record<string, Row>>;

/** The codes of what goes wrong on this machine, or between it and the install. */
const LOCAL_ROWS = {
  no_login: { sentence: "Not logged in", hint: "Fix: poplin login --server <url>", exit: "no-install" },
  no_server: { sentence: "--server is required when not logged in", hint: "Fix: poplin login --server <url>", exit: "no-install" },
  login_denied: { sentence: "The login was denied on the dashboard", hint: "Nothing was stored.", exit: "failed" },
  login_expired: { sentence: "The login expired before approval", hint: "Nothing was stored. Fix: rerun this command", exit: "failed" },
  interrupted: { sentence: "Cancelled", hint: "Nothing changed.", exit: "failed" },
  bad_login: { sentence: "The login is unusable", exit: "no-install" },
  bad_server: { sentence: "--server requires an https:// origin without a path", hint: "Usage: --server https://poplin.example.com (http:// only for 127.0.0.1, localhost, and [::1])", exit: "usage-error" },
  wrong_server: { sentence: "No token for this install", hint: "Fix: poplin login --server <url>", exit: "no-install" },
  unreadable: { sentence: "Cannot publish", exit: "failed" },
  no_name: { sentence: "Cannot derive a site name from the path", exit: "failed" },
  root_links: {
    sentence: 'A link starting with "/" breaks on an install without a domain',
    hint: "Nothing was uploaded. Fix: link relative to the page, such as css/site.css or ../css/site.css",
    exit: "failed",
  },
  copy_gone: { sentence: "The install stopped the copy", hint: "Fix: if poplin list lacks the site, run poplin duplicate <site> again", exit: "failed" },
  not_confirmed: { sentence: "The confirmation does not match the site's label. Nothing changed.", exit: "failed" },
  no_terminal: { sentence: "delete --no-trash requires a terminal to prompt for the site's label", hint: "Fix: run it in a terminal, or omit --no-trash", exit: "failed" },
  file_exists: { sentence: "File already exists", hint: "Fix: pass --overwrite, or another --out <file>", exit: "failed" },
  unwritable: { sentence: "Cannot write the backup", exit: "failed" },
  other_format: { sentence: "This CLI does not write the install's backup format", hint: "Fix: update the poplin CLI", exit: "failed" },
  site_changed: { sentence: "A version's files do not match its record", hint: "Fix: export again", exit: "failed" },
  bad_backup: { sentence: "Not a backup", hint: "Nothing was uploaded.", exit: "failed" },
  no_settings: { sentence: "The backup has no settings: it holds one site", hint: "Fix: import without --settings", exit: "failed" },
  not_in_backup: { sentence: "Site not found in the backup", hint: "See: poplin import <zip> --dry-run", exit: "failed" },
  unreachable: { sentence: "Cannot reach the install", hint: "Fix: check the URL and the network, or poplin login --server <url>", exit: "unreachable" },
  timeout: { sentence: "The install did not respond in time", hint: "Fix: retry", exit: "unreachable" },
  not_json: { sentence: "The response is not from a poplin install", exit: "unreachable" },
  unexpected_answer: { sentence: "Unexpected response from the install", hint: "A login page in front of the install or a version mismatch can cause this.", exit: "unreachable" },
  stopped: { sentence: "Cancelled", exit: "failed" },
  crashed: { sentence: "Unexpected error", exit: "failed" },
} as const satisfies Readonly<Record<string, Row>>;

/** Every row, by its code. */
const ROWS: Readonly<Record<string, Row>> = { ...API_ROWS, ...LOCAL_ROWS };

/** The hint of a code whose way out hangs on what it is about: each reason a release is refused for says what it means, and whether trying again helps. */
const HINTS_ABOUT: Readonly<Record<string, Readonly<Record<string, string>>>> = {
  release_refused: {
    no_digest: "No build is published for that version. Fix: poplin update installs the latest release",
    unreachable: "The release download failed. Fix: retry in a few minutes",
    digest_differs: `Release checksum mismatch. Fix: retry. If it recurs, report it at ${ISSUES}`,
    other_version: `The release files name another version or schema than the release index. Retrying fails the same way. Fix: report it at ${ISSUES}`,
    database: "That release migrates the database, and the requested version cannot read it. Retrying fails the same way.",
    needs_hand: TAKEN_BY_REPAIR,
    host: "The provider did not respond, and nothing was sent. Fix: retry in a few minutes",
  },
};

/** The field a code's sentence already names: a screen leaves such an `about` out, and `--json` keeps it. */
const FIELD_SAID: Readonly<Record<string, string>> = { name_taken: "public_name", id_taken: "id", needs_update_check: "auto_update" };

/** A hint or an `about` that is one statement that nothing was done, such as `Nothing was stored.` or `Nothing changed`. */
const NOTHING_DONE = /^Nothing (?:was \w+|changed)\.?$/;

/** What goes with a change whose answer never came: the install may have made it. */
const MAY_HAVE_CHANGED = "See: poplin list (the request may have been applied)";

/** What goes with a change that never left this machine: the install had nothing of it. */
const NOTHING_SENT = "No request was sent, so nothing changed. Fix: check the URL and the network";

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

/** The hint for what a refusal is about; none for a code with one way out, or about something the table does not name. */
function hintAbout(code: string, about: string | undefined): string | undefined {
  if (about === undefined || !Object.hasOwn(HINTS_ABOUT, code)) return undefined;

  const hints = HINTS_ABOUT[code] ?? {};

  return Object.hasOwn(hints, about) ? hints[about] : undefined;
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
 * @returns the table's row for the API's code, with the hint for what the refusal is about where the table has one. A code the table does not hold keeps the API's own sentence
 */
export function problemOf(failure: Failure, call: "reads" | "changes" = "reads"): Problem {
  const hint = call === "changes" ? MAY_HAVE_CHANGED : undefined;

  if (failure.kind === "timeout") return problem("timeout", `${failure.seconds} s`, hint);

  // The address that was tried is said: no other command can show it while the install gives no answer.
  if (failure.kind === "unreachable") return problem("unreachable", failure.address, hint === undefined || failure.left ? hint : NOTHING_SENT);

  if (failure.kind === "stopped") return problem("stopped", undefined, hint);

  // An answer in plain text says in its own words what is wrong, as an install that cannot start does: the words are shown, and the address is not put in doubt.
  if (failure.kind === "not-json" && failure.said !== undefined) return build("not_json", { sentence: `The install responded with plain text, status ${failure.status}`, exit: LOCAL_ROWS.not_json.exit }, failure.said, hint);

  if (failure.kind === "not-json") return problem("not_json", `status ${failure.status} from ${failure.address}`, hint ?? "Fix: check that the URL is the install's");

  if (failure.kind !== "refused") return problem("unexpected_answer", `status ${failure.status}`, hint);

  const rows: Readonly<Record<string, Row>> = API_ROWS;
  const row = Object.hasOwn(rows, failure.code) ? rows[failure.code] : undefined;

  return build(failure.code, row ?? { sentence: failure.message, exit: "failed" }, failure.about, hintAbout(failure.code, failure.about));
}

/**
 * What a problem is about, as a person reads it.
 *
 * @returns `about`, or nothing where it only repeats the field the sentence names
 */
export function aboutOf(said: Problem): string | undefined {
  return said.about !== undefined && FIELD_SAID[said.code] === said.about ? undefined : said.about;
}

/**
 * Word a problem for a person.
 *
 * @returns the sentence with what it is about, then the hint when there is one, a line each
 */
export function problemLines(said: Problem): string[] {
  const about = aboutOf(said);
  // What the problem is about, where it only says nothing was done, is a sentence of its own after the problem's.
  const joined = about !== undefined && NOTHING_DONE.test(about) ? `${said.message}. ${about}.` : `${said.message}: ${about}`;
  const sentence = about === undefined ? said.message : joined;
  if (said.hint === undefined) return [sentence];

  // A hint that only says nothing was done ends the sentence's own line: it names nothing to run.
  return NOTHING_DONE.test(said.hint) ? [`${sentence}. ${said.hint}`] : [sentence, said.hint];
}
