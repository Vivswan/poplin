// From a URL path to the bucket keys that may hold its file, each inside the site's live version.
//
//   /  and  /docs/       <dir>index.html                      one key
//   /app.js              app.js                               one key
//   /about               about                                one key, for a version that holds a file of that name
//                        about.html, about/index.html         two keys, tried in that order, for a version that holds none
//                        about, about.html, about/index.html  three keys, for a version whose files without an extension are not kept

import { fileKey } from "@poplin/core/src/actions/sites/files";
import type { Site } from "@poplin/core/src/records/site";
import { holdsBareFile, isBarePath, type VersionContents } from "@poplin/core/src/records/version-contents";
import type { ObjectKey } from "@poplin/core/src/storage/storage";

/** The file a folder's own address serves. */
const INDEX = "index.html";

/** What a path without an extension is tried with once no file has its exact name. */
const HTML_ENDING = ".html";

/** What joins the segments of a URL path and of a key. */
const SEPARATOR = "/";


function decodeSegment(segment: string): string | undefined {
  try {
    return decodeURIComponent(segment);
  } catch {
    return undefined;
  }
}

function decodePath(pathname: string): string | undefined {
  const decoded: string[] = [];

  for (const segment of pathname.slice(SEPARATOR.length).split(SEPARATOR)) {
    const text = decodeSegment(segment);
    // A decoded slash would let one URL segment name a file in another folder.
    if (text === undefined || text.includes(SEPARATOR)) return undefined;

    decoded.push(text);
  }

  return decoded.join(SEPARATOR);
}

function candidates(path: string, contents: VersionContents): string[] {
  if (path === "" || path.endsWith(SEPARATOR)) return [`${path}${INDEX}`];

  if (!isBarePath(path)) return [path];

  const held = holdsBareFile(contents, path);
  if (held === true) return [path];

  const pages = [`${path}${HTML_ENDING}`, `${path}${SEPARATOR}${INDEX}`];

  return held === false ? pages : [path, ...pages];
}

/**
 * List the keys to try for a URL path, in order.
 *
 * @param pathname - the path of the request's URL, still percent-encoded; it is decoded once, segment by segment
 * @param contents - what the live version is known to hold, which says whether a path without an extension names a file as it stands
 * @returns at most two keys of the site's live version, and three only for a version whose files without an extension are not kept, each one core's `fileKey` builds;
 * none when the path is no file path: a bad escape, a slash inside a segment, or no key that passes, as with a backslash, which `fileKey` refuses
 */
export function fileKeys(site: Pick<Site, "folder" | "live_version">, pathname: string, contents: VersionContents): readonly ObjectKey[] {
  const path = decodePath(pathname);
  if (path === undefined) return [];

  const keys: ObjectKey[] = [];

  for (const candidate of candidates(path, contents)) {
    const parsed = fileKey(site.folder, site.live_version, candidate);
    if (parsed.ok) keys.push(parsed.key);
  }

  return keys;
}
