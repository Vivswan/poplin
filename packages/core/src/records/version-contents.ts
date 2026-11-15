// What a version is known to hold, written once when it is published. A request for a path then reads the store for no file the version cannot hold.

/** The page a site shows in place of a file it does not hold: the one at its top. */
export const MISSING_PAGE = "404.html";

/** What stands before and after every path of the kept list. No path holds one: a key takes no control character. */
const FRAME = "\n";

/** What joins the segments of a path. */
const SEPARATOR = "/";

/** The longest list of files without an extension a version keeps, in characters. A version with more keeps none. */
const MAX_BARE_TEXT = 16_384;

/** A version nothing is known of: one made from no list of files. */
export const UNKNOWN_CONTENTS: VersionContents = { missing_page: false, bare_files: null };

/** What a version holds, as far as a request for a missing path or for a path without an extension needs to know. */
export interface VersionContents {
  /** Whether the version holds a `404.html` at its top. */
  readonly missing_page: boolean;

  /** The path of every file whose name holds no dot, each between two line breaks, and `""` for none. `null` when they were never listed or are too many to keep. */
  readonly bare_files: string | null;
}

/** Decide whether a path's last segment holds no dot: the one form an address without an extension can name as it stands. */
export function isBarePath(path: string): boolean {
  return !path.slice(path.lastIndexOf(SEPARATOR) + 1).includes(".");
}

/**
 * Decide whether a version holds a file without an extension at a path.
 *
 * @returns `undefined` for a version whose files without an extension are not kept
 */
export function holdsBareFile(contents: VersionContents, path: string): boolean | undefined {
  if (contents.bare_files === null) return undefined;

  return contents.bare_files.includes(`${FRAME}${path}${FRAME}`);
}

/**
 * Work out what a version holds from the paths of its files.
 *
 * @param paths - every path of the version, as its manifest names them
 * @returns what it holds; its `bare_files` is `null` once the list would pass 16,384 characters
 */
export function contentsOf(paths: Iterable<string>): VersionContents {
  const bare: string[] = [];
  let missingPage = false;
  let length = FRAME.length;

  for (const path of paths) {
    if (path === MISSING_PAGE) missingPage = true;

    if (!isBarePath(path)) continue;

    bare.push(path);
    length += path.length + FRAME.length;
  }

  if (length > MAX_BARE_TEXT) return { missing_page: missingPage, bare_files: null };

  return { missing_page: missingPage, bare_files: bare.length === 0 ? "" : `${FRAME}${bare.join(FRAME)}${FRAME}` };
}
