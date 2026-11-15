// The commands about this machine's login and about the install as a whole: whoami, logout, config, and doctor.

import { settingsToText } from "../../../core/src/records/settings";
import type { Failure } from "../client/client";
import { clearLogin } from "../local/login-file";
import { VERSION } from "../poplin";
import { readSetting } from "./install-settings";
import { type Problem, problem, problemOf } from "./problems";
import type { Outcome, RequestOf, Session } from "./records";
import { columns, countText, dayText } from "./text";

/** What the login is still good for after a logout that the install did not answer. */
const STILL_LIVE = "the token may still be live: revoke it on the install's dashboard";

/** What a change of the logins still needs: the login page in front of the install keeps a list of its own. */
const LOGINS_STEP = "one more step: on the dashboard's Domain tab, paste a token and press Repair, so the login page lets a new email in; until then only an email that was already a login gets in";

/** What follows the two versions of an install and a command that differ, in the words the list of problems has for them. */
const TWO_VERSIONS = "the install and this poplin are of two versions; update the older one";

/** The commands this module runs, as the parser read them. */
type InstallRequest = RequestOf<"whoami" | "logout" | "config" | "doctor">;

/** `config` showing every setting, showing one, or changing one. */
type ConfigAction = RequestOf<"config">["action"];

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
  const answered = await client.call("whoami", undefined);
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
  const revoked = await client.call("logout", undefined);
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
    const read = await client.call("readConfig", undefined);
    if (!read.ok) return failed(read.failure);

    const texts = settingsToText(read.value.values);
    const lines = action.kind === "show" ? [texts[action.key]] : columns(Object.entries(texts));

    return { ok: true, value: read.value, lines };
  }

  const value = readSetting(action.key, action.value);
  if (value === undefined) return { ok: false, problem: problem("bad_argument", action.key) };

  const changed = await client.call("changeConfig", undefined, { [action.key]: value });
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

/** Report on the install with calls that only read: who the token is, the settings, and the sites. Nothing is changed. */
async function doctor({ client, server, source }: Session): Promise<Outcome> {
  const who = await client.call("whoami", undefined);
  if (!who.ok) return failed(who.failure);

  const { token, version, update } = who.value;
  const settings = await client.call("readConfig", undefined);
  const sites = await client.call("listSites", {});
  const trash = await client.call("listSites", { trash: true });
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
  ];
  const lines = columns(checks.map((check) => [check.ok ? "ok" : "failed", check.check, check.detail]));

  const outcome: Outcome = { ok: true, value: { server, version, poplin: VERSION, update: update ?? null, token, checks }, lines: [...lines, "nothing was changed"] };

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
