// Step 1: the first schema. Before it the database is empty; nothing older exists to carry over.
//
// sites        one row per site; `id` is the key and the link, `folder` is where its files are and never changes
// versions     the publishes of a site that can still be gone back to
// earlier_ids  the ids a site had before each new link, each with the folder of its site
// tokens       the hashed record of every token
// settings     one row for the whole install
// secrets      what the install must keep and never show, such as the key the visitor limits are made from
// totals       one row: how many sites there are and how much their kept versions hold
// audit        what was done, by whom, and when; rows are added at the newest end and leave at the oldest
// request_counts   one row per UTC day and site, and one more per day under the empty site for all sites together; a year is kept
// declared_files   one row per UTC day: the files the uploads begun on it declared, and the times the store was written to or listed on it; the newest day and the one before it are kept
// uploads      the staged publishes: begun, taking files, then live or given up
// logins       the computers asking to be logged in: pending, then allowed or denied, and gone once used or ten minutes old
// leftovers    the folders of removed sites, each until its files are gone from the bucket
// sweep_place  one row while a walk of the scheduled sweep is under way: where its last run stopped
// update_check one row once the install has asked for the newest release: when it asked, the newest it knows, since when, and its last try to start an update by itself
// domain_check one row once the domain was checked or repaired: when, by whom, how each piece stood, and whether the users changed since
// problems     one row per UTC day and kind of what went wrong: how often, when, and the latest failure's name and cleaned message; 30 days are kept

import type { Step } from "./migrate";

/** One row per site. A site is public exactly when it holds a public name, and a public name is never a site id. `title` is the one its owner typed, `page_title` the one its entry page had when it was last published. */
const SITES = `
CREATE TABLE sites (
  id TEXT NOT NULL PRIMARY KEY,
  name TEXT NOT NULL,
  folder TEXT NOT NULL UNIQUE,
  access TEXT NOT NULL CHECK (access IN ('private', 'unlisted', 'public')),
  public_name TEXT UNIQUE,
  title TEXT,
  page_title TEXT,
  search_engines INTEGER NOT NULL CHECK (search_engines IN (0, 1)),
  embeddable INTEGER NOT NULL DEFAULT 1 CHECK (embeddable IN (0, 1)),
  expires_at INTEGER,
  live_version INTEGER NOT NULL,
  next_version INTEGER NOT NULL,
  owner TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  trashed_at INTEGER,
  trashed INTEGER GENERATED ALWAYS AS (trashed_at IS NOT NULL) VIRTUAL,
  access_rank INTEGER GENERATED ALWAYS AS (CASE access WHEN 'private' THEN 0 WHEN 'unlisted' THEN 1 WHEN 'public' THEN 2 END) VIRTUAL,
  title_key TEXT GENERATED ALWAYS AS (lower(substr(coalesce(title, page_title, name), 1, 40))) VIRTUAL,
  CHECK ((access = 'public') = (public_name IS NOT NULL)),
  CHECK (public_name IS NOT id),
  CHECK (next_version > live_version)
) STRICT, WITHOUT ROWID`;

/** The publishes of a site that can still be gone back to; they go when the site does. `missing_page` says whether the version holds a `404.html` at its top, and `bare_files` lists its files without an extension, NULL when they are not kept. */
const VERSIONS = `
CREATE TABLE versions (
  folder TEXT NOT NULL REFERENCES sites (folder) ON DELETE CASCADE,
  number INTEGER NOT NULL CHECK (number >= 1),
  published_at INTEGER NOT NULL,
  published_by TEXT NOT NULL,
  bytes INTEGER NOT NULL CHECK (bytes >= 0),
  files INTEGER NOT NULL CHECK (files >= 0),
  missing_page INTEGER NOT NULL DEFAULT 0 CHECK (missing_page IN (0, 1)),
  bare_files TEXT,
  PRIMARY KEY (folder, number)
) STRICT, WITHOUT ROWID`;

/** The ids a site had before each new link, by the folder it keeps; they go when the site does. An id here opens nothing. */
const EARLIER_IDS = `
CREATE TABLE earlier_ids (
  id TEXT NOT NULL PRIMARY KEY,
  folder TEXT NOT NULL REFERENCES sites (folder) ON DELETE CASCADE
) STRICT, WITHOUT ROWID`;

/** The hashed record of every token. Only an admin token expires. A removed token keeps its row for a time, marked with when it was removed and by whom; `end_at` is when a token ended or will: its removal, else its expiry. */
const TOKENS = `
CREATE TABLE tokens (
  id TEXT NOT NULL PRIMARY KEY,
  hash TEXT NOT NULL,
  scope TEXT NOT NULL CHECK (scope IN ('admin', 'publisher')),
  note TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  expires_at INTEGER,
  removed_at INTEGER,
  removed_by TEXT,
  end_at INTEGER GENERATED ALWAYS AS (coalesce(removed_at, expires_at)) VIRTUAL,
  CHECK ((scope = 'admin') = (expires_at IS NOT NULL)),
  CHECK ((removed_at IS NULL) = (removed_by IS NULL))
) STRICT, WITHOUT ROWID`;

/** The settings of the whole install, in one row. */
const SETTINGS = `
CREATE TABLE settings (
  id INTEGER NOT NULL PRIMARY KEY CHECK (id = 1),
  value TEXT NOT NULL CHECK (json_valid(value)),
  updated_at INTEGER NOT NULL
) STRICT`;

/** What the install keeps and no listing, export, or audit entry shows: the key the visitor limits are made from, as lowercase hex. */
const SECRETS = `
CREATE TABLE secrets (
  name TEXT NOT NULL PRIMARY KEY CHECK (name IN ('visitor_key')),
  value TEXT NOT NULL,
  created_at INTEGER NOT NULL
) STRICT, WITHOUT ROWID`;

/** How many sites there are, how many of them sit in the trash, and the bytes and files of every kept version, in one row the triggers below keep true. */
const TOTALS = `
CREATE TABLE totals (
  id INTEGER NOT NULL PRIMARY KEY CHECK (id = 1),
  sites INTEGER NOT NULL CHECK (sites >= 0),
  trashed_sites INTEGER NOT NULL CHECK (trashed_sites >= 0),
  bytes INTEGER NOT NULL CHECK (bytes >= 0),
  files INTEGER NOT NULL CHECK (files >= 0)
) STRICT`;

/** The one row of the totals, for an install with no site. */
const TOTALS_START_AT_ZERO = "INSERT INTO totals (id, sites, trashed_sites, bytes, files) VALUES (1, 0, 0, 0, 0)";

/** What was done, by whom, and when. An entry's `seq` is one above the newest entry's, which is never removed: no number is given twice. Entries leave at the oldest end alone, so none is left out between the two ends. */
const AUDIT = `
CREATE TABLE audit (
  seq INTEGER NOT NULL PRIMARY KEY,
  at INTEGER NOT NULL,
  actor TEXT NOT NULL,
  action TEXT NOT NULL,
  site_id TEXT,
  site_name TEXT,
  detail TEXT NOT NULL CHECK (json_valid(detail)),
  CHECK ((site_id IS NULL) = (site_name IS NULL))
) STRICT`;

/** A day's requests, and how many of them opened a page. A row lives a year, so it does not refer to the sites table. The row of all sites also holds the rows the database read and wrote on the day, as far as they were counted. */
const REQUEST_COUNTS = `
CREATE TABLE request_counts (
  day TEXT NOT NULL CHECK (day GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
  site TEXT NOT NULL,
  requests INTEGER NOT NULL CHECK (requests >= 1),
  views INTEGER NOT NULL DEFAULT 0 CHECK (views >= 0 AND views <= requests),
  rows_read INTEGER NOT NULL DEFAULT 0 CHECK (rows_read >= 0),
  rows_written INTEGER NOT NULL DEFAULT 0 CHECK (rows_written >= 0),
  PRIMARY KEY (day, site)
) STRICT, WITHOUT ROWID`;

/** The files the uploads begun on one UTC day declared, all holders together, and `writes`: the times the store was written to or listed on that day, a declared file counted when its upload begins. The newest day and the one before it are kept. */
const DECLARED_FILES = `
CREATE TABLE declared_files (
  day TEXT NOT NULL PRIMARY KEY CHECK (day GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
  files INTEGER NOT NULL CHECK (files >= 0),
  writes INTEGER NOT NULL DEFAULT 0 CHECK (writes >= 0)
) STRICT, WITHOUT ROWID`;

/** A staged publish from its first request on. `number` is 1 exactly for a new site, whose folder no site has yet; `manifest` is one JSON object, the declared files under keys made from their paths, while the upload is pending and empty after. */
const UPLOADS = `
CREATE TABLE uploads (
  id TEXT NOT NULL PRIMARY KEY,
  folder TEXT NOT NULL,
  number INTEGER NOT NULL CHECK (number >= 1),
  owner TEXT NOT NULL,
  state TEXT NOT NULL DEFAULT 'pending' CHECK (state IN ('pending', 'finished', 'abandoned')),
  plan TEXT NOT NULL CHECK (json_valid(plan)),
  manifest TEXT NOT NULL CHECK (json_valid(manifest) AND json_type(manifest) = 'object'),
  bytes INTEGER NOT NULL CHECK (bytes >= 0),
  files INTEGER NOT NULL CHECK (files >= 1),
  dropped TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(dropped)),
  created_at INTEGER NOT NULL,
  UNIQUE (folder, number)
) STRICT, WITHOUT ROWID`;

/** A computer's login from the terminal's first request on. `hash` is the SHA-256 of the secret the terminal holds; `code` is what a person compares, and `visitor` the key of whoever asked. Only a decided login names who decided it. */
const LOGINS = `
CREATE TABLE logins (
  id TEXT NOT NULL PRIMARY KEY,
  code TEXT NOT NULL UNIQUE,
  hash TEXT NOT NULL,
  scope TEXT NOT NULL CHECK (scope IN ('admin', 'publisher')),
  computer TEXT NOT NULL,
  visitor TEXT NOT NULL,
  state TEXT NOT NULL DEFAULT 'pending' CHECK (state IN ('pending', 'allowed', 'denied')),
  decided_by TEXT,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  CHECK ((state = 'pending') = (decided_by IS NULL)),
  CHECK (expires_at > created_at)
) STRICT, WITHOUT ROWID`;

/** The folder of every site removed for good, kept until the bucket holds nothing under it. */
const LEFTOVERS = `
CREATE TABLE leftovers (
  folder TEXT NOT NULL PRIMARY KEY
) STRICT, WITHOUT ROWID`;

/** Where the last scheduled run of the sweep stopped, as JSON; no row once a walk reached its end. */
const SWEEP_PLACE = `
CREATE TABLE sweep_place (
  id INTEGER NOT NULL PRIMARY KEY CHECK (id = 1),
  place TEXT NOT NULL CHECK (json_valid(place))
) STRICT`;

/** When the install last asked for the newest release, the newest it has learned of, as JSON, when it first learned of that version, and its last try to start an update by itself, as JSON; `news` and `seen_at` are NULL while no release is known. */
const UPDATE_CHECK = `
CREATE TABLE update_check (
  id INTEGER NOT NULL PRIMARY KEY CHECK (id = 1),
  checked_at INTEGER NOT NULL,
  news TEXT CHECK (news IS NULL OR json_valid(news)),
  seen_at INTEGER,
  auto TEXT CHECK (auto IS NULL OR json_valid(auto)),
  CHECK ((news IS NULL) = (seen_at IS NULL))
) STRICT`;

/** The last check or repair of the domain: when, by whom, which of the two, and its pieces as JSON; a run replaces the row. `users_changed_at`, `rules_changed_at`: above zero, a change of the users or the rules waits; below zero, none does. */
const DOMAIN_CHECK = `
CREATE TABLE domain_check (
  id INTEGER NOT NULL PRIMARY KEY CHECK (id = 1),
  ran_at INTEGER NOT NULL,
  ran_by TEXT NOT NULL,
  run TEXT NOT NULL CHECK (run IN ('check', 'repair')),
  pieces TEXT NOT NULL CHECK (json_valid(pieces) AND json_type(pieces) = 'array'),
  users_changed_at INTEGER,
  rules_changed_at INTEGER
) STRICT`;

/** What went wrong, per UTC day and kind. `count` is a floor, since a kind is written once an hour, and `more` says it came more often than it was written; `name` and `message` are of the latest failure. */
const PROBLEMS = `
CREATE TABLE problems (
  day TEXT NOT NULL CHECK (day GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
  kind TEXT NOT NULL CHECK (kind IN ('request_failed', 'api_failed', 'sweep_failed', 'count_unwritten', 'login_unwritten', 'login_unchecked', 'update_failed', 'users_not_carried',
    'rules_not_carried', 'copy_failed', 'files_limit_reached', 'writes_limit_reached', 'requests_limit_reached')),
  count INTEGER NOT NULL CHECK (count >= 1),
  more INTEGER NOT NULL DEFAULT 0 CHECK (more IN (0, 1)),
  first_at INTEGER NOT NULL,
  last_at INTEGER NOT NULL,
  name TEXT,
  message TEXT,
  PRIMARY KEY (day, kind),
  CHECK (last_at >= first_at)
) STRICT, WITHOUT ROWID`;

/** A site that is removed leaves its folder to be emptied, whatever removed it. */
const REMOVED_SITE_LEAVES_ITS_FOLDER = `
CREATE TRIGGER sites_delete_leaves_the_folder AFTER DELETE ON sites
BEGIN INSERT OR IGNORE INTO leftovers (folder) VALUES (OLD.folder); END`;

/** A folder a site holds is no leftover, so the files of a site stored back into its folder stay. */
const SITE_KEEPS_ITS_FOLDER = `
CREATE TRIGGER sites_insert_keeps_the_folder AFTER INSERT ON sites
BEGIN DELETE FROM leftovers WHERE folder = NEW.folder; END`;

/** A public name is an address of its own, so no new site may make a name and an id match. */
const NAME_IS_NO_ID_ON_INSERT = `
CREATE TRIGGER sites_insert_keeps_names_and_ids_apart BEFORE INSERT ON sites
WHEN EXISTS (SELECT 1 FROM sites WHERE id = NEW.public_name) OR EXISTS (SELECT 1 FROM sites WHERE public_name = NEW.id)
BEGIN SELECT RAISE(ABORT, 'a public name and a site id never match'); END`;

/** The same for a site that takes a new id or a new public name. */
const NAME_IS_NO_ID_ON_UPDATE = `
CREATE TRIGGER sites_update_keeps_names_and_ids_apart BEFORE UPDATE OF id, public_name ON sites
WHEN EXISTS (SELECT 1 FROM sites WHERE id = NEW.public_name) OR EXISTS (SELECT 1 FROM sites WHERE public_name = NEW.id)
BEGIN SELECT RAISE(ABORT, 'a public name and a site id never match'); END`;

/** A site is never without its live version: the first is made with the site, and whoever inserts the site then states its size. */
const FIRST_VERSION_COMES_WITH_THE_SITE = `
CREATE TRIGGER sites_insert_makes_the_first_version AFTER INSERT ON sites
BEGIN INSERT INTO versions (folder, number, published_at, published_by, bytes, files) VALUES (NEW.folder, NEW.live_version, NEW.created_at, NEW.owner, 0, 0); END`;

/** The live version only moves to a kept version. */
const LIVE_VERSION_IS_KEPT = `
CREATE TRIGGER sites_live_version_is_kept BEFORE UPDATE OF live_version ON sites
WHEN NOT EXISTS (SELECT 1 FROM versions WHERE folder = NEW.folder AND number = NEW.live_version)
BEGIN SELECT RAISE(ABORT, 'the live version of a site is one of its kept versions'); END`;

/** The live version is never dropped from under its site. */
const LIVE_VERSION_STAYS = `
CREATE TRIGGER versions_keep_the_live_one BEFORE DELETE ON versions
WHEN EXISTS (SELECT 1 FROM sites WHERE folder = OLD.folder AND live_version = OLD.number)
BEGIN SELECT RAISE(ABORT, 'the live version of a site is one of its kept versions'); END`;

/** The totals count a site from the moment it is there. */
const TOTALS_COUNT_A_NEW_SITE = `
CREATE TRIGGER totals_count_a_new_site AFTER INSERT ON sites
BEGIN UPDATE totals SET sites = sites + 1, trashed_sites = trashed_sites + (NEW.trashed_at IS NOT NULL); END`;

/** And stop counting it when it is gone. */
const TOTALS_FORGET_A_DELETED_SITE = `
CREATE TRIGGER totals_forget_a_deleted_site AFTER DELETE ON sites
BEGIN UPDATE totals SET sites = sites - 1, trashed_sites = trashed_sites - (OLD.trashed_at IS NOT NULL); END`;

/** A site entering or leaving the trash moves the count of trashed sites. */
const TOTALS_FOLLOW_THE_TRASH = `
CREATE TRIGGER totals_follow_the_trash AFTER UPDATE OF trashed_at ON sites
BEGIN UPDATE totals SET trashed_sites = trashed_sites + (NEW.trashed_at IS NOT NULL) - (OLD.trashed_at IS NOT NULL); END`;

/** The totals grow by every version kept. */
const TOTALS_ADD_A_KEPT_VERSION = `
CREATE TRIGGER totals_add_a_kept_version AFTER INSERT ON versions
BEGIN UPDATE totals SET bytes = bytes + NEW.bytes, files = files + NEW.files; END`;

/** They shrink by every version dropped, alone or with its site. */
const TOTALS_TAKE_OFF_A_DROPPED_VERSION = `
CREATE TRIGGER totals_take_off_a_dropped_version AFTER DELETE ON versions
BEGIN UPDATE totals SET bytes = bytes - OLD.bytes, files = files - OLD.files; END`;

/** And they follow a version whose size is restated. */
const TOTALS_FOLLOW_A_RESIZED_VERSION = `
CREATE TRIGGER totals_follow_a_resized_version AFTER UPDATE OF bytes, files ON versions
BEGIN UPDATE totals SET bytes = bytes + NEW.bytes - OLD.bytes, files = files + NEW.files - OLD.files; END`;

/** The totals row is never removed, so no change goes uncounted. */
const TOTALS_KEEP_THEIR_ROW = `
CREATE TRIGGER totals_keep_their_row BEFORE DELETE ON totals
BEGIN SELECT RAISE(ABORT, 'the totals are one row that stays'); END`;

/** A site keeps its folder for life. */
const FOLDER_NEVER_CHANGES = `
CREATE TRIGGER sites_folder_never_changes BEFORE UPDATE OF folder ON sites
BEGIN SELECT RAISE(ABORT, 'the folder of a site never changes'); END`;

/** The audit log loses entries at its oldest end alone, and never its newest one. */
const AUDIT_LOSES_ONLY_ITS_OLDEST = `
CREATE TRIGGER audit_loses_only_its_oldest BEFORE DELETE ON audit
WHEN OLD.seq > (SELECT min(seq) FROM audit) OR OLD.seq = (SELECT max(seq) FROM audit)
BEGIN SELECT RAISE(ABORT, 'the audit log loses its oldest entry alone, and never its newest'); END`;

/** And no entry is rewritten. */
const AUDIT_ROWS_NEVER_CHANGE = `
CREATE TRIGGER audit_rows_never_change BEFORE UPDATE ON audit
BEGIN SELECT RAISE(ABORT, 'an entry of the audit log is never rewritten'); END`;

/** Creates every table, index, and trigger of the first schema. */
export const CREATE_SCHEMA: Step = {
  number: 1,
  description: "create the sites, versions, earlier_ids, tokens, settings, secrets, totals, audit, request_counts, declared_files, uploads, logins, leftovers, sweep_place, update_check, domain_check, and problems tables",
  statements: [
    SITES,
    VERSIONS,
    EARLIER_IDS,
    TOKENS,
    SETTINGS,
    SECRETS,
    TOTALS,
    TOTALS_START_AT_ZERO,
    AUDIT,
    REQUEST_COUNTS,
    DECLARED_FILES,
    UPLOADS,
    LOGINS,
    LEFTOVERS,
    SWEEP_PLACE,
    UPDATE_CHECK,
    DOMAIN_CHECK,
    PROBLEMS,
    "CREATE INDEX sites_by_change ON sites (trashed, updated_at DESC, id DESC)",
    "CREATE INDEX sites_by_owner ON sites (owner, trashed, updated_at DESC, id DESC)",
    "CREATE INDEX sites_by_expiry ON sites (expires_at, id) WHERE expires_at IS NOT NULL AND trashed_at IS NULL",
    "CREATE INDEX sites_by_trashing ON sites (trashed_at, id) WHERE trashed_at IS NOT NULL",
    "CREATE INDEX earlier_ids_by_folder ON earlier_ids (folder)",
    "CREATE INDEX audit_logins ON audit (action, actor, at) WHERE action = 'login'",
    "CREATE INDEX tokens_by_creation ON tokens (created_at DESC, id DESC) WHERE removed_at IS NULL",
    "CREATE INDEX tokens_by_end ON tokens (end_at DESC, id DESC)",
    "CREATE INDEX uploads_by_age ON uploads (created_at, id)",
    "CREATE INDEX uploads_by_state ON uploads (state, owner, number, bytes)",
    "CREATE INDEX logins_by_visitor ON logins (state, visitor, created_at, expires_at)",
    NAME_IS_NO_ID_ON_INSERT,
    NAME_IS_NO_ID_ON_UPDATE,
    FIRST_VERSION_COMES_WITH_THE_SITE,
    LIVE_VERSION_IS_KEPT,
    LIVE_VERSION_STAYS,
    FOLDER_NEVER_CHANGES,
    REMOVED_SITE_LEAVES_ITS_FOLDER,
    SITE_KEEPS_ITS_FOLDER,
    TOTALS_COUNT_A_NEW_SITE,
    TOTALS_FORGET_A_DELETED_SITE,
    TOTALS_FOLLOW_THE_TRASH,
    TOTALS_ADD_A_KEPT_VERSION,
    TOTALS_TAKE_OFF_A_DROPPED_VERSION,
    TOTALS_FOLLOW_A_RESIZED_VERSION,
    TOTALS_KEEP_THEIR_ROW,
    AUDIT_LOSES_ONLY_ITS_OLDEST,
    AUDIT_ROWS_NEVER_CHANGE,
  ],
};
