/** The registry's record of a package, read past its cache. */

import type { Packument } from "./records.js";
import { isRecord } from "./util.js";

/**
 * A registry answer held to the two records the pipeline reads.
 *
 * @param body - the parsed JSON of a 200 answer
 * @param where - the package and URL, for the refusal
 * @throws {Error} the body lacks a `versions` or `dist-tags` record, or a dist-tag names a non-string
 */
export function parsePackument(body: unknown, where: string): Packument {
  if (!isRecord(body) || !isRecord(body.versions) || !isRecord(body["dist-tags"])) {
    throw new Error(
      `the registry's record of ${where} is not a packument (an object with versions and dist-tags records); refusing to publish without knowing what it holds.`,
    );
  }

  const tags: Record<string, string> = {};

  for (const [tag, value] of Object.entries(body["dist-tags"])) {
    if (typeof value !== "string") {
      throw new Error(
        `the registry's record of ${where} names dist-tag ${tag} as ${JSON.stringify(value)}, not a version; refusing to publish without knowing what it holds.`,
      );
    }

    tags[tag] = value;
  }

  return { versions: body.versions, "dist-tags": tags };
}

/**
 * The registry's record of `name`, or null while it has never been published.
 *
 * Every read carries a query string no earlier request had: the registry's CDN serves a packument from cache for up to
 * 300 s and ignores a request's no-cache, and a new cache key reaches the origin, a publish just landed included.
 *
 * @param registry - the registry's base URL
 * @throws {Error} the registry answered anything but 200 or 404, or a 200 that is no packument
 */
export async function fetchPackument(registry: string, name: string): Promise<Packument | null> {
  const url = `${registry.replace(/\/$/, "")}/${name.replaceAll("/", "%2F")}`;
  const fresh = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const response = await fetch(`${url}?fresh=${fresh}`, { headers: { accept: "application/json" } });

  if (response.status === 404) {
    return null;
  }

  if (!response.ok) {
    throw new Error(`the registry answered ${response.status} for ${name} (${url}); refusing to publish without knowing what it holds.`);
  }

  return parsePackument(await response.json(), `${name} (${url})`);
}
