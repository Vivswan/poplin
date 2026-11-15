// The notice of a newer release: what the install last learned from the project's website, set beside the version it runs.

import { PLAIN_VERSION } from "../records/update";
import type { SettingValues } from "../records/settings";
import type { Install } from "./records";

/** A release newer than the running version. */
export interface Update {
  /** The version the install runs. */
  readonly current: string;

  /** The newest released version. */
  readonly newest: string;

  /** The UTC date the newest version came out, such as `2026-12-01`. */
  readonly released: string;

  /** The address of its release notes. */
  readonly notes: string;

  /** Whether updating to it changes the database, which no older poplin can read afterwards. */
  readonly database: boolean;
}

/** The three numbers of a version such as `0.2.0`; none for a version of any other form. */
function numbersOf(version: string): readonly number[] | undefined {
  const [, ...digits] = PLAIN_VERSION.exec(version) ?? [];

  return digits.length === 0 ? undefined : digits.map(Number);
}

/** Whether `newest` is a later version than `current`. Two versions that cannot be compared are not. */
function isNewer(newest: string, current: string): boolean {
  const [ahead, behind] = [numbersOf(newest), numbersOf(current)];
  if (ahead === undefined || behind === undefined) return false;

  const at = ahead.findIndex((number, place) => number !== behind[place]);

  return at !== -1 && (ahead[at] ?? 0) > (behind[at] ?? 0);
}

/**
 * Say whether a newer poplin than the running one is out, from what the install last learned. Nothing is fetched: it reads the database, twice at most.
 *
 * @param current - the version the install runs
 * @param known - the settings, from a caller that has read them already; read here when left out
 * @returns the newer release, or `undefined` when none is known, the newest known is not strictly newer, either version is not of the form `1.2.3`, or `update_check` is off
 */
export async function updateOf(install: Pick<Install, "database">, current: string, known?: Pick<SettingValues, "update_check">): Promise<Update | undefined> {
  const settings = known ?? (await install.database.readSettings());
  if (settings?.update_check !== true) return undefined;

  const check = await install.database.readUpdateCheck();
  if (check === undefined || check.news === null) return undefined;

  const { version, released, notes, database } = check.news;
  if (!isNewer(version, current)) return undefined;

  return { current, newest: version, released, notes, database };
}
