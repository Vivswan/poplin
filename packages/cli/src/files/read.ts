// What a publish would upload: the files under a folder, or one page, listed without reading their bytes.

import { createReadStream, promises as fs } from "node:fs";
import { basename, extname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { Readable } from "node:stream";
import mime from "mime";

import { nameFromEntry, type SiteName } from "../../../core/src/names/names";
import { checkFilePath } from "../../../core/src/actions/sites/files";

const ENTRY_PAGE = "index.html";
const HTML_FILE = /\.html$/i;
const HIDDEN_PREFIX = ".";
const DEPENDENCY_FOLDER = "node_modules";
const UNKNOWN_CONTENT_TYPE = "application/octet-stream";
const KEY_SEPARATOR = "/";
const MISSING = "ENOENT";
const UNDECODED = "\ufffd";

/** One file a publish would upload. */
export interface PublishFile {
  /** Where the file sits in the site: relative to the folder, joined by `/`. A publish takes it: core's `checkFilePath` passed. */
  readonly path: string;

  /** The length in bytes when the file was listed. */
  readonly size: number;

  /** The media type its extension names, `application/octet-stream` for an unknown or absent one. */
  readonly contentType: string;

  /** Opens the file's bytes; each call starts a new read from the first byte. */
  open(): ReadableStream<Uint8Array>;
}

/** The name the site gets when the caller gives none, or why the folder or file name cannot be one. */
type DefaultName = { readonly ok: true; readonly value: SiteName } | { readonly ok: false; readonly reason: string };

/** The files to publish with their totals, or the reason nothing can be published, worded for the person who ran the command. */
type Listing =
  | {
      readonly ok: true;
      readonly files: readonly PublishFile[];
      readonly count: number;
      readonly bytes: number;
      readonly skipped: number;
      readonly name: DefaultName;
    }
  | { readonly ok: false; readonly reason: string };

/** A walk in progress over one folder. */
interface Walk {
  /** The real path of the folder being published. */
  readonly root: string;

  /** The real paths of the folders between the root and the entry being read; a link back into one is a loop. */
  readonly open: Set<string>;

  /** The files found so far, in the order the walk met them. */
  readonly files: PublishFile[];

  /** How many entries were left out; a hidden or `node_modules` folder counts once, whatever it holds. */
  skipped: number;
}

/** A user's mistake, carried up to `readFiles` and returned as a value. */
class Refusal extends Error {}

function quote(path: string): string {
  return JSON.stringify(path);
}

function isLeftOut(segment: string): boolean {
  return segment.startsWith(HIDDEN_PREFIX) || segment === DEPENDENCY_FOLDER;
}

function contentTypeOf(path: string): string {
  // The extension alone: given a whole path, the library reads a bare top-level name such as `txt` as an extension.
  return mime.getType(extname(path)) ?? UNKNOWN_CONTENT_TYPE;
}

function compareByBytes(left: PublishFile, right: PublishFile): number {
  return Buffer.compare(Buffer.from(left.path), Buffer.from(right.path));
}

function codeOf(error: unknown): string {
  if (error instanceof Error && "code" in error) return String(error.code);

  return String(error);
}

function asRefusal(error: unknown): string | undefined {
  if (error instanceof Refusal) return error.message;

  if (!(error instanceof Error) || !("code" in error) || !("path" in error)) return undefined;

  if (error.code === MISSING) return `${quote(String(error.path))} does not exist`;

  return `${quote(String(error.path))} cannot be read (${codeOf(error)})`;
}

function defaultName(entry: string): DefaultName {
  const name = nameFromEntry(entry);
  if (name.ok) return name;

  return { ok: false, reason: `no usable name, pass --name: ${quote(entry)} cannot name a site (${name.refusal})` };
}

async function publishFile(path: string, source: string): Promise<PublishFile> {
  const checked = checkFilePath(path);
  if (!checked.ok) throw new Refusal(`the file ${quote(path)} has a name that cannot be stored (${checked.refusal}); rename or remove it`);

  const { size } = await fs.stat(source);

  // Node types its own web stream apart from the global one, though at run time they are one class.
  const open = (): ReadableStream<Uint8Array> => Readable.toWeb(createReadStream(source)) as unknown as ReadableStream<Uint8Array>;

  return { path, size, contentType: contentTypeOf(path), open };
}

/** The real path a link leads to, refused unless a walk of the root could have reached that path without the link. */
async function followLink(link: string, path: string, root: string): Promise<string> {
  const target = await fs.realpath(link).catch((error: unknown) => {
    throw new Refusal(`the link ${quote(path)} cannot be followed (${codeOf(error)}); fix or remove it`);
  });

  const inside = relative(root, target);
  const segments = inside.split(sep);
  if (isAbsolute(inside) || segments[0] === "..") throw new Refusal(`the link ${quote(path)} points outside the folder, at ${quote(target)}; remove it`);

  if (segments.some(isLeftOut))
    throw new Refusal(`the link ${quote(path)} points at ${quote(inside)}, which is hidden or under ${DEPENDENCY_FOLDER}; remove it`);

  return target;
}

async function walk(folder: string, prefix: string, listing: Walk): Promise<void> {
  listing.open.add(folder);

  for (const entry of await fs.readdir(folder, { withFileTypes: true })) {
    if (isLeftOut(entry.name)) {
      listing.skipped += 1;
      continue;
    }

    const path = `${prefix}${entry.name}`;
    if (entry.name.includes(UNDECODED)) throw new Refusal(`${quote(path)} has a name that is not valid text; rename or remove it`);

    let source = join(folder, entry.name);
    let kind: { isDirectory(): boolean; isFile(): boolean } = entry;

    if (entry.isSymbolicLink()) {
      source = await followLink(source, path, listing.root);
      kind = await fs.stat(source);
    }

    if (kind.isDirectory()) {
      if (listing.open.has(source)) throw new Refusal(`the link ${quote(path)} loops back to a folder that holds it; remove it`);

      await walk(source, `${path}${KEY_SEPARATOR}`, listing);
      continue;
    }

    if (!kind.isFile()) throw new Refusal(`${quote(path)} is neither a file nor a folder; remove it`);

    listing.files.push(await publishFile(path, source));
  }

  listing.open.delete(folder);
}

async function listFolder(root: string): Promise<Walk> {
  const listing: Walk = { root, open: new Set(), files: [], skipped: 0 };
  await walk(root, "", listing);

  if (listing.files.length === 0) throw new Refusal(`the folder ${quote(root)} holds nothing to publish; hidden files and ${DEPENDENCY_FOLDER} are never sent`);

  if (!listing.files.some((file) => file.path === ENTRY_PAGE)) throw new Refusal(`the folder ${quote(root)} has no ${ENTRY_PAGE} at its top`);

  listing.files.sort(compareByBytes);

  return listing;
}

async function singlePage(target: string, source: string): Promise<PublishFile> {
  const named = await fs.lstat(target);
  if (named.isSymbolicLink()) throw new Refusal(`${quote(target)} is a link, to ${quote(source)}; name the page itself`);

  return await publishFile(ENTRY_PAGE, source);
}

async function list(target: string): Promise<Listing> {
  const entry = basename(resolve(target));
  const root = await fs.realpath(target);
  const kind = await fs.stat(root);
  let files: readonly PublishFile[];
  let skipped = 0;

  if (kind.isDirectory()) {
    ({ files, skipped } = await listFolder(root));
  } else if (kind.isFile() && HTML_FILE.test(entry)) {
    files = [await singlePage(target, root)];
  } else {
    throw new Refusal(`${quote(target)} is not a folder or an .html file`);
  }

  const bytes = files.reduce((sum, file) => sum + file.size, 0);

  return { ok: true, files, count: files.length, bytes, skipped, name: defaultName(entry) };
}

/**
 * List what publishing a folder or one HTML file would upload, without reading any file's bytes.
 *
 * A folder gives every file under it; a single HTML file, which may not be a link, gives itself alone, as `index.html`. Hidden entries (a name starting with a dot) and any entry named `node_modules` are left out at every depth.
 *
 * A link is followed when its real target lies inside the folder at a path the walk itself would list, whether it leads to a file or a folder, and its files are listed under the link's own path. Any other link is refused.
 *
 * @param target - a path to a folder or an `.html` file, absolute or relative to the working directory
 * @returns the files in the order a store lists their paths (by UTF-8 bytes), or the reason nothing can be published
 */
export async function readFiles(target: string): Promise<Listing> {
  try {
    return await list(target);
  } catch (error) {
    const reason = asRefusal(error);
    if (reason === undefined) throw error;

    return { ok: false, reason };
  }
}
