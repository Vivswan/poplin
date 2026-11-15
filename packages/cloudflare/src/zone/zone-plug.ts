// The dashboard's zone plug for Cloudflare: every object of an install read, or made to match, with a token that lives for the one call.
//
//   token -> the account's zones -> the zone of the install's domain -> records, routes, Access, the Worker's own variables, https redirect, guard rules, rate rule, bot switches, database
//
// A token proves itself by showing the install's own zone inside the install's own account; any other token is refused before anything is read.
// A check is the repair's own code with the changes left unsent, so the two cannot disagree on what a repair would do.
// The link to the token form carries every permission an install needs. A piece that needs one of the others is no failure without it: its row says which to add.

import type { DomainPlug, DomainReading, DomainRow, DomainSettings, DomainState, DomainStep, ReadSettings, TokenFacts } from "@poplin/app/src/dashboard/domain/records";
import { type Login, parseLogins } from "@poplin/core/src/auth/logins";
import { ACCESS_NOT_ENABLED, isAccessOff, readLoginFacts, syncAccess } from "./access/access";
import { syncZoneBots } from "./bots/bots";
import { type Connection, findZones, listZones, type Zone } from "./client";
import { syncDatabase } from "./database/database";
import { syncDns } from "./dns/dns";
import { INSTALL_OBJECTS } from "./install-objects";
import type { INSTALL_PIECES } from "./install-pieces";
import { HTTPS_SWITCH, syncHttps } from "./https/https";
import { type DomainLayout, privateSitesPattern } from "./layout";
import { syncRoutes } from "./routes/routes";
import { syncGuards } from "./rules/guards";
import { defaultRateRule, syncWaf } from "./rules/waf";
import { type Mode, type Report, reportOf } from "./sync";
import { syncVariables } from "./variables/variables";

/** What a token is made of. Anything else is refused unsent, so no pasted text reaches a request header. */
const TOKEN = /^[A-Za-z0-9_-]{20,512}$/;

/** The reading of a token that is not one, is refused, or does not show the install's zone in the install's account. */
const REFUSED: DomainReading = { ok: false, refusal: "token" };

/** The reading of a good token that shows no active zone of the domain typed for an install with nothing set. */
const NO_DOMAIN: DomainReading = { ok: false, refusal: "no_domain" };

/** The reading when Cloudflare did not answer, or asked to wait. */
const UNREACHABLE: DomainReading = { ok: false, refusal: "unreachable" };

/** What each setting the Domain tab changes does on Cloudflare. */
const GUARD_NOTES: DomainPlug["guardNotes"] = {
  outside_pages: "Pages of other domains framing a site or loading its files. While it is blocked poplin refuses them itself; with Zone WAF: Edit on the token, Cloudflare also stops them first.",
  search_engines_allowed: "Search engines reach public sites. While it is off poplin marks every site noindex; with Zone WAF: Edit on the token, Cloudflare also stops their crawlers.",
  block_bots: "auto blocks AI bots unless your domain has other hostnames. on adds Bot Fight Mode, which can block the command line from cloud hosts. Applied only with Bot Management: Edit on the token.",
};

/** What the WAF rule that stops verified bots also stops on a site hostname, as its row says. */
const ALWAYS_STOPPED = "also stops every method but GET and HEAD, and the paths *.php, /.env, /.env.*, /.git/, /wp-admin/, /cgi-bin/, /phpmyadmin";

/** The subject of the bots rule, whose row carries the list above. */
const BOTS_RULE = "bots rule";

/** What the Access rows say on an account whose Access is switched off. */
const ACCESS_OFF = "Access is off for the account";

/** What to do about it: no API switches Access on. */
const ACCESS_STEP = "Open Zero Trust and pick a plan (Free works): that switches Access on.";

/** What the Access row says when the stored logins cannot be read back. */
const BAD_LOGINS = "the stored logins are not a list of emails";

/** What the Access policy's row says when Cloudflare lets other emails through than the settings list. */
const OTHER_LOGINS = "not the logins of the settings";

/** What the variable's row says before the application it is read from exists. */
const NO_APPLICATION = "written once the Access application exists";

/** What a run that could not read the team's domain names as the step that failed. */
const TEAM_DOMAIN = "the team's domain";

/** What Cloudflare answers a call the token has no permission for: this status, with an error of this code. */
const NOT_PERMITTED = { status: 403, code: 10000 } as const;

/** What a row says after a refusal for a missing permission, before the permission's name. */
const ADD_RIGHT = "Add this right to the token";

/** What the row of a piece that needs an optional permission says before the permission's name, after what the piece adds. */
const SWITCH_ON = "To switch this on, add this right to the token and press Repair";

/** What a repair that wrote the variable tells the person to do next. */
const LOGIN_READY = "The login is ready. Open your dashboard and log in:";

/** Every permission the plug's calls use, in Cloudflare's own name: one an install needs, with its key as Cloudflare's page on token template links names it, or an optional one, which that page names no key for. */
const RIGHT = {
  zone: { name: "Zone: Read", key: "zone", type: "read" },
  dns: { name: "DNS: Edit", key: "dns", type: "edit" },
  routes: { name: "Workers Routes: Edit", key: "workers_routes", type: "edit" },
  access: { name: "Access: Apps and Policies: Edit", key: "access", type: "edit" },
  team: { name: "Access: Organizations, Identity Providers, and Groups: Read", key: "access_acct", type: "read" },
  scripts: { name: "Workers Scripts: Edit", key: "workers_scripts", type: "edit" },
  redirect: { name: "Single Redirect: Edit", adds: "Cloudflare sends http to https before poplin runs. Without it poplin sends the same redirect itself." },
  zoneSettings: { name: "Zone Settings: Read", key: "zone_settings", type: "read" },
  waf: { name: "Zone WAF: Edit", adds: "Cloudflare stops verified bots, scanner paths, pages of other domains, and floods before they reach poplin." },
  bots: { name: "Bot Management: Edit", adds: "Cloudflare blocks AI crawlers on the whole domain, as the block_bots setting says." },
  database: { name: "D1: Edit", key: "d1", type: "edit" },
} as const satisfies Readonly<Record<string, Right>>;

/** The permissions the calls of each object use, the one its changes use first. A piece with no row here, or with none in the list the OpenTofu module is held to, does not compile. */
const RIGHTS = {
  Zone: [RIGHT.zone],
  "DNS record": [RIGHT.dns],
  "Worker route": [RIGHT.routes],
  "Access application": [RIGHT.access],
  "Access policy": [RIGHT.access],
  "Worker variable": [RIGHT.scripts, RIGHT.team],
  "Redirect rule": [RIGHT.redirect, RIGHT.zoneSettings],
  "WAF rule": [RIGHT.waf],
  "Rate rule": [RIGHT.waf],
  "Bot settings": [RIGHT.bots],
  "D1 database": [RIGHT.database],
} as const satisfies Readonly<Record<keyof typeof INSTALL_PIECES.repair, readonly Right[]>>;

/** Where Cloudflare's form for a new token is. The link asks for every account and every zone, the one scope a link can carry: the person narrows it on the form. */
const TOKEN_FORM = "https://dash.cloudflare.com/profile/api-tokens";

/** What the form still asks of the person once its permissions are chosen. */
const TOKEN_SCOPE = "On the form, choose your account under Account Resources and your domain under Zone Resources, then create the token and copy it.";

/** The name the form suggests for the token. */
const TOKEN_NAME = "poplin setup";

/** What each state of a step is called in a check and in a repair. */
const STATES: Readonly<Record<Mode, Readonly<Record<"created" | "changed" | "removed", DomainState>>>> = {
  plan: { created: "missing", changed: "differs", removed: "differs" },
  apply: { created: "created", changed: "changed", removed: "removed" },
};

/**
 * Which install the plug is of.
 *
 * One that is set has `accountId`, the account the Worker runs in, never one a token's holder names.
 * One with nothing set has `first`, its first login: its account is the one the token shows the domain in, and a repair also writes the domain, this login, and that account onto the Worker.
 */
type Known = { readonly accountId: string; readonly first?: undefined } | { readonly accountId?: undefined; readonly first: { readonly login: Login } };

/** What the plug is built from. */
type PlugParts = Known & {
  /** The name of the install's Worker, which its routes name. */
  readonly script: string;

  /** The install's checked zone values. */
  readonly layout: DomainLayout;

  /** Where the API is; absent outside tests. */
  readonly baseUrl?: string | undefined;

  /** What sends a call; absent outside tests. */
  readonly fetch?: Connection["fetch"];
};

/** One permission of a token: one an install needs, with its key and level in a link to the form, or an optional one, with what it adds. */
type Right = { readonly name: string; readonly key: string; readonly type: "read" | "edit" } | { readonly name: string; readonly adds: string };

/** The parts once the account is known. */
type Placed = Pick<PlugParts, "script" | "layout" | "first"> & { readonly accountId: string };

/** An object the table names. */
type Piece = keyof typeof RIGHTS;

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

/** The permission a refused step lacked: of an object that needs two, the second where the step that failed is the one that reads with it. */
function lackedRight(object: Piece, failed: string): Right {
  if (failed === HTTPS_SWITCH) return RIGHT.zoneSettings;

  if (failed === TEAM_DOMAIN) return RIGHT.team;

  return RIGHTS[object][0];
}

/** Whether Cloudflare refused a step for a permission the token lacks, and for nothing else: an account whose Access is off answers with the same status. */
function lacksRight(stopped: Stopped): boolean {
  if (stopped.failure !== "refused" || stopped.status !== NOT_PERMITTED.status) return false;

  const errors = stopped.errors ?? [];

  return errors.some((error) => error.code === NOT_PERMITTED.code) && !errors.some((error) => error.message.includes(ACCESS_NOT_ENABLED));
}

/** Why a step failed, and for a missing permission the one to add, in the words of the token form. */
function failedDetail(stopped: Stopped, object: Piece): string {
  const failed = stopped.failed ?? "";
  const why = failed === "" ? failureText(stopped) : `${failed}: ${failureText(stopped)}`;

  return lacksRight(stopped) ? `${why}. ${ADD_RIGHT}: ${lackedRight(object, failed).name}` : why;
}

/** The rows of a piece that stopped. One that changed nothing for want of an optional permission is not set up, the steps it never reached with it, which is no failure. */
function stoppedRows(stopped: Stopped, objectOf: (subject: string) => Piece): DomainRow[] {
  const failed = stopped.failed ?? "";
  const object = objectOf(failed);
  const unrun = stopped.unrun ?? [];
  const right = lackedRight(object, failed);
  if ("adds" in right && lacksRight(stopped) && stopped.report.changedNothing) {
    const how = `${right.adds} ${SWITCH_ON}: ${right.name}`;
    const named = [failed, ...unrun].filter((subject) => subject !== "");
    if (named.length === 0) return [{ object, state: "optional", detail: how }];

    return named.map((subject) => ({ object: objectOf(subject), state: "optional", detail: `${subject}: ${how}` }));
  }

  return [{ object, state: "failed", detail: failedDetail(stopped, object) }, ...unrun.map((subject): DomainRow => ({ object: objectOf(subject), state: "not-run", detail: subject }))];
}

function rowsOf(outcome: Outcome, mode: Mode, objectOf: (subject: string) => Piece): DomainRow[] {
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

  if (!outcome.ok) rows.push(...stoppedRows(outcome, objectOf));

  return rows.sort((left, right) => (left.detail < right.detail ? -1 : 1));
}

// One piece of the install: its rows are added, and a failure stops every piece after it, so nothing is built on a state half made.
// A piece refused for a permission the token lacks, before it changed anything, leaves nothing half made, and the pieces after it need other permissions: the run goes on.
async function piece<Answer extends Outcome>(
  progress: Progress,
  mode: Mode,
  objectOf: (subject: string) => Piece,
  run: () => Promise<Answer>,
): Promise<Answer | undefined> {
  if (progress.stopped) {
    progress.rows.push({ object: objectOf(""), state: "not-run", detail: "" });

    return undefined;
  }

  const outcome = await run();
  progress.rows.push(...rowsOf(outcome, mode, objectOf));
  if (!outcome.ok && !(outcome.report.changedNothing && lacksRight(outcome))) progress.stopped = true;

  return outcome;
}

function accessObject(subject: string): Piece {
  return subject === INSTALL_OBJECTS.accessPolicy ? "Access policy" : "Access application";
}

// The application's row names what it stands in front of, and a policy that differs says how: it lets other emails through than the settings list.
function accessDetail(row: DomainRow, covered: string): DomainRow {
  if (row.detail === INSTALL_OBJECTS.accessApplication) return { ...row, detail: `${row.detail}: ${covered}` };

  if (row.object === "Access policy" && row.state === "differs") return { ...row, detail: `${row.detail}: ${OTHER_LOGINS}` };

  return row;
}

/**
 * Access that is switched off is a state of the account, not a failure of the run: the other pieces go on, and the page shows the one click.
 *
 * @returns whether the application can be read from: `false` for Access that is off, and `undefined` for an application that was not made, by a run that stopped or a token with no permission for it
 */
async function accessPiece(progress: Progress, mode: Mode, parts: Placed, connection: Connection, settings: DomainSettings): Promise<boolean | undefined> {
  const logins = parseLogins(settings.logins);
  if (progress.stopped || !logins.ok) {
    progress.rows.push({ object: "Access application", state: progress.stopped ? "not-run" : "failed", detail: progress.stopped ? "" : BAD_LOGINS });
    progress.stopped = true;

    return undefined;
  }

  const privateSites = privateSitesPattern(parts.layout);
  const synced = await syncAccess(connection, parts.accountId, { hostname: parts.layout.adminHostname, logins: logins.value, privateSites }, mode);
  // A refusal after a step was done is a failure of the run: its rows keep what was made.
  if (synced.ok || synced.failed !== undefined || !isAccessOff(synced)) {
    const before = progress.rows.length;
    await piece(progress, mode, accessObject, async () => synced);
    const covered = `${parts.layout.adminHostname}${INSTALL_OBJECTS.loginPath}, ${privateSites}`;
    progress.rows.splice(before, Number.POSITIVE_INFINITY, ...progress.rows.slice(before).map((row) => accessDetail(row, covered)));

    return synced.ok ? true : undefined;
  }

  progress.rows.push({ object: "Access application", state: "missing", detail: ACCESS_OFF }, { object: "Access policy", state: "missing", detail: ACCESS_OFF });
  progress.steps.push({ text: ACCESS_STEP, address: `https://one.dash.cloudflare.com/${parts.accountId}` });

  return false;
}

/** The values of an install with nothing set, as a repair writes them onto the Worker: its domain, its first login, and the account the token shows the domain in. */
function firstValues(placed: Placed): Parameters<typeof syncVariables>[2] {
  if (placed.first === undefined) return [];

  return [
    { name: INSTALL_OBJECTS.zoneBinding, value: { domain: placed.layout.domain } },
    { name: INSTALL_OBJECTS.firstSettingsBinding, value: { logins: placed.first.login } },
    { name: INSTALL_OBJECTS.accountBinding, value: placed.accountId },
  ];
}

// The Worker checks a login against the application setup made, so its audience tag is written onto the Worker once the application exists, in one change with the values of an install that has none.
async function variablesPiece(progress: Progress, mode: Mode, placed: Placed, connection: Connection, accessReady: boolean | undefined): Promise<void> {
  const name = INSTALL_OBJECTS.accessBinding;
  const object = (): Piece => "Worker variable";
  // An install whose login was refused gets no values: a Worker with a domain and no login behind it is half an install.
  if (progress.stopped || accessReady === undefined) {
    progress.rows.push({ object: object(), state: "not-run", detail: "" });

    return;
  }

  const facts = accessReady ? await readLoginFacts(connection, placed.accountId) : ({ ok: true, value: undefined } as const);
  if (!facts.ok) {
    await piece(progress, mode, object, async (): Promise<Outcome> => ({ ...facts, report: reportOf([]), failed: TEAM_DOMAIN }));

    return;
  }

  if (facts.value === undefined) progress.rows.push({ object: object(), state: "missing", detail: `${name}: ${NO_APPLICATION}` });

  const login = facts.value === undefined ? [] : [{ name, value: { team_domain: facts.value.teamDomain, audience: facts.value.audience } }];
  const wanted = [...firstValues(placed), ...login];
  if (wanted.length === 0) return;

  const synced = await piece(progress, mode, object, () => syncVariables(connection, placed, wanted, mode));
  const ready = mode === "apply" && synced?.ok === true && !synced.report.changedNothing && login.length > 0;
  if (ready) progress.steps.push({ text: LOGIN_READY, address: `https://${placed.layout.adminHostname}` });
}

/** Find the zone of the install's domain: in the install's own account, or for an install with nothing set in whichever account the token shows it in. */
async function findZone(parts: PlugParts, connection: Connection): Promise<Zone | DomainReading> {
  const zones = parts.accountId === undefined ? await findZones(connection, parts.layout.domain) : await listZones(connection, parts.accountId);
  if (!zones.ok) return zones.failure === "refused" ? REFUSED : UNREACHABLE;

  const zone = zones.value.find((candidate) => candidate.name === parts.layout.domain);
  if (zone !== undefined) return zone;

  return parts.accountId === undefined ? NO_DOMAIN : REFUSED;
}

async function read(parts: PlugParts, mode: Mode, token: string, readSettings: ReadSettings): Promise<DomainReading> {
  if (!TOKEN.test(token)) return REFUSED;

  const connection: Connection = { key: token, baseUrl: parts.baseUrl, fetch: parts.fetch };
  const zone = await findZone(parts, connection);
  if ("ok" in zone) return zone;

  const placed: Placed = { script: parts.script, layout: parts.layout, first: parts.first, accountId: zone.accountId };

  // The token is proven: only now is anything of the install read.
  const settings = await readSettings();

  const { layout } = parts;
  const { plan } = zone;
  // The public word is a fact of the install, set once: its row only shows it.
  const word: DomainRow = { object: "Public word", state: "present", detail: `${layout.publicWord} (public sites answer at <name>-${layout.publicWord}.${layout.domain})` };
  const progress: Progress = { rows: [word], steps: [], stopped: false };

  const dns = await piece(
    progress,
    mode,
    () => "DNS record",
    () => syncDns(connection, zone.id, layout, mode),
  );
  // The records say whether a hostname of the install is somebody else's, and whether the zone has hostnames of its own: unread, for whatever reason, nothing is built on the zone.
  if (dns?.ok !== true) progress.stopped = true;
  const sharesZone = dns?.ok === true && dns.sharesZone;

  await piece(
    progress,
    mode,
    () => "Worker route",
    () => syncRoutes(connection, zone.id, { layout, script: parts.script }, mode),
  );
  await variablesPiece(progress, mode, placed, connection, await accessPiece(progress, mode, placed, connection, settings));
  await piece(
    progress,
    mode,
    () => "Redirect rule",
    () => syncHttps(connection, zone.id, { layout, plan }, mode),
  );
  const guardsFrom = progress.rows.length;
  await piece(
    progress,
    mode,
    () => "WAF rule",
    () => syncGuards(connection, zone.id, { layout, plan, outsidePages: settings.outside_pages, searchEnginesAllowed: settings.search_engines_allowed }, mode),
  );
  progress.rows.splice(guardsFrom, Number.POSITIVE_INFINITY, ...progress.rows.slice(guardsFrom).map((row) => (row.detail === BOTS_RULE ? { ...row, detail: `${BOTS_RULE}: ${ALWAYS_STOPPED}` } : row)));
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
    () => syncDatabase(connection, placed.accountId, mode),
  );

  return { ok: true, rows: progress.rows, steps: progress.steps };
}

// The form reads the permissions as a JSON list of `{ key, type }`.
function tokenLink(rights: readonly Extract<Right, { readonly key: string }>[]): string {
  const chosen = rights.map((right) => ({ key: right.key, type: right.type }));

  return `${TOKEN_FORM}?permissionGroupKeys=${encodeURIComponent(JSON.stringify(chosen))}&accountId=%2A&zoneId=all&name=${encodeURIComponent(TOKEN_NAME)}`;
}

/**
 * Say what Cloudflare's form for a new token is and asks for.
 *
 * @returns the token's name, every permission an install needs, the link that opens the form with all of them chosen, and the optional ones with what each adds
 */
export function tokenFacts(): TokenFacts {
  const used: readonly Right[] = [...new Set(Object.values(RIGHTS).flat())];
  const needed = used.flatMap((right) => ("key" in right ? [right] : []));
  const optional = used.flatMap((right) => ("adds" in right ? [{ right: right.name, adds: right.adds }] : []));

  return {
    tokenLabel: "Cloudflare API token",
    tokenRights: needed.map((right) => right.name),
    tokenLink: tokenLink(needed),
    tokenOptional: optional,
    tokenNote: TOKEN_SCOPE,
  };
}

/**
 * Build the zone plug of an install on Cloudflare.
 *
 * @returns a plug whose `check` sends no change. Both refuse, alike and before reading anything, a token that is malformed, that Cloudflare refuses, or that does not show the install's domain as a zone of `accountId`.
 * With no `accountId` the account is the one the token shows the domain in as an active zone, and a token that shows none is told so. The settings are read only after that
 */
export function createDomainPlug(parts: PlugParts): DomainPlug {
  return {
    ...tokenFacts(),
    guardNotes: GUARD_NOTES,
    check: (token, settings) => read(parts, "plan", token, settings),
    repair: (token, settings) => read(parts, "apply", token, settings),
  };
}
