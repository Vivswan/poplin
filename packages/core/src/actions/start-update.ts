// Start an update, in one of two ways. A host that can replace the install's own code takes the release by itself; any other gets one request to the saved address, which the provider answers by building the install again.
// Only an admin starts one: anyone else is answered `not_allowed`. By itself:
//
//   a start in this minute already                 too_many_requests       nothing is fetched
//   no release above the running version is out    no_update               nothing is changed
//   the host holds no key, or its key is refused   no_key, key_refused, or lacks_right about the right
//   the release cannot be taken                    release_refused, about why
//   every file fetched and checked                 one `update_started` audit entry, then the files are put in place
//   the host refuses the new code                  version_refused: the install runs the code it ran before
//   the host does not answer                       update_unreachable, about `host`
//
// The audit entry is written before the files are put in place: the request after that one runs the new code, so nothing is left for the old code to write.
// The releases are read fresh on every start, so `anyway` asks for nothing here. A second start in a later minute finds the new version running, and answers `no_update`.
// At the saved address:
//
//   no address saved, or one no longer taken     no_update_address       nothing is sent
//   no newer version known, and not `anyway`     no_update               nothing is sent
//   a start in this minute already               too_many_requests       nothing is sent
//   the request fails, or takes too long         update_unreachable
//   any answer but a 2xx, a redirect included    update_refused, about its status
//   a 2xx                                        started, and one `update_started` audit entry, which says `automatic` for a start nobody asked for
//
// A start that fails or is refused, in either way, is noted as the problem `update_failed`.
// The request is a POST with no body and no header of the install's. No redirect is followed, so nothing is ever sent to a host the provider did not accept.

import * as v from "valibot";

import type { Actor } from "../auth/scopes";
import { AllowanceSpent } from "../database/driver";
import { rebuildAddress } from "../records/update";
import { NEWEST, type WantedRelease } from "./pick-release";
import { noteProblem } from "./problems";
import { type Install, type Refused, refuse } from "./records";
import { updateOf } from "./update";

/** How long the provider has to answer, in milliseconds. */
const PATIENCE_MS = 10_000;

/** The most starts the whole install takes a minute, whoever asks. */
const STARTS_PER_MINUTE = 1;

/** What the count of starts is kept under. */
const COUNT_KEY = "start_update";

/** What is noted of a request that got no answer. The failure itself may quote the address, so nothing of it is kept. */
const NO_ANSWER = "the request for a rebuild got no answer";

/** What a request to start an update may ask for. */
export const START_OPTIONS = v.strictObject({ anyway: v.optional(v.boolean()) });

/** What a start answers: a rebuild the provider took, the version the install runs, and the newer one it knows of. */
export const STARTED_UPDATE = v.object({ started: v.literal(true), from: v.string(), to: v.nullable(v.string()) });

/** Whether a start fit into its minute. */
type Taken = { readonly ok: true } | { readonly ok: false; readonly retryAfterSeconds: number };

/** Why an update the install takes by itself did not go in. `about` is the right on `lacks_right`, why on `release_refused` and `version_refused`, and `host` on `update_unreachable`. No refusal holds the host's key. */
type NotTaken = Refused<"no_update" | "no_key" | "key_refused" | "lacks_right" | "release_refused" | "version_refused" | "update_unreachable">;

/** A release whose built files were fetched and checked against what the project published. */
interface ReadyUpdate {
  /** Every file passed. */
  readonly ok: true;

  /** The version the files are of. */
  readonly version: string;

  /** Puts the files in place of the running code, whole or not at all. `unset` names a part beside the code that the host did not take, such as its schedule. */
  readonly put: () => Promise<{ readonly ok: true; readonly unset?: string } | NotTaken>;
}

/** What replaces the install's own code with a release, on a host that can. */
export interface SelfUpdate {
  /** Fetches the built files of a release and checks them. Nothing of the install is changed. */
  readonly ready: (wanted: WantedRelease) => Promise<ReadyUpdate | NotTaken>;
}

/** What starting a rebuild needs from the host the install runs on. */
export interface Rebuilding {
  /** What takes a release by itself; absent on a host that cannot, where a start goes to the saved address. */
  readonly self?: SelfUpdate | undefined;

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

  /** Whether the install starts it by itself, with nobody asking. */
  readonly automatic?: true;

  /** The one version to take, for an install that takes a release by itself; the newest when left out. */
  readonly to?: string;
}

/** A rebuild the provider took: the version the install runs, and the newer one it knows of, `null` for a rebuild asked for with none known. */
type Started = { readonly ok: true } & Readonly<v.InferOutput<typeof STARTED_UPDATE>>;

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

/** Note why an update the install takes by itself did not go in, and answer it. Nothing newer being out is no problem. */
async function notTaken(install: Pick<Install, "database" | "now">, refused: NotTaken): Promise<NotTaken> {
  if (refused.code !== "no_update") await noteProblem(install, "update_failed", `the update was refused: ${refused.code}${refused.about === undefined ? "" : `, ${refused.about}`}`);

  return refused;
}

/** Take a release by itself: count the start, have the files fetched and checked, write the audit entry, then have them put in place. */
async function takeUpdate(
  install: Pick<Install, "database" | "now">,
  actor: Actor,
  asked: Asked,
  rebuilding: Rebuilding & { readonly self: SelfUpdate },
): Promise<Started | NotTaken | Refused<"too_many_requests">> {
  const taken = await takeStart(rebuilding, install.now());
  if (!taken.ok) return refuse("too_many_requests", "update");

  const ready = await rebuilding.self.ready({ version: asked.to ?? NEWEST, automatic: asked.automatic === true });
  if (!ready.ok) return notTaken(install, ready);

  const detail = asked.automatic === true ? { from: asked.version, to: ready.version, automatic: true } : { from: asked.version, to: ready.version };
  await install.database.appendAudit({ action: "update_started", detail }, { by: actor.holder, at: install.now() });

  const put = await ready.put();
  if (!put.ok) return notTaken(install, put);

  if (put.unset !== undefined) await noteProblem(install, "update_failed", `the update is in, and its ${put.unset} could not be set`);

  return { ok: true, started: true, from: asked.version, to: ready.version };
}

/**
 * Start an update of the install, for an admin. At most one start a minute is sent, all callers together, and a start that the provider refused counts as that one.
 *
 * @param asked - the running version, `anyway` to rebuild while no newer version is known, and `automatic` for a start the install makes by itself
 * @param rebuilding - with `self`, the install takes the release by itself and the saved address is not read
 * @returns `started`, which on an install that took the release by itself says the files are in place; or the refusal the tables above name. No answer holds the address or the host's key
 * @throws {Error} the database failed; a request that was sent stays sent
 */
export async function startUpdate(
  install: Pick<Install, "database" | "now">,
  actor: Actor,
  asked: Asked,
  rebuilding: Rebuilding,
): Promise<Started | NotTaken | Refused<"not_allowed" | "no_update_address" | "no_update" | "too_many_requests" | "update_unreachable" | "update_refused">> {
  if (actor.scope !== "admin") return refuse("not_allowed");

  const { self } = rebuilding;
  if (self !== undefined) return takeUpdate(install, actor, asked, { ...rebuilding, self });

  const kept = await install.database.readUpdateAddress();
  const address = kept === undefined ? undefined : rebuildAddress(kept.address, rebuilding.accepts);
  if (address === undefined) return refuse("no_update_address");

  const update = await updateOf(install, asked.version);
  if (update === undefined && asked.anyway !== true) return refuse("no_update");

  const taken = await takeStart(rebuilding, install.now());
  if (!taken.ok) return refuse("too_many_requests", "update");

  const status = await askProvider(address, rebuilding);
  if (status === undefined || status < 200 || status > 299) {
    await noteProblem(install, "update_failed", status === undefined ? NO_ANSWER : `the request for a rebuild was answered ${status}`);

    return status === undefined ? refuse("update_unreachable") : refuse("update_refused", String(status));
  }

  const to = update?.newest ?? null;
  const detail = asked.automatic === true ? { from: asked.version, to, automatic: true } : { from: asked.version, to };
  await install.database.appendAudit({ action: "update_started", detail }, { by: actor.holder, at: install.now() });

  return { ok: true, started: true, from: asked.version, to };
}
