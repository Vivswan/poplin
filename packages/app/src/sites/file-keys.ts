// From a URL path to the bucket keys that may hold its file, each inside the site's live version.
//
//   /  and  /docs/       <dir>index.html                      one key
//   /app.js              app.js                               one key
//   /about               about, about.html, about/index.html  three keys, tried in that order

import type { Site } from "@poplin/core/src/records/site";
import { type ObjectKey, parseObjectKey } from "@poplin/core/src/storage/storage";

/** The file a folder's own address serves. */
const INDEX = "index.html";

/** What a path without an extension is tried with once no file has its exact name. */
const HTML_ENDING = ".html";

/** What joins the segments of a URL path and of a key. */
const SEPARATOR = "/";

/** What a decoded segment may not hold: either would let one URL segment name a file in another folder. */
const SEGMENT_BREAKERS = /[/\\]/;

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
    if (text === undefined || SEGMENT_BREAKERS.test(text)) return undefined;

    decoded.push(text);
  }

  return decoded.join(SEPARATOR);
}

function candidates(path: string): string[] {
  if (path === "" || path.endsWith(SEPARATOR)) return [`${path}${INDEX}`];

  const name = path.slice(path.lastIndexOf(SEPARATOR) + 1);
  if (name.includes(".")) return [path];

  return [path, `${path}${HTML_ENDING}`, `${path}${SEPARATOR}${INDEX}`];
}

/**
 * List the keys to try for a URL path, in order.
 *
 * @param pathname - the path of the request's URL, still percent-encoded; it is decoded once, segment by segment
 * @returns at most three keys under `<folder>/v<live>/`, each one core's `parseObjectKey` accepts; none when the path is no file path: a bad escape, a slash or backslash inside a segment, or no key that passes
 */
export function fileKeys(site: Pick<Site, "folder" | "live_version">, pathname: string): readonly ObjectKey[] {
  const path = decodePath(pathname);
  if (path === undefined) return [];

  const keys: ObjectKey[] = [];

  for (const candidate of candidates(path)) {
    const parsed = parseObjectKey(`${site.folder}/v${site.live_version}/${candidate}`);
    if (parsed.ok) keys.push(parsed.key);
  }

  return keys;
}
