// The one way poplin calls the Cloudflare API: the caller passes the key on every call and nothing here keeps it.

import { BaseCloudflare } from "cloudflare/client";
import { APIConnectionError, APIError } from "cloudflare/error";
import { BaseTokens as AccountTokens } from "cloudflare/resources/accounts/tokens/tokens";
import { BaseTokens as UserTokens } from "cloudflare/resources/user/tokens/tokens";
import { BaseApplications } from "cloudflare/resources/zero-trust/access/applications/applications";
import { BaseZones } from "cloudflare/resources/zones/zones";

const RATE_LIMITED_STATUS = 429;
const WHOLE_SECONDS = /^\d+$/;
const ZONE_PLANS: ReadonlySet<string> = new Set(["free", "pro", "business", "enterprise"]);

/** Where to send a call and the key that authorises it. `baseUrl` and `fetch` are absent outside tests. */
export interface Connection {
  readonly key: string;
  readonly baseUrl?: string | undefined;
  readonly fetch?: ((input: string | URL | Request, init?: RequestInit) => Promise<Response>) | undefined;
}

/** One entry of the `errors` list in Cloudflare's reply. */
interface ApiRefusal {
  readonly code: number;
  readonly message: string;
}

/** A call that did not succeed. `refused` is Cloudflare's own answer; `network` means no answer arrived. */
export type CloudflareFailure =
  | { readonly ok: false; readonly failure: "refused"; readonly status: number; readonly errors: readonly ApiRefusal[] }
  | { readonly ok: false; readonly failure: "rate-limited"; readonly retryAfterSeconds: number | undefined }
  | { readonly ok: false; readonly failure: "network"; readonly message: string };

/** The `result` of Cloudflare's reply, or why there is none. */
export type CloudflareResult<Value> = { readonly ok: true; readonly value: Value } | CloudflareFailure;

/** The plan a zone is on; an unknown plan reads as `free`, the one with the tightest limits. */
export type ZonePlan = "free" | "pro" | "business" | "enterprise";

/** A zone the key can change, in the account it was asked about. */
export interface Zone {
  readonly id: string;
  readonly name: string;
  readonly plan: ZonePlan;
}

/** Whether a key may set up this account. `no-account-access` covers a key from another account and one without the Access permission. */
export type KeyCheck = { readonly ok: true } | { readonly ok: false; readonly failure: "inactive-key" | "no-account-access" } | CloudflareFailure;

function isRefusal(entry: unknown): entry is ApiRefusal {
  if (typeof entry !== "object" || entry === null) return false;

  return "code" in entry && typeof entry.code === "number" && "message" in entry && typeof entry.message === "string";
}

function retryAfterSeconds(headers: Headers | undefined): number | undefined {
  const hint = headers?.get("retry-after") ?? "";
  if (!WHOLE_SECONDS.test(hint)) return undefined;

  return Number(hint);
}

function failureOf(error: APIError): CloudflareFailure {
  if (error instanceof APIConnectionError || error.status === undefined) return { ok: false, failure: "network", message: error.message };

  if (error.status === RATE_LIMITED_STATUS) return { ok: false, failure: "rate-limited", retryAfterSeconds: retryAfterSeconds(error.headers) };

  const errors: unknown = error.errors;
  const refusals = Array.isArray(errors) ? errors.filter(isRefusal) : [];

  return { ok: false, failure: "refused", status: error.status, errors: refusals.map(({ code, message }) => ({ code, message })) };
}

// Cloudflare names a plan by its tier and a noun, as in "Pro Website".
function planOf(name: string | undefined): ZonePlan {
  const tier = name?.split(" ")[0]?.toLowerCase() ?? "";
  if (!ZONE_PLANS.has(tier)) return "free";

  return tier as ZonePlan;
}

/**
 * Make one call to the Cloudflare API with the key the caller holds.
 *
 * @param call - builds an SDK resource on the given client and awaits one request
 * @returns the reply's `result`, or the failure; a refusal by Cloudflare is a value, never an exception, and nothing is retried
 */
export async function callCloudflare<Value>(connection: Connection, call: (api: BaseCloudflare) => Promise<Value>): Promise<CloudflareResult<Value>> {
  const api = new BaseCloudflare({ apiToken: connection.key, baseURL: connection.baseUrl, fetch: connection.fetch, maxRetries: 0, logLevel: "off" });

  try {
    return { ok: true, value: await call(api) };
  } catch (error) {
    if (error instanceof APIError) return failureOf(error);

    throw error;
  }
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

  return { ok: true, value: owned.map((zone) => ({ id: zone.id, name: zone.name, plan: planOf(zone.plan?.name) })) };
}

/**
 * Decide whether a key may set up the account the Worker runs in.
 *
 * @param accountId - the Worker's own account, never one the key's holder names
 * @returns `ok` only for an active key that can read that account's Access applications
 */
export async function verifyKey(connection: Connection, accountId: string): Promise<KeyCheck> {
  let token = await callCloudflare(connection, (api) => new AccountTokens(api).verify({ account_id: accountId }));

  // A key a person owns is unknown to the account's own endpoint and verifies on the user's.
  if (!token.ok && token.failure === "refused") token = await callCloudflare(connection, (api) => new UserTokens(api).verify());

  if (!token.ok) return token;

  if (token.value.status !== "active") return { ok: false, failure: "inactive-key" };

  const probe = await callCloudflare(connection, (api) => new BaseApplications(api).list({ account_id: accountId, per_page: 1 }));
  if (probe.ok) return { ok: true };

  if (probe.failure === "refused") return { ok: false, failure: "no-account-access" };

  return probe;
}
