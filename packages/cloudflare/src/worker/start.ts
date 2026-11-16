// One Worker instance made ready: its bindings read, its database opened and brought up to date, the first settings and the visitor key stored, and every piece built over them.
//
//   ZONE, ACCOUNT_ID, WORKER_NAME   read and checked                     else `binding`, naming every one that is refused
//   ZONE or ACCOUNT_ID absent       a Worker with nothing set            `unset`: its setup page alone, until somebody has logged in
//   ACCESS             read and checked; absent, nobody is admitted      else `binding`
//   DB                 opened, its pending schema steps applied           else `newer`, `differs`, or `failed`
//   settings           stored from FIRST_SETTINGS over the defaults, only while none exist  else `binding`; stored ones this build cannot read are `differs`
//   visitor key        stored, only while none exists
//   KEPT_KEY           read once; absent or no key, the install holds none   never a fault, and never quoted

import { createApi } from "@poplin/app/src/api/api";
import type { Counters } from "@poplin/app/src/limits/limits";
import type { DomainPlug, FirstRun } from "@poplin/app/src/console/domain/records";
import type { InstallKey } from "@poplin/app/src/console/key/records";
import type { UsersFollow } from "@poplin/app/src/console/access/users-follow";
import type { RulesFollow } from "@poplin/app/src/console/settings/rules-follow";
import type { UsageHost } from "@poplin/app/src/console/usage/records";
import type { Identify } from "@poplin/app/src/login/admit";
import { createEntries } from "@poplin/app/src/login/entries";
import { hostnameAddresses } from "@poplin/app/src/sites/hostname-addresses";
import type { Asking } from "@poplin/core/src/actions/check-update";
import type { Install } from "@poplin/core/src/actions/records";
import type { Rebuilding } from "@poplin/core/src/actions/start-update";
import { parseLogins } from "@poplin/core/src/auth/logins";
import type { Database, SettingsAndKey } from "@poplin/core/src/database/database";
import type { PublicName } from "@poplin/core/src/names/names";
import { openDatabase } from "@poplin/core/src/database/open";
import { defaultSettings, SETTING_VALUES, settingsFromText, settingsToText } from "@poplin/core/src/records/settings";
import type { SiteId } from "@poplin/core/src/sites/ids";
import * as v from "valibot";
import { version } from "../../../cli/package.json";
import { D1Driver } from "../database/d1";
import { createInstallKey } from "../key/install-key";
import { readKeptKey } from "../key/kept-key";
import { createRulesFollow } from "../key/rules-follow";
import { createUsersFollow } from "../key/users-follow";
import { CloudflareCounters } from "../limits/counters";
import { createUsageHost } from "../usage/usage-host";
import { createSelfUpdate } from "../update/self-update";
import { accessIdentity } from "../login/access-token";
import { accessKeys } from "../login/keys";
import { R2Store } from "../storage/r2";
import { readAccessBinding } from "../zone/access-binding";
import type { Connection } from "../zone/client";
import { isDeployHook } from "../zone/deploy-hook";
import { INSTALL_OBJECTS } from "../zone/install-objects";
import type { DomainLayout } from "../zone/layout";
import { readZoneBinding } from "../zone/zone-binding";
import { createFirstRun } from "../zone/first-run";
import { createDomainPlug, giveKey } from "../zone/zone-plug";
import type { Bindings } from "./bindings";
import { logFault } from "./fault";
import { derivedSecret, type Held } from "./held";
import { readOwnWorker } from "./own-worker";

/** What one request to the API may carry. Cloudflare's Free plan ends a request body at 100 MB, and core ends a manifest at 1.5 MB itself. */
const API_LIMITS = { fileBytes: 100_000_000, files: 10_000, manifestBytes: 2_000_000 } as const;

/** The bytes of a new visitor key. */
const KEY_BYTES = 32;

/** The text form of every setting, as the binding holds it. */
const SETTING_TEXTS = v.record(v.string(), v.string());

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

/** The address layout of an install, as serving and the login ask it. */
type Addresses = ReturnType<typeof hostnameAddresses>;

/** What the instance is given besides its bindings. */
export interface Outside {
  /** The clock, in milliseconds since the epoch. */
  readonly now: () => number;

  /** Fetches the keys Access signs its tokens with. */
  readonly fetch: Parameters<typeof accessKeys>[0]["fetch"];

  /** Sends setup's calls to Cloudflare; the runtime's own fetch when absent. */
  readonly cloudflare?: Connection["fetch"];

  /** What asks the project's website, once a day, which version of poplin is the newest. An install that updates itself fetches the release's files through it too. */
  readonly latest: Asking;

  /** Sends the one request that starts a build of the Worker, to the Deploy Hook an admin saved. */
  readonly rebuild: Rebuilding["fetch"];
}

/** The key one visitor's requests are counted by, from the address Cloudflare saw and the secret the instance holds for the database. */
export type VisitorOf = (request: Request, database: Database) => Promise<string>;

/** Everything a request is answered from. One is built per Worker instance: the counters and the Access keys remember what they saw. */
export interface Instance {
  /** The install's domain, its admin hostname, and its public word. */
  readonly layout: DomainLayout;

  /** The install as the actions take it: the database, the bucket, the clock, and how an address is written. */
  readonly install: Install;

  /** The install's address layout. */
  readonly addresses: Addresses;

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

  /** The install's side at Cloudflare, for setup and the Domain tab. */
  readonly domain: DomainPlug;

  /** The key poplin keeps for Cloudflare: whether the install holds one, whether Cloudflare still takes it, and the way to a new one. Nothing answers the key itself. */
  readonly key: InstallKey;

  /** The users' side at Cloudflare: a change of the logins is carried there with the kept key. */
  readonly follow: UsersFollow;

  /** The guard rules' side at Cloudflare: a change of a setting they are written from is carried there with the kept key. */
  readonly rules: RulesFollow;

  /** Cloudflare's side of the Usage screen. */
  readonly usage: UsageHost;

  /** The version of poplin the install runs. */
  readonly version: string;

  /** What starts a build of the Worker: only a Deploy Hook is taken as its address, and the starts are counted in `counters`. */
  readonly rebuilding: Rebuilding;
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

/** Why an instance could not start. `binding` names every variable that is refused, at least one. `differs` is a database another build of poplin made. `unset` is no fault: the Worker was deployed and setup has not given it its domain and its account. */
export type Failure =
  | { readonly kind: "binding"; readonly refused: readonly RefusedBinding[] }
  | { readonly kind: "newer" }
  | { readonly kind: "differs" }
  | { readonly kind: "failed" }
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
  if (binding === undefined) return badBinding("FIRST_SETTINGS", "absent");

  const texts = v.safeParse(SETTING_TEXTS, binding);
  if (!texts.success) return badBinding("FIRST_SETTINGS", "bad-shape");

  const emails = (texts.output.logins ?? "").split(",").map((email) => email.trim());
  const stated = parseLogins(emails.filter((email) => email !== ""));
  const [firstLogin] = stated.ok ? stated.value : [];
  if (firstLogin === undefined) return badBinding("FIRST_SETTINGS", stated.ok || stated.refusal === "no-logins" ? "missing at logins" : "bad-form at logins");

  const first = settingsFromText({ ...settingsToText(defaultSettings({ installer: firstLogin })), ...texts.output });
  // A key that is no setting is text of the binding's own, so it is not repeated.
  if (!first.ok && first.refusal === "unknown-key") return badBinding("FIRST_SETTINGS", first.refusal);

  if (!first.ok) return badBinding("FIRST_SETTINGS", `${first.refusal} at ${first.key}`);

  const [installer] = first.values.logins;
  if (installer === undefined) return badBinding("FIRST_SETTINGS", "missing at logins");

  await database.initSettings(first.values, { by: installer, at: now });

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
  readonly zone: ReturnType<typeof readZoneBinding>;
  readonly own: ReturnType<typeof readOwnWorker>;
  readonly access: ReturnType<typeof readAccessBinding>;
  readonly refused: readonly RefusedBinding[];
} {
  const zone = readZoneBinding(env.ZONE);
  const own = readOwnWorker({ accountId: env[INSTALL_OBJECTS.accountBinding], script: env[INSTALL_OBJECTS.workerBinding] });
  const access = readAccessBinding(env[INSTALL_OBJECTS.accessBinding]);
  const noAccess = !access.ok && access.refusal === "absent";
  const refused: RefusedBinding[] = [
    ...(zone.ok ? [] : [{ binding: "ZONE" as const, refusal: zone.refusal }]),
    ...(own.ok ? [] : own.refused),
    ...(access.ok || noAccess ? [] : [{ binding: "ACCESS" as const, refusal: access.refusal }]),
  ];

  return { zone, own, access, refused };
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

/**
 * Make one Worker instance ready to answer.
 *
 * @param visitorOf - how the API counts a computer that logs in, which has no token to be known by
 * @returns the instance, or the first thing that stopped it. Nothing is kept between calls, so a call after a failure starts from the beginning
 * @throws whatever the database rejects with while the settings or the key are stored
 */
export async function startInstance(env: Bindings, outside: Outside, visitorOf: VisitorOf): Promise<Started> {
  const { zone, own, access, refused } = readVariables(env);
  // Setup writes the domain and the account together, so either one absent is a Worker with nothing set. Any other fault is a value somebody typed wrong.
  const nothingSet = refused.every(({ binding, refusal }) => refusal === "absent" && (binding === "ZONE" || binding === INSTALL_OBJECTS.accountBinding));
  if (!nothingSet) return { ok: false, failure: { kind: "binding", refused } };

  const now = outside.now();
  const driver = new D1Driver(env.DB, outside.now);
  const opened = await openDatabase(driver, now);
  if (opened.kind === "newer") return { ok: false, failure: { kind: "newer" } };

  if (opened.kind === "failed") {
    // The step's message ends in the database's own words, which can repeat a stored value: the log gets the step's number and the kind of the failure.
    logFault(`step ${opened.step} of the database's schema failed and nothing of it was kept`, opened.failure);

    return { ok: false, failure: { kind: "failed" } };
  }

  if (opened.kind !== "open") {
    console.error(`poplin: ${opened.message}`);

    return { ok: false, failure: { kind: opened.kind } };
  }

  const { database } = opened;
  const stored = await readStored(database);
  if ("ok" in stored) return stored;

  const settled = stored.settings !== undefined;
  if (!zone.ok || !own.ok) return startUnset({ database, driver, env, outside, refused, script: own.ok ? own.value.script : own.script, settled });

  const unset = settled ? undefined : await ensureSettings(database, env.FIRST_SETTINGS, now);
  if (unset !== undefined) return unset;

  // An install that holds its key is asked for it no more: only the first start of an install makes one.
  if (stored.key === undefined) await database.ensureVisitorKey(crypto.getRandomValues(new Uint8Array(KEY_BYTES)), now);

  const layout = zone.value;
  const addresses = hostnameAddresses(layout);
  const install: Install = {
    database,
    store: new R2Store(env.SITES),
    now: outside.now,
    addressOf: addresses.addressOf,
    publicAddressOf: addresses.publicAddressOf,
    reservedNames: addresses.reservedNames,
  };
  const counters = new CloudflareCounters({ limiter: env.MINUTE_LIMITS, database, rows: driver });
  const kept = readKeptKey(env[INSTALL_OBJECTS.keyBinding], { fetch: outside.cloudflare });
  // An install that holds its key takes a release by itself; one that holds none starts a build at the saved address.
  const self = kept === undefined ? undefined : createSelfUpdate({ key: kept, worker: own.value, version: VERSION, fetch: outside.latest.fetch });
  const rebuild = { accepts: isDeployHook, fetch: outside.rebuild, self };
  const placed = { ...own.value, layout, fetch: outside.cloudflare };
  const key: InstallKey = createInstallKey(kept, own.value.accountId, (authorisation) => giveKey({ ...placed, key }, authorisation));
  const carried = { follow: createUsersFollow(kept, own.value.accountId), rules: createRulesFollow(kept, { accountId: own.value.accountId, layout }) };
  const api = createApi({
    ...install,
    readToken: (id) => database.getToken(id),
    limits: API_LIMITS,
    version: VERSION,
    layout: { kind: "hostname", public_word: layout.publicWord },
    report: (error) => logFault("an API request failed", error),
    counters,
    visitorOf: (request) => visitorOf(request, database),
    rebuild,
    ...carried,
  });

  const instance: Instance = {
    layout,
    install,
    addresses,
    counters,
    servedByName: new Map(),
    api,
    entered: createEntries(install, (error) => logFault("a login was not written to the audit log", error)),
    identify: access.ok ? accessIdentity({ keys: accessKeys({ teamDomain: access.value.teamDomain, fetch: outside.fetch }), audience: access.value.audience }) : NOBODY,
    domain: createDomainPlug({ ...placed, key }),
    key,
    ...carried,
    usage: createUsageHost({ accountId: own.value.accountId, unwrittenRows: (day) => driver.heldRows(day), key: kept }),
    version: VERSION,
    rebuilding: { ...rebuild, counters },
  };

  return { ok: true, instance };
}
