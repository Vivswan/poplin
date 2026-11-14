// An entry of the audit log: what was done, by whom, when, and to which site. Entries are only ever added.

import * as v from "valibot";

import type { SiteName } from "../names/names";
import type { SiteId } from "../sites/ids";
import { HOLDER, type Holder, MOMENT, POSITIVE, SITE_ID, SITE_NAME } from "./fields";

/** Every action the log names. The first rows are written with a change to a site, a token, the settings, or the signing key; `login` stands alone. */
const AUDIT_ACTIONS = [
  "create",
  "publish",
  "live_version",
  "access",
  "details",
  "new_id",
  "trash",
  "restore",
  "delete",
  "imported",
  "token_added",
  "token_revoked",
  "settings_set",
  "settings_changed",
  "signed-everyone-out",
  "login",
] as const;

/** A row of the audit table. `detail` is a JSON object as text. */
const AUDIT_ROW = v.object({
  seq: POSITIVE,
  at: MOMENT,
  actor: HOLDER,
  action: v.picklist(AUDIT_ACTIONS),
  site_id: v.nullable(SITE_ID),
  site_name: v.nullable(SITE_NAME),
  detail: v.pipe(v.string(), v.parseJson(), v.record(v.string(), v.unknown())),
});

/** One of the actions the audit log names. */
export type AuditAction = (typeof AUDIT_ACTIONS)[number];

/**
 * One entry of the audit log.
 *
 * `seq` is an opaque cursor: an entry written later has a greater one, and nothing else is promised of it, neither where it starts nor that none is skipped.
 *
 * `site` is the site the action touched, by the id and name it had then, or `null` for an action on no site.
 *
 * `detail` holds what the action set, such as the new access or the token's note.
 */
export interface AuditEntry {
  readonly seq: number;
  readonly at: number;
  readonly by: Holder;
  readonly action: AuditAction;
  readonly site: { readonly id: SiteId; readonly name: SiteName } | null;
  readonly detail: Readonly<Record<string, unknown>>;
}

/**
 * Turn a row of the audit table into an entry.
 *
 * @throws {Error} the row is no audit entry
 */
export function auditFromRow(row: unknown): AuditEntry {
  const parsed = v.safeParse(AUDIT_ROW, row);
  if (!parsed.success) throw new Error(`a stored audit entry is not one: ${v.summarize(parsed.issues)}`);

  const { seq, at, actor, action, site_id: id, site_name: name, detail } = parsed.output;
  const site = id === null || name === null ? null : { id, name };

  return { seq, at, by: actor, action, site, detail };
}
