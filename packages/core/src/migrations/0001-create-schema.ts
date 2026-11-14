// Step 1: the first schema. Before it the database is empty; nothing older exists to carry over.
//
// sites        one row per site; `id` is the key and the link, `folder` is where its files are and never changes
// versions     the publishes of a site that can still be gone back to
// tokens       the hashed record of every token
// settings     one row for the whole install
// audit        what was done, by whom, and when; rows are only ever added

import type { Step } from "./migrate";

/** One row per site. A site is public exactly when it holds a public name, and a public name is never a site id. */
const SITES = `
CREATE TABLE sites (
  id TEXT NOT NULL PRIMARY KEY,
  name TEXT NOT NULL,
  folder TEXT NOT NULL UNIQUE,
  access TEXT NOT NULL CHECK (access IN ('private', 'unlisted', 'public')),
  public_name TEXT UNIQUE,
  title TEXT,
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
  CHECK ((access = 'public') = (public_name IS NOT NULL)),
  CHECK (public_name IS NOT id),
  CHECK (next_version > live_version)
) STRICT`;

/** The publishes of a site that can still be gone back to; they go when the site does. */
const VERSIONS = `
CREATE TABLE versions (
  folder TEXT NOT NULL REFERENCES sites (folder) ON DELETE CASCADE,
  number INTEGER NOT NULL CHECK (number >= 1),
  published_at INTEGER NOT NULL,
  published_by TEXT NOT NULL,
  PRIMARY KEY (folder, number)
) STRICT, WITHOUT ROWID`;

/** The hashed record of every token. Only an admin token expires. */
const TOKENS = `
CREATE TABLE tokens (
  id TEXT NOT NULL PRIMARY KEY,
  hash TEXT NOT NULL,
  scope TEXT NOT NULL CHECK (scope IN ('admin', 'publisher')),
  note TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  expires_at INTEGER,
  CHECK ((scope = 'admin') = (expires_at IS NOT NULL))
) STRICT`;

/** The settings of the whole install, in one row. */
const SETTINGS = `
CREATE TABLE settings (
  id INTEGER NOT NULL PRIMARY KEY CHECK (id = 1),
  value TEXT NOT NULL CHECK (json_valid(value)),
  updated_at INTEGER NOT NULL
) STRICT`;

/** What was done, by whom, and when. */
const AUDIT = `
CREATE TABLE audit (
  seq INTEGER PRIMARY KEY AUTOINCREMENT,
  at INTEGER NOT NULL,
  actor TEXT NOT NULL,
  action TEXT NOT NULL,
  site_id TEXT,
  site_name TEXT,
  detail TEXT NOT NULL CHECK (json_valid(detail)),
  CHECK ((site_id IS NULL) = (site_name IS NULL))
) STRICT`;

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

/** A site is never without its live version: the first is made with the site. */
const FIRST_VERSION_COMES_WITH_THE_SITE = `
CREATE TRIGGER sites_insert_makes_the_first_version AFTER INSERT ON sites
BEGIN INSERT INTO versions (folder, number, published_at, published_by) VALUES (NEW.folder, NEW.live_version, NEW.created_at, NEW.owner); END`;

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

/** A site keeps its folder for life. */
const FOLDER_NEVER_CHANGES = `
CREATE TRIGGER sites_folder_never_changes BEFORE UPDATE OF folder ON sites
BEGIN SELECT RAISE(ABORT, 'the folder of a site never changes'); END`;

/** The audit log is append-only: no entry is removed. */
const AUDIT_KEEPS_ITS_ROWS = `
CREATE TRIGGER audit_keeps_its_rows BEFORE DELETE ON audit
BEGIN SELECT RAISE(ABORT, 'the audit log is append-only'); END`;

/** And no entry is rewritten. */
const AUDIT_ROWS_NEVER_CHANGE = `
CREATE TRIGGER audit_rows_never_change BEFORE UPDATE ON audit
BEGIN SELECT RAISE(ABORT, 'the audit log is append-only'); END`;

/** Creates every table, index, and trigger of the first schema. */
export const CREATE_SCHEMA: Step = {
  number: 1,
  description: "create the sites, versions, tokens, settings, and audit tables",
  statements: [
    SITES,
    VERSIONS,
    TOKENS,
    SETTINGS,
    AUDIT,
    "CREATE INDEX sites_by_change ON sites (trashed, updated_at DESC, id DESC)",
    "CREATE INDEX sites_by_owner ON sites (owner, trashed, updated_at DESC, id DESC)",
    "CREATE INDEX tokens_by_creation ON tokens (created_at DESC, id DESC)",
    NAME_IS_NO_ID_ON_INSERT,
    NAME_IS_NO_ID_ON_UPDATE,
    FIRST_VERSION_COMES_WITH_THE_SITE,
    LIVE_VERSION_IS_KEPT,
    LIVE_VERSION_STAYS,
    FOLDER_NEVER_CHANGES,
    AUDIT_KEEPS_ITS_ROWS,
    AUDIT_ROWS_NEVER_CHANGE,
  ],
};
