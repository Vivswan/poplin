// Where a site's files sit in the bucket, and how a version's or a site's files are removed.

import type { SiteFolder } from "../records/site";
import { type CheckedKey, deletePrefix, type ObjectStore, parseObjectKey } from "../storage/storage";

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
 * @returns the key, or the key rule the path breaks
 */
export function fileKey(folder: SiteFolder, number: number, path: string): CheckedKey {
  return parseObjectKey(`${versionPrefix(folder, number)}${path}`);
}

/** The prefix of every file of a site, whatever the version: `<folder>/`. */
export function sitePrefix(folder: SiteFolder): string {
  return `${folder}/`;
}

/**
 * Remove the objects under each prefix, as far as one bounded `deletePrefix` call per prefix goes.
 *
 * @returns the prefixes that may still hold objects: the store failed there, or the call's page limit stopped it. Empty when all went
 */
export async function removeFiles(store: ObjectStore, prefixes: readonly string[]): Promise<readonly string[]> {
  const left: string[] = [];

  for (const prefix of prefixes) {
    try {
      const { more } = await deletePrefix(store, prefix);
      if (more) left.push(prefix);
    } catch {
      left.push(prefix);
    }
  }

  return left;
}
