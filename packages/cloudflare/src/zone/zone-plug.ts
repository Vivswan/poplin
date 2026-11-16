// The dashboard's zone plug for Cloudflare: every object of an install read, or made to match, with a token that lives for the one call.
//
//   token -> the account's zones -> the zone of the install's domain -> records, routes, Access, the Worker's own variables and its key, https redirect, guard rules, rate rule, bot switches, database, budget alert
//
// The key is the one thing an install keeps of Cloudflare's: a repair makes it with the token where the install has none that works, and writes it onto the Worker in the same change as the variables.
// A token proves itself by showing the install's own zone inside the install's own account; any other token is refused before anything is read.
// A check is the repair's own code with the changes left unsent, so the two cannot disagree on what a repair would do.
// The link to the token form carries every permission an install needs. A piece that needs one of the others is no failure without it: its row says which to add.

import type { DomainPlug, DomainReading, DomainRow, DomainState, DomainStep, ReadSettings, TokenFacts } from "@poplin/app/src/console/domain/records";
import type { InstallKey } from "@poplin/app/src/console/key/records";
import { type Login, type Logins, parseLogins } from "@poplin/core/src/auth/logins";
import { ACCESS_NOT_ENABLED, isAccessOff, readLoginFacts, syncAccess } from "./access/access";
import { syncBudgetAlert } from "./alerts/budget-alert";
import { syncZoneBots } from "./bots/bots";
import { type CloudflareFailure, type Connection, findZones, listZones, type Zone } from "./client";
import { syncDatabase } from "./database/database";
import { syncDns } from "./dns/dns";
import { INSTALL_OBJECTS } from "./install-objects";
import type { INSTALL_PIECES } from "./install-pieces";
import { HTTPS_SWITCH, syncHttps } from "./https/https";
import { readKeyState } from "./key/key-state";
import { mintKey } from "./key/mint";
import { type DomainLayout, privateSitesPattern } from "./layout";
import { syncRoutes } from "./routes/routes";
import { syncGuards } from "./rules/guards";
import { defaultRateRule, syncWaf } from "./rules/waf";
import { type Mode, type Report, reportOf, type Synced } from "./sync";
import { syncVariables } from "./variables/variables";

/** What a token is made of. Anything else is refused unsent, so no pasted text reaches a request header. */
const TOKEN = /^[A-Za-z0-9_-]{20,512}$/;

/** The reading of a token that is not one, is refused, or does not show the install's zone in the install's account. */
const REFUSED: DomainReading = { ok: false, refusal: "token" };

/** The reading of a good token that shows no active zone of the domain typed for an install with nothing set. */
const NO_DOMAIN: DomainReading = { ok: false, refusal: "no_domain" };

/** The reading when Cloudflare did not answer, or asked to wait. */
const UNREACHABLE: DomainReading = { ok: false, refusal: "unreachable" };

/** What the WAF rule that stops verified bots also stops on a site hostname, as its row says. */
const ALWAYS_STOPPED = "also stops every method but GET and HEAD, and the paths *.php, /.env, /.env.*, /.git/, /wp-admin/, /cgi-bin/, /phpmyadmin";

/** The subject of the bots rule, whose row carries the list above. */
const BOTS_RULE = "bots rule";

/** What the open paths' row names them by. */
const OPEN_PATHS = INSTALL_OBJECTS.accessOpenApplication;

/** What the Access rows say on an account whose Access is switched off. */
const ACCESS_OFF = "Access is off for the account";

/** What to do about it: no API switches Access on. */
const ACCESS_STEP = "Open Zero Trust and pick a plan (Free works): that switches Access on.";

/** What the Access row says when the stored logins cannot be read back. */
const BAD_LOGINS = "the stored logins are not a list of emails";

/** What the Access policy's row says when Cloudflare lets other emails through than the settings list. */
const OTHER_LOGINS = "emails that are not your users";

/** What the variable's row says before the application it is read from exists. */
const NO_APPLICATION = "written once the Access application exists";

/** What a run that could not read the team's domain names as the step that failed. */
const TEAM_DOMAIN = "the team's domain";

/** What Cloudflare answers a call the token has no permission for: this status, with an error of this code. */
const NOT_PERMITTED = { status: 403, code: 10000 } as const;

/** What a row says after a refusal for a missing permission, before the permission's name. */
const ADD_RIGHT = "Add this right to the account token";

/** What the row of a piece that needs an optional permission says before the permission's name, after what the piece adds. */
const SWITCH_ON = "To switch this on, add this right to the account token and press Repair";

/** What a repair that wrote the variable tells the person to do next. */
const LOGIN_READY = "The login is ready. Open your dashboard and log in:";

/** What the key's row names: the name every key of an install has at Cloudflare. */
const KEY = INSTALL_OBJECTS.keyName;

/** What the key's row says of a key a repair replaces: one Cloudflare takes no more, and one that works and was made before a right the install uses now. */
const KEY_DIFFERS = { refused: "Cloudflare no longer takes the key the install holds", lacking: "the key the install holds lacks a right the install uses now" } as const;

/** What the key's row says of a new key whose write onto the Worker failed, by whether it could be deleted again. */
const KEY_UNWRITTEN = { deleted: "made, and deleted again when its write onto the Worker failed", left: "made, and left at Cloudflare for you to delete when its write onto the Worker failed" } as const;

/** What a repair that could not list or delete the older keys tells the person to do. */
const OLD_KEY = `An older key named ${KEY} may still be at Cloudflare. Delete it there:`;

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
  notifications: { name: "Notifications: Edit", adds: "Cloudflare emails your first user when the account's usage charges for the billing period reach 1 US dollar." },
  tokens: { name: "Account API Tokens: Edit", key: "account_api_tokens", type: "edit" },
} as const satisfies Readonly<Record<string, Right>>;

/** The permissions the calls of each object use, the one its changes use first. A piece with no row here, or with none in the list the OpenTofu module is held to, does not compile. */
const RIGHTS = {
  Zone: [RIGHT.zone],
  "DNS record": [RIGHT.dns],
  "Worker route": [RIGHT.routes],
  "Access application": [RIGHT.access],
  "Access policy": [RIGHT.access],
  "Access open paths": [RIGHT.access],
  "Worker variable": [RIGHT.scripts, RIGHT.team],
  "Redirect rule": [RIGHT.redirect, RIGHT.zoneSettings],
  "WAF rule": [RIGHT.waf],
  "Rate rule": [RIGHT.waf],
  "Bot settings": [RIGHT.bots],
  "D1 database": [RIGHT.database],
  "Budget alert": [RIGHT.notifications],
  Key: [RIGHT.tokens, RIGHT.scripts],
} as const satisfies Readonly<Record<keyof typeof INSTALL_PIECES.repair | keyof typeof INSTALL_PIECES.repairAlone, readonly Right[]>>;

/** What each object is for: the login guards the dashboard and private sites; a record, a route, or the open paths make a site or the API answer at its address. A piece with no row here does not compile. */
const PART: Readonly<Record<Piece | "Public word", DomainRow["part"]>> = {
  Zone: "rest",
  "DNS record": "reach",
  "Worker route": "reach",
  "Access application": "login",
  "Access policy": "login",
  "Access open paths": "reach",
  "Worker variable": "login",
  "Redirect rule": "rest",
  "WAF rule": "rest",
  "Rate rule": "rest",
  "Bot settings": "rest",
  "D1 database": "rest",
  "Budget alert": "rest",
  Key: "rest",
  "Public word": "rest",
};

/** The objects that hold the install's users: the policy lists every one of them, and the alert is mailed to the first. */
const HOLDS_USERS: readonly (Piece | "Public word")[] = ["Access policy", "Budget alert"];

/** Where Cloudflare's form for a new token is. The link asks for every account and every zone, the one scope a link can carry: the person narrows it on the form. */
const TOKEN_FORM = "https://dash.cloudflare.com/profile/api-tokens";

/** What the form still asks of the person once its permissions are chosen. */
const TOKEN_SCOPE = "On the form, choose your account under Account Resources and your domain under Zone Resources, then create the account token and copy it.";

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
 * `key` is the install's key as its own Worker holds it. Without one, how the key stands is read at Cloudflare with the token.
 */
type Known = { readonly accountId: string; readonly first?: undefined; readonly key?: Held } | { readonly accountId?: undefined; readonly first: { readonly login: Login }; readonly key?: undefined };

/** The install's key as the Worker that holds it sees it. */
type Held = Pick<InstallKey, "has" | "verify">;

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

/** The parts once the token has shown the zone, and with it the account. */
type Placed = Pick<PlugParts, "script" | "layout" | "first" | "key"> & { readonly accountId: string; readonly zoneId: string };

/** The variables a run wants on the Worker. */
type Wanted = Parameters<typeof syncVariables>[2];

/** An object the table names. */
type Piece = keyof typeof RIGHTS;

/** A row before it says what its object is for. */
type Found = Omit<DomainRow, "part" | "object"> & { readonly object: Piece | "Public word" };

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
  readonly rows: Found[];
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
function stoppedRows(stopped: Stopped, objectOf: (subject: string) => Piece): Found[] {
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

  const lacked = lacksRight(stopped) ? { right: right.name } : {};

  return [{ object, state: "failed", detail: failedDetail(stopped, object), ...lacked }, ...unrun.map((subject): Found => ({ object: objectOf(subject), state: "not-run", detail: subject }))];
}

function rowsOf(outcome: Outcome, mode: Mode, objectOf: (subject: string) => Piece): Found[] {
  const { report } = outcome;
  const states = STATES[mode];
  const row = (subject: string, state: DomainState, detail = subject): Found => ({ object: objectOf(subject), state, detail });
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
  if (subject === OPEN_PATHS || subject === INSTALL_OBJECTS.accessOpenPolicy) return "Access open paths";

  return subject === INSTALL_OBJECTS.accessPolicy ? "Access policy" : "Access application";
}

// An application's row names what it stands in front of, or lets past the login, and a logins' policy that differs says how: it lets other emails through than the settings list.
function accessDetail(row: Found, covered: Readonly<Record<string, string>>): Found {
  const places = covered[row.detail];
  if (places !== undefined) return { ...row, detail: `${row.detail}: ${places}` };

  if (row.object === "Access policy" && row.state === "differs") return { ...row, detail: `${row.detail}: ${OTHER_LOGINS}` };

  return row;
}

/**
 * Access that is switched off is a state of the account, not a failure of the run: the other pieces go on, and the page shows the one click.
 *
 * @returns whether the application can be read from: `false` for Access that is off, and `undefined` for an application that was not made, by a run that stopped or a token with no permission for it
 */
async function accessPiece(progress: Progress, mode: Mode, parts: Placed, connection: Connection, logins: Logins | undefined): Promise<boolean | undefined> {
  if (progress.stopped || logins === undefined) {
    progress.rows.push({ object: "Access application", state: progress.stopped ? "not-run" : "failed", detail: progress.stopped ? "" : BAD_LOGINS });
    progress.stopped = true;

    return undefined;
  }

  const privateSites = privateSitesPattern(parts.layout);
  const synced = await syncAccess(connection, parts.accountId, { hostname: parts.layout.adminHostname, logins, privateSites }, mode);
  // A refusal after a step was done is a failure of the run: its rows keep what was made.
  if (synced.ok || synced.failed !== undefined || !isAccessOff(synced)) {
    const before = progress.rows.length;
    await piece(progress, mode, accessObject, async () => synced);
    const host = parts.layout.adminHostname;
    const covered = { [INSTALL_OBJECTS.accessApplication]: `${host}, ${privateSites}`, [OPEN_PATHS]: INSTALL_OBJECTS.openPaths.map((path) => `${host}${path}`).join(", ") };
    progress.rows.splice(before, Number.POSITIVE_INFINITY, ...progress.rows.slice(before).map((row) => accessDetail(row, covered)));

    return synced.ok ? true : undefined;
  }

  progress.rows.push(...(["Access application", "Access policy", "Access open paths"] as const).map((object): Found => ({ object, state: "missing", detail: ACCESS_OFF })));
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

/** The row of a key that failed: `what` came of it, why, and for a missing permission the one to add, unless another row of the run names it. */
function keyFailed(what: string, failure: CloudflareFailure | { readonly ok: false; readonly failure: string; readonly message: string }, right: Right | undefined): Found {
  const stopped: Stopped = { ...failure, report: reportOf([]) };
  const why = `${KEY}${what}: ${failureText(stopped)}`;
  if (right === undefined || !lacksRight(stopped)) return { object: "Key", state: "failed", detail: why };

  return { object: "Key", state: "failed", detail: `${why}. ${ADD_RIGHT}: ${right.name}`, right: right.name };
}

/**
 * The row of a key that was read and left as it is: how it stands, or why that could not be read.
 *
 * @param variables - whether the run also reads the Worker's bindings for its variables, whose row then names the permission that reading lacks
 */
function keyRead(state: Awaited<ReturnType<typeof readKeyState>>, variables: boolean): Found {
  if (!state.ok && state.read === "bindings") return keyFailed("", state, variables ? undefined : RIGHT.scripts);

  if (!state.ok) return keyFailed("", state, RIGHT.tokens);

  if (state.value === "refused" || state.value === "lacking") return { object: "Key", state: "differs", detail: `${KEY}: ${KEY_DIFFERS[state.value]}` };

  return { object: "Key", state: state.value, detail: KEY };
}

/**
 * Make a new key with the token and write it onto the Worker, in one change with the variables a run wants there.
 *
 * @param replaces - whether the install held a key before, which the new one stands in for
 * @returns the key's row, a step for an older key that is still at Cloudflare, and what the one change came to; no change is `undefined`, of a key that was never made
 */
async function mintInto(connection: Connection, placed: Placed, wanted: Wanted, replaces: boolean): Promise<{ readonly row: Found; readonly steps: DomainStep[]; readonly written: Synced | undefined }> {
  const place = { accountId: placed.accountId, zoneId: placed.zoneId, name: KEY };
  const minted = await mintKey(connection, place, (value) => syncVariables(connection, placed, wanted, "apply", { name: INSTALL_OBJECTS.keyBinding, text: value }));
  if (minted.ok) {
    const steps = minted.stale ? [{ text: OLD_KEY, address: `https://dash.cloudflare.com/${placed.accountId}/api-tokens` }] : [];

    return { row: { object: "Key", state: replaces ? "changed" : "created", detail: KEY }, steps, written: minted.kept };
  }

  if (!minted.made) return { row: keyFailed("", minted.why, RIGHT.tokens), steps: [], written: undefined };

  return { row: keyFailed(`, ${minted.left ? KEY_UNWRITTEN.left : KEY_UNWRITTEN.deleted}`, minted.kept, RIGHT.scripts), steps: [], written: minted.kept };
}

// The key and the variables are one piece of work on the Worker: a key is made only where a repair finds none that works and carries every right, and then both go in one change.
async function workerPiece(progress: Progress, mode: Mode, placed: Placed, connection: Connection, wanted: Wanted): Promise<Synced | undefined> {
  const object = (): Piece => "Worker variable";
  const state = await readKeyState(placed.key, connection, placed);
  const made = mode === "apply" && state.ok && state.value !== "present" ? await mintInto(connection, placed, wanted, state.value !== "missing") : undefined;
  const written = made?.written;
  const run = written === undefined ? (): Promise<Synced> => syncVariables(connection, placed, wanted, mode) : async (): Promise<Synced> => written;
  // With no variable to write, the key's own row says everything the change came to.
  const synced = wanted.length === 0 ? written : await piece(progress, mode, object, run);
  progress.rows.push(made?.row ?? keyRead(state, wanted.length > 0));
  progress.steps.push(...(made?.steps ?? []));

  return synced;
}

/** The variables a run wants on the Worker, with the rows of what it cannot want yet; `login` says whether the login's own variable is among them. A run that may not write the Worker at all wants nothing, and answers `undefined`. */
async function wantedVariables(progress: Progress, mode: Mode, placed: Placed, connection: Connection, accessReady: boolean | undefined): Promise<{ readonly variables: Wanted; readonly login: boolean } | undefined> {
  const name = INSTALL_OBJECTS.accessBinding;
  const object = (): Piece => "Worker variable";
  // An install whose login was refused gets no values: a Worker with a domain and no login behind it is half an install.
  if (progress.stopped || accessReady === undefined) {
    progress.rows.push({ object: object(), state: "not-run", detail: "" });

    return undefined;
  }

  const facts = accessReady ? await readLoginFacts(connection, placed.accountId) : ({ ok: true, value: undefined } as const);
  if (!facts.ok) {
    await piece(progress, mode, object, async (): Promise<Outcome> => ({ ...facts, report: reportOf([]), failed: TEAM_DOMAIN }));

    return undefined;
  }

  if (facts.value === undefined) progress.rows.push({ object: object(), state: "missing", detail: `${name}: ${NO_APPLICATION}` });

  const login = facts.value === undefined ? [] : [{ name, value: { team_domain: facts.value.teamDomain, audience: facts.value.audience } }];

  return { variables: [...firstValues(placed), ...login], login: login.length > 0 };
}

// The Worker checks a login against the application setup made, so its audience tag is written onto the Worker once the application exists, in one change with the values of an install that has none.
async function variablesPiece(progress: Progress, mode: Mode, placed: Placed, connection: Connection, accessReady: boolean | undefined): Promise<void> {
  const wanted = await wantedVariables(progress, mode, placed, connection, accessReady);
  if (wanted === undefined) {
    progress.rows.push({ object: "Key", state: "not-run", detail: "" });

    return;
  }

  const synced = await workerPiece(progress, mode, placed, connection, wanted.variables);
  const ready = mode === "apply" && synced?.ok === true && !synced.report.changedNothing && wanted.login;
  if (ready) progress.steps.push({ text: LOGIN_READY, address: `https://${placed.layout.adminHostname}` });
}

// The alert goes to the first user alone: the one who holds the Cloudflare account an install is made in.
async function alertPiece(progress: Progress, mode: Mode, placed: Placed, connection: Connection, logins: Logins | undefined): Promise<void> {
  const [first] = logins ?? [];
  const object = (): Piece => "Budget alert";
  if (progress.stopped || first === undefined) {
    progress.rows.push({ object: object(), state: "not-run", detail: "" });

    return;
  }

  await piece(progress, mode, object, () => syncBudgetAlert(connection, placed.accountId, first, mode));
}

/** Find the zone of the install's domain: in the install's own account, or for an install with nothing set in whichever account the token shows it in. */
async function findZone(parts: PlugParts, connection: Connection): Promise<Zone | DomainReading> {
  const zones = parts.accountId === undefined ? await findZones(connection, parts.layout.domain) : await listZones(connection, parts.accountId);
  if (!zones.ok) return zones.failure === "refused" ? REFUSED : UNREACHABLE;

  const zone = zones.value.find((candidate) => candidate.name === parts.layout.domain);
  if (zone !== undefined) return zone;

  return parts.accountId === undefined ? NO_DOMAIN : REFUSED;
}

/** Prove a token: one that is malformed, refused, or shows no zone of the install's domain where the install is gets its refusal, and nothing of the install is read with it. */
async function prove(parts: PlugParts, token: string): Promise<{ readonly connection: Connection; readonly zone: Zone; readonly placed: Placed } | DomainReading> {
  if (!TOKEN.test(token)) return REFUSED;

  const connection: Connection = { key: token, baseUrl: parts.baseUrl, fetch: parts.fetch };
  const zone = await findZone(parts, connection);
  if ("ok" in zone) return zone;

  return { connection, zone, placed: { script: parts.script, layout: parts.layout, first: parts.first, key: parts.key, accountId: zone.accountId, zoneId: zone.id } };
}

async function read(parts: PlugParts, mode: Mode, token: string, readSettings: ReadSettings): Promise<DomainReading> {
  const proven = await prove(parts, token);
  if ("ok" in proven) return proven;

  const { connection, zone, placed } = proven;

  // The token is proven: only now is anything of the install read.
  const settings = await readSettings();
  const parsed = parseLogins(settings.logins);
  const logins = parsed.ok ? parsed.value : undefined;

  const { layout } = parts;
  const { plan } = zone;
  // The public word is a fact of the install, set once: its row only shows it.
  const word: Found = { object: "Public word", state: "present", detail: `${layout.publicWord} (public sites answer at <name>-${layout.publicWord}.${layout.domain})` };
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
  await variablesPiece(progress, mode, placed, connection, await accessPiece(progress, mode, placed, connection, logins));
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
  await alertPiece(progress, mode, placed, connection, logins);

  return { ok: true, rows: progress.rows.map((row) => ({ ...row, part: PART[row.object], ...(HOLDS_USERS.includes(row.object) ? { users: true as const } : {}) })), steps: progress.steps };
}

// The form reads the permissions as a JSON list of `{ key, type }`.
function tokenLink(rights: readonly Extract<Right, { readonly key: string }>[]): string {
  const chosen = rights.map((right) => ({ key: right.key, type: right.type }));

  return `${TOKEN_FORM}?permissionGroupKeys=${encodeURIComponent(JSON.stringify(chosen))}&accountId=%2A&zoneId=all&name=${encodeURIComponent(TOKEN_NAME)}`;
}

/**
 * Say what Cloudflare's form for a new token is and asks for.
 *
 * @returns every permission an install needs, the link that opens the form with all of them chosen, and the optional ones with what each adds
 */
export function tokenFacts(): TokenFacts {
  const used: readonly Right[] = [...new Set(Object.values(RIGHTS).flat())];
  const needed = used.flatMap((right) => ("key" in right ? [right] : []));
  const optional = used.flatMap((right) => ("adds" in right ? [{ right: right.name, adds: right.adds }] : []));

  return {
    tokenRights: needed.map((right) => right.name),
    tokenLink: tokenLink(needed),
    tokenOptional: optional,
    tokenNote: TOKEN_SCOPE,
  };
}

/**
 * Give an install a new key, made with a token a person pasted, and nothing else: no other object is read or changed.
 *
 * @param parts - the install; with `key`, a key the install holds is said to be replaced
 * @returns the key's one row, and a step for an older key that is still at Cloudflare; a token that does not prove itself is refused as a check refuses it. The older keys of the name are deleted once the new one is on the Worker
 */
export async function giveKey(parts: Extract<PlugParts, { readonly accountId: string }>, token: string): Promise<DomainReading> {
  const proven = await prove(parts, token);
  if ("ok" in proven) return proven;

  const { row, steps } = await mintInto(proven.connection, proven.placed, [], parts.key?.has() === true);

  return { ok: true, rows: [{ ...row, part: PART[row.object] }], steps };
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
    check: (token, settings) => read(parts, "plan", token, settings),
    repair: (token, settings) => read(parts, "apply", token, settings),
  };
}
