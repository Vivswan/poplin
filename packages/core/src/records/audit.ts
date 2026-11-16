// An entry of the audit log: what was done, by whom, when, and to which site. Entries are added at the newest end and leave at the oldest, once they are past the days kept.

import * as v from "valibot";

import type { SiteName } from "../names/names";
import type { SiteId } from "../sites/ids";
import { HOLDER, type Holder, MOMENT, POSITIVE, SITE_ID, SITE_NAME } from "./fields";

/** How long an entry of the log, and a token that ended, are kept before the sweep removes them, in milliseconds: 90 days. */
export const HISTORY_KEPT_MS = 90 * 86_400_000;

/** Every action the log names, each written with the change it tells of. `login` stands alone; the three after it go with a computer's login and a domain sync, and the last three with the address that starts a rebuild. */
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
  "duplicate",
  "token_added",
  "token_revoked",
  "settings_set",
  "settings_changed",
  "signed_everyone_out",
  "login",
  "domain_synced",
  "login_allowed",
  "login_denied",
  "update_address_set",
  "update_address_removed",
  "update_started",
] as const;

/** The kind each action is of: what was done to a site, who or what was let in or put out, and what was set for the whole install. A key missing here does not compile. */
const KIND_OF = {
  create: "sites",
  publish: "sites",
  live_version: "sites",
  access: "sites",
  details: "sites",
  new_id: "sites",
  trash: "sites",
  restore: "sites",
  delete: "sites",
  imported: "sites",
  duplicate: "sites",
  token_added: "access",
  token_revoked: "access",
  settings_set: "settings",
  settings_changed: "settings",
  signed_everyone_out: "access",
  login: "access",
  domain_synced: "settings",
  login_allowed: "access",
  login_denied: "access",
  update_address_set: "settings",
  update_address_removed: "settings",
  update_started: "settings",
} as const satisfies Readonly<Record<(typeof AUDIT_ACTIONS)[number], string>>;

/** The kinds a reading of the log can be narrowed to. */
export const AUDIT_KINDS = ["sites", "access", "settings"] as const satisfies readonly (typeof KIND_OF)[AuditAction][];

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

/** One of the kinds the actions of the log are of. */
export type AuditKind = (typeof AUDIT_KINDS)[number];

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

/**
 * The actions of one kind.
 *
 * @returns every action the log names under that kind, in the order the log lists its actions
 */
export function actionsOf(kind: AuditKind): readonly AuditAction[] {
  return AUDIT_ACTIONS.filter((action) => KIND_OF[action] === kind);
}
