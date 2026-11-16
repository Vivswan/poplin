// One Worker instance made ready: its bindings read, its database opened and brought up to date, the first settings and the visitor key stored, and every piece built over them.
//
//   ZONE, ACCOUNT_ID, WORKER_NAME   read and checked                     else `binding`, naming every one that is refused
//   ZONE                            a domain, or an account's address    the kind of the install, with its hosts: every piece below that differs by kind comes from that one value
//   ZONE or ACCOUNT_ID absent       a Worker with nothing set            `unset`: its setup page alone
//   ACCESS             read and checked; absent, nobody is admitted      else `binding`
//   DB                 opened, its pending schema steps applied           else `newer`, `differs`, or `failed`, which carries the way back to the code before an update
//   settings           stored from FIRST_SETTINGS over the defaults, only while none exist  else `binding`; stored ones this build cannot read are `differs`
//   visitor key        stored, only while none exists
//   KEPT_KEY           read once; absent or no key, the install holds none   never a fault, and never quoted
//   UPLOAD_KEY         read once, as the kept key is                         never a fault, and never quoted; with one that is old enough, an upload's files go straight to the bucket
//   LAST_UPDATE        the update the running code came in with; absent, the code was put in place another way

import { createApi } from "@poplin/app/src/api/api";
import type { Counters } from "@poplin/app/src/limits/limits";
import type { DomainPlug, FirstRun } from "@poplin/app/src/console/domain/records";
import type { InstallKey, Keyed } from "@poplin/app/src/console/key/records";
import type { UsersFollow } from "@poplin/app/src/console/access/users-follow";
import type { RulesFollow } from "@poplin/app/src/console/settings/rules-follow";
import type { UsageHost } from "@poplin/app/src/console/usage/records";
import type { Identify } from "@poplin/app/src/login/admit";
import { createEntries } from "@poplin/app/src/login/entries";
import type { SiteAddresses } from "@poplin/app/src/sites/addresses";
import type { Asking } from "@poplin/core/src/actions/check-update";
import type { Install } from "@poplin/core/src/actions/records";
import type { EndLogins } from "@poplin/core/src/actions/sign-out";
import type { Updating } from "@poplin/core/src/actions/start-update";
import type { Database, SettingsAndKey } from "@poplin/core/src/database/database";
import type { Jobs } from "@poplin/core/src/jobs/jobs";
import type { PublicName } from "@poplin/core/src/names/names";
import { openDatabase } from "@poplin/core/src/database/open";
import { SETTING_VALUES } from "@poplin/core/src/records/settings";
import type { SiteId } from "@poplin/core/src/sites/ids";
import type { Tickets } from "@poplin/core/src/storage/tickets";
import * as v from "valibot";
import { version } from "../../../../../cli/package.json";
import { D1Driver } from "../database/d1";
import { workflowJobs } from "../jobs/workflow-jobs";
import { workflowNameOf } from "../jobs/workflow-name";
import { readKeptKey } from "../install/key/kept-key";
import { createEndLogins } from "../install/key/logins-end";
import { isSettled, readUploadKey } from "../install/key/upload-key";
import { createUsersFollow } from "../install/key/users-follow";
import { createLoginRepair, type LoginRepair } from "../install/pieces/access/login-repair";
import { keepBudgetAlert } from "../install/pieces/alerts/budget-alert";
import { CloudflareCounters } from "../limits/counters";
import { createUsageHost } from "../usage/usage-host";
import { goBack } from "../release/update/go-back";
import { createSelfUpdate } from "../release/update/self-update";
import { accessIdentity } from "../login/access-token";
import { accessKeys } from "../login/keys";
import { R2Store } from "../storage/r2";
import { createBucketTickets } from "../storage/r2-tickets";
import { readAccessBinding } from "../login/access-binding";
import type { Connection } from "../install/client";
import { INSTALL_OBJECTS } from "../install/install-objects";
import { createFirstRun } from "../install/kind/first-run";
import { readFirstSettings } from "../install/kind/first-settings";
import type { Bindings } from "./bindings";
import { logFault } from "./fault";
import { derivedSecret, type Held } from "./held";
import { type InstallHosts, readHosts } from "./hosts";
import { readOwnWorker } from "./own-worker";

/** What one request to the API may carry. Cloudflare's Free plan ends a request body at 100 MB, and core ends a manifest at 1.5 MB itself. */
const API_LIMITS = { fileBytes: 100_000_000, files: 10_000, manifestBytes: 2_000_000 } as const;

/** The bytes of a new visitor key. */
const KEY_BYTES = 32;

/** Every setting this build reads, by its key. */
const SETTING_KEYS = Object.keys(SETTING_VALUES.entries);

/** The refusal of every login on an install whose Access application setup has not made yet. */
const NO_ACCESS = "not-set-up";

/** The login of a Worker with no `ACCESS` variable: nobody is anybody. */
const NOBODY: Identify<string> = async () => ({ ok: false, refusal: NO_ACCESS });

/** The refusal of Access while its keys cannot be had. */
const KEYS_UNAVAILABLE = "keys-unavailable";

/** The version of poplin this Worker was built from: the one the released package states, read when the Worker is bundled. */
const VERSION: string = version;

/** What the instance is given besides its bindings. */
export interface Outside {
  /** The clock, in milliseconds since the epoch. */
  readonly now: () => number;

  /** Fetches the keys Access signs its tokens with. */
  readonly fetch: Parameters<typeof accessKeys>[0]["fetch"];

  /** Sends setup's calls to Cloudflare; the runtime's own fetch when absent. */
  readonly cloudflare?: Connection["fetch"];

  /** What asks the project's website, once a day, which version of poplin is the newest. An update fetches the release's files through it too. */
  readonly latest: Asking;
}

/** The key one visitor's requests are counted by, from the address Cloudflare saw and the secret the instance holds for the database. */
export type VisitorOf = (request: Request, database: Database) => Promise<string>;

/** Everything a request is answered from. One is built per Worker instance: the counters and the Access keys remember what they saw. */
export interface Instance {
  /** Where the install answers: its kind, its admin host, and what each hostname is answered as. */
  readonly hosts: InstallHosts;

  /** The install as the actions take it: the database, the bucket, the clock, and how an address is written. */
  readonly install: Install;

  /** The install's address layout: hostnames under a domain, or paths on two hosts. */
  readonly addresses: SiteAddresses;

  /** The request counts of the limits. */
  readonly counters: CloudflareCounters;

  /** The id of the site each public name last served, which a request by that name reads the day's counts by. An instance learns one at the name's first view and holds a thousand. */
  readonly servedByName: Map<PublicName, SiteId>;

  /** Answers every path under `/api`. */
  readonly api: ReturnType<typeof createApi>;

  /** Decides who a request to the dashboard or to a private site's address is from. Without an `ACCESS` variable it refuses everyone as `NO_ACCESS`. */
  readonly identify: Identify<string>;

  /** Writes the Activity line of a login, once for each login at Access; it is told every dashboard page a user opens. */
  readonly entered: ReturnType<typeof createEntries>;

  /** The install's side at Cloudflare, for setup and the Domain screen: the plug of the install's kind. */
  readonly domain: DomainPlug;

  /** The key poplin keeps for Cloudflare: whether the install holds one, whether Cloudflare still takes it, and the way to a new one. Nothing answers the key itself. */
  readonly key: InstallKey;

  /** The users' side at Cloudflare: a change of the logins is carried there with the kept key. */
  readonly follow: UsersFollow;

  /** Ends every login of the dashboard at Cloudflare, with the kept key. */
  readonly endLogins: EndLogins;

  /** The login's own pieces at Cloudflare: a scheduled run puts back with the kept key what is missing or differs. */
  readonly login: LoginRepair;

  /** Keeps the account's budget alert with the kept key, sent to the given first user: a scheduled run makes one the account lacks. */
  readonly keepAlert: (email: string) => Promise<Keyed<readonly string[]>>;

  /** The guard rules' side at Cloudflare: a change of a setting they are written from is carried there with the kept key. */
  readonly rules: RulesFollow;

  /** Cloudflare's side of the Usage screen. */
  readonly usage: UsageHost;

  /** The version of poplin the install runs. */
  readonly version: string;

  /** What runs the rounds of a job after the request that started it. */
  readonly jobs: Jobs;

  /** What updates the install: the release is taken with the kept key, and the starts are counted in `counters`. */
  readonly updating: Updating;
}

/** A variable of the Worker that cannot be used. `refusal` says what is wrong with it and never quotes its value. */
interface RefusedBinding {
  readonly binding: "ZONE" | "ACCESS" | "FIRST_SETTINGS" | "ACCOUNT_ID" | "WORKER_NAME";
  readonly refusal: string;
}

/** What a Worker with nothing set answers its setup page from: no domain is known, so there is no install to serve. */
export interface Unset {
  /** The database, which holds no settings yet. */
  readonly database: Database;

  /** The request counts of the setup page's tries. */
  readonly counters: Counters;

  /** The Cloudflare side of an install that has no domain and no account yet. */
  readonly first: FirstRun;

  /** The secret the setup page counts its visitors with. */
  readonly secrets: Pick<Held, "visitorSecret">;
}

/**
 * Why an instance could not start. `binding` names every variable that is refused, at least one. `differs` is a database another build of poplin made.
 *
 * `failed` is a schema step that could not run: `back` puts the code before an update back in place, where the install may go back by itself.
 *
 * `unset` is no fault: the Worker was deployed and setup has not given it its domain and its account.
 */
export type Failure =
  | { readonly kind: "binding"; readonly refused: readonly RefusedBinding[] }
  | { readonly kind: "newer" }
  | { readonly kind: "differs" }
  | { readonly kind: "failed"; readonly back: () => ReturnType<typeof goBack> }
  | { readonly kind: "unset"; readonly unset: Unset };

/** An instance, or why there is none. */
export type Started = { readonly ok: true; readonly instance: Instance } | { readonly ok: false; readonly failure: Failure };

/**
 * Say what a refusal of an instance's login means to the dashboard.
 *
 * @param refusal - what `identify` answered, or `not-a-user` for a verified email that is no user
 * @returns `unchecked` while the team's keys cannot be had, `not-set-up` on an install without its `ACCESS` variable, `not-a-user` as it is, and `no-proof` for every other
 */
export function whyRefused(refusal: string): "no-proof" | "not-a-user" | "unchecked" | "not-set-up" {
  if (refusal === KEYS_UNAVAILABLE) return "unchecked";

  if (refusal === NO_ACCESS) return "not-set-up";

  return refusal === "not-a-user" ? refusal : "no-proof";
}

function badBinding(binding: RefusedBinding["binding"], refusal: string): Started {
  return { ok: false, failure: { kind: "binding", refused: [{ binding, refusal }] } };
}

/**
 * Store the first settings of an install that has none. Two instances that start together store one row: the second is answered `already_set`.
 *
 * The binding must name the logins; every setting it leaves out starts at its default.
 */
async function ensureSettings(database: Database, binding: unknown, now: number): Promise<Started | undefined> {
  const first = readFirstSettings(binding);
  if (!first.ok) return badBinding("FIRST_SETTINGS", first.refusal);

  const [installer] = first.values.logins;
  if (installer === undefined) return badBinding("FIRST_SETTINGS", "missing at logins");

  await database.initSettings(first.values, { as: "first_login", by: installer, at: now });

  return undefined;
}

/**
 * Read the settings and the visitor key the install holds, in one question, so that settings another build wrote stop the start with their own reason.
 *
 * @returns the two, each `undefined` before it was stored; or the failure, logged by the key that is wrong and never by a value
 * @throws whatever the database rejects with
 */
async function readStored(database: Database): Promise<SettingsAndKey | Extract<Started, { readonly ok: false }>> {
  try {
    return await database.readSettingsAndKey();
  } catch (error) {
    if (!v.isValiError(error)) throw error;

    // A key this build does not know is text of the stored record's own, so it is not repeated.
    const keys = new Set(error.issues.map((issue) => String(issue.path?.[0]?.key)));
    const known = SETTING_KEYS.filter((key) => keys.has(key));
    const told = keys.size > known.length ? [...known, "a key this build does not know"] : known;
    console.error(`poplin: the stored settings are not the ones this build reads, at ${told.join(", ")}`);

    return { ok: false, failure: { kind: "differs" } };
  }
}

/** Read the Worker's variables, and list every one that cannot be used. An absent `ACCESS` is no fault: nobody is admitted until setup writes it. */
function readVariables(env: Bindings): {
  readonly hosts: ReturnType<typeof readHosts>;
  readonly own: ReturnType<typeof readOwnWorker>;
  readonly access: ReturnType<typeof readAccessBinding>;
  readonly refused: readonly RefusedBinding[];
} {
  const own = readOwnWorker({ accountId: env[INSTALL_OBJECTS.accountBinding], script: env[INSTALL_OBJECTS.workerBinding] });
  const hosts = readHosts(env.ZONE, own.ok ? own.value.script : own.script);
  const access = readAccessBinding(env[INSTALL_OBJECTS.accessBinding]);
  const noAccess = !access.ok && access.refusal === "absent";
  const refused: RefusedBinding[] = [
    ...(hosts.ok ? [] : [{ binding: "ZONE" as const, refusal: hosts.refusal }]),
    ...(own.ok ? [] : own.refused),
    ...(access.ok || noAccess ? [] : [{ binding: "ACCESS" as const, refusal: access.refusal }]),
  ];

  return { hosts, own, access, refused };
}

/**
 * Answer the start of a Worker with nothing set: the parts its setup page needs, and no install.
 *
 * A Worker without its values whose database holds settings is one that lost them: it names them and offers no setup, which would give it another first login than the stored one.
 */
async function startUnset(given: {
  readonly database: Database;
  readonly driver: D1Driver;
  readonly env: Bindings;
  readonly outside: Outside;
  readonly refused: readonly RefusedBinding[];
  readonly script: string | undefined;
  readonly settled: boolean;
}): Promise<Started> {
  const { database, env, outside, refused, script, settled } = given;
  if (script === undefined || settled) return { ok: false, failure: { kind: "binding", refused } };

  const key = await database.ensureVisitorKey(crypto.getRandomValues(new Uint8Array(KEY_BYTES)), outside.now());
  const unset: Unset = {
    database,
    counters: new CloudflareCounters({ limiter: env.MINUTE_LIMITS, database, rows: given.driver }),
    first: createFirstRun({ script, fetch: outside.cloudflare }),
    secrets: await derivedSecret(key.key),
  };

  return { ok: false, failure: { kind: "unset", unset } };
}

/** What an instance reads of its two secrets: the kept key, the upload key, and the bucket's own tickets while that key signs them. */
interface Keys {
  readonly kept: ReturnType<typeof readKeptKey>;
  readonly uploadKey: ReturnType<typeof readUploadKey>;
  readonly direct: () => Tickets | undefined;
}

/**
 * Read the two secrets of an install, once: the kept key and the upload key.
 *
 * @returns the kept key, `undefined` on an install that holds none; the upload key it holds; and `direct`, which answers the bucket's own tickets once that key is old enough for the bucket to take it
 */
function readKeys(env: Bindings, accountId: string, outside: Outside): Keys {
  const kept = readKeptKey(env[INSTALL_OBJECTS.keyBinding], { fetch: outside.cloudflare });
  const uploadKey = readUploadKey(env[INSTALL_OBJECTS.uploadKeyBinding]);
  const signed = uploadKey === undefined ? undefined : createBucketTickets({ key: uploadKey, accountId, now: outside.now });
  // A key the bucket does not take yet signs nothing: until then the install takes the files itself, as an install with no key does.
  const direct = (): Tickets | undefined => (uploadKey !== undefined && isSettled(uploadKey, outside.now()) ? signed : undefined);

  return { kept, uploadKey, direct };
}

/** Answer a start whose schema step failed: the step is logged, and the failure carries the way back to the code before an update, which nothing has asked for yet. */
function failedStep(
  opened: Extract<Awaited<ReturnType<typeof openDatabase>>, { readonly kind: "failed" }>,
  given: { readonly env: Bindings; readonly outside: Outside; readonly worker: Parameters<typeof goBack>[0]["worker"] },
): Started {
  const { env, outside, worker } = given;
  // The step's message ends in the database's own words, which can repeat a stored value: the log gets the step's number, the kind of the failure, and the database's codes and fixed words.
  logFault(`step ${opened.step} of the database's schema failed and nothing of it was kept`, opened.failure);
  const failed = { last: env.LAST_UPDATE, failed: { version: VERSION, stored: opened.stored }, noting: { database: opened.behind, now: outside.now } };
  const key = readKeptKey(env[INSTALL_OBJECTS.keyBinding], { fetch: outside.cloudflare });

  return { ok: false, failure: { kind: "failed", back: () => goBack({ ...failed, key, worker }) } };
}

/**
 * Make one Worker instance ready to answer.
 *
 * @param visitorOf - how the API counts a computer that logs in, which has no token to be known by
 * @returns the instance, or the first thing that stopped it. Nothing is kept between calls, so a call after a failure starts from the beginning
 * @throws whatever the database rejects with while the settings or the key are stored
 */
export async function startInstance(env: Bindings, outside: Outside, visitorOf: VisitorOf): Promise<Started> {
  const { hosts: read, own, access, refused } = readVariables(env);
  // Setup writes the domain and the account together, so either one absent is a Worker with nothing set. Any other fault is a value somebody typed wrong.
  const nothingSet = refused.every(({ binding, refusal }) => refusal === "absent" && (binding === "ZONE" || binding === INSTALL_OBJECTS.accountBinding));
  if (!nothingSet) return { ok: false, failure: { kind: "binding", refused } };

  const now = outside.now();
  const driver = new D1Driver(env.DB, outside.now);
  const opened = await openDatabase(driver, now);
  if (opened.kind === "newer") return { ok: false, failure: { kind: "newer" } };

  if (opened.kind === "failed") return failedStep(opened, { env, outside, worker: own.ok ? own.value : undefined });

  if (opened.kind !== "open") {
    console.error(`poplin: ${opened.message}`);

    return { ok: false, failure: { kind: opened.kind } };
  }

  const { database } = opened;
  const stored = await readStored(database);
  if ("ok" in stored) return stored;

  const settled = stored.settings !== undefined;
  if (!read.ok || !own.ok) return startUnset({ database, driver, env, outside, refused, script: own.ok ? own.value.script : own.script, settled });

  const unset = settled ? undefined : await ensureSettings(database, env.FIRST_SETTINGS, now);
  if (unset !== undefined) return unset;

  // An install that holds its key is asked for it no more: only the first start of an install makes one.
  if (stored.key === undefined) await database.ensureVisitorKey(crypto.getRandomValues(new Uint8Array(KEY_BYTES)), now);

  const hosts = read.value;
  const { addresses } = hosts;
  const install: Install = {
    database,
    store: new R2Store(env.SITES),
    now: outside.now,
    addressOf: addresses.addressOf,
    publicAddressOf: addresses.publicAddressOf,
    reservedNames: addresses.reservedNames,
  };
  const counters = new CloudflareCounters({ limiter: env.MINUTE_LIMITS, database, rows: driver });
  const { kept, uploadKey, direct } = readKeys(env, own.value.accountId, outside);
  const update = createSelfUpdate({ key: kept, worker: own.value, version: VERSION, last: env.LAST_UPDATE, now: outside.now, fetch: outside.latest.fetch });
  const { key, domain, rules } = hosts.sideOf({ ...own.value, kept, uploadKey, fetch: outside.cloudflare, now: outside.now });
  const carried = { follow: createUsersFollow(kept, own.value.accountId), endLogins: createEndLogins(kept, own.value.accountId), rules };
  const api = createApi({
    ...install,
    readToken: (id) => database.getToken(id),
    limits: API_LIMITS,
    version: VERSION,
    layout: hosts.layout,
    report: (error) => logFault("an API request failed", error),
    counters,
    visitorOf: (request) => visitorOf(request, database),
    update,
    ...carried,
    jobs: workflowJobs(env.JOBS),
    direct,
  });

  const instance: Instance = {
    hosts,
    install,
    addresses,
    counters,
    servedByName: new Map(),
    api,
    entered: createEntries(install, (error) => logFault("a login was not written to the audit log", error)),
    identify: access.ok ? accessIdentity({ keys: accessKeys({ teamDomain: access.value.teamDomain, fetch: outside.fetch }), audience: access.value.audience }) : NOBODY,
    domain,
    key,
    ...carried,
    login: createLoginRepair(kept, { ...own.value, adminHost: hosts.adminHost, privateSites: hosts.privateSites }),
    keepAlert: (email) => keepBudgetAlert(kept, own.value.accountId, email),
    usage: createUsageHost({ accountId: own.value.accountId, unwrittenRows: (day) => driver.heldRows(day), databaseBytes: () => driver.heldBytes(), workflow: workflowNameOf(own.value.script), key: kept }),
    version: VERSION,
    jobs: workflowJobs(env.JOBS),
    updating: { self: update, counters },
  };

  return { ok: true, instance };
}
