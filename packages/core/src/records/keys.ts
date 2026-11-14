// Where every record lives in the bucket. This is the one place a record's key is built.
// A key holds only what never changes about a record, its kind and its own id; access, state, versions, and the shape are fields.

import type { TokenId } from "../auth/tokens";
import type { SiteName } from "../names/names";
import { type ObjectKey, parseObjectKey } from "../storage/storage";

/** The listing prefix of each record kind. Each starts with a dot, which no site name can, so a record never meets a site's files. */
export const RECORD_PREFIXES = { settings: ".settings", site: ".sites/", token: ".tokens/" } as const;

function recordKey(raw: string): ObjectKey {
  const checked = parseObjectKey(raw);
  if (!checked.ok) throw new Error(`"${raw}" is not an object key: ${checked.refusal}`);

  return checked.key;
}

/** The key of the install's one settings record. */
export function settingsKey(): ObjectKey {
  return recordKey(RECORD_PREFIXES.settings);
}

/** The key of a site's record. A site is never renamed, so the key never changes. */
export function siteKey(name: SiteName): ObjectKey {
  return recordKey(`${RECORD_PREFIXES.site}${name}`);
}

/** The key of a token's record. */
export function tokenKey(id: TokenId): ObjectKey {
  return recordKey(`${RECORD_PREFIXES.token}${id}`);
}
