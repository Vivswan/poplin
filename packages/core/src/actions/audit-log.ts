// The audit log, read by an admin.

import * as v from "valibot";

import type { Actor } from "../auth/scopes";
import { AUDIT_WINDOW, type AuditFound, type AuditSearch } from "../database/database";
import { AUDIT_KINDS, type AuditEntry, actionsOf } from "../records/audit";
import { POSITIVE } from "../records/fields";
import { type Install, type Refused, refuse } from "./records";

/** The most entries one page holds, and how many a page holds when no limit is asked. */
const MAX_PAGE = 100;

/** The most entries one reading for the screen holds: its largest page, and the one entry more that says whether a page lies beyond. */
const MAX_SCREEN_PAGE = 201;

/** The most characters a site's name holds: a longer text is in no name. */
const MAX_NAME = 40;

/** How many entries one reading of the log for a file holds. */
export const AUDIT_FILE_PAGE = 1000;

/** The most entries one file of the log may be asked to hold. */
const MOST_FILE_ENTRIES = 10_000;

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

/** What a reading of the log for the screen may ask for: what any reading asks, with a page as large as the screen's largest. */
export const AUDIT_SCREEN_QUERY = v.strictObject({ ...AUDIT_QUERY.entries, limit: v.pipe(POSITIVE, v.maxValue(MAX_SCREEN_PAGE)) });

/** What a count of the log may ask for: the narrowing of a reading. */
export const AUDIT_COUNT_QUERY = v.strictObject({ kind: AUDIT_QUERY.entries.kind, site: AUDIT_QUERY.entries.site });

/** What a reading of the log for a file may ask for: the narrowing of a page, and the place the reading before ended. */
export const AUDIT_FILE_QUERY = v.strictObject({ kind: AUDIT_QUERY.entries.kind, site: AUDIT_QUERY.entries.site, after: AUDIT_QUERY.entries.after });

/** What a question about where a file of the log ends may ask: what the file's readings ask, and how many entries the file holds. */
export const AUDIT_FILE_END_QUERY = v.strictObject({ ...AUDIT_FILE_QUERY.entries, entries: v.pipe(POSITIVE, v.maxValue(MOST_FILE_ENTRIES)) });

/** What a reading asks once it is checked: how many entries, from where, in which direction, and the narrowing as the address names it. */
type Asked = Pick<AuditSearch, "limit" | "after" | "dir" | "site"> & { readonly kind?: (typeof AUDIT_KINDS)[number] | undefined };

/**
 * What a reading of the log answers.
 *
 * `stopped_at` is there only when a narrowed reading looked at its window of the log, found fewer entries than it was asked for, and the log goes on: it is the `after` of the reading that searches further.
 */
type Reading = { readonly ok: true; readonly entries: readonly AuditEntry[]; readonly stopped_at?: number };

/** Read entries of the log: any entry by a listing, and those a narrowing keeps by a search, which looks at no more than its window. */
async function found(install: Install, { kind, ...asked }: Asked): Promise<AuditFound> {
  if (kind === undefined && asked.site === undefined) return { entries: await install.database.listAudit(asked), stoppedAt: undefined };

  return install.database.searchAudit({ ...asked, actions: kind === undefined ? undefined : actionsOf(kind) });
}

/** What was read, as a reading answers it. */
async function reading(install: Install, asked: Asked): Promise<Reading> {
  const { entries, stoppedAt } = await found(install, asked);

  return { ok: true, entries, ...(stoppedAt === undefined ? {} : { stopped_at: stoppedAt }) };
}

/**
 * Read one page of the audit log, the newest entry first, or the oldest first when asked.
 *
 * `after` is the `seq` of the last entry of the page before, in either direction: an opaque cursor taken from that entry, never a count.
 *
 * @param query - `limit` is 1 to 100; `dir` is `desc`, the newest first, unless `asc` is asked; `kind` keeps the entries of that kind, and `site` those about a site the text finds, by the name it had then or by what it holds now
 * @returns the entries, and `stopped_at` when a narrowed reading stopped short with the log going on; `not_allowed` for anyone but an admin, or `bad_argument` naming the key that was refused
 */
export async function listAudit(install: Install, actor: Actor, query: v.InferInput<typeof AUDIT_QUERY> = {}): Promise<Reading | Refused<"not_allowed" | "bad_argument">> {
  if (actor.scope !== "admin") return refuse("not_allowed");

  const asked = v.safeParse(AUDIT_QUERY, query);
  if (!asked.success) return refuse("bad_argument", v.getDotPath(asked.issues[0]) ?? "query");

  return reading(install, asked.output);
}

/**
 * Read one page of the audit log for the screen: the reading of a page with room for the screen's largest, in one query. No route of the API hands it out.
 *
 * @param query - what `listAudit` takes, with a `limit` of 1 to 201
 * @returns what `listAudit` answers
 */
export async function listAuditForScreen(install: Install, actor: Actor, query: v.InferInput<typeof AUDIT_SCREEN_QUERY>): Promise<Reading | Refused<"not_allowed" | "bad_argument">> {
  if (actor.scope !== "admin") return refuse("not_allowed");

  const asked = v.safeParse(AUDIT_SCREEN_QUERY, query);
  if (!asked.success) return refuse("bad_argument", v.getDotPath(asked.issues[0]) ?? "query");

  return reading(install, asked.output);
}

/**
 * Count the entries of the audit log among its newest 10,000, or those a narrowing keeps among its newest 5,000: as far as one narrowed reading looks.
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
  const most = kind === undefined && site === undefined ? MOST_COUNTED : AUDIT_WINDOW;

  return { ok: true, ...(await install.database.countAudit({ most, actions, site })) };
}

/**
 * Read the next entries of the audit log for a file of it, the newest first, 1,000 a reading: ten times what a page of a listing holds, so a long file takes few readings.
 *
 * It is the reading of a page with a larger page, and no route of the API hands it out.
 *
 * @param query - `kind` and `site` narrow the entries as they narrow a page; `after` is the `seq` of the last entry of the reading before
 * @returns up to 1,000 entries: fewer when the log ends with them, or when a narrowed reading stopped short, which `stopped_at` says; `not_allowed` for anyone but an admin, or `bad_argument` naming the key that was refused
 */
export async function listAuditForFile(install: Install, actor: Actor, query: v.InferInput<typeof AUDIT_FILE_QUERY> = {}): Promise<Reading | Refused<"not_allowed" | "bad_argument">> {
  if (actor.scope !== "admin") return refuse("not_allowed");

  const asked = v.safeParse(AUDIT_FILE_QUERY, query);
  if (!asked.success) return refuse("bad_argument", v.getDotPath(asked.issues[0]) ?? "query");

  return reading(install, { ...asked.output, limit: AUDIT_FILE_PAGE });
}

/**
 * Find where a narrowed file of the log ends, by the readings the file itself is made of, with their entries dropped: each looks at no more than its window.
 *
 * @param entries - how many entries the file holds
 * @returns the place the file after it goes on from: where a reading stopped short, or the file's last entry when the log goes on behind a full file; `null` when the log ends with the file
 */
async function endOfNarrowedFile(install: Install, asked: Omit<Asked, "limit">, entries: number): Promise<number | null> {
  let after = asked.after;

  for (let held = 0; held < entries; held += AUDIT_FILE_PAGE) {
    const limit = Math.min(AUDIT_FILE_PAGE, entries - held);
    const read = await found(install, { ...asked, after, limit });
    if (read.entries.length < limit) return read.stoppedAt ?? null;

    after = read.entries.at(-1)?.seq;
  }

  const beyond = await found(install, { ...asked, after, limit: 1 });

  return beyond.entries.length > 0 || beyond.stoppedAt !== undefined ? (after ?? null) : null;
}

/**
 * Find the place the file after a file of the log goes on from. It hands no entry out.
 *
 * A file of the whole log ends at its last entry, found by reading the file's rows and one more. A narrowed file ends there too, or sooner: where one of its readings stopped short.
 *
 * @param query - `kind`, `site`, and `after` as the file's readings take them; `entries` is how many entries the file holds, 10,000 at the most
 * @returns `after`, or `null` when the log ends with the file, so no file follows; `not_allowed` for anyone but an admin, or `bad_argument` naming the key that was refused
 */
export async function nextAuditFile(
  install: Install,
  actor: Actor,
  query: v.InferInput<typeof AUDIT_FILE_END_QUERY>,
): Promise<{ readonly ok: true; readonly after: number | null } | Refused<"not_allowed" | "bad_argument">> {
  if (actor.scope !== "admin") return refuse("not_allowed");

  const asked = v.safeParse(AUDIT_FILE_END_QUERY, query);
  if (!asked.success) return refuse("bad_argument", v.getDotPath(asked.issues[0]) ?? "query");

  const { entries, ...narrowed } = asked.output;
  if (narrowed.kind !== undefined || narrowed.site !== undefined) return { ok: true, after: await endOfNarrowedFile(install, narrowed, entries) };

  return { ok: true, after: (await install.database.endOfAuditPart({ entries, after: narrowed.after })) ?? null };
}
