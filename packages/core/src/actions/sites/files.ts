// Where a site's files sit in the bucket, how one folder of a version is listed, and how a version's or a site's files are removed.

import * as v from "valibot";

import type { Actor } from "../../auth/scopes";
import { POSITIVE } from "../../records/fields";
import type { SiteFolder } from "../../records/site";
import { type CheckedKey, deletePrefix, type ListCursor, MAX_LIST_LIMIT, type ObjectStore, parseObjectKey } from "../../storage/storage";
import { reachSite } from "../access/reach";
import { type Install, type Refused, refuse } from "../records";

/** The list pages one removal walks unless told otherwise. */
const REMOVAL_PAGES = 15;

/** A separator no address reaches: a file stored under a path that holds one would never be served. */
const BACKSLASH = "\\";

/** What joins the segments of a path, and ends the prefix of a folder. */
const SEPARATOR = "/";

/** A folder key of the usual length, to measure a path against before the site's own folder is known. */
const ANY_FOLDER = "0".repeat(16) as SiteFolder;

/** The widest version number. A path is taken only when its key fits under it, so a site never stops taking a path as its versions grow. */
const WIDEST_VERSION = Number.MAX_SAFE_INTEGER;

/** The longest prefix a site's files can have, built once: every path of a long manifest is measured against it. */
const WIDEST_PREFIX = versionPrefix(ANY_FOLDER, WIDEST_VERSION);

/** What a page of one folder of a version may ask for. */
const FOLDER_QUERY = v.strictObject({
  version: POSITIVE,
  folder: v.optional(v.string(), ""),
  limit: v.optional(v.pipe(POSITIVE, v.maxValue(MAX_LIST_LIMIT)), MAX_LIST_LIMIT),
  cursor: v.optional(v.string()),
});

/** A file's key, or why its path is none: the key rule it breaks, or the backslash it holds. */
type CheckedFileKey = CheckedKey | { readonly ok: false; readonly refusal: "backslash" };

/** A path a publish takes, or the rule it breaks. */
type CheckedFilePath = { readonly ok: true } | { readonly ok: false; readonly refusal: Extract<CheckedFileKey, { readonly ok: false }>["refusal"] };

/** One page of what one folder of a version holds, in the store's order. */
interface ListedFolder {
  readonly ok: true;

  /** The folders right in the folder, each by its path in the version. */
  readonly folders: readonly string[];

  /** The files right in the folder, each by its path in the version, with its length in bytes. */
  readonly files: readonly { readonly path: string; readonly size: number }[];

  /** What `cursor` takes to get the following page; absent on the last. */
  readonly next?: string;

  /** How many files the whole version was published with. */
  readonly total: number;
}

/**
 * The prefix of every file of one version: `<folder>/v<number>/`.
 *
 * @returns a prefix that ends in `/`, so version 1 never covers version 10
 */
export function versionPrefix(folder: SiteFolder, number: number): string {
  return `${folder}/v${number}/`;
}

function keyUnder(prefix: string, path: string): CheckedFileKey {
  if (path.includes(BACKSLASH)) return { ok: false, refusal: "backslash" };

  return parseObjectKey(`${prefix}${path}`);
}

/**
 * The key of one file of one version: `<folder>/v<number>/<path>`. This is the one place the key form is built.
 *
 * @param path - where the file sits in the site: segments joined by `/`, with none before the first
 * @returns the key, or why the path is none: a backslash in it, or the key rule it breaks
 */
export function fileKey(folder: SiteFolder, number: number, path: string): CheckedFileKey {
  return keyUnder(versionPrefix(folder, number), path);
}

/**
 * Decide whether a publish takes a file at this path. Every publish asks this, and so does whatever lists files for one.
 *
 * The path is measured as the key of the longest prefix a site can have, so a path that passes fits every site at every version.
 *
 * @param path - where the file sits in the site: segments joined by `/`, with none before the first
 * @returns `ok`, or the first rule the path breaks: a backslash in it, or a key rule, of which `too-long` counts the prefix too
 */
export function checkFilePath(path: string): CheckedFilePath {
  const key = keyUnder(WIDEST_PREFIX, path);
  if (!key.ok) return key;

  return { ok: true };
}

/** The prefix of every file of a site, whatever the version: `<folder>/`. */
export function sitePrefix(folder: SiteFolder): string {
  return `${folder}/`;
}

/**
 * The prefix of everything in one folder of a version: the key a file at the folder's path would have, and the separator after it, so no folder reaches outside its version.
 *
 * @param top - the version's own prefix
 * @param folder - the folder's path in the version; empty for the version's top
 * @returns the prefix, or `undefined` for a path no file can lie under
 */
function folderPrefix(top: string, folder: string): string | undefined {
  if (folder === "") return top;

  const key = keyUnder(top, folder);

  return key.ok ? `${key.key}${SEPARATOR}` : undefined;
}

/**
 * List one page of what one folder of a kept version of a site holds, from the store: one listing a call, of that folder alone and of nothing inside its folders.
 *
 * @param request - `site` is a reference to the site and `version` one of its kept versions; `folder` is the folder's path in the version, segments joined by `/`, and the version's top when left out;
 *   `limit` is 1 to 1000, of folders and files together; `cursor` is the `next` of the page before, of the same site, version, and folder
 * @returns the page, for the site's owner or an admin; a folder the version does not hold has neither folders nor files.
 *   `no_such_version` for a version the site does not keep, or `bad_argument` naming the key that was refused: `folder` for a path no file can lie under
 * @throws {Error} the store failed, or refused the cursor
 */
export async function listFolder(
  install: Install,
  actor: Actor,
  request: v.InferInput<typeof FOLDER_QUERY> & { readonly site: string },
): Promise<ListedFolder | Refused<"not_set_up" | "bad_argument" | "not_found" | "not_allowed" | "no_such_version">> {
  const { site: reference, ...query } = request;
  const asked = v.safeParse(FOLDER_QUERY, query);
  if (!asked.success) return refuse("bad_argument", v.getDotPath(asked.issues[0])?.split(".")[0] ?? "query");

  const { version, folder, limit, cursor } = asked.output;
  const reached = await reachSite(install, actor, reference);
  if (!reached.ok) return reached;

  const kept = reached.site.versions.find((one) => one.number === version);
  if (kept === undefined) return refuse("no_such_version");

  const top = versionPrefix(reached.site.folder, version);
  const prefix = folderPrefix(top, folder);
  if (prefix === undefined) return refuse("bad_argument", "folder");

  const paging = cursor === undefined ? {} : { cursor: cursor as ListCursor };
  const page = await install.store.list({ prefix, limit, shallow: true, ...paging });
  const listed = {
    folders: page.folders.map((held) => held.slice(top.length, -SEPARATOR.length)),
    files: page.objects.map((object) => ({ path: object.key.slice(top.length), size: object.size })),
    total: kept.files,
  };
  if (!page.more) return { ok: true, ...listed };

  return { ok: true, ...listed, next: page.cursor };
}

/** Walk one prefix a page at a time while the budget lasts, and answer whether it is empty. A page costs two store calls. */
async function emptyPrefix(store: ObjectStore, prefix: string, budget: { pages: number }): Promise<boolean> {
  while (budget.pages > 0) {
    budget.pages -= 1;

    const { more } = await deletePrefix(store, prefix, 1);
    if (!more) return true;
  }

  return false;
}

/**
 * Remove the objects under each prefix, in order, as far as `maxPages` list pages go over all of them: two store calls a page.
 *
 * @param maxPages - the most pages to walk, a thousand objects each; the default keeps one call to 30 store calls
 * @returns the prefixes that may still hold objects: the store failed there, or the pages ran out. Empty when all went
 */
export async function removeFiles(store: ObjectStore, prefixes: readonly string[], maxPages: number = REMOVAL_PAGES): Promise<readonly string[]> {
  const left: string[] = [];
  const budget = { pages: maxPages };

  for (const prefix of prefixes) {
    try {
      if (!(await emptyPrefix(store, prefix, budget))) left.push(prefix);
    } catch {
      left.push(prefix);
    }
  }

  return left;
}
