// The statements that read and change uploads, the room an upload is given, and the day's count of writes to the store.

import { and, eq, type SQL, sql as fragment } from "drizzle-orm";
import { alias } from "drizzle-orm/sqlite-core";

import type { UploadId } from "../records/upload";
import type { Statement } from "./driver";
import { declaredFiles, sites, totals, uploads, versions } from "./schema";
import { BUILD, CHANGED, bare, built, insertFrom } from "./statements";

/** Every column of an upload but its manifest. */
export const UPLOAD_FIELDS = {
  id: uploads.id,
  folder: uploads.folder,
  number: uploads.number,
  owner: uploads.owner,
  state: uploads.state,
  plan: uploads.plan,
  bytes: uploads.bytes,
  files: uploads.files,
  dropped: uploads.dropped,
  created_at: uploads.created_at,
};

/** The bytes of every pending upload and every kept version together. */
export const BYTES_HELD = fragment`((SELECT COALESCE(SUM(${uploads.bytes}), 0) FROM ${uploads} WHERE ${uploads.state} = 'pending') + (SELECT ${totals.bytes} FROM ${totals} WHERE ${totals.id} = 1))`;

/** The sites there are and the ones the pending uploads would make. Only a new site's upload has number 1. */
export const SITES_HELD = fragment`((SELECT COALESCE(SUM(${uploads.number} = 1), 0) FROM ${uploads} WHERE ${uploads.state} = 'pending') + (SELECT ${totals.sites} FROM ${totals} WHERE ${totals.id} = 1))`;

/** The `uploads` table as `u`, for a subquery inside a statement on the same table. In the template an alias stands for its short name alone, so a FROM names the table before it. */
export const AN_UPLOAD = alias(uploads, "u");

/** The `sites` table as `s`. */
const ITS_SITE = alias(sites, "s");

/** The `versions` table as `v`. */
export const A_VERSION = alias(versions, "v");

/** How many times the store was written to or listed on a day. */
export function writesOf(day: string): SQL {
  return fragment`(SELECT COALESCE(SUM(${declaredFiles.writes}), 0) FROM ${declaredFiles} WHERE ${declaredFiles.day} = ${day})`;
}

/** The counts of every day before the one before the given day, dropped. Yesterday's stay: an upload that began just before midnight is still counted against it. */
export function dropEarlierDays(day: string): Statement {
  return built(BUILD.delete(declaredFiles).where(fragment`${declaredFiles.day} < date(${day}, '-1 day')`));
}

/** So many more writes on a day, on the row it shares with the day's declared files, only while the condition holds. */
export function addWrites(day: string, writes: number, condition: SQL): Statement {
  const counted = bare(declaredFiles.writes);
  const added = fragment`SELECT ${day}, 0, ${writes} WHERE ${condition} ON CONFLICT (${bare(declaredFiles.day)}) DO UPDATE SET ${counted} = ${counted} + excluded.${counted}`;

  return insertFrom(declaredFiles, [declaredFiles.day, declaredFiles.files, declaredFiles.writes], added);
}

/** The upload with the given id, without its manifest. */
export function uploadById(id: UploadId): Statement {
  return built(BUILD.select(UPLOAD_FIELDS).from(uploads).where(eq(uploads.id, id)));
}

/** An upload marked finished and its manifest dropped, only when the statement before it changed a row. */
export function finishUpload(id: UploadId): Statement {
  return built(BUILD.update(uploads).set({ state: "finished", manifest: "{}" }).where(and(eq(uploads.id, id), CHANGED)));
}

/** How many pending uploads a holder began. */
export function pendingOf(owner: string): SQL {
  return fragment`(SELECT COUNT(*) FROM ${uploads} WHERE ${uploads.state} = 'pending' AND ${uploads.owner} = ${owner})`;
}

/** The bytes a folder would hold: what its pending uploads declare, and the `staying` newest kept versions of its site. */
export function bytesIn(folder: string, staying: number): SQL {
  const pending = fragment`(SELECT COALESCE(SUM(${uploads.bytes}), 0) FROM ${uploads} WHERE ${uploads.state} = 'pending' AND ${uploads.folder} = ${folder})`;
  const newest = fragment`(SELECT ${versions.number} FROM ${versions} WHERE ${versions.folder} = ${folder} ORDER BY ${versions.number} DESC LIMIT ${staying})`;

  return fragment`(${pending} + (SELECT COALESCE(SUM(${versions.bytes}), 0) FROM ${versions} WHERE ${versions.folder} = ${folder} AND ${versions.number} IN ${newest}))`;
}

/** The folder of an upload, as a subquery. */
export function folderOf(upload: UploadId): SQL {
  return fragment`(SELECT ${uploads.folder} FROM ${uploads} WHERE ${uploads.id} = ${upload})`;
}

/** Whether an upload can be made its site's next version: it is pending, its site is live, and its number was set aside and is above every kept one. */
export function canPublish(upload: UploadId): SQL {
  const above = fragment`(SELECT MAX(${A_VERSION.number}) FROM ${versions} ${A_VERSION} WHERE ${A_VERSION.folder} = ${ITS_SITE.folder})`;
  const ready = fragment`${AN_UPLOAD.id} = ${upload} AND ${AN_UPLOAD.state} = 'pending' AND ${ITS_SITE.trashed} = 0 AND ${AN_UPLOAD.number} < ${ITS_SITE.next_version} AND ${AN_UPLOAD.number} > ${above}`;

  return fragment`EXISTS (SELECT 1 FROM ${uploads} ${AN_UPLOAD} JOIN ${sites} ${ITS_SITE} ON ${ITS_SITE.folder} = ${AN_UPLOAD.folder} WHERE ${ready})`;
}

/** Whether the site of an upload has the access asked with it, under the public name asked; true when no access is asked. */
export function hasAccess(upload: UploadId, access: string | null, publicName: string | null): SQL {
  const asked = fragment`${sites.folder} = ${folderOf(upload)} AND ${sites.access} = ${access} AND ${sites.public_name} IS ${publicName}`;

  return fragment`(${access} IS NULL OR EXISTS (SELECT 1 FROM ${sites} WHERE ${asked}))`;
}
