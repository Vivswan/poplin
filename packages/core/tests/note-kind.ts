// A made-up record kind with three shapes, for the doorway and migration tests: no shipped record has an old shape to test with.

import * as v from "valibot";

import type { Registry, Step } from "../src/migrations/upgrade";
import { REVISION } from "../src/records/fields";
import type { RecordKind } from "../src/records/kind";
import type { Etag, ObjectKey, ObjectStore } from "../src/storage/storage";
import { bytesOf, objectKey } from "./storage-contract";

const JSON_TYPE = { contentType: "application/json" };

const NOTE_SCHEMA = v.strictObject({ shape: v.literal(3), revision: REVISION, title: v.string(), tags: v.array(v.string()) });

/** A note in its current shape, the third. */
export type Note = v.InferOutput<typeof NOTE_SCHEMA>;

/** The note kind: shape 1 held `text`, shape 2 renamed it `title`, shape 3 added `tags`. */
export const NOTE: RecordKind<Note> = { name: "note", shape: 3, schema: NOTE_SCHEMA };

/** Shape 1 to 2. */
export const RENAME_TEXT: Step = {
  from: 1,
  description: "rename text to title",
  run: ({ text, ...rest }) => ({ ...rest, title: text }),
};

/** Shape 2 to 3. */
export const ADD_TAGS: Step = {
  from: 2,
  description: "add an empty tag list",
  run: (old) => ({ ...old, tags: [] }),
};

/** Shape 2 to 3, for a step that cannot do its work. */
export const BROKEN_TAGS: Step = {
  from: 2,
  description: "add an empty tag list",
  run: () => {
    throw new Error("the tag list is unknown");
  },
};

/** The note's steps as the doorway takes them. */
export const NOTE_STEPS: Registry = { note: [RENAME_TEXT, ADD_TAGS] };

/** The key of a note fixture. */
export function noteKey(name: string): ObjectKey {
  return objectKey(`.notes/${name}`);
}

/** Store a value as JSON, with no check: the way an older release left its records. */
export async function putRaw(store: ObjectStore, key: ObjectKey, value: unknown): Promise<Etag> {
  const info = await store.write(key, bytesOf(typeof value === "string" ? value : JSON.stringify(value)), JSON_TYPE);

  return info.etag;
}

/** What a key holds now, as parsed JSON with its etag; `undefined` for a missing key. */
export async function stored(store: ObjectStore, key: ObjectKey): Promise<{ readonly value: unknown; readonly etag: Etag } | undefined> {
  const read = await store.read(key);
  if (read.kind !== "found") return undefined;

  return { value: JSON.parse(await new Response(read.body).text()), etag: read.info.etag };
}

/** A store that counts the reads and conditional writes made through it. */
export function counting(store: ObjectStore): { readonly store: ObjectStore; readonly calls: { reads: number; writes: number } } {
  const calls = { reads: 0, writes: 0 };
  const counted: ObjectStore = {
    head: (key) => store.head(key),
    read: (key, options) => {
      calls.reads += 1;

      return store.read(key, options);
    },
    write: (key, body, options) => store.write(key, body, options),
    writeIf: (key, body, options, condition) => {
      calls.writes += 1;

      return store.writeIf(key, body, options, condition);
    },
    delete: (key) => store.delete(key),
    deleteMany: (keys) => store.deleteMany(keys),
    list: (options) => store.list(options),
  };

  return { store: counted, calls };
}
