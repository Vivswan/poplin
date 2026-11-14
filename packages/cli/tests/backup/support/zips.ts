// Zips for the backup tests: a small backup written entry by entry, so a test can change one entry, and the means to read a zip back or to edit its bytes.

import { createWriteStream, readFileSync, writeFileSync } from "node:fs";
import { buffer } from "node:stream/consumers";
import { pipeline } from "node:stream/promises";
import yauzl from "yauzl";
import yazl from "yazl";

/** The signature of an entry's record in a zip's central directory, and where that record holds the checksum, the uncompressed size, and the name. */
const CENTRAL = { signature: 0x02014b50, checksum: 16, size: 24, nameLength: 28, name: 46 } as const;

/** The site of the small backup. */
export const SITE = { id: "k3f9x2ab71qz", name: "notes", label: "notes--k3f9x2ab71qz" } as const;

/** The two files of the small backup's one version. */
export const FILES = { "index.html": "<title>Field notes</title>", "css/site.css": "body{}" } as const;

/** One entry of a zip to write: its name and its content. */
export type ZipEntry = readonly [name: string, content: string | Uint8Array];

/** What the small backup is built from; a test replaces what it wants wrong. */
interface Parts {
  readonly files?: Readonly<Record<string, string>>;
  readonly record?: Readonly<Record<string, unknown>>;
  readonly manifest?: Readonly<Record<string, unknown>>;
  readonly settings?: Readonly<Record<string, string>>;
}

function json(value: unknown): string {
  return JSON.stringify(value);
}

/**
 * The entries of a small backup that passes every check: one site with one version of two files, and no settings.
 *
 * @param parts - `files` replaces the version's files; `record` and `manifest` lay keys over the site's record and the manifest; `settings` adds a `settings.json`
 */
export function backupEntries(parts: Parts = {}): ZipEntry[] {
  const files = Object.entries(parts.files ?? FILES);
  const bytes = files.reduce((sum, [, content]) => sum + content.length, 0);
  const folder = `sites/${SITE.label}`;
  const record = { id: SITE.id, name: SITE.name, live_version: 1, versions: [{ number: 1, files: files.length, bytes }], ...parts.record };
  const manifest = { format: 1, made_by: "poplin 0.0.0", made_at: 0, all_versions: false, settings: parts.settings !== undefined, sites: 1, files: files.length, bytes, ...parts.manifest };
  const index = files.map(([path, content]) => ({ path, size: content.length, content_type: "text/plain" }));
  const settings: ZipEntry[] = parts.settings === undefined ? [] : [["settings.json", json(parts.settings)]];

  return [
    ...settings,
    [`${folder}/site.json`, json(record)],
    ...files.map(([path, content]): ZipEntry => [`${folder}/versions/1/files/${path}`, content]),
    [`${folder}/versions/1/files.json`, json(index)],
    ["manifest.json", json(manifest)],
  ];
}

/** Write a zip of the entries, in their order, at `path`; answers the path. */
export async function writeZip(path: string, entries: readonly ZipEntry[]): Promise<string> {
  const zip = new yazl.ZipFile();
  for (const [name, content] of entries) zip.addBuffer(Buffer.from(content), name);

  zip.end();
  await pipeline(zip.outputStream, createWriteStream(path));

  return path;
}

/** Read every entry of a zip: its name and its bytes, in the zip's order. */
export async function readZip(path: string): Promise<[name: string, content: Buffer][]> {
  const zip = await yauzl.openPromise(path, { lazyEntries: true, autoClose: false });
  const entries: [string, Buffer][] = [];

  try {
    for await (const entry of zip.eachEntry()) entries.push([entry.fileName, await buffer(await zip.openReadStreamPromise(entry))]);
  } finally {
    zip.close();
  }

  return entries;
}

/** Replace every occurrence of a text in a zip's bytes by another of the same length: the way to give an entry a name no zip writer agrees to write. */
export function replaceBytes(path: string, from: string, to: string): void {
  if (from.length !== to.length) throw new Error("the replacement must be as long as what it replaces");

  writeFileSync(path, Buffer.from(readFileSync(path).toString("latin1").replaceAll(from, to), "latin1"));
}

/** Make the zip's directory say an entry is `value` bytes long, or has the checksum `value`, whatever its stream holds. */
export function declare(path: string, name: string, field: "size" | "checksum", value: number): void {
  const bytes = readFileSync(path);

  for (let at = bytes.indexOf(name); at !== -1; at = bytes.indexOf(name, at + 1)) {
    const record = at - CENTRAL.name;
    const isRecord = record >= 0 && bytes.readUInt32LE(record) === CENTRAL.signature && bytes.readUInt16LE(record + CENTRAL.nameLength) === name.length;

    if (isRecord) bytes.writeUInt32LE(value, record + CENTRAL[field]);
  }

  writeFileSync(path, bytes);
}
