// An upload's manifest as its row holds it: one JSON object, the declared files under keys made from their paths, so the engine reads one file out of it without walking the rest.

import type { ManifestFile } from "../records/upload";

/** Where the 32-bit FNV-1a hash starts, as the signed number those bits are: an engine keeps a hash that starts as one in whole-number arithmetic. */
const FNV_OFFSET = 0x811c9dc5 | 0;

/** What the 32-bit FNV-1a hash multiplies by at every character. */
const FNV_PRIME = 0x01000193;

/** How many paths of a manifest are hashed side by side. */
const HASHED_ABREAST = 4;

/** The base a manifest key's digits are written in. */
const HEX = 16;

/** The digits of that base. */
const HEX_DIGITS = "0123456789abcdef";

/** How many bits one such digit stands for. */
const HEX_DIGIT_BITS = 4;

/** Where a key ends in a manifest written as a flat list: the quote and comma between its last digit and its files. A quote inside a text follows a backslash, so no path and no type holds this. */
const KEY_END = /(?<=[0-9a-f])",\[\[/g;

/** The form of a key of a stored manifest: the letter and the hex digits of a 32-bit hash. Nothing in it ends a text or a step of a JSON path. */
export const MANIFEST_KEY = /^f[0-9a-f]{1,8}$/;

/** One file as a stored manifest holds it: its path, size, type, place in the manifest, and hash. */
type StoredFile = readonly [path: string, size: number, type: string, place: number, sha256: string];

/** Carry a 32-bit FNV-1a hash on over a path, from one of its UTF-16 units to its end. */
function hashOn(hash: number, path: string, from: number): number {
  let carried = hash;
  for (let at = from; at < path.length; at += 1) carried = Math.imul(carried ^ path.charCodeAt(at), FNV_PRIME);

  return carried;
}

/** The 32-bit FNV-1a hash of a path, taken over its UTF-16 units. */
function pathHash(path: string): number {
  return hashOn(FNV_OFFSET, path, 0) >>> 0;
}

/**
 * The hash of every path of a manifest, as `pathHash` gives it, in the manifest's order.
 * Four paths are hashed side by side: each step of a hash waits on the one before it, and four hashes that wait at once take little longer than one.
 */
function pathHashes(manifest: readonly ManifestFile[]): Uint32Array {
  const hashes = new Uint32Array(manifest.length);
  const abreast = manifest.length - (manifest.length % HASHED_ABREAST);

  for (let place = 0; place < abreast; place += HASHED_ABREAST) {
    const first = (manifest[place] as ManifestFile).path;
    const second = (manifest[place + 1] as ManifestFile).path;
    const third = (manifest[place + 2] as ManifestFile).path;
    const fourth = (manifest[place + 3] as ManifestFile).path;
    const shared = Math.min(first.length, second.length, third.length, fourth.length);
    let one = FNV_OFFSET;
    let two = FNV_OFFSET;
    let three = FNV_OFFSET;
    let four = FNV_OFFSET;

    for (let at = 0; at < shared; at += 1) {
      one = Math.imul(one ^ first.charCodeAt(at), FNV_PRIME);
      two = Math.imul(two ^ second.charCodeAt(at), FNV_PRIME);
      three = Math.imul(three ^ third.charCodeAt(at), FNV_PRIME);
      four = Math.imul(four ^ fourth.charCodeAt(at), FNV_PRIME);
    }

    hashes[place] = hashOn(one, first, shared);
    hashes[place + 1] = hashOn(two, second, shared);
    hashes[place + 2] = hashOn(three, third, shared);
    hashes[place + 3] = hashOn(four, fourth, shared);
  }

  for (let place = abreast; place < manifest.length; place += 1) hashes[place] = pathHash((manifest[place] as ManifestFile).path);

  return hashes;
}

/**
 * The key a file has in a stored manifest, made from the hash of its path.
 *
 * @param hash - what `pathHash` gave for the path
 * @returns a letter and the hash's hex digits, which is one plain step of a JSON path whatever the path holds. Two paths may share a key
 */
function keyOfHash(hash: number): string {
  const last = HEX_DIGITS[hash % HEX] as string;
  const rest = hash >>> HEX_DIGIT_BITS;

  // An engine writes a small whole number in hex several times faster than one past 31 bits.
  return rest === 0 ? `f${last}` : `f${rest.toString(HEX)}${last}`;
}

/**
 * The manifest as the JSON object its row holds: under each key the files whose paths have it, each as its path, size, type, place in the manifest, and hash.
 *
 * @throws {Error} two files share a path
 */
export function manifestToText(manifest: readonly ManifestFile[]): string {
  const hashes = pathHashes(manifest);
  const sharing = new Map<number, StoredFile[]>();
  const keyed: (string | StoredFile[])[] = [];

  for (let place = 0; place < manifest.length; place += 1) {
    const { path, size, content_type: type, sha256 } = manifest[place] as ManifestFile;
    const hash = hashes[place] as number;
    const held = sharing.get(hash);

    if (held === undefined) {
      const files: StoredFile[] = [[path, size, type, place, sha256]];
      sharing.set(hash, files);
      keyed.push(keyOfHash(hash), files);
      continue;
    }

    if (held.some(([other]) => other === path)) throw new Error("two files of an upload share a path");

    held.push([path, size, type, place, sha256]);
  }

  // One call writes every key and its files as a flat list, which costs a long manifest a fraction of what an object with as many keys does.
  const listed = JSON.stringify(keyed);

  return `{${listed.slice(1, -1).replace(KEY_END, '":[[')}}`;
}

/** `manifestToText` is the one writer of a stored file, so its fields are read as written, unchecked. */
function declaredFile([path, size, type, , sha256]: StoredFile): ManifestFile {
  return { path, size, content_type: type, sha256 };
}

/**
 * Read a stored manifest back as the list it was declared as.
 *
 * @param text - what `manifestToText` wrote, or the `{}` of an upload that takes no more files
 * @throws {Error} the places are not 0 to one less than the count of files, each once
 */
export function manifestFromText(text: string): ManifestFile[] {
  const stored: Readonly<Record<string, readonly StoredFile[]>> = JSON.parse(text);
  const manifest: (ManifestFile | undefined)[] = [];
  let files = 0;

  for (const sharing of Object.values(stored)) {
    for (const file of sharing) manifest[file[3]] = declaredFile(file);

    files += sharing.length;
  }

  if (manifest.length !== files || manifest.includes(undefined)) throw new Error("a stored manifest does not hold each place once");

  return manifest as ManifestFile[];
}

/**
 * Name the key a path's file is stored under in a manifest.
 *
 * @returns the key `manifestToText` wrote the file under; two paths may share it
 */
export function manifestKey(path: string): string {
  return keyOfHash(pathHash(path));
}

/**
 * Find a path's file among the files stored under its key.
 *
 * @param sharing - the JSON text a stored manifest holds under `manifestKey(path)`
 * @returns the file as it was declared; `undefined` when the files under the key are those of other paths
 */
export function fileUnderKey(sharing: string, path: string): ManifestFile | undefined {
  const files: readonly StoredFile[] = JSON.parse(sharing);
  const file = files.find(([held]) => held === path);

  return file === undefined ? undefined : declaredFile(file);
}

/**
 * Find each path's file among the files stored under the keys of several paths.
 *
 * @param sharing - JSON lists of what a stored manifest holds under the `manifestKey` of each path: the files under a key, or `null` for a key it has not
 * @returns the files as they were declared, in the order of the paths; `undefined` in the place of a path the manifest does not name
 */
export function filesUnderKeys(sharing: readonly string[], paths: readonly string[]): (ManifestFile | undefined)[] {
  const under = sharing.flatMap((list): readonly (readonly StoredFile[] | null)[] => JSON.parse(list));
  const stored = new Map<string, StoredFile>();
  for (const file of under.flatMap((files) => files ?? [])) stored.set(file[0], file);

  return paths.map((path) => {
    const file = stored.get(path);

    return file === undefined ? undefined : declaredFile(file);
  });
}
