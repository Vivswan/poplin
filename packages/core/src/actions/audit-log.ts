// The audit log, read by an admin.

import * as v from "valibot";

import type { Actor } from "../auth/scopes";
import { AUDIT_KINDS, type AuditEntry, actionsOf } from "../records/audit";
import { POSITIVE } from "../records/fields";
import { type Install, type Refused, refuse } from "./records";

/** The most entries one page holds, and how many a page holds when no limit is asked. */
const MAX_PAGE = 100;

/** The most characters a site's name holds: a longer text is in no name. */
const MAX_NAME = 40;

/** How far back a count of the log reads: a log of more entries is counted as this many and more. */
const MOST_COUNTED = 10_000;

/** What a reading of the log may ask for. */
export const AUDIT_QUERY = v.strictObject({
  limit: v.optional(v.pipe(POSITIVE, v.maxValue(MAX_PAGE)), MAX_PAGE),
  after: v.optional(POSITIVE),
  dir: v.optional(v.picklist(["desc", "asc"]), "desc"),
  kind: v.optional(v.picklist(AUDIT_KINDS)),
  site: v.optional(v.pipe(v.string(), v.minLength(1), v.maxLength(MAX_NAME))),
});

/** What a count of the log may ask for: the narrowing of a reading. */
export const AUDIT_COUNT_QUERY = v.strictObject({ kind: AUDIT_QUERY.entries.kind, site: AUDIT_QUERY.entries.site });

/**
 * Read one page of the audit log, the newest entry first, or the oldest first when asked.
 *
 * `after` is the `seq` of the last entry of the page before, in either direction: an opaque cursor taken from that entry, never a count.
 *
 * @param query - `limit` is 1 to 100; `dir` is `desc`, the newest first, unless `asc` is asked; `kind` keeps the entries of that kind, and `site` those about a site whose name then held that text
 * @returns the entries, `not_allowed` for anyone but an admin, or `bad_argument` naming the key that was refused
 */
export async function listAudit(
  install: Install,
  actor: Actor,
  query: v.InferInput<typeof AUDIT_QUERY> = {},
): Promise<{ readonly ok: true; readonly entries: readonly AuditEntry[] } | Refused<"not_allowed" | "bad_argument">> {
  if (actor.scope !== "admin") return refuse("not_allowed");

  const asked = v.safeParse(AUDIT_QUERY, query);
  if (!asked.success) return refuse("bad_argument", v.getDotPath(asked.issues[0]) ?? "query");

  const { limit, after, dir, kind, site } = asked.output;
  const actions = kind === undefined ? undefined : actionsOf(kind);

  return { ok: true, entries: await install.database.listAudit({ limit, after, dir, actions, site }) };
}

/**
 * Count the entries of the audit log, or those a narrowing keeps, reading at most the newest 10,000 entries.
 *
 * @param query - `kind` and `site` narrow the count as they narrow a reading
 * @returns `count`, exact when `whole` and otherwise the least it can be, since the log holds as many entries as were read, or more; `not_allowed` for anyone but an admin, or `bad_argument` naming the key that was refused
 */
export async function countAudit(
  install: Install,
  actor: Actor,
  query: v.InferInput<typeof AUDIT_COUNT_QUERY> = {},
): Promise<{ readonly ok: true; readonly count: number; readonly whole: boolean } | Refused<"not_allowed" | "bad_argument">> {
  if (actor.scope !== "admin") return refuse("not_allowed");

  const asked = v.safeParse(AUDIT_COUNT_QUERY, query);
  if (!asked.success) return refuse("bad_argument", v.getDotPath(asked.issues[0]) ?? "query");

  const { kind, site } = asked.output;
  const actions = kind === undefined ? undefined : actionsOf(kind);

  return { ok: true, ...(await install.database.countAudit({ most: MOST_COUNTED, actions, site })) };
}
