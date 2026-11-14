// The database interface over SQLite. Every SQL text poplin runs outside a migration step is in this file, and every row leaves it as a checked value.
//
// A change is one batch: the statement that changes a row carries its own condition, and each statement after it runs only when the one before it changed a row.
// So a change and its audit entry are kept together or not at all, and nothing is decided from an earlier read.

import * as v from "valibot";

import type { ComputerLogin, LoginId, PendingLogin, UserCode } from "../auth/computer-logins";
import type { TokenId, TokenRecord } from "../auth/tokens";
import type { PublicName, SiteName } from "../names/names";
import { type AuditAction, type AuditEntry, auditFromRow } from "../records/audit";
import { computerLoginFromRow } from "../records/computer-login";
import { SITE_ID, SITE_NAME } from "../records/fields";
import { SETTING_CHANGES, SETTING_VALUES, type SettingValues } from "../records/settings";
import { signingKeyFromRow, signingKeyToText } from "../records/secret";
import { NEW_SITE, SITE_DETAILS, SITE_FOLDER, type Site, type SiteAccess, type SiteFolder, siteFromRow, siteToRow } from "../records/site";
import { SWEEP_PLACE, type SweepPlace } from "../records/sweep-place";
import { type SiteSize, sizeFromRow, type Totals, totalsFromRow } from "../records/sizes";
import { mintSiteId, type SiteId } from "../sites/ids";
import { tokenFromRow } from "../records/token";
import { type ManifestFile, MANIFEST_FILE, manifestFromText, type Upload, type UploadId, uploadFromRow } from "../records/upload";
import { dayOf, type SiteViews, viewDays } from "../records/views";
import type {
  Address,
  AuditNote,
  CountedRequests,
  Database,
  Done,
  ExportPage,
  LeftoversPage,
  LoginDecision,
  LoginRoom,
  NewSite,
  NewUpload,
  NewVersion,
  Published,
  Refused,
  RequestCounts,
  Reserved,
  Signed,
  SigningKey,
  SiteDetails,
  SitesPage,
  SitesQuery,
  Unchanged,
  UploadedVersion,
  UploadRoom,
  UploadsPage,
} from "./database";
import type { SqlDriver, SqlValue, Statement, StatementResult } from "./driver";

/** How many ids are tried for one site before giving up; an id is about 62 random bits, so a second try is already a rare event. */
const MINT_ATTEMPTS = 5;

/** The most rows one page of a listing holds. */
const MAX_PAGE = 100;

/** A `before` that every audit entry is below. */
const NEWEST = Number.MAX_SAFE_INTEGER;

/** A site with its kept versions gathered into one JSON column, so one query gives the whole site. */
const SELECT_SITE = `
SELECT s.id, s.name, s.folder, s.access, s.public_name, s.title, s.page_title, s.search_engines, s.embeddable, s.expires_at, s.live_version, s.owner, s.created_at, s.updated_at, s.trashed_at,
  (SELECT json_group_array(json_object('number', v.number, 'published_at', v.published_at, 'published_by', v.published_by, 'bytes', v.bytes, 'files', v.files)) FROM versions v WHERE v.folder = s.folder) AS versions
FROM sites s`;

/** The site with id `?1`. */
const SITE_BY_ID = `${SELECT_SITE} WHERE s.id = ?1`;

/** The id and the name of every site whose id is in the JSON array `?1`. */
const SITE_NAMES = "SELECT id, name FROM sites WHERE id IN (SELECT value FROM json_each(?1))";

/** A row of `SITE_NAMES`. */
const NAMED_SITE = v.object({ id: SITE_ID, name: SITE_NAME });

/** The site holding public name `?1`. */
const SITE_BY_PUBLIC_NAME = `${SELECT_SITE} WHERE s.public_name = ?1`;

/** The site whose files sit under folder `?1`. */
const SITE_BY_FOLDER = `${SELECT_SITE} WHERE s.folder = ?1`;

/** The site in the folder of upload `?1`. */
const SITE_OF_UPLOAD = `${SELECT_SITE} WHERE s.folder = (SELECT folder FROM uploads WHERE id = ?1)`;

/** Added to a lookup by address: the site is outside the trash and not past its expiry at `?2`. */
const IS_SERVED = "AND s.trashed = 0 AND (s.expires_at IS NULL OR s.expires_at > ?2)";

/** The audit entry of a change to the site now at id `?4`, written only when the statement before it changed a row. */
const AUDIT_SITE =
  "INSERT INTO audit (at, actor, action, site_id, site_name, detail) SELECT ?1, ?2, ?3, id, name, ?5 FROM sites WHERE id = ?4 AND changes() = 1";

/** The audit entry of a change to no site, written only when the statement before it changed a row. */
const AUDIT_PLAIN = "INSERT INTO audit (at, actor, action, detail) SELECT ?1, ?2, ?3, ?4 WHERE changes() = 1";

/** An audit entry that goes with no change. */
const AUDIT_NOTE = "INSERT INTO audit (at, actor, action, site_id, site_name, detail) VALUES (?1, ?2, ?3, ?4, ?5, ?6)";

/** A new site, only while its id and its public name are free: no site has either as its id or its public name. The schema adds version 1 with the row. Its owner is whoever began upload `?12`, and `?9` when it is made from none. */
const INSERT_SITE = `
INSERT INTO sites (id, name, folder, access, public_name, title, search_engines, expires_at, live_version, next_version, owner, created_at, updated_at, embeddable, page_title)
SELECT ?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, 1, 2, COALESCE((SELECT owner FROM uploads WHERE id = ?12), ?9), ?10, ?10, ?11, ?13
WHERE NOT EXISTS (SELECT 1 FROM sites WHERE id = ?1)
  AND NOT EXISTS (SELECT 1 FROM sites WHERE public_name = ?1)
  AND (?5 IS NULL OR (?5 <> ?1 AND NOT EXISTS (SELECT 1 FROM sites WHERE public_name = ?5) AND NOT EXISTS (SELECT 1 FROM sites WHERE id = ?5)))`;

/** The size of the first version, which the schema made with the site, stated only when the site was made. */
const SIZE_FIRST_VERSION = "UPDATE versions SET bytes = ?2, files = ?3 WHERE folder = ?1 AND number = 1 AND changes() = 1";

/** Whether a site has `?1` as its public name or its id. */
const NAME_IS_HELD = "SELECT (EXISTS (SELECT 1 FROM sites WHERE public_name = ?1) OR EXISTS (SELECT 1 FROM sites WHERE id = ?1)) AS held";

/** A new access for a live site, only when it differs and the public name asked for is free. */
const SET_ACCESS = `
UPDATE sites SET access = ?2, public_name = ?3, updated_at = ?4
WHERE id = ?1 AND trashed = 0 AND (access <> ?2 OR public_name IS NOT ?3)
  AND (?3 IS NULL OR (NOT EXISTS (SELECT 1 FROM sites WHERE public_name = ?3 AND id <> ?1) AND NOT EXISTS (SELECT 1 FROM sites WHERE id = ?3)))`;

/** A new id for a live site, only while that id is free. */
const SET_ID = `
UPDATE sites SET id = ?2, updated_at = ?3
WHERE id = ?1 AND trashed = 0 AND NOT EXISTS (SELECT 1 FROM sites WHERE id = ?2) AND NOT EXISTS (SELECT 1 FROM sites WHERE public_name = ?2)`;

/** The counts of site `?1` on the days in the JSON list `?3`, moved to its new id `?2`, only when the statement before it wrote the audit entry of that change. */
const MOVE_COUNTS = "UPDATE request_counts SET site = ?2 WHERE site = ?1 AND day IN (SELECT j.value FROM json_each(?3) AS j) AND changes() = 1";

/** A live site into the trash. */
const TRASH = "UPDATE sites SET trashed_at = ?2, updated_at = ?2 WHERE id = ?1 AND trashed = 0";

/** A trashed site out of the trash, without an expiry that is not after `?2`. */
const RESTORE = "UPDATE sites SET trashed_at = NULL, updated_at = ?2, expires_at = CASE WHEN expires_at > ?2 THEN expires_at END WHERE id = ?1 AND trashed = 1";

/** The audit entry of a delete, written while the site is still there to name. */
const AUDIT_DELETE = "INSERT INTO audit (at, actor, action, site_id, site_name, detail) SELECT ?1, ?2, 'delete', id, name, '{}' FROM sites WHERE id = ?3";

/** The delete itself, only when its audit entry was written. */
const DELETE_SITE = "DELETE FROM sites WHERE id = ?1 AND changes() = 1";

/** A page of the leftovers in ascending order, from above folder `?1`. */
const LIST_LEFTOVERS = "SELECT folder FROM leftovers WHERE folder > ?1 ORDER BY folder LIMIT ?2";

/** The leftover of folder `?1`, forgotten. */
const FORGET_LEFTOVER = "DELETE FROM leftovers WHERE folder = ?1";

/** The next version number of a live site, set aside. */
const RESERVE = "UPDATE sites SET next_version = next_version + 1 WHERE id = ?1 AND trashed = 0";

/** The number the statement before it set aside. */
const RESERVED = "SELECT next_version - 1 AS number FROM sites WHERE id = ?1";

/** A version, only when its number was reserved and is above every kept one, so a slower, older publish never replaces a newer one. */
const INSERT_VERSION = `
INSERT INTO versions (folder, number, published_at, published_by, bytes, files)
SELECT s.folder, ?2, ?3, ?4, ?5, ?6 FROM sites s
WHERE s.id = ?1 AND s.trashed = 0 AND ?2 < s.next_version AND ?2 > (SELECT MAX(v.number) FROM versions v WHERE v.folder = s.folder)`;

/** The version just kept made live. */
const SET_LIVE_TO_NEW = "UPDATE sites SET live_version = ?2, updated_at = ?3 WHERE id = ?1 AND changes() = 1";

/** The versions beyond the `?2` highest dropped, only after a publish. */
const DROP_OLD_VERSIONS = `
DELETE FROM versions
WHERE changes() = 1 AND folder = (SELECT folder FROM sites WHERE id = ?1)
  AND number NOT IN (SELECT number FROM versions WHERE folder = (SELECT folder FROM sites WHERE id = ?1) ORDER BY number DESC LIMIT ?2)`;

/** A kept version of a live site made live, only when it is not live already. */
const SET_LIVE = `
UPDATE sites SET live_version = ?2, updated_at = ?3
WHERE id = ?1 AND trashed = 0 AND live_version <> ?2 AND EXISTS (SELECT 1 FROM versions v WHERE v.folder = sites.folder AND v.number = ?2)`;

/** The highest kept version below the live one made live. */
const SET_LIVE_TO_PREVIOUS = `
UPDATE sites SET live_version = (SELECT MAX(v.number) FROM versions v WHERE v.folder = sites.folder AND v.number < sites.live_version), updated_at = ?2
WHERE id = ?1 AND trashed = 0 AND EXISTS (SELECT 1 FROM versions v WHERE v.folder = sites.folder AND v.number < sites.live_version)`;

/** The audit entry of a move of the live version, naming the version the site is at now. */
const AUDIT_LIVE = `
INSERT INTO audit (at, actor, action, site_id, site_name, detail)
SELECT ?1, ?2, 'live_version', id, name, json_object('version', live_version) FROM sites WHERE id = ?3 AND changes() = 1`;

/** What the kept versions of the site with id `?1` hold together; `versions` is 0 for no site. */
const SITE_SIZE = `
SELECT COALESCE(SUM(v.bytes), 0) AS bytes, COALESCE(SUM(v.files), 0) AS files, COUNT(*) AS versions
FROM versions v WHERE v.folder = (SELECT folder FROM sites WHERE id = ?1)`;

/** The one row of running totals, which the schema keeps equal to the sums over every site and every kept version. */
const READ_TOTALS = "SELECT sites, trashed_sites, bytes, files FROM totals WHERE id = 1";

/** A page of every site in ascending order of id, from above `?1`. */
const EXPORT_SITES = `${SELECT_SITE} WHERE s.id > ?1 ORDER BY s.id LIMIT ?2`;

/** A site from a backup under the id it had, only while its id, its folder, and its public name are free, and upload `?16` is pending as the first version of its folder unless that is NULL. The schema adds its live version with the row. */
const IMPORT_SITE = `
INSERT INTO sites (id, name, folder, access, public_name, title, search_engines, embeddable, expires_at, live_version, next_version, owner, created_at, updated_at, trashed_at, page_title)
SELECT ?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?17
WHERE NOT EXISTS (SELECT 1 FROM sites WHERE id = ?1)
  AND NOT EXISTS (SELECT 1 FROM sites WHERE public_name = ?1)
  AND NOT EXISTS (SELECT 1 FROM sites WHERE folder = ?3)
  AND (?5 IS NULL OR (?5 <> ?1 AND NOT EXISTS (SELECT 1 FROM sites WHERE public_name = ?5) AND NOT EXISTS (SELECT 1 FROM sites WHERE id = ?5)))
  AND (?16 IS NULL OR EXISTS (SELECT 1 FROM uploads WHERE id = ?16 AND state = 'pending' AND folder = ?3 AND number = 1))`;

/** Every version of the list `?2` kept under folder `?1`, only when the site's audit entry was written. The live one is there already and takes its exported values. */
const IMPORT_VERSIONS = `
INSERT INTO versions (folder, number, published_at, published_by, bytes, files)
SELECT ?1, j.value ->> 'number', j.value ->> 'published_at', j.value ->> 'published_by', j.value ->> 'bytes', j.value ->> 'files'
FROM json_each(?2) j WHERE changes() = 1
ON CONFLICT (folder, number) DO UPDATE SET published_at = excluded.published_at, published_by = excluded.published_by, bytes = excluded.bytes, files = excluded.files`;

/** Whether a site already holds an imported site's id `?1`, as its id or its public name, and whether one holds its folder `?2`. */
const IMPORT_IS_HELD = `
SELECT (EXISTS (SELECT 1 FROM sites WHERE id = ?1) OR EXISTS (SELECT 1 FROM sites WHERE public_name = ?1)) AS id_held,
  EXISTS (SELECT 1 FROM sites WHERE folder = ?2) AS folder_held`;

/** Every column of an upload but its manifest. */
const UPLOAD_COLUMNS = "id, folder, number, owner, state, plan, bytes, files, dropped, created_at";

/** How many pending uploads holder `?4` began. */
const PENDING_OF_OWNER = "(SELECT COUNT(*) FROM uploads WHERE state = 'pending' AND owner = ?4)";

/** The bytes folder `?2` would hold: what its pending uploads declare, and the `?5` newest kept versions of its site. */
const BYTES_IN_FOLDER = `((SELECT COALESCE(SUM(bytes), 0) FROM uploads WHERE state = 'pending' AND folder = ?2)
  + (SELECT COALESCE(SUM(bytes), 0) FROM versions WHERE folder = ?2 AND number IN (SELECT number FROM versions WHERE folder = ?2 ORDER BY number DESC LIMIT ?5)))`;

/** The bytes of every kept version and every pending upload together. */
const BYTES_HELD = "((SELECT COALESCE(SUM(bytes), 0) FROM uploads WHERE state = 'pending') + (SELECT bytes FROM totals WHERE id = 1))";

/** The sites there are and the ones the pending uploads would make. Only a new site's upload has number 1. */
const SITES_HELD = "((SELECT COALESCE(SUM(number = 1), 0) FROM uploads WHERE state = 'pending') + (SELECT sites FROM totals WHERE id = 1))";

/** What a new upload of holder `?4` under folder `?2` is measured against, read before it is recorded. */
const UPLOAD_ROOM = `SELECT ?1 AS id, ?3 AS number, ${PENDING_OF_OWNER} AS own, ${BYTES_IN_FOLDER} AS folder_bytes, ${BYTES_HELD} AS total_bytes, ${SITES_HELD} AS sites`;

/** A new upload, pending, only while it fits: its owner's count under `?11`, its folder's bytes within `?12`, all bytes within `?13`, and the sites under `?14` unless that is NULL. */
const INSERT_UPLOAD = `
INSERT INTO uploads (id, folder, number, owner, plan, manifest, bytes, files, created_at)
SELECT ?1, ?2, ?3, ?4, ?6, ?7, ?8, ?9, ?10
WHERE ${PENDING_OF_OWNER} < ?11 AND ${BYTES_IN_FOLDER} + ?8 <= ?12 AND ${BYTES_HELD} + ?8 <= ?13 AND (?14 IS NULL OR ${SITES_HELD} < ?14)`;

/** The upload with id `?1`, without its manifest. */
const UPLOAD_BY_ID = `SELECT ${UPLOAD_COLUMNS} FROM uploads WHERE id = ?1`;

/** The upload with id `?1` and its whole manifest. */
const UPLOAD_WITH_MANIFEST = `SELECT ${UPLOAD_COLUMNS}, manifest FROM uploads WHERE id = ?1`;

/** The upload with id `?1` and the one file of its manifest at path `?2`, picked out by the engine so the manifest stays where it is. */
const UPLOAD_WITH_FILE = `
SELECT ${UPLOAD_COLUMNS}, (SELECT j.value FROM json_each(uploads.manifest) j WHERE j.value ->> 'path' = ?2) AS file
FROM uploads WHERE id = ?1`;

/** Added to `INSERT_SITE` for a site made from upload `?12`: only while that upload is pending and is the first version of the same folder. */
const WHILE_UPLOAD_IS_PENDING = "AND EXISTS (SELECT 1 FROM uploads WHERE id = ?12 AND state = 'pending' AND folder = ?3 AND number = 1)";

/** An upload marked finished and its manifest dropped, only when the statement before it changed a row. */
const FINISH_UPLOAD = "UPDATE uploads SET state = 'finished', manifest = '[]' WHERE id = ?1 AND changes() = 1";

/** Whether upload `?1` can be made its site's next version: it is pending, its site is live, and its number was reserved and is above every kept one. */
const UPLOAD_CAN_PUBLISH = `
EXISTS (SELECT 1 FROM uploads u JOIN sites s ON s.folder = u.folder
  WHERE u.id = ?1 AND u.state = 'pending' AND s.trashed = 0 AND u.number < s.next_version
    AND u.number > (SELECT MAX(v.number) FROM versions v WHERE v.folder = s.folder))`;

/** The access asked with upload `?1`, set by the rule of `SET_ACCESS`, only while the upload can be published. */
const SET_ACCESS_WITH_UPLOAD = `
UPDATE sites SET access = ?2, public_name = ?3, updated_at = ?4
WHERE folder = (SELECT folder FROM uploads WHERE id = ?1) AND (access <> ?2 OR public_name IS NOT ?3)
  AND (?3 IS NULL OR (NOT EXISTS (SELECT 1 FROM sites o WHERE o.public_name = ?3 AND o.folder <> sites.folder) AND NOT EXISTS (SELECT 1 FROM sites o WHERE o.id = ?3)))
  AND ${UPLOAD_CAN_PUBLISH}`;

/** The audit entry of a change made with upload `?4` to its site, written only when the statement before it changed a row. */
const AUDIT_WITH_UPLOAD = `
INSERT INTO audit (at, actor, action, site_id, site_name, detail)
SELECT ?1, ?2, ?3, id, name, ?5 FROM sites WHERE folder = (SELECT folder FROM uploads WHERE id = ?4) AND changes() = 1`;

/** Whether the site of upload `?1` has access `?2` under public name `?3`; true when no access is asked, which is a `?2` of NULL. */
const UPLOAD_HAS_ACCESS = `
(?2 IS NULL OR EXISTS (SELECT 1 FROM sites WHERE folder = (SELECT folder FROM uploads WHERE id = ?1) AND access = ?2 AND public_name IS ?3))`;

/** Whether a site other than the one of upload `?1` has `?2` as its public name, or any site has it as its id. */
const NAME_IS_HELD_BY_ANOTHER = `
SELECT (EXISTS (SELECT 1 FROM sites WHERE public_name = ?2 AND folder <> (SELECT folder FROM uploads WHERE id = ?1))
  OR EXISTS (SELECT 1 FROM sites WHERE id = ?2)) AS held`;

/** The version of upload `?1` with the size its manifest declared, only while the upload can be published and its site has the access asked with it. */
const INSERT_UPLOADED_VERSION = `
INSERT INTO versions (folder, number, published_at, published_by, bytes, files)
SELECT u.folder, u.number, ?4, ?5, u.bytes, u.files FROM uploads u
WHERE u.id = ?1 AND ${UPLOAD_HAS_ACCESS} AND ${UPLOAD_CAN_PUBLISH}`;

/** The version just kept for upload `?1` made live, with `?3` as the title of its entry page. */
const SET_LIVE_TO_UPLOADED = `
UPDATE sites SET live_version = (SELECT number FROM uploads WHERE id = ?1), page_title = ?3, updated_at = ?2
WHERE folder = (SELECT folder FROM uploads WHERE id = ?1) AND changes() = 1`;

/** The audit entry of the publish of upload `?3`, naming the version the site is at now. */
const AUDIT_UPLOADED_VERSION = `
INSERT INTO audit (at, actor, action, site_id, site_name, detail)
SELECT ?1, ?2, 'publish', s.id, s.name, json_object('version', s.live_version) FROM sites s
WHERE s.folder = (SELECT folder FROM uploads WHERE id = ?3) AND changes() = 1`;

/** Upload `?1` marked finished with the versions beyond the `?2` highest, which the next statement drops. */
const FINISH_UPLOADED_VERSION = `
UPDATE uploads SET state = 'finished', manifest = '[]', dropped = (
  SELECT json_group_array(v.number) FROM versions v
  WHERE v.folder = uploads.folder AND v.number NOT IN (SELECT k.number FROM versions k WHERE k.folder = uploads.folder ORDER BY k.number DESC LIMIT ?2))
WHERE id = ?1 AND changes() = 1`;

/** The versions beyond the `?2` highest dropped from the site of upload `?1`, only after its publish. */
const DROP_BEHIND_UPLOAD = `
DELETE FROM versions
WHERE changes() = 1 AND folder = (SELECT folder FROM uploads WHERE id = ?1)
  AND number NOT IN (SELECT number FROM versions WHERE folder = (SELECT folder FROM uploads WHERE id = ?1) ORDER BY number DESC LIMIT ?2)`;

/** The dropped versions of finished upload `?1` that still have files, as a JSON list. */
const SET_DROPPED = "UPDATE uploads SET dropped = ?2 WHERE id = ?1 AND state = 'finished'";

/** A pending upload given up, and its manifest dropped. */
const ABANDON_UPLOAD = "UPDATE uploads SET state = 'abandoned', manifest = '[]' WHERE id = ?1 AND state = 'pending'";

/** The record of an upload that takes no more files, removed. */
const DELETE_UPLOAD = "DELETE FROM uploads WHERE id = ?1 AND state <> 'pending'";

/** A page of the uploads begun before `?1`, the oldest first, from after the upload begun at `?2` with id `?3`. */
const LIST_UPLOADS = `SELECT ${UPLOAD_COLUMNS} FROM uploads WHERE created_at < ?1 AND (created_at, id) > (?2, ?3) ORDER BY created_at, id LIMIT ?4`;

/** Every column of a token. */
const SELECT_TOKEN = "SELECT id, hash, scope, note, created_at, expires_at FROM tokens";

/** A new token, only while its id is free. */
const INSERT_TOKEN =
  "INSERT INTO tokens (id, hash, scope, note, created_at, expires_at) SELECT ?1, ?2, ?3, ?4, ?5, ?6 WHERE NOT EXISTS (SELECT 1 FROM tokens WHERE id = ?1)";

/** The audit entry of a revoked token, written while the token is still there to name. */
const AUDIT_REVOKE = `
INSERT INTO audit (at, actor, action, detail)
SELECT ?1, ?2, 'token_revoked', json_object('token', id, 'scope', scope, 'note', note) FROM tokens WHERE id = ?3`;

/** The removal itself, only when its audit entry was written. */
const DELETE_TOKEN = "DELETE FROM tokens WHERE id = ?1 AND changes() = 1";

/** Every column of a login. */
const SELECT_LOGIN = "SELECT id, code, hash, scope, computer, visitor, state, decided_by, created_at, expires_at, polled_at FROM logins";

/** Whether id `?1` and code `?2` are both free, so the login that brings them will be stored. */
const LOGIN_IS_NEW = "NOT EXISTS (SELECT 1 FROM logins WHERE id = ?1 OR code = ?2)";

/** Room for a new login of visitor `?4`: of that visitor's logins that wait at `?3`, pending and not run out, all but the newest `?5` are removed. */
const MAKE_ROOM_OF_VISITOR = `
DELETE FROM logins
WHERE id IN (SELECT id FROM logins WHERE visitor = ?4 AND state = 'pending' AND expires_at > ?3 ORDER BY created_at DESC, id DESC LIMIT -1 OFFSET ?5) AND ${LOGIN_IS_NEW}`;

/** Room for a new login among all: once `?4` logins wait at `?3`, the oldest one of the visitor with the most is removed. */
const MAKE_ROOM_OF_ALL = `
DELETE FROM logins
WHERE id = (
  SELECT l.id FROM logins l WHERE l.state = 'pending' AND l.expires_at > ?3
  ORDER BY (SELECT COUNT(*) FROM logins o WHERE o.visitor = l.visitor AND o.state = 'pending' AND o.expires_at > ?3) DESC, l.created_at, l.id LIMIT 1
) AND (SELECT COUNT(*) FROM logins WHERE state = 'pending' AND expires_at > ?3) >= ?4 AND ${LOGIN_IS_NEW}`;

/** A new login, pending, only while its id and its code are free. */
const INSERT_LOGIN = `
INSERT INTO logins (id, code, hash, scope, computer, visitor, created_at, expires_at)
SELECT ?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8 WHERE ${LOGIN_IS_NEW}`;

/** The login under code `?1` allowed or denied by `?3`, only while it is pending and has not run out at `?4`. */
const DECIDE_LOGIN = "UPDATE logins SET state = ?2, decided_by = ?3 WHERE code = ?1 AND state = 'pending' AND expires_at > ?4";

/** The audit entry of a decided login, written only when the statement before it changed a row. It names the scope and the computer, and nothing of the secret. */
const AUDIT_LOGIN = `
INSERT INTO audit (at, actor, action, detail)
SELECT ?1, ?2, ?3, json_object('scope', scope, 'computer', computer) FROM logins WHERE code = ?4 AND changes() = 1`;

/** The time `?2` a pending login's terminal last asked, only when it last asked at or before `?3`. */
const POLL_LOGIN = "UPDATE logins SET polled_at = ?2 WHERE id = ?1 AND state = 'pending' AND (polled_at IS NULL OR polled_at <= ?3)";

/** A token for login `?1`, only while the login is allowed, has not run out at `?5`, and is of the token's scope `?7`. */
const INSERT_TOKEN_OF_LOGIN = `
INSERT INTO tokens (id, hash, scope, note, created_at, expires_at)
SELECT ?2, ?3, l.scope, ?4, ?5, ?6 FROM logins l
WHERE l.id = ?1 AND l.state = 'allowed' AND l.expires_at > ?5 AND l.scope = ?7 AND NOT EXISTS (SELECT 1 FROM tokens WHERE id = ?2)`;

/** The audit entry of that token, signed by whoever allowed login `?2`, written only when the token was stored. */
const AUDIT_TOKEN_OF_LOGIN = "INSERT INTO audit (at, actor, action, detail) SELECT ?1, decided_by, 'token_added', ?3 FROM logins WHERE id = ?2 AND changes() = 1";

/** The login removed, only when its token's audit entry was written. */
const DELETE_REDEEMED_LOGIN = "DELETE FROM logins WHERE id = ?1 AND changes() = 1";

/** Every login that ran out at or before `?1`, removed. */
const DELETE_OLD_LOGINS = "DELETE FROM logins WHERE expires_at <= ?1";

/** Where the sweep's walk stopped, as JSON text. */
const READ_SWEEP_PLACE = "SELECT place FROM sweep_place WHERE id = 1";

/** Where the sweep's walk stopped, in place of what was kept. */
const KEEP_SWEEP_PLACE = "INSERT INTO sweep_place (id, place) VALUES (1, ?1) ON CONFLICT (id) DO UPDATE SET place = excluded.place";

/** The sweep's place forgotten. */
const FORGET_SWEEP_PLACE = "DELETE FROM sweep_place";

/** The settings, as JSON text. */
const READ_SETTINGS = "SELECT value FROM settings WHERE id = 1";

/** The settings of a new install, only while none are stored. */
const INSERT_SETTINGS = "INSERT INTO settings (id, value, updated_at) SELECT 1, ?1, ?2 WHERE NOT EXISTS (SELECT 1 FROM settings WHERE id = 1)";

/** A merge patch: each key it names is replaced and every other key stays, in one statement, only when a value differs. */
const PATCH_SETTINGS = "UPDATE settings SET value = json_patch(value, ?1), updated_at = ?2 WHERE id = 1 AND json(json_patch(value, ?1)) <> json(value)";

/** The signing key, as hex text. */
const READ_SIGNING_KEY = "SELECT value FROM secrets WHERE name = 'session_key'";

/** A signing key, only while none is stored. */
const INSERT_SIGNING_KEY =
  "INSERT INTO secrets (name, value, created_at) SELECT 'session_key', ?1, ?2 WHERE NOT EXISTS (SELECT 1 FROM secrets WHERE name = 'session_key')";

/** A signing key in place of the stored one, or as the first. */
const REPLACE_SIGNING_KEY = `
INSERT INTO secrets (name, value, created_at) VALUES ('session_key', ?1, ?2)
ON CONFLICT (name) DO UPDATE SET value = excluded.value, created_at = excluded.created_at`;

/** The audit entries below `?1`, the newest first. */
const LIST_AUDIT = "SELECT seq, at, actor, action, site_id, site_name, detail FROM audit WHERE seq < ?1 ORDER BY seq DESC LIMIT ?2";

/** The form of a day: a date such as `2026-11-13`, which sorts as text in the order of time. */
const DAY_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

/** The site column of the row that counts all sites together; no site id is empty. */
const ALL_SITES = "";

/** The counts of every day before `?1`, dropped so the table holds seven days. */
const DROP_EARLIER_DAYS = "DELETE FROM request_counts WHERE day < ?1";

/** `?3` more requests on day `?1` for site `?2`, `?4` of them page views, and the count of requests after them. */
const ADD_REQUESTS = `
INSERT INTO request_counts (day, site, requests, views) VALUES (?1, ?2, ?3, ?4)
ON CONFLICT (day, site) DO UPDATE SET requests = requests + excluded.requests, views = views + excluded.views
RETURNING requests`;

/** The page views of each site in the JSON list `?2` over the days in the JSON list `?1`, and those of day `?3` among them. Every row is found by its key. */
const READ_VIEWS = `
SELECT c.site AS site, SUM(c.views) AS week, SUM(CASE WHEN c.day = ?3 THEN c.views ELSE 0 END) AS today
FROM json_each(?2) AS s CROSS JOIN json_each(?1) AS d
JOIN request_counts AS c ON c.day = d.value AND c.site = s.value
GROUP BY c.site`;

/** The most sites one read of views takes: a page of a listing. */
const MOST_VIEWED_SITES = 100;

/** The count of day `?1` for site `?2`; no row when nothing was counted. */
const READ_REQUESTS = "SELECT requests FROM request_counts WHERE day = ?1 AND site = ?2";

/** The column each site detail is stored in, and its stored value. */
const DETAIL_COLUMNS: { readonly [Key in keyof Required<SiteDetails>]: (value: Required<SiteDetails>[Key]) => readonly [column: string, stored: SqlValue] } = {
  name: (name) => ["name", name],
  title: (title) => ["title", title],
  search_engines: (allowed) => ["search_engines", allowed ? 1 : 0],
  embeddable: (allowed) => ["embeddable", allowed ? 1 : 0],
  expires: (expires) => ["expires_at", expires === "never" ? null : expires],
};

/** The `SET` and the differs-from condition of each detail given, with each stored value added to `params` and named by its place there. */
function detailColumns(given: SiteDetails, params: SqlValue[]): { readonly sets: string[]; readonly differs: string[] } {
  const sets: string[] = [];
  const differs: string[] = [];

  for (const key of ["name", "title", "search_engines", "embeddable", "expires"] as const) {
    const value = given[key];
    if (value === undefined) continue;

    const [column, stored] = (DETAIL_COLUMNS[key] as (value: unknown) => readonly [string, SqlValue])(value);
    params.push(stored);
    sets.push(`${column} = ?${params.length}`);
    differs.push(`${column} IS NOT ?${params.length}`);
  }

  return { sets, differs };
}

function sql(text: string, ...params: SqlValue[]): Statement {
  return { sql: text, params };
}

function auditSite(signed: Signed, action: AuditAction, id: SiteId, detail: Readonly<Record<string, unknown>>): Statement {
  return sql(AUDIT_SITE, signed.at, signed.by, action, id, JSON.stringify(detail));
}

function auditPlain(signed: Signed, action: AuditAction, detail: Readonly<Record<string, unknown>>): Statement {
  return sql(AUDIT_PLAIN, signed.at, signed.by, action, JSON.stringify(detail));
}

function requirePage(limit: number): void {
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > MAX_PAGE) throw new RangeError(`a page holds 1 to ${MAX_PAGE} rows, not ${limit}`);
}

function requireCount(what: string, count: number): void {
  if (!Number.isSafeInteger(count) || count < 0) throw new RangeError(`${what} is a whole number from 0 up, not ${count}`);
}

function publicNameOf(access: SiteAccess): PublicName | null {
  return access.access === "public" ? access.public_name : null;
}

function siteIn(result: StatementResult | undefined): Site | undefined {
  const row = result?.rows[0];

  return row === undefined ? undefined : siteFromRow(row);
}

function changed(result: StatementResult | undefined): boolean {
  return (result?.changes ?? 0) > 0;
}

function done(result: StatementResult | undefined): Done {
  const site = siteIn(result);
  if (site === undefined) throw new Error("a change to a site was made and the site is not there to read");

  return { kind: "done", site };
}

/** Why a site that is live could not be changed: there is none, or it sits in the trash. `undefined` for a live site. */
function unreachable(site: Site | undefined): Refused<"not_found" | "in_trash"> | undefined {
  if (site === undefined) return { kind: "not_found" };

  if (site.state === "trash") return { kind: "in_trash" };

  return undefined;
}

function uploadIn(result: StatementResult | undefined): Upload | undefined {
  const row = result?.rows[0];

  return row === undefined ? undefined : uploadFromRow(row);
}

function loginIn(result: StatementResult | undefined): ComputerLogin | undefined {
  const row = result?.rows[0];

  return row === undefined ? undefined : computerLoginFromRow(row);
}

function signingKeyIn(result: StatementResult | undefined): Uint8Array<ArrayBuffer> | undefined {
  const row = result?.rows[0];

  return row === undefined ? undefined : signingKeyFromRow(row);
}

function placeIn(result: StatementResult | undefined): SweepPlace | undefined {
  const text = result?.rows[0]?.place;
  if (typeof text !== "string") return undefined;

  const place = v.safeParse(SWEEP_PLACE, JSON.parse(text));

  return place.success ? place.output : undefined;
}

function settingsIn(result: StatementResult | undefined): SettingValues | undefined {
  const value = result?.rows[0]?.value;
  if (typeof value !== "string") return undefined;

  return v.parse(SETTING_VALUES, JSON.parse(value));
}

function requireDay(day: string): void {
  if (!DAY_PATTERN.test(day)) throw new RangeError(`a day is a date such as 2026-11-13, not ${JSON.stringify(day)}`);
}

function requestsIn(result: StatementResult | undefined): number {
  return Number(result?.rows[0]?.requests ?? 0);
}

/** Core's database over any SQLite a driver reaches: D1 in the Worker, `bun:sqlite` in the tests. */
export class SqlDatabase implements Database {
  readonly #driver: SqlDriver;

  readonly #mintId: () => SiteId;

  /**
   * @param driver - a database already at the current schema version
   * @param mintId - makes a candidate site id; the default draws 12 random base36 characters
   */
  constructor(driver: SqlDriver, mintId: () => SiteId = mintSiteId) {
    this.#driver = driver;
    this.#mintId = mintId;
  }

  async createSite(draft: NewSite, signed: Signed): Promise<Done | Refused<"name_taken">> {
    const made = await this.#insertSite(draft, signed);
    if (made.kind === "done") return made;

    if (made.kind === "not_pending") throw new Error("a site made from no upload waits for none");

    return { kind: "name_taken" };
  }

  async getSite(id: SiteId): Promise<Site | undefined> {
    const [found] = await this.#driver.batch([sql(SITE_BY_ID, id)]);

    return siteIn(found);
  }

  async getSiteNames(ids: readonly SiteId[]): Promise<ReadonlyMap<SiteId, SiteName>> {
    const [found] = await this.#driver.batch([sql(SITE_NAMES, JSON.stringify(ids))]);
    const named = (found?.rows ?? []).map((row) => v.parse(NAMED_SITE, row));

    return new Map(named.map(({ id, name }) => [id, name]));
  }

  async getSiteByPublicName(name: PublicName): Promise<Site | undefined> {
    const [found] = await this.#driver.batch([sql(SITE_BY_PUBLIC_NAME, name)]);

    return siteIn(found);
  }

  async getSiteByFolder(folder: Site["folder"]): Promise<Site | undefined> {
    const [found] = await this.#driver.batch([sql(SITE_BY_FOLDER, folder)]);

    return siteIn(found);
  }

  async findServed(address: Address, now: number): Promise<Site | undefined> {
    const lookup = "id" in address ? sql(`${SITE_BY_ID} ${IS_SERVED}`, address.id, now) : sql(`${SITE_BY_PUBLIC_NAME} ${IS_SERVED}`, address.public_name, now);
    const [found] = await this.#driver.batch([lookup]);

    return siteIn(found);
  }

  async listSites(query: SitesQuery): Promise<SitesPage> {
    requirePage(query.limit);

    const conditions = ["s.trashed = ?1"];
    const params: SqlValue[] = [query.trash ? 1 : 0];

    if (query.owner !== undefined) {
      params.push(query.owner);
      conditions.push(`s.owner = ?${params.length}`);
    }

    if (query.after !== undefined) {
      params.push(query.after.updated_at, query.after.id);
      conditions.push(`(s.updated_at, s.id) < (?${params.length - 1}, ?${params.length})`);
    }

    // One row more than the page shows whether another page follows.
    params.push(query.limit + 1);
    const text = `${SELECT_SITE} WHERE ${conditions.join(" AND ")} ORDER BY s.updated_at DESC, s.id DESC LIMIT ?${params.length}`;
    const [listed] = await this.#driver.batch([sql(text, ...params)]);
    const sites = (listed?.rows ?? []).slice(0, query.limit).map(siteFromRow);
    const last = sites.at(-1);
    if (last === undefined || (listed?.rows.length ?? 0) <= query.limit) return { sites };

    return { sites, next: { updated_at: last.updated_at, id: last.id } };
  }

  async changeAccess(id: SiteId, access: SiteAccess, signed: Signed): Promise<Done | Unchanged | Refused<"not_found" | "in_trash" | "name_taken">> {
    const publicName = publicNameOf(access);
    const [updated, , after] = await this.#driver.batch([
      sql(SET_ACCESS, id, access.access, publicName, signed.at),
      auditSite(signed, "access", id, { access: access.access, public_name: publicName }),
      sql(SITE_BY_ID, id),
    ]);
    if (changed(updated)) return done(after);

    const site = siteIn(after);
    const refusal = unreachable(site);
    if (site === undefined || refusal !== undefined) return refusal ?? { kind: "not_found" };

    if (site.access === access.access && publicNameOf(site) === publicName) return { kind: "unchanged", site };

    return { kind: "name_taken" };
  }

  async changeDetails(id: SiteId, details: SiteDetails, signed: Signed): Promise<Done | Unchanged | Refused<"not_found" | "in_trash">> {
    const given = v.parse(SITE_DETAILS, details);
    const params: SqlValue[] = [id, signed.at];
    const { sets, differs } = detailColumns(given, params);
    if (sets.length === 0) return this.#unchanged(id);

    const text = `UPDATE sites SET ${sets.join(", ")}, updated_at = ?2 WHERE id = ?1 AND trashed = 0 AND (${differs.join(" OR ")})`;
    const [updated, , after] = await this.#driver.batch([sql(text, ...params), auditSite(signed, "details", id, given), sql(SITE_BY_ID, id)]);
    if (changed(updated)) return done(after);

    return this.#unchangedIn(after);
  }

  async giveNewId(id: SiteId, signed: Signed): Promise<Done | Refused<"not_found" | "in_trash">> {
    for (let attempt = 0; attempt < MINT_ATTEMPTS; attempt += 1) {
      const next = this.#mintId();
      const [updated, , after, before] = await this.#driver.batch([
        sql(SET_ID, id, next, signed.at),
        auditSite(signed, "new_id", next, { from: id }),
        sql(SITE_BY_ID, next),
        sql(SITE_BY_ID, id),
        sql(MOVE_COUNTS, id, next, JSON.stringify(viewDays(dayOf(signed.at)))),
      ]);
      if (changed(updated)) return done(after);

      const refusal = unreachable(siteIn(before));
      if (refusal !== undefined) return refusal;
    }

    throw new Error(`no free site id in ${MINT_ATTEMPTS} tries`);
  }

  async trashSite(id: SiteId, signed: Signed): Promise<Done | Refused<"not_found" | "in_trash">> {
    const [updated, , after] = await this.#driver.batch([sql(TRASH, id, signed.at), auditSite(signed, "trash", id, {}), sql(SITE_BY_ID, id)]);
    if (changed(updated)) return done(after);

    return unreachable(siteIn(after)) ?? { kind: "not_found" };
  }

  async restoreSite(id: SiteId, signed: Signed): Promise<Done | Refused<"not_found" | "not_in_trash">> {
    const [updated, , after] = await this.#driver.batch([sql(RESTORE, id, signed.at), auditSite(signed, "restore", id, {}), sql(SITE_BY_ID, id)]);
    if (changed(updated)) return done(after);

    return { kind: siteIn(after) === undefined ? "not_found" : "not_in_trash" };
  }

  async deleteSite(id: SiteId, signed: Signed): Promise<Done | Refused<"not_found">> {
    const [before, , deleted] = await this.#driver.batch([sql(SITE_BY_ID, id), sql(AUDIT_DELETE, signed.at, signed.by, id), sql(DELETE_SITE, id)]);
    if (!changed(deleted)) return { kind: "not_found" };

    return done(before);
  }

  async listLeftovers(query: { readonly limit: number; readonly after?: SiteFolder }): Promise<LeftoversPage> {
    requirePage(query.limit);

    // One row more than the page shows whether another page follows.
    const [listed] = await this.#driver.batch([sql(LIST_LEFTOVERS, query.after ?? "", query.limit + 1)]);
    const folders = (listed?.rows ?? []).slice(0, query.limit).map((row) => v.parse(SITE_FOLDER, row.folder));
    const last = folders.at(-1);
    if (last === undefined || (listed?.rows.length ?? 0) <= query.limit) return { folders };

    return { folders, next: last };
  }

  async forgetLeftover(folder: SiteFolder): Promise<void> {
    await this.#driver.batch([sql(FORGET_LEFTOVER, folder)]);
  }

  async reserveVersion(id: SiteId): Promise<Reserved | Refused<"not_found" | "in_trash">> {
    const [updated, reserved, after] = await this.#driver.batch([sql(RESERVE, id), sql(RESERVED, id), sql(SITE_BY_ID, id)]);
    if (changed(updated)) return { kind: "reserved", number: Number(reserved?.rows[0]?.number) };

    return unreachable(siteIn(after)) ?? { kind: "not_found" };
  }

  async addVersion(id: SiteId, version: NewVersion, signed: Signed): Promise<Published | Refused<"not_found" | "in_trash" | "stale_number">> {
    if (!Number.isSafeInteger(version.keep) || version.keep < 1) throw new RangeError(`a site keeps at least 1 version, not ${version.keep}`);

    requireCount("the size of a version in bytes", version.bytes);
    requireCount("the number of files of a version", version.files);

    const [before, , updated, , , after] = await this.#driver.batch([
      sql(SITE_BY_ID, id),
      sql(INSERT_VERSION, id, version.number, signed.at, signed.by, version.bytes, version.files),
      sql(SET_LIVE_TO_NEW, id, version.number, signed.at),
      auditSite(signed, "publish", id, { version: version.number }),
      sql(DROP_OLD_VERSIONS, id, version.keep),
      sql(SITE_BY_ID, id),
    ]);
    if (!changed(updated)) return unreachable(siteIn(after)) ?? { kind: "stale_number" };

    const published = done(after);
    const kept = new Set(published.site.versions.map((entry) => entry.number));
    const dropped = (siteIn(before)?.versions ?? []).map((entry) => entry.number).filter((number) => !kept.has(number));

    return { ...published, dropped };
  }

  async setLiveVersion(
    id: SiteId,
    target: number | "previous",
    signed: Signed,
  ): Promise<Done | Unchanged | Refused<"not_found" | "in_trash" | "no_such_version">> {
    const update = target === "previous" ? sql(SET_LIVE_TO_PREVIOUS, id, signed.at) : sql(SET_LIVE, id, target, signed.at);
    const [updated, , after] = await this.#driver.batch([update, sql(AUDIT_LIVE, signed.at, signed.by, id), sql(SITE_BY_ID, id)]);
    if (changed(updated)) return done(after);

    const site = siteIn(after);
    const refusal = unreachable(site);
    if (site === undefined || refusal !== undefined) return refusal ?? { kind: "not_found" };

    if (site.live_version === target) return { kind: "unchanged", site };

    return { kind: "no_such_version" };
  }

  async getSiteSize(id: SiteId): Promise<SiteSize | undefined> {
    const [summed] = await this.#driver.batch([sql(SITE_SIZE, id)]);

    return sizeFromRow(summed?.rows[0]);
  }

  async readTotals(): Promise<Totals> {
    const [read] = await this.#driver.batch([sql(READ_TOTALS)]);

    return totalsFromRow(read?.rows[0]);
  }

  async exportSites(query: { readonly limit: number; readonly after?: SiteId }): Promise<ExportPage> {
    requirePage(query.limit);

    // One row more than the page shows whether another page follows.
    const [listed] = await this.#driver.batch([sql(EXPORT_SITES, query.after ?? "", query.limit + 1)]);
    const sites = (listed?.rows ?? []).slice(0, query.limit).map(siteFromRow);
    const last = sites.at(-1);
    if (last === undefined || (listed?.rows.length ?? 0) <= query.limit) return { sites };

    return { sites, next: last.id };
  }

  async importSite(site: Site, signed: Signed): Promise<Done | Refused<"id_taken" | "folder_taken" | "name_taken">> {
    const stored = await this.#storeSite(site, signed);
    if (stored.kind === "done") return stored;

    if (stored.kind === "not_pending") throw new Error("an import from no upload waited on one");

    return { kind: stored.kind };
  }

  importUploadAsSite(id: UploadId, site: Site, signed: Signed): Promise<Done | Refused<"id_taken" | "folder_taken" | "name_taken" | "not_pending">> {
    return this.#storeSite(site, signed, id);
  }

  async addUpload(upload: NewUpload, room: UploadRoom): Promise<{ readonly kind: "done" } | Refused<"own_full" | "folder_full" | "total_full" | "sites_full">> {
    const manifest = JSON.stringify(upload.manifest);
    const bytes = upload.manifest.reduce((sum, file) => sum + file.size, 0);
    const row = { ...upload, state: "pending", plan: JSON.stringify(upload.plan), bytes, files: upload.manifest.length, dropped: "[]" };
    const checked = uploadFromRow(row);
    const named: SqlValue[] = [checked.id, checked.folder, checked.number, checked.owner, room.staying];

    const [before, inserted] = await this.#driver.batch([
      sql(UPLOAD_ROOM, ...named),
      sql(INSERT_UPLOAD, ...named, row.plan, manifest, checked.bytes, checked.files, checked.created_at, room.own, room.folderBytes, room.totalBytes, room.sites),
    ]);
    if (changed(inserted)) return { kind: "done" };

    const held = before?.rows[0];
    if (Number(held?.own) >= room.own) return { kind: "own_full" };

    if (Number(held?.folder_bytes) + checked.bytes > room.folderBytes) return { kind: "folder_full" };

    return { kind: Number(held?.total_bytes) + checked.bytes > room.totalBytes ? "total_full" : "sites_full" };
  }

  async getUpload(id: UploadId): Promise<{ readonly upload: Upload; readonly manifest: readonly ManifestFile[] } | undefined> {
    const [found] = await this.#driver.batch([sql(UPLOAD_WITH_MANIFEST, id)]);
    const upload = uploadIn(found);
    if (upload === undefined) return undefined;

    return { upload, manifest: manifestFromText(found?.rows[0]?.manifest) };
  }

  async getUploadFile(id: UploadId, path: string): Promise<{ readonly upload: Upload; readonly file: ManifestFile | undefined } | undefined> {
    const [found] = await this.#driver.batch([sql(UPLOAD_WITH_FILE, id, path)]);
    const upload = uploadIn(found);
    if (upload === undefined) return undefined;

    const file = found?.rows[0]?.file;
    if (typeof file !== "string") return { upload, file: undefined };

    return { upload, file: v.parse(MANIFEST_FILE, JSON.parse(file)) };
  }

  publishUploadAsSite(id: UploadId, draft: NewSite, signed: Signed): Promise<Done | Refused<"name_taken" | "not_pending">> {
    return this.#insertSite(draft, signed, id);
  }

  async publishUploadAsVersion(
    id: UploadId,
    version: UploadedVersion,
    signed: Signed,
  ): Promise<Published | Refused<"not_found" | "in_trash" | "name_taken" | "stale_number" | "not_pending">> {
    if (!Number.isSafeInteger(version.keep) || version.keep < 1) throw new RangeError(`a site keeps at least 1 version, not ${version.keep}`);

    const access = version.access?.access ?? null;
    const publicName = version.access === undefined ? null : publicNameOf(version.access);
    const settings = [...this.#accessWith(id, version.access, signed), ...this.#detailsWith(id, { access, publicName, details: version.details }, signed)];
    const results = await this.#driver.batch([
      ...settings,
      sql(INSERT_UPLOADED_VERSION, id, access, publicName, signed.at, signed.by),
      sql(SET_LIVE_TO_UPLOADED, id, signed.at, version.page_title ?? null),
      sql(AUDIT_UPLOADED_VERSION, signed.at, signed.by, id),
      sql(FINISH_UPLOADED_VERSION, id, version.keep),
      sql(DROP_BEHIND_UPLOAD, id, version.keep),
      sql(SITE_OF_UPLOAD, id),
      sql(UPLOAD_BY_ID, id),
      sql(NAME_IS_HELD_BY_ANOTHER, id, publicName),
    ]);
    const [inserted, , , , , after, finished, held] = results.slice(settings.length);
    const upload = uploadIn(finished);
    if (changed(inserted) && upload !== undefined) return { ...done(after), dropped: upload.dropped };

    if (upload?.state !== "pending") return { kind: "not_pending" };

    const refusal = unreachable(siteIn(after));
    if (refusal !== undefined) return refusal;

    return { kind: held?.rows[0]?.held === 1 ? "name_taken" : "stale_number" };
  }

  async setUploadDropped(id: UploadId, dropped: readonly number[]): Promise<void> {
    await this.#driver.batch([sql(SET_DROPPED, id, JSON.stringify(dropped))]);
  }

  async abandonUpload(id: UploadId): Promise<boolean> {
    const [abandoned] = await this.#driver.batch([sql(ABANDON_UPLOAD, id)]);

    return changed(abandoned);
  }

  async removeUpload(id: UploadId): Promise<boolean> {
    const [removed] = await this.#driver.batch([sql(DELETE_UPLOAD, id)]);

    return changed(removed);
  }

  async listUploads(query: { readonly before: number; readonly limit: number; readonly after?: { readonly created_at: number; readonly id: UploadId } }): Promise<UploadsPage> {
    requirePage(query.limit);

    // One row more than the page shows whether another page follows.
    const [listed] = await this.#driver.batch([sql(LIST_UPLOADS, query.before, query.after?.created_at ?? -1, query.after?.id ?? "", query.limit + 1)]);
    const uploads = (listed?.rows ?? []).slice(0, query.limit).map(uploadFromRow);
    const last = uploads.at(-1);
    if (last === undefined || (listed?.rows.length ?? 0) <= query.limit) return { uploads };

    return { uploads, next: { created_at: last.created_at, id: last.id } };
  }

  async addToken(token: TokenRecord, signed: Signed): Promise<{ readonly kind: "done" } | Refused<"id_taken">> {
    const expires = token.scope === "admin" ? token.expiresAt : null;
    const [inserted] = await this.#driver.batch([
      sql(INSERT_TOKEN, token.id, token.hash, token.scope, token.note, token.createdAt, expires),
      auditPlain(signed, "token_added", { token: token.id, scope: token.scope, note: token.note }),
    ]);

    return { kind: changed(inserted) ? "done" : "id_taken" };
  }

  async getToken(id: TokenId): Promise<TokenRecord | undefined> {
    const [found] = await this.#driver.batch([sql(`${SELECT_TOKEN} WHERE id = ?1`, id)]);
    const row = found?.rows[0];

    return row === undefined ? undefined : tokenFromRow(row);
  }

  async listTokens(): Promise<readonly TokenRecord[]> {
    const [listed] = await this.#driver.batch([sql(`${SELECT_TOKEN} ORDER BY created_at DESC, id DESC`)]);

    return (listed?.rows ?? []).map(tokenFromRow);
  }

  async revokeToken(id: TokenId, signed: Signed): Promise<{ readonly kind: "done"; readonly token: TokenRecord } | Refused<"not_found">> {
    const [before, , deleted] = await this.#driver.batch([
      sql(`${SELECT_TOKEN} WHERE id = ?1`, id),
      sql(AUDIT_REVOKE, signed.at, signed.by, id),
      sql(DELETE_TOKEN, id),
    ]);
    const row = before?.rows[0];
    if (!changed(deleted) || row === undefined) return { kind: "not_found" };

    return { kind: "done", token: tokenFromRow(row) };
  }

  async addComputerLogin(login: PendingLogin, room: LoginRoom): Promise<{ readonly kind: "done" } | Refused<"taken">> {
    const [, , inserted] = await this.#driver.batch([
      sql(MAKE_ROOM_OF_VISITOR, login.id, login.code, login.createdAt, login.visitor, room.perVisitor - 1),
      sql(MAKE_ROOM_OF_ALL, login.id, login.code, login.createdAt, room.all),
      sql(INSERT_LOGIN, login.id, login.code, login.hash, login.scope, login.computer, login.visitor, login.createdAt, login.expiresAt),
    ]);

    return { kind: changed(inserted) ? "done" : "taken" };
  }

  async getComputerLogin(id: LoginId): Promise<ComputerLogin | undefined> {
    const [found] = await this.#driver.batch([sql(`${SELECT_LOGIN} WHERE id = ?1`, id)]);

    return loginIn(found);
  }

  async findComputerLogin(code: UserCode): Promise<ComputerLogin | undefined> {
    const [found] = await this.#driver.batch([sql(`${SELECT_LOGIN} WHERE code = ?1`, code)]);

    return loginIn(found);
  }

  async decideComputerLogin(code: UserCode, decision: LoginDecision): Promise<{ readonly kind: "done"; readonly login: ComputerLogin } | Refused<"not_pending">> {
    const [updated, , after] = await this.#driver.batch([
      sql(DECIDE_LOGIN, code, decision.state, decision.by, decision.at),
      sql(AUDIT_LOGIN, decision.at, decision.by, decision.state === "allowed" ? "login_allowed" : "login_denied", code),
      sql(`${SELECT_LOGIN} WHERE code = ?1`, code),
    ]);
    const login = loginIn(after);
    if (!changed(updated) || login === undefined) return { kind: "not_pending" };

    return { kind: "done", login };
  }

  async pollComputerLogin(id: LoginId, poll: { readonly at: number; readonly notAfter: number }): Promise<boolean> {
    const [polled] = await this.#driver.batch([sql(POLL_LOGIN, id, poll.at, poll.notAfter)]);

    return changed(polled);
  }

  async redeemComputerLogin(id: LoginId, token: TokenRecord): Promise<{ readonly kind: "done" } | Refused<"not_allowed">> {
    const expires = token.scope === "admin" ? token.expiresAt : null;
    const detail = JSON.stringify({ token: token.id, scope: token.scope, note: token.note });
    const [inserted] = await this.#driver.batch([
      sql(INSERT_TOKEN_OF_LOGIN, id, token.id, token.hash, token.note, token.createdAt, expires, token.scope),
      sql(AUDIT_TOKEN_OF_LOGIN, token.createdAt, id, detail),
      sql(DELETE_REDEEMED_LOGIN, id),
    ]);

    return { kind: changed(inserted) ? "done" : "not_allowed" };
  }

  async sweepComputerLogins(now: number): Promise<number> {
    const [removed] = await this.#driver.batch([sql(DELETE_OLD_LOGINS, now)]);

    return removed?.changes ?? 0;
  }

  async readSweepPlace(): Promise<SweepPlace | undefined> {
    const [read] = await this.#driver.batch([sql(READ_SWEEP_PLACE)]);

    return placeIn(read);
  }

  async keepSweepPlace(place: SweepPlace | undefined): Promise<void> {
    const kept = place === undefined ? sql(FORGET_SWEEP_PLACE) : sql(KEEP_SWEEP_PLACE, JSON.stringify(v.parse(SWEEP_PLACE, place)));

    await this.#driver.batch([kept]);
  }

  async readSettings(): Promise<SettingValues | undefined> {
    const [read] = await this.#driver.batch([sql(READ_SETTINGS)]);

    return settingsIn(read);
  }

  async initSettings(values: SettingValues, signed: Signed): Promise<{ readonly kind: "done" | "already_set"; readonly values: SettingValues }> {
    const checked = v.parse(SETTING_VALUES, values);
    const [inserted, , read] = await this.#driver.batch([
      sql(INSERT_SETTINGS, JSON.stringify(checked), signed.at),
      auditPlain(signed, "settings_set", {}),
      sql(READ_SETTINGS),
    ]);
    const stored = settingsIn(read);
    if (stored === undefined) throw new Error("the settings were stored and are not there to read");

    return { kind: changed(inserted) ? "done" : "already_set", values: stored };
  }

  async changeSettings(
    changes: Partial<SettingValues>,
    signed: Signed,
  ): Promise<{ readonly kind: "done" | "unchanged"; readonly values: SettingValues } | Refused<"not_set_up">> {
    const checked = v.parse(SETTING_CHANGES, changes);
    const [patched, , read] = await this.#driver.batch([
      sql(PATCH_SETTINGS, JSON.stringify(checked), signed.at),
      auditPlain(signed, "settings_changed", checked),
      sql(READ_SETTINGS),
    ]);
    const values = settingsIn(read);
    if (values === undefined) return { kind: "not_set_up" };

    return { kind: changed(patched) ? "done" : "unchanged", values };
  }

  async readSigningKey(): Promise<Uint8Array<ArrayBuffer> | undefined> {
    const [read] = await this.#driver.batch([sql(READ_SIGNING_KEY)]);

    return signingKeyIn(read);
  }

  async ensureSigningKey(fresh: Uint8Array, at: number): Promise<SigningKey> {
    const [inserted, read] = await this.#driver.batch([sql(INSERT_SIGNING_KEY, signingKeyToText(fresh), at), sql(READ_SIGNING_KEY)]);
    const key = signingKeyIn(read);
    if (key === undefined) throw new Error("the signing key was stored and is not there to read");

    return { kind: changed(inserted) ? "created" : "kept", key };
  }

  async rotateSigningKey(fresh: Uint8Array, signed: Signed): Promise<void> {
    await this.#driver.batch([sql(REPLACE_SIGNING_KEY, signingKeyToText(fresh), signed.at), auditPlain(signed, "signed_everyone_out", {})]);
  }

  async appendAudit(note: AuditNote, signed: Signed): Promise<void> {
    await this.#driver.batch([sql(AUDIT_NOTE, signed.at, signed.by, note.action, note.site?.id ?? null, note.site?.name ?? null, JSON.stringify(note.detail))]);
  }

  async listAudit(query: { readonly limit: number; readonly before?: number }): Promise<readonly AuditEntry[]> {
    requirePage(query.limit);
    const [listed] = await this.#driver.batch([sql(LIST_AUDIT, query.before ?? NEWEST, query.limit)]);

    return (listed?.rows ?? []).map(auditFromRow);
  }

  async addRequests(counted: CountedRequests): Promise<RequestCounts> {
    requireDay(counted.day);
    if (!Number.isSafeInteger(counted.requests) || counted.requests < 1) throw new RangeError(`requests are counted in whole numbers from 1, not ${counted.requests}`);

    const views = counted.views ?? 0;
    if (!Number.isSafeInteger(views) || views < 0 || views > counted.requests) throw new RangeError(`views are counted in whole numbers from 0 to the requests, not ${views}`);

    const [, site, all] = await this.#driver.batch([
      sql(DROP_EARLIER_DAYS, viewDays(counted.day)[0] ?? counted.day),
      sql(ADD_REQUESTS, counted.day, counted.site, counted.requests, views),
      sql(ADD_REQUESTS, counted.day, ALL_SITES, counted.requests, views),
    ]);

    return { site: requestsIn(site), all: requestsIn(all) };
  }

  async readViews(sites: readonly SiteId[], day: string): Promise<ReadonlyMap<SiteId, SiteViews>> {
    requireDay(day);
    if (sites.length > MOST_VIEWED_SITES) throw new RangeError(`the views of at most ${MOST_VIEWED_SITES} sites are read at once, not of ${sites.length}`);

    const views = new Map<SiteId, SiteViews>(sites.map((site) => [site, { today: 0, week: 0 }]));
    if (sites.length === 0) return views;

    // A site named twice is read once: its rows would be summed once for each naming.
    const [read] = await this.#driver.batch([sql(READ_VIEWS, JSON.stringify(viewDays(day)), JSON.stringify([...views.keys()]), day)]);
    for (const row of read?.rows ?? []) views.set(row.site as SiteId, { today: Number(row.today), week: Number(row.week) });

    return views;
  }

  async readRequests(day: string, site?: SiteId): Promise<RequestCounts> {
    requireDay(day);
    const ofSite = site === undefined ? [] : [sql(READ_REQUESTS, day, site)];
    const read = await this.#driver.batch([sql(READ_REQUESTS, day, ALL_SITES), ...ofSite]);

    return { site: requestsIn(read[1]), all: requestsIn(read[0]) };
  }

  /** The statements that set the access asked with an upload, and their audit entry; none when no access is asked. */
  #accessWith(id: UploadId, access: SiteAccess | undefined, signed: Signed): Statement[] {
    if (access === undefined) return [];

    const detail = { access: access.access, public_name: publicNameOf(access) };

    return [
      sql(SET_ACCESS_WITH_UPLOAD, id, access.access, publicNameOf(access), signed.at),
      sql(AUDIT_WITH_UPLOAD, signed.at, signed.by, "access", id, JSON.stringify(detail)),
    ];
  }

  /** The statements that set the details asked with an upload, only once its site has the access asked with it, and their audit entry; none when no detail is asked. */
  #detailsWith(
    id: UploadId,
    asked: { readonly access: string | null; readonly publicName: string | null; readonly details: SiteDetails },
    signed: Signed,
  ): Statement[] {
    const given = v.parse(SITE_DETAILS, asked.details);
    const params: SqlValue[] = [id, asked.access, asked.publicName, signed.at];
    const { sets, differs } = detailColumns(given, params);
    if (sets.length === 0) return [];

    const text = `
UPDATE sites SET ${sets.join(", ")}, updated_at = ?4
WHERE folder = (SELECT folder FROM uploads WHERE id = ?1) AND (${differs.join(" OR ")}) AND ${UPLOAD_HAS_ACCESS} AND ${UPLOAD_CAN_PUBLISH}`;

    return [sql(text, ...params), sql(AUDIT_WITH_UPLOAD, signed.at, signed.by, "details", id, JSON.stringify(given))];
  }

  /** Make a site under a fresh id; with `upload`, only while that upload is pending, and marking it finished in the same step. */
  async #insertSite(draft: NewSite, signed: Signed, upload?: UploadId): Promise<Done | Refused<"name_taken" | "not_pending">> {
    const site = v.parse(NEW_SITE, draft);
    const publicName = publicNameOf(site);
    const expires = site.expires === "never" ? null : site.expires;
    const detail = { access: site.access, public_name: publicName };
    const columns = [site.name, site.folder, site.access, publicName, site.title, site.search_engines ? 1 : 0, expires, signed.by, signed.at, site.embeddable ? 1 : 0];
    const text = upload === undefined ? INSERT_SITE : `${INSERT_SITE}\n  ${WHILE_UPLOAD_IS_PENDING}`;
    const insert = (id: SiteId): Statement => sql(text, id, ...columns, upload ?? null, site.page_title ?? null);

    for (let attempt = 0; attempt < MINT_ATTEMPTS; attempt += 1) {
      const id = this.#mintId();
      const [inserted, , , , held, made, waiting] = await this.#driver.batch([
        insert(id),
        sql(SIZE_FIRST_VERSION, site.folder, site.bytes, site.files),
        auditSite(signed, "create", id, detail),
        sql(FINISH_UPLOAD, upload ?? null),
        sql(NAME_IS_HELD, publicName),
        sql(SITE_BY_ID, id),
        sql(UPLOAD_BY_ID, upload ?? null),
      ]);
      if (changed(inserted)) return done(made);

      if (upload !== undefined && uploadIn(waiting)?.state !== "pending") return { kind: "not_pending" };

      if (publicName !== null && held?.rows[0]?.held === 1) return { kind: "name_taken" };
    }

    throw new Error(`no free site id in ${MINT_ATTEMPTS} tries`);
  }

  /** Store a site from a backup under its own id; with `upload`, only while that upload is pending, and marking it finished in the same step. */
  async #storeSite(site: Site, signed: Signed, upload?: UploadId): Promise<Done | Refused<"id_taken" | "folder_taken" | "name_taken" | "not_pending">> {
    const row = siteToRow(site);
    const nextVersion = Math.max(...row.versions.map((version) => version.number)) + 1;
    const identity: SqlValue[] = [row.id, row.name, row.folder, row.access, row.public_name, row.title, row.search_engines, row.embeddable, row.expires_at, row.live_version, nextVersion];

    // The upload is finished straight after the audit entry, so each statement up to the versions sees the one row the statement before it wrote.
    const results = await this.#driver.batch([
      sql(IMPORT_SITE, ...identity, row.owner, row.created_at, row.updated_at, row.trashed_at, upload ?? null, row.page_title),
      auditSite(signed, "imported", row.id, { versions: row.versions.length }),
      ...(upload === undefined ? [] : [sql(FINISH_UPLOAD, upload)]),
      sql(IMPORT_VERSIONS, row.folder, JSON.stringify(row.versions)),
      sql(IMPORT_IS_HELD, row.id, row.folder),
      sql(SITE_BY_ID, row.id),
      sql(UPLOAD_BY_ID, upload ?? null),
    ]);
    const [held, made, waiting] = results.slice(-3);
    if (changed(results[0])) return done(made);

    const begun = uploadIn(waiting);
    if (upload !== undefined && (begun?.state !== "pending" || begun.folder !== row.folder || begun.number !== 1)) return { kind: "not_pending" };

    if (held?.rows[0]?.id_held === 1) return { kind: "id_taken" };

    if (held?.rows[0]?.folder_held === 1) return { kind: "folder_taken" };

    return { kind: "name_taken" };
  }

  async #unchanged(id: SiteId): Promise<Unchanged | Refused<"not_found" | "in_trash">> {
    const [found] = await this.#driver.batch([sql(SITE_BY_ID, id)]);

    return this.#unchangedIn(found);
  }

  #unchangedIn(result: StatementResult | undefined): Unchanged | Refused<"not_found" | "in_trash"> {
    const site = siteIn(result);
    const refusal = unreachable(site);
    if (site === undefined || refusal !== undefined) return refusal ?? { kind: "not_found" };

    return { kind: "unchanged", site };
  }
}
