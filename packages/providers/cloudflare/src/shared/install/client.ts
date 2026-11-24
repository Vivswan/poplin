// The one way poplin calls the Cloudflare API: the caller passes the key on every call and nothing here keeps it.

import { BaseCloudflare } from "cloudflare/client";
import { APIConnectionError, APIError } from "cloudflare/error";
import { BaseZones } from "cloudflare/resources/zones/zones";
import * as v from "valibot";

// Where every call goes, unless a test names another place.
const API = "https://api.cloudflare.com/client/v4";

// The status of an answer that asks to wait.
const RATE_LIMITED_STATUS = 429;

// The milliseconds of a second, which an answer that asks to wait counts in.
const MS_PER_SECOND = 1000;

// The plans a zone can be on, as the first word of Cloudflare's name for one.
const ZONE_PLANS: ReadonlySet<string> = new Set(["free", "pro", "business", "enterprise"]);

// One entry of the `errors` list in a reply, as far as a refusal is read.
const REFUSAL = v.object({ code: v.number(), message: v.string() });

/**
 * Where to send a call and the key that authorises it. `baseUrl` and `fetch` are absent outside tests.
 * `sleep` waits so many milliseconds before a call is made again, as between two reads of settings that trail an upload: the platform's own timer where absent.
 * Its `why` is the line a person is shown meanwhile, on a wait long enough to need one.
 * `ride` makes a call again while its answer asks to wait, and only the connection of an install command has one: with it the SDK tries such an answer once, and every wait is the rider's.
 */
export interface Connection {
  readonly key: string;
  readonly baseUrl?: string | undefined;
  readonly fetch?: ((input: string | URL | Request, init?: RequestInit) => Promise<Response>) | undefined;
  readonly sleep?: ((milliseconds: number, why?: string) => Promise<void>) | undefined;
  readonly ride?: (<Value>(call: () => Promise<CloudflareResult<Value>>) => Promise<CloudflareResult<Value>>) | undefined;
}

/** One entry of the `errors` list in Cloudflare's reply. */
interface ApiRefusal {
  readonly code: number;
  readonly message: string;
}

/** A call that did not succeed. `refused` is Cloudflare's own answer, `rate-limited` a last answer that asked to wait (429), with the wait it named where `Retry-After` named one in seconds, and `network` means no answer arrived. */
export type CloudflareFailure =
  | { readonly ok: false; readonly failure: "refused"; readonly status: number; readonly errors: readonly ApiRefusal[] }
  | { readonly ok: false; readonly failure: "rate-limited"; readonly afterMs?: number }
  | { readonly ok: false; readonly failure: "network"; readonly message: string };

/** The `result` of Cloudflare's reply, or why there is none. */
export type CloudflareResult<Value> = { readonly ok: true; readonly value: Value } | CloudflareFailure;

/** The plan a zone is on; an unknown plan reads as `free`, the one with the tightest limits. */
export type ZonePlan = "free" | "pro" | "business" | "enterprise";

/** A zone the key can change, with the account it is in. */
export interface Zone {
  readonly id: string;
  readonly name: string;
  readonly plan: ZonePlan;
  readonly accountId: string;
}

function limitedBy(retryAfter: string | null | undefined): CloudflareFailure {
  const seconds = retryAfter == null || retryAfter.trim() === "" ? Number.NaN : Number(retryAfter);
  if (!Number.isFinite(seconds) || seconds < 0) return { ok: false, failure: "rate-limited" };

  return { ok: false, failure: "rate-limited", afterMs: seconds * MS_PER_SECOND };
}

// The SDK tries an answer of some statuses again by itself, unseen, on a timer no person can end. Its own header for "do not try again" hands an answer of the status to the caller at once.
function unretried(send: NonNullable<Connection["fetch"]>, status: number): NonNullable<Connection["fetch"]> {
  return async (input, init) => {
    const response = await send(input, init);
    if (response.status !== status) return response;

    const headers = new Headers(response.headers);
    headers.set("x-should-retry", "false");

    return new Response(response.body, { status: response.status, headers });
  };
}

/**
 * A connection whose answers of a status the SDK hands back at once, whatever their codes: it tries a conflict (409) three times within two seconds by itself.
 *
 * @param status - the status of an answer the caller makes the call again for by itself, after a wait of its own; an answer of another status is tried again as before
 */
export function unretriedOn(connection: Connection, status: number): Connection {
  return { ...connection, fetch: unretried(connection.fetch ?? fetch, status) };
}

/** The clock a connection's waits are on: its own, or the platform's timer where it has none. */
export function clockOf(connection: Connection): NonNullable<Connection["sleep"]> {
  return connection.sleep ?? ((milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds)));
}

function failureOf(error: APIError): CloudflareFailure {
  if (error instanceof APIConnectionError || error.status === undefined) return { ok: false, failure: "network", message: error.message };

  if (error.status === RATE_LIMITED_STATUS) return limitedBy(error.headers?.get("retry-after"));

  const errors: unknown = error.errors;
  const refusals = Array.isArray(errors) ? errors.filter((entry) => v.is(REFUSAL, entry)) : [];

  return { ok: false, failure: "refused", status: error.status, errors: refusals.map(({ code, message }) => ({ code, message })) };
}

// Cloudflare names a plan by its tier and a noun, as in "Pro Website".
function planOf(name: string | undefined): ZonePlan {
  const tier = name?.split(" ")[0]?.toLowerCase() ?? "";
  if (!ZONE_PLANS.has(tier)) return "free";

  return tier as ZonePlan;
}

// The SDK fills each option left out from a variable of the environment (CLOUDFLARE_BASE_URL, _API_TOKEN, _API_KEY, _EMAIL, _API_USER_SERVICE_KEY, _LOG), so each one is stated; CLOUDFLARE_CUSTOM_HEADERS has no option, so its headers are dropped.
function clientOf(connection: Connection): BaseCloudflare {
  const api = new BaseCloudflare({
    apiToken: connection.key,
    apiKey: null,
    apiEmail: null,
    userServiceKey: null,
    baseURL: connection.baseUrl ?? API,
    fetch: connection.ride === undefined ? connection.fetch : unretried(connection.fetch ?? fetch, RATE_LIMITED_STATUS),
    logLevel: "off",
  });
  // biome-ignore lint/complexity/useLiteralKeys: the SDK's types keep these options private, and this form reaches them with the name still checked.
  api["_options"].defaultHeaders = undefined;

  return api;
}

/**
 * Make one call to the Cloudflare API with the key the caller holds.
 *
 * A busy answer (429), a conflict (409), a failure of Cloudflare's own (5xx), and a dropped connection are tried again by the SDK, twice at most, after the wait Cloudflare names, or else up to half a second and then up to one.
 * A connection with a rider leaves the busy answer to it: the rider makes the whole call again after each wait. A connection made with `unretriedOn` leaves an answer of its status to the caller.
 *
 * @param call - builds an SDK resource on the given client and awaits one request
 * @returns the reply's `result`, or the failure of the last try; a refusal by Cloudflare is a value, never an exception
 */
export async function callCloudflare<Value>(connection: Connection, call: (api: BaseCloudflare) => Promise<Value>): Promise<CloudflareResult<Value>> {
  const api = clientOf(connection);
  const once = async (): Promise<CloudflareResult<Value>> => {
    try {
      return { ok: true, value: await call(api) };
    } catch (error) {
      if (error instanceof APIError) return failureOf(error);

      throw error;
    }
  };

  return connection.ride === undefined ? once() : connection.ride(once);
}

/**
 * List the zones of one account the key can see.
 *
 * @returns only zones Cloudflare says belong to `accountId`, whatever else the key reaches
 */
export async function listZones(connection: Connection, accountId: string): Promise<CloudflareResult<Zone[]>> {
  const zones = await callCloudflare(connection, (api) => Array.fromAsync(new BaseZones(api).list({ account: { id: accountId } })));
  if (!zones.ok) return zones;

  const owned = zones.value.filter((zone) => zone.account.id === accountId);

  return { ok: true, value: owned.map((zone) => ({ id: zone.id, name: zone.name, plan: planOf(zone.plan?.name), accountId })) };
}

/**
 * Find the zones of a domain the key can see, in whatever account.
 *
 * @returns only zones of exactly that name that are active: a zone anybody added and never proved theirs is pending, and is left out
 */
export async function findZones(connection: Connection, domain: string): Promise<CloudflareResult<Zone[]>> {
  const zones = await callCloudflare(connection, (api) => Array.fromAsync(new BaseZones(api).list({ name: domain, status: "active" })));
  if (!zones.ok) return zones;

  const found = zones.value.flatMap((zone) => {
    const accountId = zone.account.id;
    if (zone.name !== domain || zone.status !== "active" || accountId === undefined) return [];

    return [{ id: zone.id, name: zone.name, plan: planOf(zone.plan?.name), accountId }];
  });

  return { ok: true, value: found };
}
