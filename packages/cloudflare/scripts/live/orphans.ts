// Remove from the test install's bucket the files that no record of its database names.
//
//   the account, checked to be the test account -> every object of the bucket, a thousand a list -> the folders their keys start with
//     -> the folders the database names: of a site, in the trash or not, of an upload, and of a removed site whose files the install still removes
//     -> every other folder emptied, one object a call, until the ceiling
//
// The install finds a folder by its record alone. A run that makes the database anew drops every record, and the files of the database before it stay in the bucket with nothing to remove them.
// The bucket is listed before the database is read, so a folder made in between is in no listing, and one listed has its record by then.
// A run removes what fits its ceiling of lists and deletes, and says what is left: the next run goes on. A key that starts with no folder of a site is never touched.

import { SITE_FOLDER } from "@poplin/core/src/records/site";
import { BaseDatabase } from "cloudflare/resources/d1/database/database";
import { BaseObjects } from "cloudflare/resources/r2/buckets/objects";
import * as v from "valibot";

import { callCloudflare, type Zone } from "../../src/zone/client";
import { refuseOtherAccount } from "./test-account";
import { BUCKET, isStop, type Run, type Stop, stopOf } from "./util";

/** The most objects one list of the bucket answers. */
const PAGE = 1000;

/** What joins the segments of a key: a site's folder is the first of them. */
const SEPARATOR = "/";

/** Every folder a record of the database names. */
const NAMED_FOLDERS = "SELECT folder FROM sites UNION SELECT folder FROM uploads UNION SELECT folder FROM leftovers";

/** The rows that statement answers. */
const NAMED_ROWS = v.array(v.object({ folder: SITE_FOLDER }));

/** Sent with every call to the bucket: the client sends none again by itself, so each call is one request and the count is the bucket's own. */
const ONCE = { maxRetries: 0 } as const;

/** The token permission each call needs. */
const PERMISSIONS = { bucket: "Workers R2 Storage: Edit", database: "D1: Edit" } as const;

/** What one removal came to. */
export interface Orphans {
  /** The folders it emptied. */
  readonly folders: number;

  /** The objects it removed. */
  readonly objects: number;

  /** The folders no record names that still hold objects, and how many: what the ceiling left for the next run. */
  readonly left: { readonly folders: number; readonly objects: number };

  /** The lists and deletes it asked the bucket for. */
  readonly calls: number;

  /** Why a delete did not go through, which ended the removal with the rest left; absent for a removal that ran to its end or its ceiling. */
  readonly stopped?: Stop;
}

/** The lists and deletes of one removal: how many were asked for, and the most that may be. */
interface Calls {
  spent: number;
  readonly ceiling: number;
}

/** The first segment of a key where it is the folder of a site; `undefined` for any other key. */
function folderOf(key: string): string | undefined {
  const [folder, ...rest] = key.split(SEPARATOR);

  return rest.length > 0 && v.is(SITE_FOLDER, folder) ? folder : undefined;
}

/** Add a key to the keys of the site's folder it starts with; a key that starts with none is left out. */
function keep(folders: Map<string, string[]>, key: string): void {
  const folder = folderOf(key);
  if (folder === undefined) return;

  const held = folders.get(folder);
  if (held === undefined) folders.set(folder, [key]);
  else held.push(key);
}

/**
 * List the whole bucket, a page a call, and sort its keys by the folder of a site each starts with.
 *
 * @returns the keys of each folder, or why the listing stopped: a listing that does not end inside the ceiling names no folder as whole
 */
async function listFolders(run: Run, calls: Calls): Promise<ReadonlyMap<string, readonly string[]> | Stop> {
  const folders = new Map<string, string[]>();

  const listed = await callCloudflare(run.connection, async (api) => {
    calls.spent += 1;
    const first = await new BaseObjects(api).list(BUCKET, { account_id: run.accountId, per_page: PAGE }, ONCE);

    for await (const page of first.iterPages()) {
      for (const { key = "" } of page.result) keep(folders, key);

      if (!page.hasNextPage()) return true;

      if (calls.spent >= calls.ceiling) return false;

      calls.spent += 1;
    }

    return true;
  });
  if (!listed.ok) return stopOf(listed, PERMISSIONS.bucket);

  return listed.value ? folders : { kind: "failed", what: `the listing of the bucket did not end within the ceiling of ${calls.ceiling} lists and deletes` };
}

/**
 * Read every folder a record of the database names.
 *
 * @returns the folders, or why they are not known: a database that names none holds no site, which no reset leaves, so nothing is removed on its word
 */
async function namedFolders(run: Run, database: string): Promise<ReadonlySet<string> | Stop> {
  const asked = await callCloudflare(run.connection, (api) => Array.fromAsync(new BaseDatabase(api).query(database, { account_id: run.accountId, sql: NAMED_FOLDERS })));
  if (!asked.ok) return stopOf(asked, PERMISSIONS.database);

  if (asked.value.some((result) => result.success !== true)) return { kind: "failed", what: "the database did not say which folders its records name" };

  const rows = v.safeParse(NAMED_ROWS, asked.value.flatMap((result) => result.results ?? []));
  if (!rows.success) return { kind: "failed", what: "the database named a folder in a form no site has" };

  if (rows.output.length === 0) return { kind: "failed", what: "the database names no folder, so no file is removed" };

  return new Set(rows.output.map((row) => row.folder));
}

/** Remove the objects of one folder, one a call, while the ceiling lasts; answers how many went, and why the next one did not. */
async function emptyFolder(run: Run, keys: readonly string[], calls: Calls): Promise<{ readonly removed: number; readonly stopped?: Stop }> {
  let removed = 0;

  for (const key of keys) {
    if (calls.spent >= calls.ceiling) return { removed };

    calls.spent += 1;
    const gone = await callCloudflare(run.connection, (api) => new BaseObjects(api).delete(key, { account_id: run.accountId, bucket_name: BUCKET }, ONCE));
    if (!gone.ok) return { removed, stopped: stopOf(gone, PERMISSIONS.bucket) };

    removed += 1;
  }

  return { removed };
}

/**
 * Remove the files of the test install's bucket that sit under a folder no site, no upload, and no removed site's record names.
 *
 * @param zone - the zone of the run's install, `undefined` for one without a domain: any account but a test account is refused before anything is listed
 * @param rule - the install's database, and the most lists and deletes the removal may ask the bucket for
 * @returns what went and what is left, with why where a delete ended it early; or why nothing was removed at all; a second run after one that left nothing lists the bucket and removes nothing
 */
export async function removeOrphans(run: Run, zone: Zone | undefined, rule: { readonly database: string; readonly ceiling: number }): Promise<Orphans | Stop> {
  const refused = await refuseOtherAccount(run, zone);
  if (refused !== undefined) return refused;

  const calls: Calls = { spent: 0, ceiling: rule.ceiling };
  const listed = await listFolders(run, calls);
  if (isStop(listed)) return listed;

  const named = await namedFolders(run, rule.database);
  if (isStop(named)) return named;

  const orphans = [...listed].filter(([folder]) => !named.has(folder)).map(([, keys]) => keys);
  const held = orphans.reduce((sum, keys) => sum + keys.length, 0);
  let [folders, objects] = [0, 0];
  let stopped: Stop | undefined;

  for (const keys of orphans) {
    const emptied = await emptyFolder(run, keys, calls);
    objects += emptied.removed;
    if (emptied.removed === keys.length) folders += 1;

    stopped = emptied.stopped;
    if (stopped !== undefined) break;
  }

  return { folders, objects, left: { folders: orphans.length - folders, objects: held - objects }, calls: calls.spent, ...(stopped === undefined ? {} : { stopped }) };
}
