// One Worker instance made ready: its bindings read, its database opened and brought up to date, the first settings and the signing key stored, and every piece built over them.
//
//   ZONE, ACCESS       read and checked                                  else `binding`
//   DB                 opened, its pending schema steps applied           else `newer` or `failed`
//   settings           stored from FIRST_SETTINGS, only while none exist  else `binding`
//   signing key        stored, only while none exists

import { createApi } from "@poplin/app/src/api/api";
import type { Counters } from "@poplin/app/src/limits/limits";
import type { Identify } from "@poplin/app/src/login/login";
import { hostnameAddresses } from "@poplin/app/src/sites/hostname-addresses";
import type { Install } from "@poplin/core/src/actions/records";
import type { Database } from "@poplin/core/src/database/database";
import { openDatabase } from "@poplin/core/src/database/open";
import { settingsFromText } from "@poplin/core/src/records/settings";
import * as v from "valibot";
import { D1Driver } from "../database/d1";
import { CloudflareCounters } from "../limits/counters";
import { accessIdentity } from "../login/access-token";
import { accessKeys } from "../login/keys";
import { R2Store } from "../storage/r2";
import { readAccessBinding } from "../zone/access-binding";
import { INSTALL_OBJECTS } from "../zone/install-objects";
import type { DomainLayout } from "../zone/layout";
import { readZoneBinding } from "../zone/zone-binding";
import type { Bindings } from "./bindings";

/** What one request to the API may carry. Cloudflare's Free plan ends a request body at 100 MB, and core ends a manifest at 1.5 MB itself. */
const API_LIMITS = { fileBytes: 100_000_000, files: 10_000, manifestBytes: 2_000_000 } as const;

/** The bytes of a new signing key. */
const KEY_BYTES = 32;

/** The text form of every setting, as the binding holds it. */
const SETTING_TEXTS = v.record(v.string(), v.string());

/** The address layout of an install, as serving and the login ask it. */
type Addresses = ReturnType<typeof hostnameAddresses>;

/** What the instance is given besides its bindings. */
export interface Outside {
  /** The clock, in milliseconds since the epoch. */
  readonly now: () => number;

  /** Fetches the keys Access signs its tokens with. */
  readonly fetch: Parameters<typeof accessKeys>[0]["fetch"];
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

  /** Decides who a request to the login path is from. */
  readonly identify: Identify<string>;
}

/** Why an instance could not start. `refusal` says what is wrong with a binding and never quotes a value of it. */
export type Failure = { readonly kind: "binding"; readonly binding: "ZONE" | "ACCESS" | "FIRST_SETTINGS"; readonly refusal: string } | { readonly kind: "newer" } | { readonly kind: "failed" };

/** An instance, or why there is none. */
export type Started = { readonly ok: true; readonly instance: Instance } | { readonly ok: false; readonly failure: Failure };

function badBinding(binding: Extract<Failure, { kind: "binding" }>["binding"], refusal: string): Started {
  return { ok: false, failure: { kind: "binding", binding, refusal } };
}

/** Store the first settings while the install has none. Two instances that start together store one row: the second is answered `already_set`. */
async function ensureSettings(database: Database, binding: unknown, now: number): Promise<Started | undefined> {
  if ((await database.readSettings()) !== undefined) return undefined;

  if (binding === undefined) return badBinding("FIRST_SETTINGS", "absent");

  const texts = v.safeParse(SETTING_TEXTS, binding);
  if (!texts.success) return badBinding("FIRST_SETTINGS", "bad-shape");

  const first = settingsFromText(texts.output);
  // A key that is no setting is text of the binding's own, so it is not repeated.
  if (!first.ok && first.refusal === "unknown-key") return badBinding("FIRST_SETTINGS", first.refusal);

  if (!first.ok) return badBinding("FIRST_SETTINGS", `${first.refusal} at ${first.key}`);

  const [installer] = first.values.logins;
  if (installer === undefined) return badBinding("FIRST_SETTINGS", "missing at logins");

  await database.initSettings(first.values, { by: installer, at: now });

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
  if (!zone.ok) return badBinding("ZONE", zone.refusal);

  const access = readAccessBinding(env[INSTALL_OBJECTS.accessBinding]);
  if (!access.ok) return badBinding("ACCESS", access.refusal);

  const now = outside.now();
  const opened = await openDatabase(new D1Driver(env.DB), now);
  if (opened.kind === "newer") return { ok: false, failure: { kind: "newer" } };

  if (opened.kind === "failed") {
    console.error(`poplin: ${opened.message}`);

    return { ok: false, failure: { kind: "failed" } };
  }

  const { database } = opened;
  const unset = await ensureSettings(database, env.FIRST_SETTINGS, now);
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
  const keys = accessKeys({ teamDomain: access.value.teamDomain, fetch: outside.fetch });
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
    identify: accessIdentity({ keys, audience: access.value.audience }),
  };

  return { ok: true, instance };
}
