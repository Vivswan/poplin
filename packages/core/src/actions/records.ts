// What every action is given, and the one form every refusal takes.

import type { Database } from "../database/database";
import type { PublicName, ReservedNames } from "../names/names";
import type { SettingValues } from "../records/settings";
import type { Site } from "../records/site";
import type { SiteLabel } from "../sites/labels";
import type { ObjectStore } from "../storage/storage";

/** One poplin: where its records and files are kept, its clock, and how it spells its addresses. */
export interface Install {
  /** The stored sites, tokens, settings, and audit log. */
  readonly database: Database;

  /** The bucket that holds every site's files. */
  readonly store: ObjectStore;

  /** The clock, in milliseconds since the epoch. */
  readonly now: () => number;

  /** The address a site answers at under its label: it carries the letter of the access given. */
  readonly addressOf: (label: SiteLabel, access: Site["access"]) => string;

  /** The address a public site answers at under its public name. */
  readonly publicAddressOf: (name: PublicName) => string;

  /** The public names the address layout keeps for itself: no site may hold one. */
  readonly reservedNames: ReservedNames;

  /** The settings one request read on its way in, given only to a request that changes nothing: its actions take them as read. Absent, an action reads the database. */
  readonly knownSettings?: SettingValues;
}

/** An action that was not done: nothing was changed and no audit entry was written. `about` names the argument, limit, or path the code is about. */
export interface Refused<Code extends string> {
  readonly ok: false;
  readonly code: Code;
  readonly about?: string;
}

/**
 * Read the install's settings: the ones its request already read, or else the stored ones.
 *
 * @returns the settings, or `undefined` before setup stored them
 */
export async function settingsOf(install: Pick<Install, "database" | "knownSettings">): Promise<SettingValues | undefined> {
  return install.knownSettings ?? (await install.database.readSettings());
}

/**
 * Build a refusal.
 *
 * @param about - the argument, the limit, or the path the code is about
 */
export function refuse<Code extends string>(code: Code, about?: string): Refused<Code> {
  if (about === undefined) return { ok: false, code };

  return { ok: false, code, about };
}
