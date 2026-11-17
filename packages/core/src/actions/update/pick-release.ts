// Which published release an update takes, from what the project's website names and the version that runs.
//
//   asked for            the release is                                    answer
//   the newest           none published, or none above the running one     no_update
//   the running version                                                    no_update: there is nothing to do
//   one below the running one, other than the version before               no_update: going back reaches the version before alone
//   one version          not published                                     no_digest
//   one, by itself       not above the running one                         no_update
//   any, by itself       one whose schema differs from this install's own  database: a person starts it
//   the version before, with another schema                                database: the code of that release cannot read this database
//   all of the above passed                                                the release, and whether it changes the database
//
// Nothing is fetched here.

import gt from "semver/functions/gt";
import lt from "semver/functions/lt";

import { newestPinned, type ReleasePins } from "../../records/release";
import { isPlainVersion } from "../../records/update";
import { changesDatabase } from "./update";

/** What is asked for in place of one version: the newest release that is published. */
export const NEWEST = "latest";

/** The release an update is asked to take. */
export interface WantedRelease {
  /** One version, such as `0.2.0`, or `NEWEST`. */
  readonly version: string;

  /** Whether the install takes it by itself, with nobody asking. */
  readonly automatic: boolean;

  /** The version the install ran before its last update: the one version below the running one that is taken. Left out where there is no way back. */
  readonly back?: string | undefined;
}

/** One release as the website publishes it. */
type Pin = ReleasePins[string];

/** The release to take, or why none is; the table at the top of this file says when. */
type Picked = { readonly ok: true; readonly version: string; readonly pin: Pin; readonly database: boolean } | { readonly ok: false; readonly refusal: "no_update" | "no_digest" | "database" };

/** The version asked for, or the newest one above the running version. */
function versionOf(pins: ReleasePins, wanted: WantedRelease, running: string): string | undefined {
  if (wanted.version !== NEWEST) return wanted.version;

  const newest = newestPinned(pins);

  return newest !== undefined && gt(newest, running) ? newest : undefined;
}

/**
 * Pick the release an update takes.
 *
 * @param running - the version the install runs; one that is no released version, such as a build of a branch, takes none
 * @returns the release with what the website publishes of it, or the refusal the table above names
 */
export function pickRelease(pins: ReleasePins, wanted: WantedRelease, running: string): Picked {
  if (!isPlainVersion(running)) return { ok: false, refusal: "no_update" };

  const version = versionOf(pins, wanted, running);
  if (version === undefined) return { ok: false, refusal: "no_update" };

  if (isPlainVersion(version) && !gt(version, running) && version !== wanted.back) return { ok: false, refusal: "no_update" };

  const pin = Object.hasOwn(pins, version) ? pins[version] : undefined;
  if (pin === undefined) return { ok: false, refusal: "no_digest" };

  if (wanted.automatic && !gt(version, running)) return { ok: false, refusal: "no_update" };

  const database = changesDatabase(pin);
  if (database && (wanted.automatic || lt(version, running))) return { ok: false, refusal: "database" };

  return { ok: true, version, pin, database };
}
