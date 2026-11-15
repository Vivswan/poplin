// The commands about this machine's login and about the install as a whole: whoami, logout, config, and doctor.

import type * as v from "valibot";

import { DOMAIN_SENTENCES, DOMAIN_STATE } from "../../../core/src/actions/domain-state";
import { PROBLEMS_LISTED } from "../../../core/src/actions/problems";
import { LISTED_SITES } from "../../../core/src/actions/list";
import { REVOKED_TOKEN, WHOAMI_ANSWER } from "../../../core/src/actions/manage-tokens";
import { SETTINGS_ANSWER } from "../../../core/src/actions/store-settings";
import { settingsToText } from "../../../core/src/records/settings";
import type { Called, Failure } from "../client/client";
import { clearLogin } from "../local/login-file";
import { VERSION } from "../poplin";
import { readSetting } from "./install-settings";
import { type Problem, problem, problemOf } from "./problems";
import type { Outcome, RequestOf, Session } from "./records";
import { columns, countText, dayText } from "./text";

/** What the login is still good for after a logout that the install did not answer. */
const STILL_LIVE = "the token may still be live: revoke it on the install's dashboard";

/** What a change of the logins still needs: the login page in front of the install keeps a list of its own. */
const LOGINS_STEP = "one more step: on the dashboard's Domain tab, paste an account token and press Repair, so the login page lets a new email in; until then only an email that was already a login gets in";

/** What follows the two versions of an install and a command that differ, in the words the list of problems has for them. */
const TWO_VERSIONS = "the install and this poplin are of two versions; update the older one";

/** The commands this module runs, as the parser read them. */
type InstallRequest = RequestOf<"whoami" | "logout" | "config" | "doctor">;

/** `config` showing every setting, showing one, or changing one. */
type ConfigAction = RequestOf<"config">["action"];

/** What the install remembers of its domain needing, as the API answers it. */
type DomainNote = v.InferOutput<typeof DOMAIN_STATE>["note"];

/** One line of a doctor's report. */
interface Check {
  readonly check: string;
  readonly ok: boolean;
  readonly detail: string;
}

function failed(failure: Failure, call: "reads" | "changes" = "reads"): Outcome {
  return { ok: false, problem: problemOf(failure, call) };
}

function expiryText(expires: "never" | number): string {
  return expires === "never" ? "never" : dayText(expires);
}

async function whoami({ client, server, source }: Session): Promise<Outcome> {
  const answered = await client.call(WHOAMI_ANSWER, (api) => api.whoami.$get());
  if (!answered.ok) return failed(answered.failure);

  const { token } = answered.value;
  const facts = [
    ["install", server],
    ["role", token.scope],
    ["token", token.note === "" ? token.id : `${token.id} (${token.note})`],
    ["expires", expiryText(token.expires)],
    ["login", source === "file" ? "saved on this machine" : "POPLIN_SERVER and POPLIN_TOKEN"],
  ];

  return { ok: true, value: { server, ...answered.value }, lines: columns(facts) };
}

/** Whether the token is dead on the install: revoked now, or not a live token before the call. */
function isRevoked(failure: Failure | undefined): boolean {
  return failure === undefined || (failure.kind === "refused" && failure.code === "not_logged_in");
}

/**
 * Revoke the token on the install, then forget the saved login. The saved login goes even when the install gave no answer.
 *
 * A login from the environment has no file of its own, so the saved login of this machine, which may be another one, is left alone.
 */
async function logout({ client, io, server, source }: Session): Promise<Outcome> {
  const revoked = await client.call(REVOKED_TOKEN, (api) => api.token.$delete());
  const failure = revoked.ok ? undefined : revoked.failure;
  if (source === "file") await clearLogin(io.machine);

  const local = source === "file" ? "the saved login was removed from this machine" : "POPLIN_SERVER and POPLIN_TOKEN are still set in this shell";

  if (failure !== undefined && !isRevoked(failure)) {
    const said: Problem = problemOf(failure);

    return { ok: false, problem: { ...said, hint: `${local}; ${STILL_LIVE}` } };
  }

  const lines = [`logged out of ${server}`, failure === undefined ? "the token is revoked" : "the token was dead already"];

  return { ok: true, value: { server, revoked: failure === undefined }, lines, notes: source === "file" ? [] : [local] };
}

async function config(action: ConfigAction, { client }: Session): Promise<Outcome> {
  if (action.kind !== "change") {
    const read = await client.call(SETTINGS_ANSWER, (api) => api.config.$get());
    if (!read.ok) return failed(read.failure);

    const texts = settingsToText(read.value.values);
    const lines = action.kind === "show" ? [texts[action.key]] : columns(Object.entries(texts));

    return { ok: true, value: read.value, lines };
  }

  const value = readSetting(action.key, action.value);
  if (value === undefined) return { ok: false, problem: problem("bad_argument", action.key) };

  const changed = await client.call(SETTINGS_ANSWER, (api) => api.config.$patch({ json: { [action.key]: value } }));
  if (!changed.ok) return failed(changed.failure, "changes");

  const lines = columns([[action.key, settingsToText(changed.value.values)[action.key]]]);

  return { ok: true, value: changed.value, lines, notes: action.key === "logins" ? [LOGINS_STEP] : [] };
}

/** A check that reads something an admin alone may read: a publisher's refusal is a finding, not a failure. */
function checkOf(check: string, failure: Failure | undefined, detail: string): Check {
  if (failure === undefined) return { check, ok: true, detail };

  if (failure.kind === "refused" && failure.code === "not_allowed") return { check, ok: true, detail: "not read: this token is no admin's" };

  const said = problemOf(failure);

  return { check, ok: false, detail: said.about === undefined ? said.message : `${said.message}: ${said.about}` };
}

/** The versions of the install and of this command, side by side. Two that differ are a finding, not a failure: every call the report makes was still answered. */
function versionCheck(install: string): Check {
  const both = `install ${install}, this poplin ${VERSION}`;

  return { check: "version", ok: true, detail: install === VERSION ? both : `${both}: ${TWO_VERSIONS}` };
}

/** The newer release the install has learned of, as one line of the report. It is a finding, not a failure. */
function updateCheck(update: { readonly current: string; readonly newest: string; readonly notes: string }): Check {
  return { check: "update", ok: true, detail: `${update.newest} is out (this install runs ${update.current}): ${update.notes}` };
}

/**
 * What the last check of the domain left to act on: the note for `--json`, `null` when it was not read, and its line of the report.
 * There is no line while nothing is left, and none for a token that is no admin's. It is a finding, not a failure: it is what that check found, not the state now.
 */
function domainFinding(domain: Called<{ readonly note: DomainNote }>): { readonly note: DomainNote | null; readonly checks: Check[] } {
  if (!domain.ok) return { note: null, checks: domain.failure.kind === "refused" && domain.failure.code === "not_allowed" ? [] : [checkOf("domain", domain.failure, "")] };

  const { note } = domain.value;

  return { note, checks: note === "none" ? [] : [{ check: "domain", ok: true, detail: DOMAIN_SENTENCES[note.code] }] };
}

/**
 * What went wrong in the install's last week: the kinds of today and of the week for `--json`, `null` when they were not read, and their line of the report.
 * A kind noted today is a failure; one of an earlier day is a finding.
 */
function problemsFinding(listed: Called<v.InferOutput<typeof PROBLEMS_LISTED>>): { readonly problems: { readonly today: string[]; readonly week: string[] } | null; readonly checks: Check[] } {
  if (!listed.ok) return { problems: null, checks: [checkOf("problems", listed.failure, "")] };

  const week = [...new Set(listed.value.problems.map((problem) => problem.kind))];
  const today = [...new Set(listed.value.problems.filter((problem) => problem.day === listed.value.today).map((problem) => problem.kind))];
  if (today.length > 0) return { problems: { today, week }, checks: [{ check: "problems", ok: false, detail: `${countText(today.length, "kind")} today: ${today.join(", ")}` }] };

  const detail = week.length === 0 ? "none in 7 days" : `none today; in 7 days: ${week.join(", ")}`;

  return { problems: { today, week }, checks: [{ check: "problems", ok: true, detail }] };
}

/** Read what went wrong, for an admin's token. Any other token is not asked, so a refusal of that read is never its failure, and its report has no such line. */
async function notedProblems(client: Session["client"], scope: string): Promise<ReturnType<typeof problemsFinding>> {
  if (scope !== "admin") return { problems: null, checks: [] };

  return problemsFinding(await client.call(PROBLEMS_LISTED, (api) => api.problems.$get()));
}

/** Report on the install with calls that only read: who the token is, the settings, the sites, and what it noted of its domain and of what went wrong. Nothing is changed. */
async function doctor({ client, server, source }: Session): Promise<Outcome> {
  const who = await client.call(WHOAMI_ANSWER, (api) => api.whoami.$get());
  if (!who.ok) return failed(who.failure);

  const { token, version, update } = who.value;
  const settings = await client.call(SETTINGS_ANSWER, (api) => api.config.$get());
  const sites = await client.call(LISTED_SITES, (api) => api.sites.$get());
  const trash = await client.call(LISTED_SITES, (api) => api.sites.$get({ query: { trash: "true" } }));
  const domain = domainFinding(await client.call(DOMAIN_STATE, (api) => api.domain.$get()));
  const noted = await notedProblems(client, token.scope);
  const kept = settings.ok ? `${Object.keys(settings.value.values).length} settings read` : "";
  const live = sites.ok ? `${countText(sites.value.sites.length, "site")}${sites.value.next === undefined ? "" : " and more"}` : "";
  const trashed = trash.ok ? `${countText(trash.value.sites.length, "site")}${trash.value.next === undefined ? "" : " and more"}` : "";
  const checks: Check[] = [
    { check: "install", ok: true, detail: `${server} answers` },
    versionCheck(version),
    ...(update === undefined ? [] : [updateCheck(update)]),
    { check: "login", ok: true, detail: `${token.scope} token ${token.id}, ${source === "file" ? "saved on this machine" : "from the environment"}, expires ${expiryText(token.expires)}` },
    checkOf("settings", settings.ok ? undefined : settings.failure, kept),
    checkOf("sites", sites.ok ? undefined : sites.failure, live),
    checkOf("trash", trash.ok ? undefined : trash.failure, trashed),
    ...domain.checks,
    ...noted.checks,
  ];
  const lines = columns(checks.map((check) => [check.ok ? "ok" : "failed", check.check, check.detail]));

  const outcome: Outcome = { ok: true, value: { server, version, poplin: VERSION, update: update ?? null, domain: domain.note, problems: noted.problems, token, checks }, lines: [...lines, "nothing was changed"] };

  return checks.every((check) => check.ok) ? outcome : { ...outcome, found: "failed" };
}

/**
 * Run one command about the login or the install.
 *
 * @returns what the install answered, worded for a person and kept whole for `--json`, or the problem. `doctor` only reads, and `logout` forgets the saved login whatever the install answers
 */
export async function runInstallCommand(request: InstallRequest, session: Session): Promise<Outcome> {
  switch (request.kind) {
    case "whoami":
      return whoami(session);
    case "logout":
      return logout(session);
    case "doctor":
      return doctor(session);
    case "config":
      return config(request.action, session);
  }
}
