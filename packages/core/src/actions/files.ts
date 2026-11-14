// Where a site's files sit in the bucket, and how a version's or a site's files are removed.

import type { SiteFolder } from "../records/site";
import { type CheckedKey, deletePrefix, type ObjectStore, parseObjectKey } from "../storage/storage";

/** The list pages one removal walks unless told otherwise. */
const REMOVAL_PAGES = 15;

/** A separator no address reaches: a file stored under a path that holds one would never be served. */
const BACKSLASH = "\\";

/** A file's key, or why its path is none: the key rule it breaks, or the backslash it holds. */
type CheckedFileKey = CheckedKey | { readonly ok: false; readonly refusal: "backslash" };

/**
 * The prefix of every file of one version: `<folder>/v<number>/`.
 *
 * @returns a prefix that ends in `/`, so version 1 never covers version 10
 */
export function versionPrefix(folder: SiteFolder, number: number): string {
  return `${folder}/v${number}/`;
}

/**
 * The key of one file of one version: `<folder>/v<number>/<path>`. This is the one place the key form is built.
 *
 * @param path - where the file sits in the site: segments joined by `/`, with none before the first
 * @returns the key, or why the path is none: a backslash in it, or the key rule it breaks
 */
export function fileKey(folder: SiteFolder, number: number, path: string): CheckedFileKey {
  if (path.includes(BACKSLASH)) return { ok: false, refusal: "backslash" };

  return parseObjectKey(`${versionPrefix(folder, number)}${path}`);
}

/** The prefix of every file of a site, whatever the version: `<folder>/`. */
export function sitePrefix(folder: SiteFolder): string {
  return `${folder}/`;
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
