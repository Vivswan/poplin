// Start an update: one request to the saved address, which the install's provider answers by building the install again. The build fetches the newest release.
//
//   not an admin                                 not_allowed
//   no address saved, or one no longer taken     no_update_address       nothing is sent
//   no newer version known, and not `anyway`     no_update               nothing is sent
//   a start in this minute already               too_many_requests       nothing is sent
//   the request fails, or takes too long         update_unreachable
//   any answer but a 2xx, a redirect included    update_refused, about its status
//   a 2xx                                        started, and one `update_started` audit entry
//
// The request is a POST with no body and no header of the install's. No redirect is followed, so nothing is ever sent to a host the provider did not accept.

import * as v from "valibot";

import type { Actor } from "../auth/scopes";
import { AllowanceSpent } from "../database/driver";
import { rebuildAddress } from "../records/update";
import { type Install, type Refused, refuse } from "./records";
import { updateOf } from "./update";

/** How long the provider has to answer, in milliseconds. */
const PATIENCE_MS = 10_000;

/** The most starts the whole install takes a minute, whoever asks. */
const STARTS_PER_MINUTE = 1;

/** What the count of starts is kept under. */
const COUNT_KEY = "start_update";

/** What a request to start an update may ask for. */
export const START_OPTIONS = v.strictObject({ anyway: v.optional(v.boolean()) });

/** Whether a start fit into its minute. */
type Taken = { readonly ok: true } | { readonly ok: false; readonly retryAfterSeconds: number };

/** What starting a rebuild needs from the host the install runs on. */
export interface Rebuilding {
  /** Whether the host's provider starts rebuilds at an address. It is asked when an address is saved and again before each request. */
  readonly accepts: (address: URL) => boolean;

  /** Sends the one request: the platform's own `fetch`, or a stand-in. */
  readonly fetch: (address: string, init: { readonly method: "POST"; readonly redirect: "manual"; readonly signal: AbortSignal }) => Promise<Response>;

  /** Where the starts of a minute are counted, all callers together. */
  readonly counters: { takeMinute(window: { readonly scope: "install"; readonly key: string; readonly limit: number }, now: number): Promise<Taken> };

  /** How long the provider has to answer, in milliseconds; ten seconds when left out. */
  readonly patienceMs?: number;
}

/** What starting is asked with. */
interface Asked extends v.InferOutput<typeof START_OPTIONS> {
  /** The version the install runs. */
  readonly version: string;
}

/** A rebuild the provider took: the version the install runs, and the newer one it knows of, `null` for a rebuild asked for with none known. */
interface Started {
  readonly ok: true;
  readonly started: true;
  readonly from: string;
  readonly to: string | null;
}

/** Count one start against the install's minute. A counter that cannot answer counts as a full minute. */
async function takeStart(rebuilding: Rebuilding, now: number): Promise<Taken> {
  try {
    return await rebuilding.counters.takeMinute({ scope: "install", key: COUNT_KEY, limit: STARTS_PER_MINUTE }, now);
  } catch (error) {
    // A database that is spent for the day is told as that, never as a full minute.
    if (error instanceof AllowanceSpent) throw error;

    return { ok: false, retryAfterSeconds: 60 };
  }
}

/** Send the one request. `undefined` is no answer in time, for whatever reason: the failure may quote the address, so nothing of it is kept. */
async function askProvider(address: string, rebuilding: Rebuilding): Promise<number | undefined> {
  try {
    const response = await rebuilding.fetch(address, { method: "POST", redirect: "manual", signal: AbortSignal.timeout(rebuilding.patienceMs ?? PATIENCE_MS) });
    // The answer is its status alone: a body that cannot be let go takes nothing back from it.
    await response.body?.cancel().catch(() => undefined);

    return response.status;
  } catch {
    return undefined;
  }
}

/**
 * Start an update of the install, for an admin. At most one start a minute is sent, all callers together, and a start that the provider refused counts as that one.
 *
 * @param asked - the running version, and `anyway` to rebuild while no newer version is known
 * @returns `started`, or the refusal the table above names; no answer holds the address
 * @throws {Error} the database failed; a request that was sent stays sent
 */
export async function startUpdate(
  install: Pick<Install, "database" | "now">,
  actor: Actor,
  asked: Asked,
  rebuilding: Rebuilding,
): Promise<Started | Refused<"not_allowed" | "no_update_address" | "no_update" | "too_many_requests" | "update_unreachable" | "update_refused">> {
  if (actor.scope !== "admin") return refuse("not_allowed");

  const kept = await install.database.readUpdateAddress();
  const address = kept === undefined ? undefined : rebuildAddress(kept.address, rebuilding.accepts);
  if (address === undefined) return refuse("no_update_address");

  const update = await updateOf(install, asked.version);
  if (update === undefined && asked.anyway !== true) return refuse("no_update");

  const taken = await takeStart(rebuilding, install.now());
  if (!taken.ok) return refuse("too_many_requests", "update");

  const status = await askProvider(address, rebuilding);
  if (status === undefined) return refuse("update_unreachable");

  if (status < 200 || status > 299) return refuse("update_refused", String(status));

  const to = update?.newest ?? null;
  await install.database.appendAudit({ action: "update_started", detail: { from: asked.version, to } }, { by: actor.holder, at: install.now() });

  return { ok: true, started: true, from: asked.version, to };
}
