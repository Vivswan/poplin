// Start an update: the host the install runs on takes a release by itself and puts it in place of the running code.
// Only an admin starts one: anyone else is answered `not_allowed`.
//
//   the host holds no key                          no_key                  nothing is asked of the host, counted, or noted
//   a start in this minute already                 too_many_requests       nothing is fetched
//   no release above the running version is out    no_update               nothing is changed
//   the host no longer takes its key               key_refused, or lacks_right about the right
//   the release cannot be taken                    release_refused, about why
//   every file fetched and checked                 one `update_started` audit entry, then the files are put in place
//   the host refuses the new code                  version_refused: the install runs the code it ran before
//   the host does not answer                       update_unreachable, about `host`
//
// The audit entry is written before the files are put in place: the request after that one runs the new code, so nothing is left for the old code to write.
// The releases are read fresh on every start. A second start in a later minute finds the new version running, and answers `no_update`.
// A start that names one version takes that one. A lower one is taken only when it is the version before the last update: going back is such a start, and `pickRelease` refuses every other lower version.
// A refused start is noted as the problem `update_failed`: the refusal's code is its name, and what the refusal is about is its message.

import * as v from "valibot";

import type { Actor } from "../auth/scopes";
import { AllowanceSpent } from "../database/driver";
import { type LastUpdate, UPDATE_NEWS } from "../records/update";
import { wayBack } from "./go-back";
import { NEWEST, type WantedRelease } from "./pick-release";
import { noteProblem } from "./problems";
import { type Install, type Refused, refuse } from "./records";

/** The most starts the whole install takes a minute, whoever asks. */
const STARTS_PER_MINUTE = 1;

/** What the count of starts is kept under. */
const COUNT_KEY = "start_update";

/** What a start answers: the files of a release are in place, the version the install ran, and the version of the release. */
export const STARTED_UPDATE = v.object({ started: v.literal(true), from: v.string(), to: v.string() });

/** What a start may name: one version to take, such as `0.2.0`, in place of the newest. A lower one than the install runs is a going back, and only the version before is taken. */
export const UPDATE_REQUEST = v.strictObject({ to: v.optional(UPDATE_NEWS.entries.version) });

/** Whether a start fit into its minute. */
type Taken = { readonly ok: true } | { readonly ok: false; readonly retryAfterSeconds: number };

/** Why an update did not go in. `about` is the right on `lacks_right`, why on `release_refused` and `version_refused`, and `host` on `update_unreachable`. No refusal holds the host's key. */
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

/** What replaces the install's own code with a release: the one way an install updates. */
export interface SelfUpdate {
  /** Whether the host holds the key an update is sent with. No call is made, and a host that holds none is asked for nothing more. */
  readonly holdsKey: () => boolean;

  /** Fetches the built files of a release and checks them. Nothing of the install is changed. */
  readonly ready: (wanted: WantedRelease) => Promise<ReadyUpdate | NotTaken>;

  /** The update the install last took by itself, as the host keeps it beside the code that update put in place; left out where it keeps none. */
  readonly last?: LastUpdate | undefined;
}

/** What updating needs from the host the install runs on. */
export interface Updating {
  /** What takes a release and puts it in place of the running code. */
  readonly self: SelfUpdate;

  /** Where the starts of a minute are counted, all callers together. */
  readonly counters: { takeMinute(window: { readonly scope: "install"; readonly key: string; readonly limit: number }, now: number): Promise<Taken> };
}

/** What starting is asked with. */
interface Asked {
  /** The version the install runs. */
  readonly version: string;

  /** Whether the install starts it by itself, with nobody asking. */
  readonly automatic?: true;

  /** The one version to take; the newest when left out. */
  readonly to?: string | undefined;
}

/** An update that is in place: the version the install ran, and the version of the release. */
type Started = { readonly ok: true } & Readonly<v.InferOutput<typeof STARTED_UPDATE>>;

/** Count one start against the install's minute. A counter that cannot answer counts as a full minute. */
async function takeStart(updating: Updating, now: number): Promise<Taken> {
  try {
    return await updating.counters.takeMinute({ scope: "install", key: COUNT_KEY, limit: STARTS_PER_MINUTE }, now);
  } catch (error) {
    // A database that is spent for the day is told as that, never as a full minute.
    if (error instanceof AllowanceSpent) throw error;

    return { ok: false, retryAfterSeconds: 60 };
  }
}

/** A refusal as a problem keeps it: its code as the name, and what it is about as the message. A problem keeps no message of digits alone, so a status is kept as `status 400`. */
function asFailure(refused: NotTaken): Error {
  const about = refused.about ?? "";
  const failure = new Error(/^\d+$/.test(about) ? `status ${about}` : about);
  failure.name = refused.code;

  return failure;
}

/** Note why an update did not go in, and answer it. Nothing newer being out is no problem. */
async function notTaken(install: Pick<Install, "database" | "now">, refused: NotTaken): Promise<NotTaken> {
  if (refused.code !== "no_update") await noteProblem(install, "update_failed", asFailure(refused));

  return refused;
}

/**
 * Start an update of the install, for an admin: count the start, have the files fetched and checked, write the audit entry, then have them put in place. At most one start a minute is taken, all callers together.
 *
 * @param asked - the running version, `automatic` for a start the install makes by itself, and `to` for one version in place of the newest
 * @returns `started` once the files are in place, or the refusal the table above names. No answer holds the host's key
 * @throws {Error} the database failed; files that were handed over stay handed over
 */
export async function startUpdate(install: Pick<Install, "database" | "now">, actor: Actor, asked: Asked, updating: Updating): Promise<Started | NotTaken | Refused<"not_allowed" | "too_many_requests">> {
  if (actor.scope !== "admin") return refuse("not_allowed");

  if (!updating.self.holdsKey()) return refuse("no_key");

  const taken = await takeStart(updating, install.now());
  if (!taken.ok) return refuse("too_many_requests", "update");

  const ready = await updating.self.ready({ version: asked.to ?? NEWEST, automatic: asked.automatic === true, back: wayBack(updating.self.last, asked.version)?.to });
  if (!ready.ok) return notTaken(install, ready);

  const detail = asked.automatic === true ? { from: asked.version, to: ready.version, automatic: true } : { from: asked.version, to: ready.version };
  await install.database.appendAudit({ action: "update_started", detail }, { by: actor.holder, at: install.now() });

  const put = await ready.put();
  if (!put.ok) return notTaken(install, put);

  if (put.unset !== undefined) await noteProblem(install, "update_failed", `the update is in, and its ${put.unset} could not be set`);

  return { ok: true, started: true, from: asked.version, to: ready.version };
}
