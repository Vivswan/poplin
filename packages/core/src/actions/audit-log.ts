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

/** What a reading of the log may ask for. */
export const AUDIT_QUERY = v.strictObject({
  limit: v.optional(v.pipe(POSITIVE, v.maxValue(MAX_PAGE)), MAX_PAGE),
  before: v.optional(POSITIVE),
  kind: v.optional(v.picklist(AUDIT_KINDS)),
  site: v.optional(v.pipe(v.string(), v.minLength(1), v.maxLength(MAX_NAME))),
});

/**
 * Read the newest audit entries, the newest first.
 *
 * @param query - `limit` is 1 to 100; `before` is the `seq` of the last entry of the page before, an opaque cursor taken from that entry and never a count; `kind` keeps the entries of that kind, and `site` those about a site whose name then held that text
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

  const { limit, before, kind, site } = asked.output;
  const actions = kind === undefined ? undefined : actionsOf(kind);

  return { ok: true, entries: await install.database.listAudit({ limit, before, actions, site }) };
}
