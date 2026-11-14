// One Worker instance made ready: its bindings read, its database opened and brought up to date, the first settings and the signing key stored, and every piece built over them.
//
//   ZONE, ACCOUNT_ID, WORKER_NAME   read and checked                     else `binding`, naming every one that is refused
//   ACCESS             read and checked; absent, the login stays shut    else `binding`
//   DB                 opened, its pending schema steps applied           else `newer` or `failed`
//   settings           stored from FIRST_SETTINGS over the defaults, only while none exist  else `binding`
//   signing key        stored, only while none exists

import { createApi } from "@poplin/app/src/api/api";
import type { Counters } from "@poplin/app/src/limits/limits";
import type { DomainPlug } from "@poplin/app/src/dashboard/domain/records";
import type { Identify } from "@poplin/app/src/login/login";
import { hostnameAddresses } from "@poplin/app/src/sites/hostname-addresses";
import type { Install } from "@poplin/core/src/actions/records";
import { parseLogins } from "@poplin/core/src/auth/logins";
import type { Database } from "@poplin/core/src/database/database";
import { openDatabase } from "@poplin/core/src/database/open";
import { defaultSettings, settingsFromText, settingsToText } from "@poplin/core/src/records/settings";
import * as v from "valibot";
import { D1Driver } from "../database/d1";
import { CloudflareCounters } from "../limits/counters";
import { accessIdentity } from "../login/access-token";
import { accessKeys } from "../login/keys";
import { R2Store } from "../storage/r2";
import { readAccessBinding } from "../zone/access-binding";
import type { Connection } from "../zone/client";
import { INSTALL_OBJECTS } from "../zone/install-objects";
import type { DomainLayout } from "../zone/layout";
import { readZoneBinding } from "../zone/zone-binding";
import { createDomainPlug } from "../zone/zone-plug";
import type { Bindings } from "./bindings";
import { readOwnWorker } from "./own-worker";

/** What one request to the API may carry. Cloudflare's Free plan ends a request body at 100 MB, and core ends a manifest at 1.5 MB itself. */
const API_LIMITS = { fileBytes: 100_000_000, files: 10_000, manifestBytes: 2_000_000 } as const;

/** The bytes of a new signing key. */
const KEY_BYTES = 32;

/** The text form of every setting, as the binding holds it. */
const SETTING_TEXTS = v.record(v.string(), v.string());

/** The refusal of every login on an install whose Access application setup has not made yet. */
export const NO_ACCESS = "not-set-up";

/** The login of a Worker with no `ACCESS` variable: nobody is anybody. */
const NOBODY: Identify<string> = async () => ({ ok: false, refusal: NO_ACCESS });

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
  readonly counters: Counters;

  /** Answers every path under `/api`. */
  readonly api: ReturnType<typeof createApi>;

  /** Decides who a request to the login path or to a private site's address is from. Without an `ACCESS` variable it refuses everyone as `NO_ACCESS`. */
  readonly identify: Identify<string>;

  /** The install's side at Cloudflare, for setup and the Domain tab. */
  readonly domain: DomainPlug;
}

/** A variable of the Worker that cannot be used. `refusal` says what is wrong with it and never quotes its value. */
interface RefusedBinding {
  readonly binding: "ZONE" | "ACCESS" | "FIRST_SETTINGS" | "ACCOUNT_ID" | "WORKER_NAME";
  readonly refusal: string;
}

/** Why an instance could not start. `binding` names every variable that is refused, at least one. */
export type Failure = { readonly kind: "binding"; readonly refused: readonly RefusedBinding[] } | { readonly kind: "newer" } | { readonly kind: "failed" };

/** An instance, or why there is none. */
export type Started = { readonly ok: true; readonly instance: Instance } | { readonly ok: false; readonly failure: Failure };

function badBinding(binding: RefusedBinding["binding"], refusal: string): Started {
  return { ok: false, failure: { kind: "binding", refused: [{ binding, refusal }] } };
}

/**
 * Store the first settings while the install has none. Two instances that start together store one row: the second is answered `already_set`.
 *
 * The binding must name the logins; every setting it leaves out starts at its default.
 */
async function ensureSettings(database: Database, binding: unknown, at: { readonly now: number; readonly hostname: string }): Promise<Started | undefined> {
  if ((await database.readSettings()) !== undefined) return undefined;

  if (binding === undefined) return badBinding("FIRST_SETTINGS", "absent");

  const texts = v.safeParse(SETTING_TEXTS, binding);
  if (!texts.success) return badBinding("FIRST_SETTINGS", "bad-shape");

  const emails = (texts.output.logins ?? "").split(",").map((email) => email.trim());
  const stated = parseLogins(emails.filter((email) => email !== ""));
  const [firstLogin] = stated.ok ? stated.value : [];
  if (firstLogin === undefined) return badBinding("FIRST_SETTINGS", stated.ok || stated.refusal === "no-logins" ? "missing at logins" : "bad-form at logins");

  const first = settingsFromText({ ...settingsToText(defaultSettings({ installer: firstLogin, hostname: at.hostname })), ...texts.output });
  // A key that is no setting is text of the binding's own, so it is not repeated.
  if (!first.ok && first.refusal === "unknown-key") return badBinding("FIRST_SETTINGS", first.refusal);

  if (!first.ok) return badBinding("FIRST_SETTINGS", `${first.refusal} at ${first.key}`);

  const [installer] = first.values.logins;
  if (installer === undefined) return badBinding("FIRST_SETTINGS", "missing at logins");

  await database.initSettings(first.values, { by: installer, at: at.now });

  return undefined;
}

/**
 * Make one Worker instance ready to answer.
 *
 * @param visitorOf - how the API counts a computer that logs in, which has no token to be known by
 * @returns the instance, or the first thing that stopped it. Nothing is kept between calls, so a call after a failure starts from the beginning
 * @throws whatever the database rejects with while the settings or the key are stored
 */
export async function startInstance(env: Bindings, outside: Outside, visitorOf: VisitorOf): Promise<Started> {
  const zone = readZoneBinding(env.ZONE);
  const own = readOwnWorker({ accountId: env[INSTALL_OBJECTS.accountBinding], script: env[INSTALL_OBJECTS.workerBinding] });
  const access = readAccessBinding(env[INSTALL_OBJECTS.accessBinding]);
  // An absent `ACCESS` is an install setup has not finished, and no fault: the login stays shut until setup writes it.
  const noAccess = !access.ok && access.refusal === "absent";
  const refused: RefusedBinding[] = [
    ...(zone.ok ? [] : [{ binding: "ZONE" as const, refusal: zone.refusal }]),
    ...(own.ok ? [] : own.refused),
    ...(access.ok || noAccess ? [] : [{ binding: "ACCESS" as const, refusal: access.refusal }]),
  ];
  if (!zone.ok || !own.ok || refused.length > 0) return { ok: false, failure: { kind: "binding", refused } };

  const now = outside.now();
  const opened = await openDatabase(new D1Driver(env.DB), now);
  if (opened.kind === "newer") return { ok: false, failure: { kind: "newer" } };

  if (opened.kind === "failed") {
    console.error(`poplin: ${opened.message}`);

    return { ok: false, failure: { kind: "failed" } };
  }

  const { database } = opened;
  const unset = await ensureSettings(database, env.FIRST_SETTINGS, { now, hostname: zone.value.adminHostname });
  if (unset !== undefined) return unset;

  await database.ensureSigningKey(crypto.getRandomValues(new Uint8Array(KEY_BYTES)), now);

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
  const counters = new CloudflareCounters({ limiter: env.MINUTE_LIMITS, database });
  const api = createApi({
    ...install,
    readToken: (id) => database.getToken(id),
    limits: API_LIMITS,
    report: (error) => console.error("poplin: an API request failed", error),
    counters,
    visitorOf: (request) => visitorOf(request, database),
  });

  const instance: Instance = {
    layout,
    install,
    addresses,
    counters,
    api,
    identify: access.ok ? accessIdentity({ keys: accessKeys({ teamDomain: access.value.teamDomain, fetch: outside.fetch }), audience: access.value.audience }) : NOBODY,
    domain: createDomainPlug({ ...own.value, layout, fetch: outside.cloudflare }),
  };

  return { ok: true, instance };
}
