// The current schema, declared once: every table, column, check, and index. The queries of `sql-database.ts` take their column names from here, and a new migration step is drafted from the difference between this file and what the steps build.
//
// What a declaration cannot say stays in the migration steps alone: STRICT, WITHOUT ROWID, and the triggers.

import { sql } from "drizzle-orm";
import { check, index, integer, primaryKey, sqliteTable, text, unique } from "drizzle-orm/sqlite-core";

/** The form a day is stored in. */
const DAY_FORM = "[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]";

/** One row per site; `id` is the key and the link, `folder` is where its files are and never changes. */
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
  ],
);

/** The publishes of a site that can still be gone back to; they go when the site does. */
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
  },
  (table) => [
    primaryKey({ columns: [table.folder, table.number] }),
    check("versions_number", sql`${table.number} >= 1`),
    check("versions_bytes", sql`${table.bytes} >= 0`),
    check("versions_files", sql`${table.files} >= 0`),
  ],
);

/** The hashed record of every token. Only an admin token expires. */
export const tokens = sqliteTable(
  "tokens",
  {
    id: text().notNull().primaryKey(),
    hash: text().notNull(),
    scope: text({ enum: ["admin", "publisher"] }).notNull(),
    note: text().notNull(),
    created_at: integer().notNull(),
    expires_at: integer(),
  },
  (table) => [
    check("tokens_scope", sql`${table.scope} IN ('admin', 'publisher')`),
    check("tokens_admin_expires", sql`(${table.scope} = 'admin') = (${table.expires_at} IS NOT NULL)`),
    index("tokens_by_creation").on(sql`${table.created_at} DESC`, sql`${table.id} DESC`),
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
    name: text({ enum: ["session_key", "update_address"] })
      .notNull()
      .primaryKey(),
    value: text().notNull(),
    created_at: integer().notNull(),
  },
  (table) => [check("secrets_name", sql`${table.name} IN ('session_key', 'update_address')`)],
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

/** What was done, by whom, and when; rows are only ever added. */
export const audit = sqliteTable(
  "audit",
  {
    seq: integer().primaryKey({ autoIncrement: true }),
    at: integer().notNull(),
    actor: text().notNull(),
    action: text().notNull(),
    site_id: text(),
    site_name: text(),
    detail: text().notNull(),
  },
  (table) => [check("audit_detail", sql`json_valid(${table.detail})`), check("audit_names_its_site", sql`(${table.site_id} IS NULL) = (${table.site_name} IS NULL)`)],
);

/** A day's requests, and how many of them opened a page: one row per UTC day and site, and one more per day under the empty site for all sites together. */
export const requestCounts = sqliteTable(
  "request_counts",
  {
    day: text().notNull(),
    site: text().notNull(),
    requests: integer().notNull(),
    views: integer().notNull().default(0),
  },
  (table) => [
    primaryKey({ columns: [table.day, table.site] }),
    check("request_counts_day", sql`${table.day} GLOB ${sql.raw(`'${DAY_FORM}'`)}`),
    check("request_counts_requests", sql`${table.requests} >= 1`),
    check("request_counts_views", sql`${table.views} >= 0 AND ${table.views} <= ${table.requests}`),
  ],
);

/** The files the uploads begun on one UTC day declared, all holders together. */
export const declaredFiles = sqliteTable(
  "declared_files",
  {
    day: text().notNull().primaryKey(),
    files: integer().notNull(),
  },
  (table) => [check("declared_files_day", sql`${table.day} GLOB ${sql.raw(`'${DAY_FORM}'`)}`), check("declared_files_files", sql`${table.files} >= 1`)],
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

/** A computer asking to be logged in: pending, then allowed or denied, and gone once used or run out. */
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
  },
  (table) => [
    check("logins_scope", sql`${table.scope} IN ('admin', 'publisher')`),
    check("logins_state", sql`${table.state} IN ('pending', 'allowed', 'denied')`),
    check("logins_decided_names_who", sql`(${table.state} = 'pending') = (${table.decided_by} IS NULL)`),
    check("logins_expires_after_creation", sql`${table.expires_at} > ${table.created_at}`),
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

/** When the install last asked for the newest release, and the newest it has learned of, as JSON. */
export const updateCheck = sqliteTable(
  "update_check",
  {
    id: integer().notNull().primaryKey(),
    checked_at: integer().notNull(),
    news: text(),
  },
  (table) => [check("update_check_one_row", sql`${table.id} = 1`), check("update_check_news", sql`${table.news} IS NULL OR json_valid(${table.news})`)],
);
