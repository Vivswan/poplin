// The audit log, read by an admin.

import * as v from "valibot";

import type { Actor } from "../auth/scopes";
import type { AuditEntry } from "../records/audit";
import { POSITIVE } from "../records/fields";
import { type Install, type Refused, refuse } from "./records";

/** The most entries one page holds, and how many a page holds when no limit is asked. */
const MAX_PAGE = 100;

/** What a reading of the log may ask for. */
export const AUDIT_QUERY = v.strictObject({
  limit: v.optional(v.pipe(POSITIVE, v.maxValue(MAX_PAGE)), MAX_PAGE),
  before: v.optional(POSITIVE),
});

/**
 * Read the newest audit entries, the newest first.
 *
 * @param query - `limit` is 1 to 100; `before` is the `seq` of the last entry of the page before
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

  return { ok: true, entries: await install.database.listAudit(asked.output) };
}
