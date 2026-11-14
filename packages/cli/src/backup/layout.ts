// The form of a backup: one zip of plain files. This is the one place that says where each entry sits and what its JSON holds; the writer and the reader build and read every name through it.
//
//   settings.json                             the install's settings, each as the text it is typed in; absent from the backup of one site
//   sites/<label>/site.json                   the site as the install stores it: id, name, settings, owner, times, state, and the versions it keeps
//   sites/<label>/versions/<n>/files/<path>   one file of version <n>, byte for byte
//   sites/<label>/versions/<n>/files.json     the files of version <n> in the order above: path, size, content type
//   manifest.json                             the format number and the counts of sites, files, and bytes; always the last entry
//
// The entries are written in this order, a site at a time and a version at a time, so a reader holds one site and never the whole backup.

import * as v from "valibot";

/** The number of the form this code writes, and the highest it reads. It is the number an install's export answers with. */
export const BACKUP_FORMAT = 1;

/** A whole count, of files or of bytes. */
const COUNT = v.pipe(v.number(), v.safeInteger(), v.minValue(0));

/** A whole number from 1: a version's number, or the format's. */
const POSITIVE = v.pipe(v.number(), v.safeInteger(), v.minValue(1));

/** The name of every entry but a site's, and what builds the name of a site's. A label, a number, and a path are put in as they are: the reader checks each before it trusts one. */
export const LAYOUT = {
  settings: "settings.json",
  manifest: "manifest.json",
  site: (label: string): string => `sites/${label}/site.json`,
  file: (label: string, version: number, path: string): string => `sites/${label}/versions/${version}/files/${path}`,
  index: (label: string, version: number): string => `sites/${label}/versions/${version}/files.json`,
} as const;

/** The name of an entry under `sites/`: the label, then the site's record, a version's index, or one file of a version. A version's number has no sign and no leading zero. */
const SITE_ENTRY = /^sites\/([^/]+)\/(?:(site\.json)|versions\/([1-9]\d{0,15})\/(?:(files\.json)|files\/(.+)))$/s;

/** What `manifest.json` holds. `settings` says whether the backup has a `settings.json`; `sites` counts the sites, and `files` and `bytes` every file of every site. */
export const MANIFEST = v.looseObject({
  format: POSITIVE,
  made_by: v.string(),
  made_at: v.number(),
  all_versions: v.boolean(),
  settings: v.boolean(),
  sites: COUNT,
  files: COUNT,
  bytes: COUNT,
});

/** What `settings.json` holds: every setting by its key, as text. */
export const SETTINGS = v.record(v.string(), v.string());

/** What a `site.json` must hold for the backup to be read: what names the site, and what each version it keeps holds. Every other key is kept as written, and checked by the install that imports it. */
export const SITE_RECORD = v.looseObject({
  id: v.string(),
  name: v.string(),
  public_name: v.optional(v.string()),
  live_version: POSITIVE,
  versions: v.array(v.looseObject({ number: POSITIVE, files: COUNT, bytes: COUNT })),
});

/** What a version's `files.json` holds: each file's path in the version, its length in bytes, and the media type it is served with. */
export const FILE_INDEX = v.array(v.strictObject({ path: v.string(), size: COUNT, content_type: v.string() }));

/** What `manifest.json` holds, read. */
export type Manifest = v.InferOutput<typeof MANIFEST>;

/** A site's record, read. */
export type SiteRecord = v.InferOutput<typeof SITE_RECORD>;

/** One row of a version's `files.json`. */
export type IndexedFile = v.InferOutput<typeof FILE_INDEX>[number];

/** What the name of an entry says it is. */
export type EntryName =
  | { readonly kind: "settings" }
  | { readonly kind: "manifest" }
  | { readonly kind: "site"; readonly label: string }
  | { readonly kind: "index"; readonly label: string; readonly version: number }
  | { readonly kind: "file"; readonly label: string; readonly version: number; readonly path: string };

/**
 * Read the name of an entry of a backup.
 *
 * @returns what the entry is, or nothing for a name no entry of a backup has. The label and the path are as written, and not yet checked
 */
export function readEntryName(name: string): EntryName | undefined {
  if (name === LAYOUT.settings) return { kind: "settings" };

  if (name === LAYOUT.manifest) return { kind: "manifest" };

  const [, label, isSite, number, isIndex, path] = SITE_ENTRY.exec(name) ?? [];
  if (label === undefined) return undefined;

  if (isSite !== undefined) return { kind: "site", label };

  const version = Number(number);
  if (isIndex !== undefined) return { kind: "index", label, version };

  return { kind: "file", label, version, path: path ?? "" };
}
