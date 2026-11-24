// The current schema, declared once: every table, column, check, and index. The queries of `sql-database.ts` take their column names from here, and a new migration step is drafted from the difference between this file and what the steps build.
//
// What a declaration cannot say stays in the migration steps alone: STRICT, WITHOUT ROWID, and the triggers.

import { sql } from "drizzle-orm";
import { check, index, integer, primaryKey, sqliteTable, text, unique } from "drizzle-orm/sqlite-core";

import { PROBLEM_KINDS } from "../records/problem";

/** The form a day is stored in. */
const DAY_FORM = "[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]";

/** One row per site; `id` is the key and the link, `folder` is where its files are and never changes. `access_rank` places its access in a listing by access, from the most private on, and `title_key` its listed title in a listing by title. */
export const sites = sqliteTable(
  "sites",
  {
    id: text().notNull().primaryKey(),
    name: text().notNull(),
    folder: text().notNull().unique(),
    access: text({ enum: ["private", "unlisted", "public"] }).notNull(),
    public_name: text().unique(),
    title: text(),
    page_title: text(),
    search_engines: integer().notNull(),
    embeddable: integer().notNull().default(1),
    expires_at: integer(),
    live_version: integer().notNull(),
    next_version: integer().notNull(),
    owner: text().notNull(),
    created_at: integer().notNull(),
    updated_at: integer().notNull(),
    trashed_at: integer(),
    trashed: integer().generatedAlwaysAs(sql`(trashed_at IS NOT NULL)`, { mode: "virtual" }),
    access_rank: integer().generatedAlwaysAs(sql`(CASE access WHEN 'private' THEN 0 WHEN 'unlisted' THEN 1 WHEN 'public' THEN 2 END)`, { mode: "virtual" }),
    title_key: text().generatedAlwaysAs(sql`(lower(substr(coalesce(title, page_title, name), 1, 40)))`, { mode: "virtual" }),
  },
  (table) => [
    check("sites_access", sql`${table.access} IN ('private', 'unlisted', 'public')`),
    check("sites_search_engines", sql`${table.search_engines} IN (0, 1)`),
    check("sites_embeddable", sql`${table.embeddable} IN (0, 1)`),
    check("sites_public_has_a_name", sql`(${table.access} = 'public') = (${table.public_name} IS NOT NULL)`),
    check("sites_name_is_no_id", sql`${table.public_name} IS NOT ${table.id}`),
    check("sites_next_is_above_live", sql`${table.next_version} > ${table.live_version}`),
    index("sites_by_change").on(table.trashed, sql`${table.updated_at} DESC`, sql`${table.id} DESC`),
    index("sites_by_owner").on(table.owner, table.trashed, sql`${table.updated_at} DESC`, sql`${table.id} DESC`),
    index("sites_by_name").on(table.name, table.id).where(sql`trashed_at IS NULL`),
    index("sites_by_title").on(table.title_key, table.id).where(sql`trashed_at IS NULL`),
    index("sites_by_access").on(table.access_rank, table.id).where(sql`trashed_at IS NULL`),
    index("sites_by_expiry").on(table.expires_at, table.id).where(sql`expires_at IS NOT NULL AND trashed_at IS NULL`),
    index("sites_by_trashing").on(table.trashed_at, table.id).where(sql`trashed_at IS NOT NULL`),
  ],
);

/** The publishes of a site that can still be gone back to; they go when the site does. Each says whether it holds a `404.html` at its top, and lists its files without an extension, NULL when they are not kept. */
export const versions = sqliteTable(
  "versions",
  {
    folder: text()
      .notNull()
      .references(() => sites.folder, { onDelete: "cascade" }),
    number: integer().notNull(),
    published_at: integer().notNull(),
    published_by: text().notNull(),
    bytes: integer().notNull(),
    files: integer().notNull(),
    missing_page: integer().notNull().default(0),
    bare_files: text(),
  },
  (table) => [
    primaryKey({ columns: [table.folder, table.number] }),
    check("versions_number", sql`${table.number} >= 1`),
    check("versions_bytes", sql`${table.bytes} >= 0`),
    check("versions_files", sql`${table.files} >= 0`),
    check("versions_missing_page", sql`${table.missing_page} IN (0, 1)`),
  ],
);

/** The ids a site had before each new link, by the folder it keeps: one row per id given up, gone when the site is. An id here opens nothing; it only says which site an older entry of the log was about. */
export const earlierIds = sqliteTable(
  "earlier_ids",
  {
    id: text().notNull().primaryKey(),
    folder: text()
      .notNull()
      .references(() => sites.folder, { onDelete: "cascade" }),
  },
  (table) => [index("earlier_ids_by_folder").on(table.folder)],
);

/** The hashed record of every token. `expires_at` is when it runs out, NULL for one that never does, whatever its scope; `allowed_by` is the user behind it. A removed token keeps its row for a time, with when and by whom. */
export const tokens = sqliteTable(
  "tokens",
  {
    id: text().notNull().primaryKey(),
    hash: text().notNull(),
    scope: text({ enum: ["admin", "publisher"] }).notNull(),
    note: text().notNull(),
    created_at: integer().notNull(),
    expires_at: integer(),
    allowed_by: text().notNull(),
    removed_at: integer(),
    removed_by: text(),
    user_removed: integer().notNull().default(0),
    end_at: integer().generatedAlwaysAs(sql`(coalesce(removed_at, expires_at))`, { mode: "virtual" }),
  },
  (table) => [
    check("tokens_scope", sql`${table.scope} IN ('admin', 'publisher')`),
    check("tokens_removed_names_who", sql`(${table.removed_at} IS NULL) = (${table.removed_by} IS NULL)`),
    check("tokens_user_removed", sql`${table.user_removed} IN (0, 1)`),
    check("tokens_user_removed_is_removed", sql`${table.user_removed} = 0 OR ${table.removed_at} IS NOT NULL`),
    index("tokens_by_creation")
      .on(sql`${table.created_at} DESC`, sql`${table.id} DESC`)
      .where(sql`removed_at IS NULL`),
    index("tokens_by_end").on(sql`${table.end_at} DESC`, sql`${table.id} DESC`),
    index("tokens_by_user")
      .on(table.allowed_by, table.expires_at)
      .where(sql`removed_at IS NULL`),
  ],
);

/** The settings of the whole install, in one row. */
export const settings = sqliteTable(
  "settings",
  {
    id: integer().notNull().primaryKey(),
    value: text().notNull(),
    updated_at: integer().notNull(),
  },
  (table) => [check("settings_one_row", sql`${table.id} = 1`), check("settings_value", sql`json_valid(${table.value})`)],
);

/** What the install keeps and no listing, export, or audit entry shows. */
export const secrets = sqliteTable(
  "secrets",
  {
    name: text({ enum: ["visitor_key"] })
      .notNull()
      .primaryKey(),
    value: text().notNull(),
    created_at: integer().notNull(),
  },
  (table) => [check("secrets_name", sql`${table.name} IN ('visitor_key')`)],
);

/** How many sites there are, how many of them sit in the trash, and the bytes and files of every kept version, in one row the triggers keep true. */
export const totals = sqliteTable(
  "totals",
  {
    id: integer().notNull().primaryKey(),
    sites: integer().notNull(),
    trashed_sites: integer().notNull(),
    bytes: integer().notNull(),
    files: integer().notNull(),
  },
  (table) => [
    check("totals_one_row", sql`${table.id} = 1`),
    check("totals_sites", sql`${table.sites} >= 0`),
    check("totals_trashed_sites", sql`${table.trashed_sites} >= 0`),
    check("totals_bytes", sql`${table.bytes} >= 0`),
    check("totals_files", sql`${table.files} >= 0`),
  ],
);

/** What was done, by whom, and when; rows are added at the newest end and leave at the oldest. The logins among them are indexed, so whether one is held is read from one entry. */
export const audit = sqliteTable(
  "audit",
  {
    seq: integer().primaryKey(),
    at: integer().notNull(),
    actor: text().notNull(),
    action: text().notNull(),
    site_id: text(),
    site_name: text(),
    detail: text().notNull(),
  },
  (table) => [
    check("audit_detail", sql`json_valid(${table.detail})`),
    check("audit_names_its_site", sql`(${table.site_id} IS NULL) = (${table.site_name} IS NULL)`),
    index("audit_logins").on(table.action, table.actor, table.at).where(sql`action = 'login'`),
  ],
);

/** A day's requests, and how many of them opened a page: one row per UTC day and site, and one more per day under the empty site for all sites together. That one also holds the rows the database read and wrote on the day, as far as they were counted. */
export const requestCounts = sqliteTable(
  "request_counts",
  {
    day: text().notNull(),
    site: text().notNull(),
    requests: integer().notNull(),
    views: integer().notNull().default(0),
    rows_read: integer().notNull().default(0),
    rows_written: integer().notNull().default(0),
  },
  (table) => [
    primaryKey({ columns: [table.day, table.site] }),
    check("request_counts_day", sql`${table.day} GLOB ${sql.raw(`'${DAY_FORM}'`)}`),
    check("request_counts_requests", sql`${table.requests} >= 1`),
    check("request_counts_views", sql`${table.views} >= 0 AND ${table.views} <= ${table.requests}`),
    check("request_counts_rows_read", sql`${table.rows_read} >= 0`),
    check("request_counts_rows_written", sql`${table.rows_written} >= 0`),
  ],
);

/** What the sweep summed of a site's page views, once a day is over: one row per site and UTC day that counted a view, with the views of the day and of every day before it, so a stretch of days is the difference of two rows. */
export const viewSums = sqliteTable(
  "view_sums",
  {
    site: text().notNull(),
    day: text().notNull(),
    views: integer().notNull(),
    earlier: integer().notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.site, table.day] }),
    check("view_sums_day", sql`${table.day} GLOB ${sql.raw(`'${DAY_FORM}'`)}`),
    check("view_sums_views", sql`${table.views} >= 0`),
    check("view_sums_earlier", sql`${table.earlier} >= 0`),
  ],
);

/** The files the uploads begun on one UTC day declared, all holders together, and the times the store was written to or listed on that day. */
export const declaredFiles = sqliteTable(
  "declared_files",
  {
    day: text().notNull().primaryKey(),
    files: integer().notNull(),
    writes: integer().notNull().default(0),
  },
  (table) => [
    check("declared_files_day", sql`${table.day} GLOB ${sql.raw(`'${DAY_FORM}'`)}`),
    check("declared_files_files", sql`${table.files} >= 0`),
    check("declared_files_writes", sql`${table.writes} >= 0`),
  ],
);

/** A staged publish from its first request on: begun, taking files, then live or given up. */
export const uploads = sqliteTable(
  "uploads",
  {
    id: text().notNull().primaryKey(),
    folder: text().notNull(),
    number: integer().notNull(),
    owner: text().notNull(),
    state: text({ enum: ["pending", "finished", "abandoned"] })
      .notNull()
      .default("pending"),
    plan: text().notNull(),
    manifest: text().notNull(),
    bytes: integer().notNull(),
    files: integer().notNull(),
    dropped: text().notNull().default("[]"),
    created_at: integer().notNull(),
  },
  (table) => [
    unique("uploads_folder_number").on(table.folder, table.number),
    check("uploads_number", sql`${table.number} >= 1`),
    check("uploads_state", sql`${table.state} IN ('pending', 'finished', 'abandoned')`),
    check("uploads_plan", sql`json_valid(${table.plan})`),
    check("uploads_manifest", sql`json_valid(${table.manifest}) AND json_type(${table.manifest}) = 'object'`),
    check("uploads_bytes", sql`${table.bytes} >= 0`),
    check("uploads_files", sql`${table.files} >= 1`),
    check("uploads_dropped", sql`json_valid(${table.dropped})`),
    index("uploads_by_age").on(table.created_at, table.id),
    index("uploads_by_state").on(table.state, table.owner, table.number, table.bytes),
  ],
);

/** A computer asking to be logged in: pending, then allowed or denied, and gone once used or run out. `token_expires_at` is when the token of an allowed one runs out, NULL for a token that never does. */
export const logins = sqliteTable(
  "logins",
  {
    id: text().notNull().primaryKey(),
    code: text().notNull().unique(),
    hash: text().notNull(),
    scope: text({ enum: ["admin", "publisher"] }).notNull(),
    computer: text().notNull(),
    visitor: text().notNull(),
    state: text({ enum: ["pending", "allowed", "denied"] })
      .notNull()
      .default("pending"),
    decided_by: text(),
    created_at: integer().notNull(),
    expires_at: integer().notNull(),
    token_expires_at: integer(),
  },
  (table) => [
    check("logins_scope", sql`${table.scope} IN ('admin', 'publisher')`),
    check("logins_state", sql`${table.state} IN ('pending', 'allowed', 'denied')`),
    check("logins_decided_names_who", sql`(${table.state} = 'pending') = (${table.decided_by} IS NULL)`),
    check("logins_expires_after_creation", sql`${table.expires_at} > ${table.created_at}`),
    check("logins_token_expiry_is_allowed", sql`${table.token_expires_at} IS NULL OR ${table.state} = 'allowed'`),
    index("logins_by_visitor").on(table.state, table.visitor, table.created_at, table.expires_at),
  ],
);

/** The folder of every site removed for good, kept until the bucket holds nothing under it. */
export const leftovers = sqliteTable("leftovers", {
  folder: text().notNull().primaryKey(),
});

/** Where the last scheduled run of the sweep stopped, as JSON; no row once a walk reached its end. */
export const sweepPlace = sqliteTable(
  "sweep_place",
  {
    id: integer().notNull().primaryKey(),
    place: text().notNull(),
  },
  (table) => [check("sweep_place_one_row", sql`${table.id} = 1`), check("sweep_place_place", sql`json_valid(${table.place})`)],
);

/** When the install last asked for the newest release, the newest it has learned of, as JSON, when it first learned of that version, and its last try to start an update by itself, as JSON. */
export const updateCheck = sqliteTable(
  "update_check",
  {
    id: integer().notNull().primaryKey(),
    checked_at: integer().notNull(),
    news: text(),
    seen_at: integer(),
    auto: text(),
  },
  (table) => [
    check("update_check_one_row", sql`${table.id} = 1`),
    check("update_check_news", sql`${table.news} IS NULL OR json_valid(${table.news})`),
    check("update_check_seen", sql`(${table.news} IS NULL) = (${table.seen_at} IS NULL)`),
    check("update_check_auto", sql`${table.auto} IS NULL OR json_valid(${table.auto})`),
  ],
);

/** The last check or repair of the domain: when, by whom, which of the two, and its pieces as JSON; a run replaces the row. `users_changed_at`, `rules_changed_at`, `alerts_changed_at`: above zero, a change of them waits or is not confirmed. */
export const domainCheck = sqliteTable(
  "domain_check",
  {
    id: integer().notNull().primaryKey(),
    ran_at: integer().notNull(),
    ran_by: text().notNull(),
    run: text({ enum: ["check", "repair"] }).notNull(),
    pieces: text().notNull(),
    users_changed_at: integer(),
    rules_changed_at: integer(),
    alerts_changed_at: integer(),
  },
  (table) => [
    check("domain_check_one_row", sql`${table.id} = 1`),
    check("domain_check_run", sql`${table.run} IN ('check', 'repair')`),
    check("domain_check_pieces", sql`json_valid(${table.pieces}) AND json_type(${table.pieces}) = 'array'`),
  ],
);

/** What went wrong, one row per UTC day and kind: how often at the least, whether it came more often than it was written, the first and the last time, and the name and cleaned message of the latest failure. */
export const problems = sqliteTable(
  "problems",
  {
    day: text().notNull(),
    kind: text({ enum: PROBLEM_KINDS }).notNull(),
    count: integer().notNull(),
    more: integer().notNull().default(0),
    first_at: integer().notNull(),
    last_at: integer().notNull(),
    name: text(),
    message: text(),
  },
  (table) => [
    primaryKey({ columns: [table.day, table.kind] }),
    check("problems_day", sql`${table.day} GLOB ${sql.raw(`'${DAY_FORM}'`)}`),
    check("problems_kind", sql`${table.kind} IN (${sql.raw(PROBLEM_KINDS.map((kind) => `'${kind}'`).join(", "))})`),
    check("problems_count", sql`${table.count} >= 1`),
    check("problems_more", sql`${table.more} IN (0, 1)`),
    check("problems_last_is_after_first", sql`${table.last_at} >= ${table.first_at}`),
  ],
);
