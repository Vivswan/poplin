// Compares two backups: whether a second export, made after the first was put back, holds what the first held. It reads what the entries hold and never the zip around them, so an entry's date and its packing count for nothing.
//
//   an entry one backup has alone      one difference: the entry, as `absent` beside `held`
//   a JSON entry both have             one difference a value that is not the same, at its place in the JSON
//   a file both have                   one difference when its length or its SHA-256 is not the same
//   the same entries in another order  one difference: the first place the two orders part

import { createHash } from "node:crypto";
import diff from "microdiff";

import { LAYOUT, readEntryName } from "../../../cli/src/backup/layout";
import { readZip } from "../../../cli/tests/backup/support/zips";

/** What a second backup may hold other than the first, each with why it cannot be the same, in the words the pages name it by. Nothing else is passed over. */
export const IGNORED = [{ entry: LAYOUT.manifest, field: "made_at", why: "the moment the zip was made" }] as const;

/** What stands for an entry, or a value, one backup does not have. */
const ABSENT = "absent";

/** One thing two backups do not agree on: where it sits, and what each backup holds there. A file is given as its length and its hash, never as its bytes. */
interface Difference {
  readonly path: string;
  readonly first: string;
  readonly second: string;
}

/** What comparing two backups came to. The counts are the first backup's; `ignored` names each passed-over value that the two did not agree on. */
export interface Compared {
  readonly same: boolean;
  readonly differences: readonly Difference[];
  readonly ignored: readonly string[];
  readonly sites: number;
  readonly files: number;
  readonly bytes: number;
}

/** What one entry holds, as it is compared: a file's length and hash, or a JSON entry's value. */
type Held = { readonly kind: "file"; readonly said: string } | { readonly kind: "json"; readonly value: Record<string, unknown> | unknown[] };

/** A backup as it is compared: what each entry holds, in the entries' order, and its counts. */
interface Read {
  readonly entries: ReadonlyMap<string, Held>;
  readonly sites: number;
  readonly files: number;
  readonly bytes: number;
}

async function read(zip: string): Promise<Read> {
  const entries = new Map<string, Held>();
  const counts = { sites: 0, files: 0, bytes: 0 };

  for (const [entry, content] of await readZip(zip)) {
    const kind = readEntryName(entry)?.kind;
    if (kind === "site") counts.sites += 1;

    if (kind !== undefined && kind !== "file") {
      entries.set(entry, { kind: "json", value: JSON.parse(content.toString()) });
      continue;
    }

    entries.set(entry, { kind: "file", said: `${content.length} bytes, sha256 ${createHash("sha256").update(content).digest("hex")}` });
    counts.files += 1;
    counts.bytes += content.length;
  }

  return { entries, ...counts };
}

/** The entries one backup holds and the other does not, each as one difference. */
function missingEntries(first: Read, second: Read): Difference[] {
  const onlyFirst = [...first.entries.keys()].filter((entry) => !second.entries.has(entry)).map((path) => ({ path, first: "held", second: ABSENT }));
  const onlySecond = [...second.entries.keys()].filter((entry) => !first.entries.has(entry)).map((path) => ({ path, first: ABSENT, second: "held" }));

  return [...onlyFirst, ...onlySecond];
}

/** Where the entries both backups hold stop coming in the same order, as one difference, or none. */
function orderDifference(first: Read, second: Read): Difference[] {
  const shared = { first: [...first.entries.keys()].filter((entry) => second.entries.has(entry)), second: [...second.entries.keys()].filter((entry) => first.entries.has(entry)) };
  const at = shared.first.findIndex((entry, place) => entry !== shared.second[place]);
  if (at === -1) return [];

  return [{ path: `the order of the entries, at place ${at + 1}`, first: shared.first[at] ?? ABSENT, second: shared.second[at] ?? ABSENT }];
}

/** A value's place in a JSON entry, such as `versions[0].bytes`. */
function placeOf(path: readonly (string | number)[]): string {
  return path.map((key, at) => (typeof key === "number" ? `[${key}]` : `${at === 0 ? "" : "."}${key}`)).join("");
}

/** What one entry both backups hold does not agree on: a file's length or hash, or each value of a JSON entry. */
function entryDifferences(entry: string, first: Held, second: Held): Difference[] {
  if (first.kind === "file" || second.kind === "file") {
    const said = { first: first.kind === "file" ? first.said : "JSON", second: second.kind === "file" ? second.said : "JSON" };

    return said.first === said.second ? [] : [{ path: entry, ...said }];
  }

  return diff(first.value, second.value).map((found) => ({
    path: `${entry}: ${placeOf(found.path)}`,
    first: found.type === "CREATE" ? ABSENT : JSON.stringify(found.oldValue),
    second: found.type === "REMOVE" ? ABSENT : JSON.stringify(found.value),
  }));
}

/**
 * Compare two backups by what they hold.
 *
 * @param first - the path of the zip that was put back
 * @param second - the path of the zip exported after it
 * @returns `same` when nothing but a value of `IGNORED` is other in the second; else every difference, each with its place and what both hold there
 */
export async function compareBackups(first: string, second: string): Promise<Compared> {
  const [held, after] = [await read(first), await read(second)];
  const passed = new Set<string>(IGNORED.map(({ entry, field }) => `${entry}: ${field}`));
  const values = [...held.entries].flatMap(([entry, value]) => {
    const other = after.entries.get(entry);

    return other === undefined ? [] : entryDifferences(entry, value, other);
  });
  const found = [...missingEntries(held, after), ...orderDifference(held, after), ...values];
  const differences = found.filter((difference) => !passed.has(difference.path));
  const ignored = found.filter((difference) => passed.has(difference.path)).map((difference) => difference.path);

  return { same: differences.length === 0, differences, ignored, sites: held.sites, files: held.files, bytes: held.bytes };
}

/** The differences as lines a failure prints: the place, then what the first backup holds and what the second does. */
export function differenceLines(compared: Pick<Compared, "differences">): string[] {
  return compared.differences.map((difference) => `${difference.path}: ${difference.first} -> ${difference.second}`);
}
