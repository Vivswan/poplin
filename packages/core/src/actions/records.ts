// What every action is given, and the one form every refusal takes.

import type { Database } from "../database/database";
import type { PublicName } from "../names/names";
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

  /** The address a site answers at under its label, or a public site under its public name. */
  readonly addressOf: (label: SiteLabel | PublicName) => string;

  /** The public names the address layout keeps for itself: no site may hold one. */
  readonly reservedNames: ReadonlySet<string>;
}

/** An action that was not done: nothing was changed and no audit entry was written. `about` names the argument, limit, or path the code is about. */
export interface Refused<Code extends string> {
  readonly ok: false;
  readonly code: Code;
  readonly about?: string;
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
