// The commands about this machine's login and about the install as a whole: whoami, logout, config, and doctor.

import type * as v from "valibot";

import { DOMAIN_STATE, domainSentence } from "../../../../core/src/actions/install/domain-state";
import { PROBLEMS_LISTED } from "../../../../core/src/actions/install/problems";
import { LISTED_SITES } from "../../../../core/src/actions/sites/list";
import { REVOKED_TOKEN, WHOAMI_ANSWER } from "../../../../core/src/actions/access/manage-tokens";
import { SETTINGS_ANSWER } from "../../../../core/src/actions/install/store-settings";
import { settingsToText } from "../../../../core/src/records/settings";
import type { AddressLayout } from "../../../../core/src/sites/address-layout";
import type { Called, Failure } from "../../client/client";
import { clearLogin } from "../../local/login-file";
import { VERSION } from "../../poplin";
import { readSetting } from "./install-settings";
import { type Problem, problem, problemOf } from "../problems";
import type { Outcome, RequestOf, Session } from "../records";
import type { Line } from "../../local/screen";
import { columns, countText, dayText, GAP, REHEARSED } from "../text";

/** What the login is still good for after a logout that the install did not answer: an install that was removed answers none, and its tokens went with it. */
const STILL_LIVE = "The token may still be valid. Fix: revoke it on the dashboard";

/** What a change of the users still needs on an install that did not carry it to the login page by itself: that page keeps a list of its own. */
const USERS_STEP = ["New users cannot log in yet", "Fix: on the dashboard's Domain screen, paste an account token and press Repair"] as const;

/** What a dry run of a change of the users says of that step: whether it is needed shows only once the change is stored. */
const USERS_MAY_STEP = "Before new users can log in, a real run may also need this: open Domain on the dashboard and press Repair";

/** What follows the two versions of an install and a command that differ. */
const TWO_VERSIONS = "versions differ";

/** What a sentence calls the install's side at its provider, by how the install lays out its addresses: one under a domain of its own, or one on paths with none. */
const THINGS = { hostname: "the domain", path: "the install" } as const satisfies Record<AddressLayout["kind"], string>;

/** The commands this module runs, as the parser read them. */
type InstallRequest = RequestOf<"whoami" | "logout" | "config" | "doctor">;

/** `config` showing every setting, showing one, or changing one. */
type ConfigAction = RequestOf<"config">["action"];

/** The key of one setting of an install. */
type SettingKey = Extract<ConfigAction, { readonly key: unknown }>["key"];

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
    ["source", source === "file" ? "stored login" : "POPLIN_SERVER and POPLIN_TOKEN"],
  ];

  return { ok: true, value: { server, ...answered.value }, lines: columns(facts) };
}

/** Whether the token is dead on the install: revoked now, or not a live token before the call. */
function isRevoked(failure: Failure | undefined): boolean {
  return failure === undefined || (failure.kind === "refused" && failure.code === "not_logged_in");
}

/**
 * Say what a logout would do: the install is asked who the token is, which tells a live token from a dead one, and nothing is revoked or forgotten.
 *
 * @returns what a logout would say, or why the install gave no answer to go by
 */
async function rehearseLogout({ client, server, source }: Session): Promise<Outcome> {
  const answered = await client.call(WHOAMI_ANSWER, (api) => api.whoami.$get());
  const failure = answered.ok ? undefined : answered.failure;
  if (failure !== undefined && !isRevoked(failure)) return failed(failure);

  const token = failure === undefined ? "the token would be revoked" : "the token is already invalid";
  const lines = [{ tone: "done", text: `Would log out of ${server}: ${token}` } as const, "Dry run: one read-only request checked the token"];

  return { ok: true, value: { dry_run: true, server, revoked: failure === undefined }, lines, notes: source === "file" ? [] : ["POPLIN_SERVER and POPLIN_TOKEN would stay set in this shell"] };
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

  const local = source === "file" ? "The stored login is deleted" : "POPLIN_SERVER and POPLIN_TOKEN are still set in this shell";

  if (failure !== undefined && !isRevoked(failure)) {
    const said: Problem = problemOf(failure);

    return { ok: false, problem: { ...said, hint: `${local}. ${STILL_LIVE}` } };
  }

  const lines = [{ tone: "done", text: `Logged out of ${server}: ${failure === undefined ? "the token is revoked" : "the token was already invalid"}` } as const];

  return { ok: true, value: { server, revoked: failure === undefined }, lines, notes: source === "file" ? [] : [local] };
}

/** What `--json` prints of the one setting a command named: its key and its value, so a script reads what it asked about and no other setting. */
function oneSetting(key: SettingKey, values: v.InferOutput<typeof SETTINGS_ANSWER>["values"]): { readonly key: SettingKey; readonly value: unknown } {
  return { key, value: values[key] };
}

/** Give one setting a value, or with a dry run ask the install what the setting would be. */
async function changeSetting(action: Extract<ConfigAction, { readonly kind: "change" }>, { client }: Session): Promise<Outcome> {
  const value = readSetting(action.key, action.value);
  if (value === undefined) return { ok: false, problem: problem("bad_argument", action.key) };

  const query = action.dryRun ? { dry_run: "true" } : {};
  const changed = await client.call(SETTINGS_ANSWER, (api) => api.config.$patch({ query, json: { [action.key]: value } }));
  if (!changed.ok) return failed(changed.failure, action.dryRun ? "reads" : "changes");

  const shown = [action.key, settingsToText(changed.value.values)[action.key]];
  const lines = action.dryRun ? [...columns([["would set", ...shown]]), REHEARSED] : columns([shown]);
  const answer = action.dryRun ? { dry_run: true, ...oneSetting(action.key, changed.value.values) } : oneSetting(action.key, changed.value.values);
  if (action.key !== "users") return { ok: true, value: answer, lines, notes: [] };

  if (action.dryRun) return { ok: true, value: answer, lines, notes: [USERS_MAY_STEP] };

  // The install says whether the change still waits for a repair. One that does not say, or that remembers no run of its domain to say it by, is taken to wait.
  const domain = await client.call(DOMAIN_STATE, (api) => api.domain.$get());
  const settled = domain.ok && domain.value.check !== null && !domain.value.waits;

  return { ok: true, value: answer, lines, notes: settled ? [] : [...USERS_STEP] };
}

async function config(action: ConfigAction, session: Session): Promise<Outcome> {
  const { client } = session;
  if (action.kind !== "change") {
    const read = await client.call(SETTINGS_ANSWER, (api) => api.config.$get());
    if (!read.ok) return failed(read.failure);

    const texts = settingsToText(read.value.values);
    if (action.kind === "show") return { ok: true, value: oneSetting(action.key, read.value.values), lines: [texts[action.key]] };

    return { ok: true, value: read.value, lines: columns(Object.entries(texts)) };
  }

  return changeSetting(action, session);
}

/** A check that reads something an admin alone may read: a publisher's refusal is a finding, not a failure. */
function checkOf(check: string, failure: Failure | undefined, detail: string): Check {
  if (failure === undefined) return { check, ok: true, detail };

  if (failure.kind === "refused" && failure.code === "not_allowed") return { check, ok: true, detail: "skipped: requires an admin token" };

  const said = problemOf(failure);

  return { check, ok: false, detail: said.about === undefined ? said.message : `${said.message}: ${said.about}` };
}

/** The versions of the install and of this command, side by side. Two that differ are a finding, not a failure: every call the report makes was still answered. */
function versionCheck(install: string): Check {
  const both = `install ${install}, CLI ${VERSION}`;

  return { check: "version", ok: true, detail: install === VERSION ? both : `${both}: ${TWO_VERSIONS}` };
}

/** The newer release the install has learned of, as one line of the report. It is a finding, not a failure. */
function updateCheck(update: { readonly current: string; readonly newest: string; readonly notes: string }): Check {
  return { check: "update", ok: true, detail: `${update.newest} is available (the install runs ${update.current}): ${update.notes}` };
}

/**
 * What the last check of the domain left to act on: the note for `--json`, `null` when it was not read, and its line of the report.
 * There is no line while nothing is left, and none for a token that is no admin's. It is a finding, not a failure: it is what that check found, not the state now.
 */
function domainFinding(domain: Called<{ readonly note: DomainNote }>, thing: string): { readonly note: DomainNote | null; readonly checks: Check[] } {
  if (!domain.ok) return { note: null, checks: domain.failure.kind === "refused" && domain.failure.code === "not_allowed" ? [] : [checkOf("domain", domain.failure, "")] };

  const { note } = domain.value;

  return { note, checks: note === "none" ? [] : [{ check: "domain", ok: true, detail: domainSentence(note, thing) }] };
}

/**
 * What went wrong in the install's last week: the kinds of today and of the week for `--json`, `null` when they were not read, and their line of the report.
 * A kind noted today is a failure; one of an earlier day is a finding.
 */
function problemsFinding(listed: Called<v.InferOutput<typeof PROBLEMS_LISTED>>): { readonly problems: { readonly today: string[]; readonly week: string[] } | null; readonly checks: Check[] } {
  if (!listed.ok) return { problems: null, checks: [checkOf("problems", listed.failure, "")] };

  const week = [...new Set(listed.value.problems.map((problem) => problem.kind))];
  const today = [...new Set(listed.value.problems.filter((problem) => problem.day === listed.value.today).map((problem) => problem.kind))];
  if (today.length > 0) return { problems: { today, week }, checks: [{ check: "problems", ok: false, detail: `${countText(today.length, "type")} today: ${today.join(", ")}` }] };

  const detail = week.length === 0 ? "none in 7 days" : `none today, in 7 days: ${week.join(", ")}`;

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

  const { token, version, update, layout } = who.value;
  const settings = await client.call(SETTINGS_ANSWER, (api) => api.config.$get());
  const sites = await client.call(LISTED_SITES, (api) => api.sites.$get());
  const trash = await client.call(LISTED_SITES, (api) => api.sites.$get({ query: { trash: "true" } }));
  const domain = domainFinding(await client.call(DOMAIN_STATE, (api) => api.domain.$get()), THINGS[layout.kind]);
  const noted = await notedProblems(client, token.scope);
  const kept = settings.ok ? `${Object.keys(settings.value.values).length} settings` : "";
  const live = sites.ok ? `${sites.value.next === undefined ? "" : "more than "}${countText(sites.value.sites.length, "site")}` : "";
  const trashed = trash.ok ? `${trash.value.next === undefined ? "" : "more than "}${countText(trash.value.sites.length, "site")}` : "";
  const checks: Check[] = [
    { check: "install", ok: true, detail: `${server} responds` },
    versionCheck(version),
    ...(update === undefined ? [] : [updateCheck(update)]),
    { check: "login", ok: true, detail: `${token.scope} token ${token.id}, ${source === "file" ? "stored on this machine" : "from the environment"}, expires ${expiryText(token.expires)}` },
    checkOf("settings", settings.ok ? undefined : settings.failure, kept),
    checkOf("sites", sites.ok ? undefined : sites.failure, live),
    checkOf("trash", trash.ok ? undefined : trash.failure, trashed),
    ...domain.checks,
    ...noted.checks,
  ];
  const marks = checks.map((check) => (check.ok ? "ok" : "failed"));
  // A detail a terminal folds goes on under itself, past the mark and the name of its check.
  const hang = Math.max(...marks.map((mark) => mark.length)) + Math.max(...checks.map((check) => check.check.length)) + 2 * GAP.length;
  const lines = columns(checks.map((check, at) => [marks[at] ?? "", check.check, check.detail])).map((text, at): Line => ({ tone: checks[at]?.ok === true ? "done" : "error", text, hang }));

  const outcome: Outcome = { ok: true, value: { server, version, poplin: VERSION, update: update ?? null, domain: domain.note, problems: noted.problems, token, checks }, lines };

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
      return request.dryRun ? rehearseLogout(session) : logout(session);
    case "doctor":
      return doctor(session);
    case "config":
      return config(request.action, session);
  }
}
