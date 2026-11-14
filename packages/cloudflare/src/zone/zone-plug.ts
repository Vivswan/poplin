// The dashboard's zone plug for Cloudflare: every object of an install read, or made to match, with a token that lives for the one call.
//
//   token -> the account's zones -> the zone of the install's domain -> records, routes, Access, guard rules, rate rule, bot switches, database
//
// A token proves itself by showing the install's own zone inside the install's own account; any other token is refused before anything is read.
// A check is the repair's own code with the changes left unsent, so the two cannot disagree on what a repair would do.

import type { DomainPlug, DomainReading, DomainRow, DomainSettings, DomainState, DomainStep, ReadSettings } from "@poplin/app/src/dashboard/domain/records";
import { parseLogins } from "@poplin/core/src/auth/logins";
import { isAccessOff, syncAccess } from "./access/access";
import { syncZoneBots } from "./bots/bots";
import { type Connection, listZones } from "./client";
import { syncDatabase } from "./database/database";
import { syncDns } from "./dns/dns";
import { INSTALL_OBJECTS } from "./install-objects";
import type { DomainLayout } from "./layout";
import { syncRoutes } from "./routes/routes";
import { syncGuards } from "./rules/guards";
import { defaultRateRule, syncWaf } from "./rules/waf";
import type { Mode, Report } from "./sync";

/** What a token is made of. Anything else is refused unsent, so no pasted text reaches a request header. */
const TOKEN = /^[A-Za-z0-9_-]{20,512}$/;

/** The reading of a token that is not one, is refused, or does not show the install's zone in the install's account. */
const REFUSED: DomainReading = { ok: false, refusal: "token" };

/** The reading when Cloudflare did not answer, or asked to wait. */
const UNREACHABLE: DomainReading = { ok: false, refusal: "unreachable" };

/** What each setting the Domain tab changes does on Cloudflare. */
const GUARD_NOTES: DomainPlug["guardNotes"] = {
  outside_pages: "Pages of other domains framing a site or loading its files.",
  search_engines_allowed: "Search engines reach public sites.",
  block_bots: "auto blocks AI bots unless your domain has other hostnames. on adds Bot Fight Mode, which can block the command line from cloud hosts.",
};

/** The reading of a proven token on an install with no stored settings. */
const NOT_SET_UP: DomainReading = { ok: false, refusal: "not_set_up" };

/** What the Access rows say on an account whose Access is switched off. */
const ACCESS_OFF = "Access is off for the account";

/** What to do about it: no API switches Access on. */
const ACCESS_STEP = "Open Zero Trust and pick a plan (Free works): that switches Access on.";

/** What the Access row says when the stored logins cannot be read back. */
const BAD_LOGINS = "the stored logins are not a list of emails";

/** What each state of a step is called in a check and in a repair. */
const STATES: Readonly<Record<Mode, Readonly<Record<"created" | "changed" | "removed", DomainState>>>> = {
  plan: { created: "missing", changed: "differs", removed: "differs" },
  apply: { created: "created", changed: "changed", removed: "removed" },
};

/** What the plug is built from. */
interface PlugParts {
  /** The account the Worker runs in, never one a token's holder names. */
  readonly accountId: string;

  /** The name of the install's Worker, which its routes name. */
  readonly script: string;

  /** The install's checked zone values. */
  readonly layout: DomainLayout;

  /** Where the API is; absent outside tests. */
  readonly baseUrl?: string;
}

/** A piece that stopped: what was done before, the step that failed and the ones never reached, and whichever of Cloudflare's answer or the piece's own message says why. */
interface Stopped {
  readonly ok: false;
  readonly report: Report;
  readonly failure: string;
  readonly failed?: string;
  readonly unrun?: readonly string[];
  readonly message?: string;
  readonly status?: number;
  readonly errors?: readonly { readonly code: number; readonly message: string }[];
}

/** What one piece of the install answered. */
type Outcome = { readonly ok: true; readonly report: Report } | Stopped;

/** The rows of a run so far, and whether a failure has stopped it. */
interface Progress {
  readonly rows: DomainRow[];
  readonly steps: DomainStep[];
  stopped: boolean;
}

function failureText(stopped: Stopped): string {
  if (stopped.failure === "no-id") return "Cloudflare named no database";

  if (stopped.failure === "rate-limited") return "Cloudflare asked to wait";

  if (stopped.failure === "network") return "no answer from Cloudflare";

  if (stopped.failure !== "refused") return stopped.message ?? stopped.failure;

  const errors = (stopped.errors ?? []).map((error) => `${error.code} ${error.message}`).join("; ");

  return errors === "" ? `refused with status ${stopped.status}` : `refused with status ${stopped.status}: ${errors}`;
}

function rowsOf(outcome: Outcome, mode: Mode, objectOf: (subject: string) => string): DomainRow[] {
  const { report } = outcome;
  const states = STATES[mode];
  const row = (subject: string, state: DomainState, detail = subject): DomainRow => ({ object: objectOf(subject), state, detail });
  const rows = [
    ...report.left.map((subject) => row(subject, "present")),
    ...report.created.map((subject) => row(subject, states.created)),
    ...report.changed.map((subject) => row(subject, states.changed)),
    ...report.removed.map((subject) => row(subject, states.removed, mode === "plan" ? `${subject} (stale)` : subject)),
    ...report.skipped.map((skip) => row(skip.subject, "left-out", `${skip.subject}: ${skip.reason}`)),
  ];

  if (!outcome.ok) {
    const failed = outcome.failed ?? "";
    rows.push(row(failed, "failed", failed === "" ? failureText(outcome) : `${failed}: ${failureText(outcome)}`));
    rows.push(...(outcome.unrun ?? []).map((subject) => row(subject, "not-run")));
  }

  return rows.sort((left, right) => (left.detail < right.detail ? -1 : 1));
}

// One piece of the install: its rows are added, and a failure stops every piece after it.
async function piece<Answer extends Outcome>(
  progress: Progress,
  mode: Mode,
  objectOf: (subject: string) => string,
  run: () => Promise<Answer>,
): Promise<Answer | undefined> {
  if (progress.stopped) {
    progress.rows.push({ object: objectOf(""), state: "not-run", detail: "" });

    return undefined;
  }

  const outcome = await run();
  progress.rows.push(...rowsOf(outcome, mode, objectOf));
  if (!outcome.ok) progress.stopped = true;

  return outcome;
}

function accessObject(subject: string): string {
  return subject === INSTALL_OBJECTS.accessPolicy ? "Access policy" : "Access application";
}

// Access that is switched off is a state of the account, not a failure of the run: the other pieces go on, and the page shows the one click.
async function accessPiece(progress: Progress, mode: Mode, parts: PlugParts, connection: Connection, settings: DomainSettings): Promise<void> {
  const logins = parseLogins(settings.logins);
  if (progress.stopped || !logins.ok) {
    progress.rows.push({ object: "Access application", state: progress.stopped ? "not-run" : "failed", detail: progress.stopped ? "" : BAD_LOGINS });
    progress.stopped = true;

    return;
  }

  const synced = await syncAccess(connection, parts.accountId, { hostname: parts.layout.adminHostname, logins: logins.value }, mode);
  // A refusal after a step was done is a failure of the run: its rows keep what was made.
  if (synced.ok || synced.failed !== undefined || !isAccessOff(synced)) {
    await piece(progress, mode, accessObject, async () => synced);

    return;
  }

  progress.rows.push({ object: "Access application", state: "missing", detail: ACCESS_OFF }, { object: "Access policy", state: "missing", detail: ACCESS_OFF });
  progress.steps.push({ text: ACCESS_STEP, address: `https://one.dash.cloudflare.com/${parts.accountId}` });
}

async function read(parts: PlugParts, mode: Mode, token: string, readSettings: ReadSettings): Promise<DomainReading> {
  if (!TOKEN.test(token)) return REFUSED;

  const connection: Connection = { key: token, baseUrl: parts.baseUrl };
  const zones = await listZones(connection, parts.accountId);
  if (!zones.ok) return zones.failure === "refused" ? REFUSED : UNREACHABLE;

  const zone = zones.value.find((candidate) => candidate.name === parts.layout.domain);
  if (zone === undefined) return REFUSED;

  // The token is proven: only now is anything of the install read.
  const settings = await readSettings();
  if (settings === undefined) return NOT_SET_UP;

  const { layout } = parts;
  const { plan } = zone;
  const progress: Progress = { rows: [], steps: [], stopped: false };

  const dns = await piece(
    progress,
    mode,
    () => "DNS record",
    () => syncDns(connection, zone.id, layout, mode),
  );
  const sharesZone = dns?.ok === true && dns.sharesZone;

  await piece(
    progress,
    mode,
    () => "Worker route",
    () => syncRoutes(connection, zone.id, { layout, script: parts.script }, mode),
  );
  await accessPiece(progress, mode, parts, connection, settings);
  await piece(
    progress,
    mode,
    () => "WAF rule",
    () => syncGuards(connection, zone.id, { layout, plan, outsidePages: settings.outside_pages, searchEnginesAllowed: settings.search_engines_allowed }, mode),
  );
  await piece(
    progress,
    mode,
    () => "Rate rule",
    () => syncWaf(connection, zone.id, { layout, plan, sharesZone, rateRule: defaultRateRule(plan) }, mode),
  );
  await piece(
    progress,
    mode,
    () => "Bot settings",
    () => syncZoneBots(connection, zone.id, { blockBots: settings.block_bots, plan, sharesZone }, mode),
  );
  await piece(
    progress,
    mode,
    () => "D1 database",
    () => syncDatabase(connection, parts.accountId, mode),
  );

  return { ok: true, rows: progress.rows, steps: progress.steps };
}

/**
 * Build the zone plug of an install on Cloudflare.
 *
 * @returns a plug whose `check` sends no change; both refuse, alike and before reading anything, a token that is malformed, that Cloudflare refuses, or that does not show the install's domain as a zone of `accountId`; the settings are read only after that
 */
export function createDomainPlug(parts: PlugParts): DomainPlug {
  return {
    tokenLabel: "Cloudflare API token",
    guardNotes: GUARD_NOTES,
    check: (token, settings) => read(parts, "plan", token, settings),
    repair: (token, settings) => read(parts, "apply", token, settings),
  };
}
