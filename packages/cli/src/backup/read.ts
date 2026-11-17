// The reader of a backup: the whole zip is checked before anything is handed out, and then its sites are read one at a time, in the order the layout writes them.

import { promises as fs } from "node:fs";
import { Readable } from "node:stream";
import { buffer } from "node:stream/consumers";
import { crc32 } from "node:zlib";
import * as v from "valibot";
import yauzl, { type Entry, type ZipFile } from "yauzl";

import { siteReference } from "../../../core/src/sites/labels";
import { parseObjectKey } from "../../../core/src/storage/storage";
import { BACKUP_FORMAT, type EntryName, FILE_INDEX, LAYOUT, MANIFEST, type Manifest, readEntryName, SETTINGS, SITE_RECORD, type SiteRecord } from "./layout";

/** How the zip is opened: one entry at a time, names with a backslash, a drive, a leading slash, or a `..` refused, and a stream that is not as long as its entry says failed. */
const ZIP_OPTIONS = { lazyEntries: true, autoClose: false, strictFileNames: true, validateEntrySizes: true } as const;

/** The most bytes of one JSON entry that are read: 32 MB, far above the index of a version of ten thousand files. */
const MAX_JSON_BYTES = 32_000_000;

/** How many bytes of a file are read at once: 64 KiB. */
const PIECE_BYTES = 65_536;

/** What a manifest must hold for its format to be told, before the rest of it is read. */
const FORMAT_ALONE = v.looseObject({ format: MANIFEST.entries.format });

/** One file of one version of a site in a backup. */
interface BackupFile {
  /** The file's path in its version. */
  readonly path: string;

  /** Its length in bytes. */
  readonly size: number;

  /** The media type it is served with. */
  readonly contentType: string;

  /** Opens the file's bytes; each call starts a new read from the first byte. */
  open(): Promise<ReadableStream<Uint8Array>>;
}

/** One site of a backup: its label, its record as `site.json` holds it, and the files of every version the record names, in the record's order. */
export interface BackupSite {
  readonly label: string;
  readonly record: SiteRecord;
  readonly versions: readonly { readonly number: number; readonly files: readonly BackupFile[] }[];
  readonly files: number;
  readonly bytes: number;
}

/**
 * A backup that passed every check, open for reading.
 *
 * `sites` reads the sites one at a time; a site's files can be opened until the next site is asked for. `close` lets the file go.
 */
export interface Backup {
  readonly manifest: Manifest;
  readonly settings: Readonly<Record<string, string>> | undefined;
  readonly sites: () => AsyncGenerator<BackupSite>;
  readonly close: () => Promise<void>;
}

/** A site whose entries are being read: the versions whose index was met, and the files met since the last index. */
interface OpenSite {
  readonly label: string;
  readonly record: SiteRecord;
  readonly versions: { readonly number: number; readonly files: readonly BackupFile[] }[];
  readonly pending: Map<string, Entry>;
}

/** Why a zip is no backup, carried up to `openBackup` and returned as a value. */
class Refusal extends Error {}

/**
 * The file a zip is read from, with every read held inside it.
 *
 * The zip library hands an offset a zip names straight to the file, and one beyond what a file can hold throws where nothing catches it. Closing a zip leaves the file open: it is `openBackup`'s.
 */
class BoundedFile extends yauzl.RandomAccessReader {
  readonly size: number;

  readonly #file: fs.FileHandle;

  constructor(file: fs.FileHandle, size: number) {
    super();
    this.#file = file;
    this.size = size;
  }

  /** The bytes from `start` up to `end`, read by position: under bun the file's own stream closes the file at its end, whatever it is told. */
  override _readStreamForRange(start: number, end: number): Readable {
    const file = this.#file;

    async function* pieces(): AsyncGenerator<Buffer> {
      for (let at = start; at < end; ) {
        const length = Math.min(PIECE_BYTES, end - at);
        const { bytesRead, buffer } = await file.read(Buffer.allocUnsafe(length), 0, length, at);
        if (bytesRead === 0) return;

        yield buffer.subarray(0, bytesRead);
        at += bytesRead;
      }
    }

    return Readable.from(pieces(), { objectMode: false });
  }

  override read(buffer: Buffer, offset: number, length: number, position: number, callback: (error: Error | null, bytesRead?: number) => void): void {
    if (!Number.isSafeInteger(position) || position < 0 || position + length > this.size) {
      callback(new Error("an entry points outside the file"));

      return;
    }

    this.#file.read(buffer, offset, length, position).then(({ bytesRead }) => callback(null, bytesRead), callback);
  }
}

function refuse(reason: string): never {
  throw new Refusal(reason);
}

function quote(name: string): string {
  return JSON.stringify(name);
}

/** Check a JSON value against the form its entry has. */
function shaped<const Schema extends v.GenericSchema>(schema: Schema, value: unknown, entry: Entry): v.InferOutput<Schema> {
  const read = v.safeParse(schema, value);
  if (!read.success) refuse(`${quote(entry.fileName)} does not match the backup schema`);

  return read.output;
}

function damaged(entry: Entry): never {
  return refuse(`${quote(entry.fileName)} fails its checksum`);
}

/** Read a JSON entry whole, under the cap, and check its bytes against the checksum the zip was written with. */
async function readJson(zip: ZipFile, entry: Entry): Promise<unknown> {
  if (entry.uncompressedSize > MAX_JSON_BYTES) refuse(`${quote(entry.fileName)} is too large to read`);

  const written = await buffer(await zip.openReadStreamPromise(entry));
  if (crc32(written) !== entry.crc32) damaged(entry);

  // A value nested too deep to be written again is read without complaint, and would fail only when it is sent to the install.
  try {
    const value: unknown = JSON.parse(written.toString());
    JSON.stringify(value);

    return value;
  } catch {
    return refuse(`${quote(entry.fileName)} is not JSON that can be parsed and serialized again`);
  }
}

/** Read a file to its end, which fails on a stream longer or shorter than its entry says, and check its bytes against the checksum the zip was written with. */
async function verify(zip: ZipFile, entry: Entry): Promise<void> {
  let sum = 0;
  for await (const chunk of await zip.openReadStreamPromise(entry)) sum = crc32(chunk as Buffer, sum);

  if (sum !== entry.crc32) damaged(entry);
}

/** Read a site's record. The folder it sits in must be the label of that very site, so no two sites share a folder and no folder name is taken on trust. */
async function openSite(zip: ZipFile, entry: Entry, label: string, seen: Set<string>): Promise<OpenSite> {
  if (seen.has(label)) refuse(`site ${quote(label)} appears twice`);

  const record = shaped(SITE_RECORD, await readJson(zip, entry), entry);
  const named = siteReference(label);
  if (!named.ok || named.value.kind !== "site" || named.value.name !== record.name || named.value.id !== record.id)
    refuse(`${quote(entry.fileName)} is not in the folder of its site's label`);

  const numbers = new Set(record.versions.map((version) => version.number));
  if (numbers.size !== record.versions.length || !numbers.has(record.live_version)) refuse(`${quote(entry.fileName)} lists a version twice, or lacks its live version`);

  seen.add(label);

  return { label, record, versions: [], pending: new Map() };
}

/** The version whose entries are due: the first the record names that has no index yet. An entry of any other version is out of place. */
function dueVersion(site: OpenSite, entry: Entry, version: number): SiteRecord["versions"][number] {
  const due = site.record.versions[site.versions.length];
  if (due === undefined || due.number !== version) return refuse(`${quote(entry.fileName)} is out of order: a site's versions follow its record's order, each ending with its files.json`);

  return due;
}

function addFile(site: OpenSite, entry: Entry, name: Extract<EntryName, { readonly kind: "file" }>): void {
  dueVersion(site, entry, name.version);

  if (!parseObjectKey(name.path).ok) refuse(`${quote(entry.fileName)} has a path no site can store`);

  if (site.pending.has(name.path)) refuse(`${quote(entry.fileName)} appears twice`);

  site.pending.set(name.path, entry);
}

/** End a version at its index: the files met are the files listed, each as long as listed, and together what the site's record says the version holds. */
async function closeVersion(zip: ZipFile, site: OpenSite, entry: Entry, checks: { readonly version: number; readonly bytes: boolean }): Promise<void> {
  const due = dueVersion(site, entry, checks.version);
  const files: BackupFile[] = [];
  let bytes = 0;

  for (const listed of shaped(FILE_INDEX, await readJson(zip, entry), entry)) {
    const held = site.pending.get(listed.path);
    if (held === undefined || held.uncompressedSize !== listed.size) refuse(`${quote(entry.fileName)} lists ${quote(listed.path)}, which the version lacks at that size`);

    site.pending.delete(listed.path);
    if (checks.bytes) await verify(zip, held);

    bytes += listed.size;
    files.push({
      path: listed.path,
      size: listed.size,
      contentType: listed.content_type,
      open: async () => Readable.toWeb(await zip.openReadStreamPromise(held)) as unknown as ReadableStream<Uint8Array>,
    });
  }

  if (site.pending.size > 0) refuse(`${quote(entry.fileName)} does not list every file of its version`);

  if (files.length !== due.files || bytes !== due.bytes) refuse(`version ${due.number} of ${quote(site.label)} does not match the file count or size in its record`);

  site.versions.push({ number: due.number, files });
}

function closeSite(site: OpenSite): BackupSite {
  if (site.versions.length !== site.record.versions.length || site.pending.size > 0) refuse(`site ${quote(site.label)} lacks a version its record lists`);

  const all = site.versions.flatMap((version) => version.files);

  return { label: site.label, record: site.record, versions: site.versions, files: all.length, bytes: all.reduce((sum, file) => sum + file.size, 0) };
}

/** Take one entry of the site being read: a file of the version that is due, or the index that ends that version. */
async function addEntry(zip: ZipFile, site: OpenSite | undefined, entry: Entry, checks: { readonly name: Extract<EntryName, { readonly label: string }>; readonly bytes: boolean }): Promise<void> {
  const { name } = checks;
  if (site === undefined || site.label !== name.label) return refuse(`${quote(entry.fileName)} is out of order: a site's entries follow its site.json`);

  if (name.kind === "file") addFile(site, entry, name);

  if (name.kind === "index") await closeVersion(zip, site, entry, { version: name.version, bytes: checks.bytes });
}

/**
 * Read the sites of a zip in the order they are written, checking every entry against the layout.
 *
 * @param checkBytes - whether every file is read to its end and checked, which the first pass over a backup does
 * @throws {Refusal} an entry is none of a backup, is out of place, or disagrees with its site's record
 */
async function* sitesOf(file: BoundedFile, checkBytes: boolean): AsyncGenerator<BackupSite> {
  const zip = await yauzl.fromRandomAccessReaderPromise(file, file.size, ZIP_OPTIONS);
  const seen = new Set<string>();
  let site: OpenSite | undefined;

  for await (const entry of zip.eachEntry()) {
    const name = readEntryName(entry.fileName);
    if (name === undefined) refuse(`${quote(entry.fileName)} is not a backup entry`);

    if (name.kind === "settings" || name.kind === "manifest") continue;

    if (name.kind !== "site") {
      await addEntry(zip, site, entry, { name, bytes: checkBytes });
      continue;
    }

    if (site !== undefined) yield closeSite(site);

    site = await openSite(zip, entry, name.label, seen);
  }

  if (site !== undefined) yield closeSite(site);
}

/** Read the manifest, which is the last entry, and the settings, which are the first when the backup has them. */
async function readHead(file: BoundedFile): Promise<Pick<Backup, "manifest" | "settings">> {
  const zip = await yauzl.fromRandomAccessReaderPromise(file, file.size, ZIP_OPTIONS);
  let settings: Entry | undefined;
  let last: Entry | undefined;

  for await (const entry of zip.eachEntry()) {
    if (last?.fileName === LAYOUT.manifest) refuse("an entry follows manifest.json, which must be last");

    if (entry.fileName === LAYOUT.settings && last !== undefined) refuse("settings.json is not the first entry, or appears twice");

    if (entry.fileName === LAYOUT.settings) settings = entry;

    last = entry;
  }

  if (last?.fileName !== LAYOUT.manifest) return refuse("the zip does not end with manifest.json, so it is not a backup or is truncated");

  const written = await readJson(zip, last);
  const { format } = shaped(FORMAT_ALONE, written, last);
  if (format > BACKUP_FORMAT) refuse(`format ${format} is newer than this CLI reads, which is up to format ${BACKUP_FORMAT}`);

  const manifest = shaped(MANIFEST, written, last);
  if (manifest.settings !== (settings !== undefined)) refuse("the manifest and the entries disagree on whether the settings are included");

  if (settings === undefined) return { manifest, settings: undefined };

  return { manifest, settings: shaped(SETTINGS, await readJson(zip, settings), settings) };
}

/** Read every site and every byte once, and hold the manifest's counts against what was read. */
async function checkContents(file: BoundedFile, manifest: Manifest): Promise<void> {
  const held = { sites: 0, files: 0, bytes: 0 };

  for await (const site of sitesOf(file, true)) {
    held.sites += 1;
    held.files += site.files;
    held.bytes += site.bytes;
  }

  if (held.sites !== manifest.sites || held.files !== manifest.files || held.bytes !== manifest.bytes) refuse("the manifest counts differ from the sites, files, or bytes in the zip");
}

/**
 * Open a backup and check all of it: the format, every name, every site against its record, every file's length and bytes, and the manifest against the whole.
 *
 * The check reads the zip once to its end and holds one site at a time. No entry is written anywhere: a path in a backup is only ever a name inside its own site.
 *
 * @returns the backup, or the reason the file is none, worded to follow "the file is not a backup:"
 */
export async function openBackup(path: string): Promise<{ readonly ok: true; readonly backup: Backup } | { readonly ok: false; readonly reason: string }> {
  const handle = await fs.open(path, "r").catch(() => undefined);
  if (handle === undefined) return { ok: false, reason: `cannot open "${path}"` };

  try {
    const found = await handle.stat();
    if (found.isDirectory()) refuse(`"${path}" is a folder, and a backup is a zip written by poplin export`);

    const file = new BoundedFile(handle, found.size);
    const head = await readHead(file);
    await checkContents(file, head.manifest);

    return { ok: true, backup: { ...head, sites: () => sitesOf(file, false), close: () => handle.close() } };
  } catch (error) {
    await handle.close();
    if (error instanceof Refusal) return { ok: false, reason: error.message };

    return { ok: false, reason: "the file is not a readable zip" };
  }
}
