// The dashboard's zone plug for Cloudflare: every object of an install with a domain read, or made to match, with a token that lives for the one call.
//
//   token -> the account's zones -> the zone of the install's domain -> records, routes, Access, the Worker's own variables and its keys, https redirect, guard rules, rate rule, bot switches, database, budget alert, certificate alert, Workflow
//
// The two keys are all an install keeps of Cloudflare's: a repair makes each with the token where the install has none that works, and writes them onto the Worker in the same change as the variables.
// A token proves itself by showing the install's own zone inside the install's own account; any other token is refused before anything is read.
// A check is the repair's own code with the changes left unsent, so the two cannot disagree on what a repair would do.
// The link to the token form carries every permission an install needs. A piece that needs one of the others is no failure without it: its row says which to add.
// The plug of an install without a domain is made of the same pieces: the rows, the login, the Worker's variables with its keys, and the token form are exported for it.
//
// An install that holds its key checks by itself, with no token: the same pieces are read with the key, each under one of the key's own rights.
//
//   the key reads a piece                  its row, as a token's check says it; an optional piece that is not set up reads `optional`, as a token without its right reads it
//   the key lacks the right of a piece     that row names the right and says to press Repair; the other pieces are still read
//   Cloudflare refuses the key             the row says so and the check stops; the key's row says to repair
//   the database, the keys' own rights     not asked: the key holds no right to either; the upload key's row says only whether the install holds one
//
// No row of such a check holds a text Cloudflare sent.

import type { DomainPlug, DomainReading, DomainRow, DomainState, DomainStep, ReadSettings } from "@poplin/app/src/console/domain/records";
import type { KeyRefusal } from "@poplin/app/src/console/key/records";
import { type Login, type Logins, parseLogins } from "@poplin/core/src/auth/logins";
import type { Hostname } from "@poplin/core/src/names/hostname";
import type { TokenFacts } from "@poplin/core/src/install/token-facts";
import { type KeptKey, keyed } from "../shared/install/key/kept-key";
import { ACCESS_NOT_ENABLED, isAccessOff, readLoginFacts, syncAccess } from "../shared/install/pieces/access/access";
import { type AccountAlert, listAlerts, syncAlert } from "../shared/install/pieces/alerts/account-alert";
import { BUDGET_ALERT } from "../shared/install/pieces/alerts/budget-alert";
import { CERTIFICATE_ALERT } from "./pieces/alerts/certificate-alert";
import { syncZoneBots } from "./pieces/bots/bots";
import { type CloudflareFailure, type Connection, findZones, listZones, type Zone } from "../shared/install/client";
import { syncDatabase } from "../shared/install/pieces/database/database";
import { syncDns } from "./pieces/dns/dns";
import { INSTALL_OBJECTS } from "../shared/install/install-objects";
import { syncJobs } from "../shared/install/pieces/jobs/jobs";
import { syncLogs } from "../shared/install/pieces/worker-logs/worker-logs";
import { HTTPS_SWITCH, syncHttps } from "./pieces/https/https";
import { uploadKeyText } from "../shared/install/key/upload-key";
import { type HeldKey, type HeldKeys, type KeyRead, readBucket, readKeyStates } from "../shared/install/key/key-state";
import { type Minted, mintKeys, removeKeys, type WantedKey } from "../shared/install/key/mint";
import { type Bucket, keyPolicies, uploadKeyPolicies } from "../shared/install/key/rights";
import type { KeyRight } from "../shared/install/key/rights";
import { failureWords } from "../shared/install/first/rows";
import { type DomainLayout, privateSitesPattern } from "./layout";
import { syncRoutes } from "./pieces/routes/routes";
import { syncGuards } from "./pieces/rules/guards";
import { syncWaf } from "./pieces/rules/waf";
import { type Mode, type Report, reportOf, type Synced } from "../shared/install/sync";
import { syncVariables } from "../shared/install/pieces/variables/variables";

/** What a token is made of. Anything else is refused unsent, so no pasted text reaches a request header. */
export const TOKEN = /^[A-Za-z0-9_-]{20,512}$/;

/** The reading of a token that is not one, is refused, or does not show the install's zone in the install's account. */
export const REFUSED: DomainReading = { ok: false, refusal: "token" };

/** The reading when Cloudflare did not answer, or asked to wait. */
export const UNREACHABLE: DomainReading = { ok: false, refusal: "unreachable" };

/** What the WAF rule that stops verified bots also stops on a site hostname, as its row says. */
const ALWAYS_STOPPED = "also stops every method but GET and HEAD, and the paths *.php, /.env, /.env.*, /.git/, /wp-admin/, /cgi-bin/, /phpmyadmin";

/** The subject of the bots rule, whose row carries the list above. */
const BOTS_RULE = "bots rule";

/** What the open paths' row names them by. */
const OPEN_PATHS = INSTALL_OBJECTS.accessOpenApplication;

/** What the Access rows say on an account whose Access is switched off. */
export const ACCESS_OFF = "Access is off for the account";

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
const ADD_PERMISSION = "Add this permission to the account token";

/** What the row of a piece that needs an optional permission says before the permission's name, after what the piece adds; a piece that is made without the permission too says its own. */
const SWITCH_ON = "To switch this on, add this permission to the account token and press Repair";

/** What the row of an alert that is not set up says in place of that: the install's key makes its alerts too. */
const BY_ITSELF = "An install whose key Cloudflare takes makes it by itself within a day. To make it now, add this permission to the account token and press Repair";

/** What a repair that wrote the variable tells the person to do next. */
const LOGIN_READY = "The login is ready. Open your dashboard and log in:";

/** The two keys of an install: the row each has, the name every key of its kind has at Cloudflare, which its row names, and the secret of the Worker that holds it. */
const KEYS = {
  kept: { object: "Key", name: INSTALL_OBJECTS.keyName, binding: INSTALL_OBJECTS.keyBinding },
  upload: { object: "Upload key", name: INSTALL_OBJECTS.uploadKeyName, binding: INSTALL_OBJECTS.uploadKeyBinding },
} as const;

/** The two keys, in the order of their rows. */
const KEY_KINDS = ["kept", "upload"] as const;

/** What a key's row says of a key a repair replaces: one Cloudflare takes no more, and one that works and was made before a right the install uses now. */
const KEY_DIFFERS = { refused: "Cloudflare no longer takes the key the install holds", lacking: "the key the install holds lacks a permission the install uses now" } as const;

/** What a key's row says of a key of the name that the install does not hold, such as a new key whose write failed: as a check finds it, and once a repair deleted it. */
const KEY_SPARE = { left: "a key of its name that the install does not hold is at Cloudflare", removed: "a key of its name that the install does not hold was deleted" } as const;

/** What a key's row says of a new key whose write onto the Worker failed, by whether it could be deleted again. */
const KEY_UNWRITTEN = { deleted: "made, and deleted again when its write onto the Worker failed", left: "made, and left at Cloudflare for you to delete when its write onto the Worker failed" } as const;

/** What the upload key's row says on a Worker that is bound to no bucket. */
const NO_BUCKET = "the Worker is bound to no bucket";

/** What a row says of a piece the install's own key could not read, by what came of the call. */
const KEY_SAYS: Readonly<Record<Exclude<KeyRefusal, "no_key">, string>> = {
  lacks_right: "the key the install holds lacks this permission",
  key_refused: "Cloudflare refused the key the install holds",
  unreachable: "no usable answer from Cloudflare",
};

/** What stands for the answer of a call that threw in a check the install makes by itself: its row then says Cloudflare gave no usable answer. */
const NO_ANSWER = { ok: false, failure: "network", message: "" } as const;

/** What such a row tells the person to do: a repair makes a new key where the install's is refused or lacks a right. */
const PRESS_REPAIR = "Press Repair.";

/** What the database's row says in a check the install makes by itself, after the database's name. */
const OWN_DATABASE = "the install is running on it";

/** Every permission the plug's calls use, in Cloudflare's own name: one an install needs, with its key as Cloudflare's page on token template links names it, or chosen by hand where that page names none; or an optional one. */
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
  bucket: { name: "Workers R2 Storage: Edit", chosen: "by hand" },
  notifications: {
    name: "Notifications: Edit",
    adds: "Cloudflare emails your first user when the account's usage charges for the billing period reach 1 US dollar.",
    how: BY_ITSELF,
  },
  certificates: {
    name: "Notifications: Edit",
    adds: "Cloudflare emails your first user when a certificate it issues for a domain fails, is renewed, or runs out: for every domain of the account, not this one alone.",
    how: BY_ITSELF,
  },
  tokens: { name: "Account API Tokens: Edit", key: "account_api_tokens", type: "edit" },
} as const satisfies Readonly<Record<string, Right>>;

/** The permissions the calls of each object use, the one its changes use first. The bucket is no piece of a repair: an install makes it. */
const RIGHTS = {
  Zone: [RIGHT.zone],
  "DNS record": [RIGHT.dns],
  "Worker route": [RIGHT.routes],
  "Access application": [RIGHT.access],
  "Access policy": [RIGHT.access],
  "Access open paths": [RIGHT.access],
  "Worker variable": [RIGHT.scripts, RIGHT.team],
  "Worker logs": [RIGHT.scripts],
  "Redirect rule": [RIGHT.redirect, RIGHT.zoneSettings],
  "WAF rule": [RIGHT.waf],
  "Rate rule": [RIGHT.waf],
  "Bot settings": [RIGHT.bots],
  "D1 database": [RIGHT.database],
  "R2 bucket": [RIGHT.bucket],
  Workflow: [RIGHT.scripts],
  "Budget alert": [RIGHT.notifications],
  "Certificate alert": [RIGHT.certificates],
  Key: [RIGHT.tokens, RIGHT.scripts],
  "Upload key": [RIGHT.tokens, RIGHT.scripts],
  Forwarder: [RIGHT.scripts],
} as const satisfies Readonly<Record<string, readonly Right[]>>;

/** The right of the key each object is read under in a check the install makes by itself. The database, the bucket, and the two keys are read with no call. A piece with no row here does not compile. */
const KEY_RIGHT: Readonly<Record<Piece, KeyRight | undefined>> = {
  Zone: "Zone Read",
  "DNS record": "DNS Read",
  "Worker route": "Workers Routes Read",
  "Access application": "Access: Apps and Policies Write",
  "Access policy": "Access: Apps and Policies Write",
  "Access open paths": "Access: Apps and Policies Write",
  "Worker variable": "Workers Scripts Write",
  "Worker logs": "Workers Scripts Write",
  "Redirect rule": "Dynamic URL Redirects Read",
  "WAF rule": "Zone WAF Write",
  "Rate rule": "Zone WAF Write",
  "Bot settings": "Bot Management Read",
  "D1 database": undefined,
  "R2 bucket": undefined,
  "Budget alert": "Notifications Write",
  "Certificate alert": "Notifications Write",
  Key: undefined,
  "Upload key": undefined,
  Forwarder: "Workers Scripts Write",
  Workflow: "Workers Scripts Write",
};

/** What each object is for: the login guards the dashboard and private sites; a record, a route, or the open paths make a site or the API answer at its address. A piece with no row here does not compile. */
const PART: Readonly<Record<Piece | "Public word", DomainRow["part"]>> = {
  Zone: "rest",
  "DNS record": "reach",
  "Worker route": "reach",
  "Access application": "login",
  "Access policy": "login",
  "Access open paths": "reach",
  "Worker variable": "login",
  "Worker logs": "rest",
  "Redirect rule": "rest",
  "WAF rule": "rest",
  "Rate rule": "rest",
  "Bot settings": "rest",
  "D1 database": "rest",
  "R2 bucket": "rest",
  Workflow: "rest",
  "Budget alert": "rest",
  "Certificate alert": "rest",
  Key: "rest",
  "Upload key": "rest",
  Forwarder: "reach",
  "Public word": "rest",
};

/** The objects that hold the install's users: the policy lists every one of them, and each alert is mailed to the first. */
const HOLDS_USERS: readonly (Piece | "Public word")[] = ["Access policy", "Budget alert", "Certificate alert"];

/** Where Cloudflare's form for a new token is. The link asks for every account and every zone, the one scope a link can carry: the person narrows it on the form. */
const TOKEN_FORM = "https://dash.cloudflare.com/profile/api-tokens";

/** The token form of each kind of install: the objects whose permissions it asks for, the zones its link names, what it still asks of the person once its permissions are chosen, and what a token must be made for. */
const TOKEN_FORMS = {
  domain: {
    pieces: [
      "Zone",
      "DNS record",
      "Worker route",
      "Access application",
      "Access policy",
      "Access open paths",
      "Worker variable",
      "Worker logs",
      "Redirect rule",
      "WAF rule",
      "Rate rule",
      "Bot settings",
      "D1 database",
      "Workflow",
      "Budget alert",
      "Certificate alert",
      "Key",
      "Upload key",
    ],
    zones: "&zoneId=all",
    note: "On the form, choose your account under Account Resources and your domain under Zone Resources, then create the account token and copy it.",
    for: "this account and this domain",
  },
  noDomain: {
    pieces: ["Forwarder", "Access application", "Access policy", "Access open paths", "Worker variable", "Worker logs", "D1 database", "Workflow", "Budget alert", "Key", "Upload key"],
    zones: "",
    note: "On the form, choose your account under Account Resources, then create the account token and copy it.",
    for: "this account",
  },
} as const satisfies Readonly<Record<string, { readonly pieces: readonly Piece[]; readonly zones: string; readonly note: string; readonly for: string }>>;

/** The name the form suggests for the token. */
const TOKEN_NAME = "poplin install";

/** What the form's note says before each permission the link cannot choose. */
const BY_HAND = "The link does not choose this permission, so choose it on the form yourself";

/** What each state of a step is called in a check and in a repair. */
const STATES: Readonly<Record<Mode, Readonly<Record<"created" | "changed" | "removed", DomainState>>>> = {
  plan: { created: "missing", changed: "differs", removed: "differs" },
  apply: { created: "created", changed: "changed", removed: "removed" },
};

/**
 * Which install the plug is of.
 *
 * One that is set has `accountId`, the account the Worker runs in, never one a token's holder names.
 * One with nothing set has `first`: its first login, and the account the token was found in, where alone it is looked for. A repair also writes where the install answers, this login, and that account onto the Worker.
 * `key` is the install's kept key as its own Worker holds it, and `uploadKeyId` the id of the upload key that Worker holds. Without `key`, how both keys stand is read at Cloudflare with the token.
 * `kept` is the kept key ready to call Cloudflare with: an install that has it checks by itself, with no token.
 */
export type Known =
  | { readonly accountId: string; readonly first?: undefined; readonly key?: HeldKey; readonly uploadKeyId?: string | undefined; readonly kept?: KeptKey | undefined }
  | { readonly accountId?: undefined; readonly first: { readonly login: Login; readonly accountId: string }; readonly key?: undefined; readonly uploadKeyId?: undefined; readonly kept?: undefined };

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

  /** What waits between two reads of settings that trail an upload; the platform's own timer where absent. */
  readonly sleep?: Connection["sleep"];

  /** The clock a new upload key's moment of making is read from, in milliseconds since the epoch; absent outside tests. */
  readonly now?: (() => number) | undefined;
};

/** One permission of a token: one an install needs, with its key and level in a link to the form, or one the link cannot choose, which the person chooses on the form; or an optional one, with what it adds. */
type Right =
  | { readonly name: string; readonly key: string; readonly type: "read" | "edit" }
  | { readonly name: string; readonly chosen: "by hand" }
  | { readonly name: string; readonly adds: string; readonly how?: string };

/** An optional permission. `how` is what its piece's row says in place of the usual words, where the piece is made without the permission too. */
type Optional = Extract<Right, { readonly adds: string }>;

/** An install once the token has shown its account: what the pieces both kinds of install share are made from. */
export interface Placed {
  /** The name of the install's Worker. */
  readonly script: string;

  /** The account the token showed the install in. */
  readonly accountId: string;

  /** The install's zone; an install without a domain has none. */
  readonly zoneId: string | undefined;

  /** The install's kept key as its own Worker holds it. */
  readonly key: HeldKey | undefined;

  /** The id of the upload key that Worker holds. */
  readonly uploadKeyId: string | undefined;

  /** The clock a new upload key's moment of making is read from; absent outside tests. */
  readonly now: (() => number) | undefined;

  /** The dashboard's hostname. */
  readonly adminHost: Hostname;

  /** What the login guards as the private sites: a pattern of hostnames, or one host whole. */
  readonly privateSites: string;

  /** The values a repair gives a Worker with nothing set; none on an install that is set. */
  readonly firstValues: Wanted;
}

/** What the keys of an install are read and made from: where its Worker is, the keys that Worker holds, and the clock. */
type KeyHolder = Pick<Placed, "script" | "accountId" | "zoneId" | "key" | "uploadKeyId" | "now">;

/** Which of an install's two keys. */
type KeyKind = (typeof KEY_KINDS)[number];

/** Which keys a run makes anew: for each one it makes, whether the install held one before, which the new one stands in for. `bucket` is the install's bucket where the run has read it already. */
interface Making {
  readonly kept?: boolean | undefined;
  readonly upload?: boolean | undefined;
  readonly bucket?: Bucket | undefined;
}

/** One key a run makes: what Cloudflare and the Worker are sent for it, which key it is, and whether it stands in for an older one. */
interface Minting extends WantedKey {
  readonly kind: KeyKind;
  readonly replaces: boolean;
}

/** What mending keys came to: the row of each key the run made or tidied, a step for each key that is still at Cloudflare and should not be, and what the one change came to; no change is `undefined`, of a run that made no key. */
interface Mended {
  readonly rows: Partial<Record<KeyKind, Found>>;
  readonly steps: DomainStep[];
  readonly written: Synced | undefined;
}

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

/** The rows of a run so far, and whether a failure has stopped it. `own` is on a check the install makes by itself: the key it reads with, and the worst Cloudflare said of that key so far. */
export interface Progress {
  readonly rows: Found[];
  readonly steps: DomainStep[];
  stopped: boolean;
  readonly own?: { readonly kept: KeptKey; fault?: "refused" | "lacking" };
}

/** Why a piece stopped: Cloudflare's answer in the words every row says it in, or else the piece's own message. */
function failureText(stopped: Stopped): string {
  if (stopped.failure === "no-id") return "Cloudflare named no database";

  const failure = asFailure(stopped);

  return failure === undefined ? (stopped.message ?? stopped.failure) : failureWords(failure);
}

/** The permission a refused step lacked: of an object that needs two, the second where the step that failed is the one that reads with it. */
function lackedRight(object: Piece, failed: string): Right {
  if (failed === HTTPS_SWITCH) return RIGHT.zoneSettings;

  if (failed === TEAM_DOMAIN) return RIGHT.team;

  return RIGHTS[object][0];
}

/** Whether Cloudflare refused a step for a permission the token lacks, and for nothing else: an account whose Access is off answers with the same status. */
export function lacksRight(stopped: { readonly failure: string; readonly status?: number; readonly errors?: readonly { readonly code: number; readonly message: string }[] }): boolean {
  if (stopped.failure !== "refused" || stopped.status !== NOT_PERMITTED.status) return false;

  const errors = stopped.errors ?? [];

  return errors.some((error) => error.code === NOT_PERMITTED.code) && !errors.some((error) => error.message.includes(ACCESS_NOT_ENABLED));
}

/** Why a step failed, and for a missing permission the one to add, in the words of the token form. */
function failedDetail(stopped: Stopped, object: Piece): string {
  const failed = stopped.failed ?? "";
  const why = failed === "" ? failureText(stopped) : `${failed}: ${failureText(stopped)}`;

  return lacksRight(stopped) ? `${why}. ${ADD_PERMISSION}: ${lackedRight(object, failed).name}` : why;
}

/** What the row of an optional piece that is not set up says: what the piece adds, then how a person gets it, with the permission's name. */
function switchOn(right: Optional): string {
  return `${right.adds} ${right.how ?? SWITCH_ON}: ${right.name}`;
}

/** The rows of a piece that stopped. One that changed nothing for want of an optional permission is not set up, the steps it never reached with it, which is no failure. */
function stoppedRows(stopped: Stopped, objectOf: (subject: string) => Piece): Found[] {
  const failed = stopped.failed ?? "";
  const object = objectOf(failed);
  const unrun = stopped.unrun ?? [];
  const right = lackedRight(object, failed);
  if ("adds" in right && lacksRight(stopped) && stopped.report.changedNothing) {
    const how = switchOn(right);
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

/** The right of the key a piece is read under: of an object read in two calls, the second's where the step that failed is the one that reads with it. */
function keyRight(object: Piece, failed: string): KeyRight | undefined {
  if (failed === HTTPS_SWITCH) return "Zone Settings Read";

  if (failed === TEAM_DOMAIN) return "Access: Organizations, Identity Providers, and Groups Read";

  return KEY_RIGHT[object];
}

/** A row of a check the install makes by itself: an optional piece a repair would make or change reads as a token without its right reads it, since the key alone does not say the person wants it. */
function asOptional(row: Found): Found {
  const right = row.object === "Public word" ? undefined : RIGHTS[row.object][0];
  if (right === undefined || !("adds" in right) || (row.state !== "missing" && row.state !== "differs")) return row;

  return { object: row.object, state: "optional", detail: `${row.detail}: ${switchOn(right)}` };
}

/** A piece Cloudflare stopped, as the one call the key's answers are read from; `undefined` for a piece that stopped itself, such as one that found a record in its way: Cloudflare answered it, and its own words say why. */
function asFailure(stopped: Stopped): CloudflareFailure | undefined {
  if (stopped.failure === "refused") return { ok: false, failure: "refused", status: stopped.status ?? 0, errors: stopped.errors ?? [] };

  if (stopped.failure === "rate-limited") return { ok: false, failure: "rate-limited" };

  return stopped.failure === "network" ? { ok: false, failure: "network", message: "" } : undefined;
}

/**
 * Make a call a piece reads from before it has its rows. In a check the install makes by itself, one that throws is no answer, as it is for a call made through `keyed`.
 *
 * @param none - what stands for the answer of a call that threw
 */
async function answered<Value>(progress: Progress, call: () => Promise<Value>, none: Value): Promise<Value> {
  return progress.own === undefined ? call() : call().catch(() => none);
}

/**
 * Read one piece with the install's own key.
 *
 * @returns what the piece answered, `undefined` for a call that threw, and its rows: a piece the key could not read says which of the key's answers it got, in fixed words, and for a missing right names it
 */
async function ownPiece<Answer extends Outcome>(own: NonNullable<Progress["own"]>, objectOf: (subject: string) => Piece, run: () => Promise<Answer>): Promise<{ readonly outcome: Answer | undefined; readonly rows: Found[] }> {
  const held: { outcome?: Answer } = {};
  const told = await keyed(own.kept, "", async () => {
    held.outcome = await run();

    return (held.outcome.ok ? undefined : asFailure(held.outcome)) ?? { ok: true, value: undefined };
  });
  const { outcome } = held;
  // A piece Cloudflare answered says its rows as any check does, the ones of a piece that stopped itself among them.
  if (told.ok || told.refusal === "no_key") return { outcome, rows: outcome === undefined ? [] : rowsOf(outcome, "plan", objectOf).map(asOptional) };

  const rows = outcome === undefined ? [] : rowsOf({ ok: true, report: outcome.report }, "plan", objectOf).map(asOptional);
  const failed = outcome?.ok === false ? (outcome.failed ?? "") : "";
  const object = objectOf(failed);
  const what = failed === "" ? "" : `${failed}: `;
  if (told.refusal === "unreachable") return { outcome, rows: [...rows, { object, state: "failed", detail: `${what}${KEY_SAYS.unreachable}` }] };

  const right = told.refusal === "lacks_right" ? keyRight(object, failed) : undefined;
  own.fault = told.refusal === "key_refused" ? "refused" : (own.fault ?? "lacking");
  const says = right === undefined ? KEY_SAYS[told.refusal] : `${KEY_SAYS.lacks_right}: ${right}`;

  return { outcome, rows: [...rows, { object, state: "failed", detail: `${what}${says}. ${PRESS_REPAIR}`, ...(right === undefined ? {} : { right }) }] };
}

// One piece of the install: its rows are added, and a failure stops every piece after it, so nothing is built on a state half made.
// A piece refused for a permission the token lacks, before it changed anything, leaves nothing half made, and the pieces after it need other permissions: the run goes on.
// A check the install makes by itself reads the piece with its own key.
export async function piece<Answer extends Outcome>(
  progress: Progress,
  mode: Mode,
  objectOf: (subject: string) => Piece,
  run: () => Promise<Answer>,
): Promise<Answer | undefined> {
  if (progress.stopped) {
    progress.rows.push({ object: objectOf(""), state: "not-run", detail: "" });

    return undefined;
  }

  const { outcome, rows } = progress.own === undefined ? await run().then((answer) => ({ outcome: answer, rows: rowsOf(answer, mode, objectOf) })) : await ownPiece(progress.own, objectOf, run);
  progress.rows.push(...rows);
  if (outcome === undefined || (!outcome.ok && !(outcome.report.changedNothing && lacksRight(outcome)))) progress.stopped = true;

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
export async function accessPiece(progress: Progress, mode: Mode, placed: Placed, connection: Connection, logins: Logins | undefined): Promise<boolean | undefined> {
  if (progress.stopped || logins === undefined) {
    progress.rows.push({ object: "Access application", state: progress.stopped ? "not-run" : "failed", detail: progress.stopped ? "" : BAD_LOGINS });
    progress.stopped = true;

    return undefined;
  }

  const { adminHost: host, privateSites } = placed;
  const synced = await answered(progress, () => syncAccess(connection, placed.accountId, { hostname: host, logins, privateSites }, mode), { ...NO_ANSWER, report: reportOf([]) });
  // A refusal after a step was done is a failure of the run: its rows keep what was made.
  if (synced.ok || synced.failed !== undefined || !isAccessOff(synced)) {
    const before = progress.rows.length;
    await piece(progress, mode, accessObject, async () => synced);
    const covered = { [INSTALL_OBJECTS.accessApplication]: `${host}, ${privateSites}`, [OPEN_PATHS]: INSTALL_OBJECTS.openPaths.map((path) => `${host}${path}`).join(", ") };
    progress.rows.splice(before, Number.POSITIVE_INFINITY, ...progress.rows.slice(before).map((row) => accessDetail(row, covered)));

    return synced.ok ? true : undefined;
  }

  progress.rows.push(...(["Access application", "Access policy", "Access open paths"] as const).map((object): Found => ({ object, state: "missing", detail: ACCESS_OFF })));
  progress.steps.push({ text: ACCESS_STEP, address: `https://one.dash.cloudflare.com/${placed.accountId}` });

  return false;
}

/**
 * Write the values of an install with nothing set, as a repair gives them to the Worker.
 *
 * @param zone - where the install answers, as its `ZONE` variable holds it
 * @param accountId - the account the token showed the install in
 * @returns that value, the first login, and the account; nothing for an install that is set
 */
export function firstValues(known: Known, zone: Readonly<Record<string, string>>, accountId: string): Wanted {
  if (known.first === undefined) return [];

  return [
    { name: INSTALL_OBJECTS.zoneBinding, value: zone },
    { name: INSTALL_OBJECTS.firstSettingsBinding, value: { logins: known.first.login } },
    { name: INSTALL_OBJECTS.accountBinding, value: accountId },
  ];
}

/** The row of a key that failed: `what` came of it, why, and for a missing permission the one to add, unless another row of the run names it. */
function keyFailed(kind: KeyKind, what: string, failure: CloudflareFailure | { readonly ok: false; readonly failure: string; readonly message: string }, right: Right | undefined): Found {
  const { object, name } = KEYS[kind];
  const stopped: Stopped = { ...failure, report: reportOf([]) };
  const why = `${name}${what}: ${failureText(stopped)}`;
  if (right === undefined || !lacksRight(stopped)) return { object, state: "failed", detail: why };

  return { object, state: "failed", detail: `${why}. ${ADD_PERMISSION}: ${right.name}`, right: right.name };
}

/** The row of a key in a check the install makes by itself: the kept key stands, since the check is read with it, and the upload key is there where the install holds one. Cloudflare is not asked about either: the kept key reads no token of the account. */
function heldRow(kind: KeyKind, placed: KeyHolder): Found {
  const { object, name } = KEYS[kind];

  return { object, state: kind === "kept" || placed.uploadKeyId !== undefined ? "present" : "missing", detail: name };
}

/**
 * The row of a key that was read and left as it is: how it stands, or why that could not be read.
 *
 * @param variables - whether the run also reads the Worker's bindings for its variables, whose row then names the permission that reading lacks
 */
function keyRead(kind: KeyKind, state: KeyRead, variables: boolean): Found {
  const { object, name } = KEYS[kind];
  if (!state.ok && state.read === "bindings") return keyFailed(kind, "", state, variables ? undefined : RIGHT.scripts);

  if (!state.ok) return keyFailed(kind, "", state, RIGHT.tokens);

  if (state.value === "refused" || state.value === "lacking") return { object, state: "differs", detail: `${name}: ${KEY_DIFFERS[state.value]}` };

  if (state.spare.length > 0) return { object, state: "differs", detail: `${name}: ${KEY_SPARE.left}` };

  return { object, state: state.value, detail: name };
}

/** The row of a key a run tried to make. */
function mintedRow({ kind, replaces }: Minting, minted: Minted): Found {
  const { object, name } = KEYS[kind];
  if (minted.ok) return { object, state: replaces ? "changed" : "created", detail: name };

  if (!minted.made) return keyFailed(kind, "", minted.why, RIGHT.tokens);

  return keyFailed(kind, `, ${minted.left ? KEY_UNWRITTEN.left : KEY_UNWRITTEN.deleted}`, minted.kept, RIGHT.scripts);
}

/** The upload key as a run makes it, or the row that says why it cannot: the key is of the install's one bucket, which is read from the Worker's bindings where the run has not read them. */
async function uploadMinting(connection: Connection, placed: KeyHolder, making: Making & { readonly upload: boolean }): Promise<Minting | Found> {
  const { object, name } = KEYS.upload;
  const read = making.bucket === undefined ? await readBucket(connection, placed) : ({ ok: true, value: making.bucket } as const);
  if (!read.ok) return keyFailed("upload", "", read, RIGHT.scripts);

  const bucket = read.value;
  if (bucket === undefined) return { object, state: "failed", detail: `${name}: ${NO_BUCKET}` };

  const text: WantedKey["text"] = async (made) => {
    const written = await uploadKeyText(made, bucket, (placed.now ?? Date.now)());

    return { text: written.text, secrets: [written.secret] };
  };

  return { kind: "upload", replaces: making.upload, name, policies: (groups) => uploadKeyPolicies({ accountId: placed.accountId, bucket }, groups), text };
}

/**
 * Make new keys with the token and write them onto the Worker, in one change with the variables a run wants there.
 *
 * @returns the row of each key the run was to make, a step for each older key that is still at Cloudflare, and what the one change came to
 */
async function mintInto(connection: Connection, placed: KeyHolder, wanted: Wanted, making: Making): Promise<Mended> {
  const rows: Mended["rows"] = {};
  const minting: Minting[] = [];
  if (making.kept !== undefined) {
    minting.push({ kind: "kept", replaces: making.kept, name: KEYS.kept.name, policies: (groups) => keyPolicies(placed, groups), text: async ({ value }) => ({ text: value, secrets: [] }) });
  }

  const upload = making.upload === undefined ? undefined : await uploadMinting(connection, placed, { ...making, upload: making.upload });
  if (upload !== undefined && "kind" in upload) minting.push(upload);
  else if (upload !== undefined) rows.upload = upload;

  if (minting.length === 0) return { rows, steps: [], written: undefined };

  const outcomes = await mintKeys(connection, placed.accountId, minting, (texts) => {
    const secrets = texts.map(({ key, text }) => ({ name: KEYS[key.kind].binding, text }));

    return syncVariables(connection, placed, wanted, "apply", secrets);
  });
  const steps: DomainStep[] = [];
  let written: Synced | undefined;

  for (const { key, minted } of outcomes) {
    rows[key.kind] = mintedRow(key, minted);
    if (minted.ok || minted.made) written = minted.kept;

    if (minted.ok && minted.stale) steps.push({ text: `An older key named ${key.name} may still be at Cloudflare. Delete it there:`, address: `https://dash.cloudflare.com/${placed.accountId}/api-tokens` });
  }

  return { rows, steps, written };
}

/** For a key a repair makes anew, whether the new one stands in for one the install held; `undefined` for a key that is left as it is: one that works and carries every right, or one whose state could not be read. */
function replacesHeld(state: KeyRead): boolean | undefined {
  return state.ok && state.value !== "present" ? state.value !== "missing" : undefined;
}

/** What a repair does about the keys it read: a new one where none works and carries every right, and beside one that does, every key of its name that the install does not hold deleted. */
async function mendKeys(connection: Connection, placed: KeyHolder, wanted: Wanted, states: Awaited<ReturnType<typeof readKeyStates>>): Promise<Mended> {
  const making: Making = { kept: replacesHeld(states.kept), upload: replacesHeld(states.upload), bucket: states.bucket };
  const mended: Mended = making.kept === undefined && making.upload === undefined ? { rows: {}, steps: [], written: undefined } : await mintInto(connection, placed, wanted, making);

  for (const kind of KEY_KINDS) {
    const state = states[kind];
    const { object, name } = KEYS[kind];
    if (!state.ok || state.value !== "present" || state.spare.length === 0) continue;

    if (await removeKeys(connection, placed.accountId, state.spare)) {
      mended.rows[kind] = { object, state: "changed", detail: `${name}: ${KEY_SPARE.removed}` };
      continue;
    }

    // By its name alone such a key cannot be told from the one the install holds, so the person is sent to the list.
    mended.rows[kind] = { object, state: "present", detail: name };
    mended.steps.push({
      text: `A key named ${name} that the install does not hold could not be deleted at Cloudflare. Press Repair again. The keys are listed there:`,
      address: `https://dash.cloudflare.com/${placed.accountId}/api-tokens`,
    });
  }

  return mended;
}

// The keys and the variables are one piece of work on the Worker: a key is made only where a repair finds none that works and carries every right, and then everything goes in one change.
async function workerPiece(progress: Progress, mode: Mode, placed: KeyHolder, connection: Connection, wanted: Wanted): Promise<Synced | undefined> {
  const object = (): Piece => "Worker variable";
  const held: HeldKeys | undefined = placed.key === undefined ? undefined : { kept: placed.key, uploadId: placed.uploadKeyId };
  // A key answers nothing about its own rights and reads no token of the account, so a check made with it reads neither key at Cloudflare.
  const states = progress.own === undefined ? await readKeyStates(held, connection, placed) : undefined;
  const mended = mode === "apply" && states !== undefined ? await mendKeys(connection, placed, wanted, states) : undefined;
  const written = mended?.written;
  const run = written === undefined ? (): Promise<Synced> => syncVariables(connection, placed, wanted, mode) : async (): Promise<Synced> => written;
  // With no variable to write, the keys' own rows say everything the change came to.
  const synced = wanted.length === 0 ? written : await piece(progress, mode, object, run);
  progress.rows.push(...KEY_KINDS.map((kind) => mended?.rows[kind] ?? (states === undefined ? heldRow(kind, placed) : keyRead(kind, states[kind], wanted.length > 0))));
  progress.steps.push(...(mended?.steps ?? []));

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

  const facts = accessReady ? await answered(progress, () => readLoginFacts(connection, placed.accountId), NO_ANSWER) : ({ ok: true, value: undefined } as const);
  if (!facts.ok) {
    await piece(progress, mode, object, async (): Promise<Outcome> => ({ ...facts, report: reportOf([]), failed: TEAM_DOMAIN }));

    return undefined;
  }

  if (facts.value === undefined) progress.rows.push({ object: object(), state: "missing", detail: `${name}: ${NO_APPLICATION}` });

  const login = facts.value === undefined ? [] : [{ name, value: { team_domain: facts.value.teamDomain, audience: facts.value.audience } }];

  return { variables: [...placed.firstValues, ...login], login: login.length > 0 };
}

// The Worker checks a login against the application a repair made, so its audience tag is written onto the Worker once the application exists, in one change with the values of an install that has none.
export async function variablesPiece(progress: Progress, mode: Mode, placed: Placed, connection: Connection, accessReady: boolean | undefined): Promise<void> {
  const wanted = await wantedVariables(progress, mode, placed, connection, accessReady);
  if (wanted === undefined) {
    progress.rows.push(...KEY_KINDS.map((kind): Found => ({ object: KEYS[kind].object, state: "not-run", detail: "" })));

    return;
  }

  const synced = await workerPiece(progress, mode, placed, connection, wanted.variables);
  const ready = mode === "apply" && synced?.ok === true && !synced.report.changedNothing && wanted.login;
  if (ready) progress.steps.push({ text: LOGIN_READY, address: `https://${placed.adminHost}` });
}

/** The pieces of an install's alerts, each a row of its own, read from one list of the account's policies. Each alert goes to the first user alone, the one who holds the Cloudflare account an install is made in. */
async function alertPieces(progress: Progress, mode: Mode, placed: Placed, connection: Connection, logins: Logins | undefined, kept: readonly { readonly object: Piece; readonly alert: AccountAlert }[]): Promise<void> {
  const [first] = logins ?? [];
  if (progress.stopped || first === undefined) {
    progress.rows.push(...kept.map(({ object }): Found => ({ object, state: "not-run", detail: "" })));

    return;
  }

  const read = await answered(progress, () => listAlerts(connection, placed.accountId), NO_ANSWER);

  for (const { object, alert } of kept) {
    await piece(
      progress,
      mode,
      () => object,
      () => syncAlert(connection, placed.accountId, alert, first, mode, read),
    );
  }
}

/** The piece of the Worker's logs, of an install of either kind: Cloudflare keeps the lines the Worker writes, or keeps none, as the setting `provider_logs` says. */
export async function logsPiece(progress: Progress, mode: Mode, placed: Placed, connection: Connection, kept: boolean): Promise<void> {
  await piece(
    progress,
    mode,
    () => "Worker logs",
    () => syncLogs(connection, placed, kept, mode),
  );
}

/** The budget alert's piece, of an install of either kind: the alert is the account's. */
export function alertPiece(progress: Progress, mode: Mode, placed: Placed, connection: Connection, logins: Logins | undefined): Promise<void> {
  return alertPieces(progress, mode, placed, connection, logins, [{ object: "Budget alert", alert: BUDGET_ALERT }]);
}

/** The database's piece. A check the install makes by itself asks Cloudflare nothing of it: the key holds no right to a database, and the install read its settings from its own for this very check. */
export async function databasePiece(progress: Progress, mode: Mode, placed: Placed, connection: Connection): Promise<void> {
  const object = (): Piece => "D1 database";
  if (progress.own !== undefined && !progress.stopped) {
    progress.rows.push({ object: object(), state: "present", detail: `${INSTALL_OBJECTS.database}: ${OWN_DATABASE}` });

    return;
  }

  await piece(progress, mode, object, () => syncDatabase(connection, placed.accountId, mode));
}

/** Find the zone of the install's domain: in the install's own account, or for an install with nothing set in the account the token was found in. */
async function findZone(parts: PlugParts, connection: Connection): Promise<Zone | DomainReading> {
  const zones = parts.accountId === undefined ? await findZones(connection, parts.layout.domain) : await listZones(connection, parts.accountId);
  if (!zones.ok) return zones.failure === "refused" ? REFUSED : UNREACHABLE;

  const found = parts.first?.accountId;
  const zone = zones.value.find((candidate) => candidate.name === parts.layout.domain && (found === undefined || candidate.accountId === found));
  return zone ?? REFUSED;
}

/** The install in the account its zone is in. */
function placedIn(parts: PlugParts, zone: Zone): Placed {
  const { layout } = parts;
  const { accountId, id: zoneId } = zone;
  const firsts = firstValues(parts, { domain: layout.domain }, accountId);

  return { script: parts.script, accountId, zoneId, key: parts.key, uploadKeyId: parts.uploadKeyId, now: parts.now, adminHost: layout.adminHostname, privateSites: privateSitesPattern(layout), firstValues: firsts };
}

/** Prove a token: one that is malformed, refused, or shows no zone of the install's domain where the install is gets its refusal, and nothing of the install is read with it. */
async function prove(parts: PlugParts, token: string): Promise<{ readonly connection: Connection; readonly zone: Zone; readonly placed: Placed } | DomainReading> {
  if (!TOKEN.test(token)) return REFUSED;

  const connection: Connection = { key: token, baseUrl: parts.baseUrl, fetch: parts.fetch, sleep: parts.sleep };
  const zone = await findZone(parts, connection);
  if ("ok" in zone) return zone;

  return { connection, zone, placed: placedIn(parts, zone) };
}

/** The rows of a check the install made by itself, with the key's row as the pieces were answered: a key Cloudflare refused, or one that lacks a right, is one a repair replaces. */
function keySettled(rows: readonly Found[], fault: "refused" | "lacking"): Found[] {
  const key: Found = { object: "Key", state: "differs", detail: `${KEYS.kept.name}: ${fault === "refused" ? KEY_SAYS.key_refused : KEY_DIFFERS.lacking}` };
  if (!rows.some((row) => row.object === "Key")) return [...rows, key];

  return rows.map((row) => (row.object === "Key" ? key : row));
}

/**
 * Write the rows of a finished run as a reading.
 *
 * @returns every row with what its object is for, and the steps only a person can do
 */
export function readingOf(progress: Progress): DomainReading {
  const rows = progress.own?.fault === undefined ? progress.rows : keySettled(progress.rows, progress.own.fault);

  return { ok: true, rows: rows.map((row) => ({ ...row, part: PART[row.object], ...(HOLDS_USERS.includes(row.object) ? { users: true as const } : {}) })), steps: progress.steps };
}

/** Read every piece of an install whose zone is found, or make each match. The settings are read here and no earlier: a token has proven itself by now. */
async function readPieces(parts: PlugParts, mode: Mode, found: { readonly connection: Connection; readonly zone: Zone; readonly placed: Placed }, progress: Progress, readSettings: ReadSettings): Promise<DomainReading> {
  const { connection, zone, placed } = found;
  const settings = await readSettings();
  const parsed = parseLogins(settings.logins);
  const logins = parsed.ok ? parsed.value : undefined;

  const { layout } = parts;
  const { plan } = zone;
  // The public word is a fact of the install, set once: its row only shows it.
  progress.rows.push({ object: "Public word", state: "present", detail: `${layout.publicWord} (public sites answer at <name>-${layout.publicWord}.${layout.domain})` });

  const dns = await piece(
    progress,
    mode,
    () => "DNS record",
    () => syncDns(connection, zone.id, layout, mode),
  );
  // The records say whether a hostname of the install is somebody else's, and whether the zone has hostnames of its own: unread, for whatever reason, nothing is built on the zone.
  // A check the install makes by itself builds nothing, so it reads on, and leaves out the two pieces whose plan is made from the records.
  const recordsRead = dns?.ok === true;
  if (!recordsRead && progress.own === undefined) progress.stopped = true;
  const sharesZone = dns?.ok === true && dns.sharesZone;
  const fromRecords = async (object: Piece, run: () => Promise<Synced>): Promise<void> => {
    if (recordsRead || progress.stopped) await piece(progress, mode, () => object, run);
    else progress.rows.push({ object, state: "not-run", detail: "" });
  };

  await piece(
    progress,
    mode,
    () => "Worker route",
    () => syncRoutes(connection, zone.id, { layout, script: parts.script }, mode),
  );
  await variablesPiece(progress, mode, placed, connection, await accessPiece(progress, mode, placed, connection, logins));
  await logsPiece(progress, mode, placed, connection, settings.provider_logs);
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
  await fromRecords("Rate rule", () => syncWaf(connection, zone.id, { layout, plan, sharesZone }, mode));
  await fromRecords("Bot settings", () => syncZoneBots(connection, zone.id, { blockBots: settings.block_bots, plan, sharesZone }, mode));
  await databasePiece(progress, mode, placed, connection);
  // Cloudflare takes no zone for the certificate alert: it is of every domain of the account, and its name says so.
  await alertPieces(progress, mode, placed, connection, logins, [
    { object: "Budget alert", alert: BUDGET_ALERT },
    { object: "Certificate alert", alert: CERTIFICATE_ALERT },
  ]);
  // The Workflow comes last: nothing else of the install waits for it. Only a copy too large for one request needs it.
  await piece(
    progress,
    mode,
    () => "Workflow",
    () => syncJobs(connection, placed, mode),
  );

  return readingOf(progress);
}

async function read(parts: PlugParts, mode: Mode, token: string, readSettings: ReadSettings): Promise<DomainReading> {
  const proven = await prove(parts, token);
  if ("ok" in proven) return proven;

  return readPieces(parts, mode, proven, { rows: [], steps: [], stopped: false }, readSettings);
}

/** Check an install with the key it holds: its zone is found among the account's zones, as a token's is, and every piece is then read with the key. A zone the key does not show is said to be missing, and nothing more is read. */
async function readOwn(parts: PlugParts, accountId: string, kept: KeptKey, readSettings: ReadSettings): Promise<DomainReading> {
  const progress: Progress = { rows: [], steps: [], stopped: false, own: { kept } };
  const { connection } = kept;
  const shown: { zones?: readonly Zone[] } = {};
  await piece(progress, "plan", (): Piece => "Zone", async (): Promise<Outcome> => {
    const listed = await listZones(connection, accountId);
    if (!listed.ok) return { ...listed, report: reportOf([]) };

    shown.zones = listed.value;

    return { ok: true, report: reportOf([]) };
  });
  const zone = shown.zones?.find((candidate) => candidate.name === parts.layout.domain);
  if (zone === undefined) {
    if (shown.zones !== undefined) progress.rows.push({ object: "Zone", state: "missing", detail: parts.layout.domain });

    return readingOf(progress);
  }

  return readPieces(parts, "plan", { connection, zone, placed: placedIn(parts, zone) }, progress, readSettings);
}

// The form reads the permissions as a JSON list of `{ key, type }`.
function tokenLink(rights: readonly Extract<Right, { readonly key: string }>[], zones: string): string {
  const chosen = rights.map((right) => ({ key: right.key, type: right.type }));

  return `${TOKEN_FORM}?permissionGroupKeys=${encodeURIComponent(JSON.stringify(chosen))}&accountId=%2A${zones}&name=${encodeURIComponent(TOKEN_NAME)}`;
}

/** Every permission the objects of a kind's token form use, and those of the objects named beside them, each once, in the order of the table of rights. */
function usedRights(kind: keyof typeof TOKEN_FORMS, also: readonly Piece[]): Right[] {
  const asked: readonly Piece[] = TOKEN_FORMS[kind].pieces;
  const pieces = (Object.keys(RIGHTS) as Piece[]).filter((object) => asked.includes(object) || also.includes(object));

  return [...new Set(pieces.flatMap((object): readonly Right[] => RIGHTS[object]))];
}

/**
 * Name the permissions a token needs that no link to the form can choose, so a person chooses each on the form.
 *
 * @param kind - the kind of install the token is for
 * @param also - the objects the token is to make beside the ones a repair of that kind makes
 */
export function rightsByHand(kind: keyof typeof TOKEN_FORMS, also: readonly Piece[] = []): string[] {
  return usedRights(kind, also).flatMap((right) => ("chosen" in right ? [right.name] : []));
}

/**
 * Say what Cloudflare's form for a new token is and asks for.
 *
 * @param kind - the kind of install the token is for: one with a domain, or one without
 * @param also - the objects the token is to make beside the ones a repair of that kind makes, such as the bucket of a new install
 * @returns every permission such an install needs, the link that opens the form with each one chosen that a link can choose, and the optional ones with what each adds
 */
export function tokenFacts(kind: keyof typeof TOKEN_FORMS, also: readonly Piece[] = []): TokenFacts {
  const form = TOKEN_FORMS[kind];
  const used = usedRights(kind, also);
  const needed = used.filter((right) => !("adds" in right));
  const extra = used.flatMap((right): Optional[] => ("adds" in right ? [right] : []));
  // Two pieces may need one optional permission: the form names it once, with what each adds.
  const optional = [...new Set(extra.map((right) => right.name))].map((name) => ({ right: name, adds: extra.flatMap((right) => (right.name === name ? [right.adds] : [])).join(" ") }));
  const byHand = rightsByHand(kind, also);

  return {
    tokenRights: needed.map((right) => right.name),
    tokenLink: tokenLink(needed.flatMap((right) => ("key" in right ? [right] : [])), form.zones),
    tokenOptional: optional,
    tokenNote: byHand.length === 0 ? form.note : `${form.note} ${BY_HAND}: ${byHand.join(", ")}.`,
    tokenFor: form.for,
  };
}

/**
 * Name the permission a token needs first for one object of an install, as the token form names it.
 *
 * @param object - an object as its row names it, such as `R2 bucket`
 */
export function rightFor(object: Piece): string {
  return RIGHTS[object][0].name;
}

/**
 * Give an install new keys, both made with a token that has proven itself, and nothing else: no other object is changed.
 *
 * @param replaces - for each key, whether the install holds one, which the new one stands in for
 * @returns a row a key, and a step for an older key that is still at Cloudflare. The older keys of each name are deleted once the new ones are on the Worker
 */
export async function keyGiven(connection: Connection, placed: KeyHolder, replaces: Readonly<Record<KeyKind, boolean>>): Promise<DomainReading> {
  const { rows, steps } = await mintInto(connection, placed, [], replaces);

  return { ok: true, rows: KEY_KINDS.flatMap((kind) => rows[kind] ?? []).map((row) => ({ ...row, part: PART[row.object] })), steps };
}

/**
 * Give an install with a domain new keys, made with a token a person pasted.
 *
 * @param parts - the install; with `key` or `uploadKeyId`, a key the install holds is said to be replaced
 * @returns what `keyGiven` answers; a token that does not prove itself is refused as a check refuses it
 */
export async function giveKey(parts: Extract<PlugParts, { readonly accountId: string }>, token: string): Promise<DomainReading> {
  const proven = await prove(parts, token);
  if ("ok" in proven) return proven;

  return keyGiven(proven.connection, proven.placed, { kept: parts.key?.has() === true, upload: parts.uploadKeyId !== undefined });
}

/**
 * Build the zone plug of an install on Cloudflare.
 *
 * @returns a plug whose `check` sends no change. Both refuse, alike and before reading anything, a token that is malformed, that Cloudflare refuses, or that does not show the install's domain as a zone of `accountId`.
 * With no `accountId` the account is the one `first` names. The settings are read only after that.
 * With `kept` the plug has `ownCheck`, which reads the same pieces with that key and no token
 */
export function createDomainPlug(parts: PlugParts): DomainPlug {
  const { accountId, kept } = parts;

  return {
    ...tokenFacts("domain"),
    words: { thing: "the domain", line: null },
    carriedSettings: ["outside_pages", "search_engines_allowed", "block_bots"],
    idleSettings: {},
    check: (token, settings) => read(parts, "plan", token, settings),
    repair: (token, settings) => read(parts, "apply", token, settings),
    ...(accountId === undefined || kept === undefined ? {} : { ownCheck: (settings: ReadSettings) => readOwn(parts, accountId, kept, settings) }),
  };
}
