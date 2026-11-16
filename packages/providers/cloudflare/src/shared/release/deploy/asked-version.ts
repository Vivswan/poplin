// What the build variable `POPLIN_VERSION` asks a hosted build to deploy.

import { isPlainVersion } from "@poplin/core/src/records/update";

/** What a build was asked for: the newest release, one release by its version, or the files of the copy the build runs in. */
export type Asked = { readonly kind: "latest" } | { readonly kind: "exact"; readonly version: string } | { readonly kind: "this" };

/**
 * Read the build variable. Unset and empty both ask for the newest release.
 *
 * @returns what was asked for, or `undefined` for a value that is none of `latest`, `this`, and a version
 */
export function parseAskedVersion(raw: string | undefined): Asked | undefined {
  const word = (raw ?? "").trim();

  if (word === "" || word === "latest") return { kind: "latest" };
  if (word === "this") return { kind: "this" };
  if (isPlainVersion(word)) return { kind: "exact", version: word };

  return undefined;
}
