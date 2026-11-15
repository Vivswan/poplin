// An install made and filled by one tree's own code: its preview seeds the sample install it ships, on a database and a store this check keeps hold of.
//
// The seed belongs to the tree, so an install of the last release is filled by the last release's actions, whatever they were.

import { BunSqliteDriver } from "../../../packages/core/tests/database/support/bun-sqlite-driver";
import { part, type Tree } from "./trees";

/** Where a tree keeps what this check reads it through: each module from the tree's root, and the export taken from it. */
const SEAMS = {
  preview: ["packages/demo/src/preview/preview.ts", "createPreview"],
  samples: ["packages/demo/scripts/samples.ts", "readSamples"],
  store: ["packages/core/src/storage/memory.ts", "MemoryStore"],
} as const;

/** The version every install of the check is told it runs, so that no answer differs by it. */
export const VERSION = "1.0.0";

/** The object store of a tree, as far as this check asks it. */
interface TreeStore {
  list(options: {
    readonly prefix: string;
    readonly cursor?: string;
  }): Promise<{ readonly objects: readonly { readonly key: string }[]; readonly more: boolean; readonly cursor?: string }>;
  read(key: string): Promise<{ readonly kind: string; readonly info?: { readonly contentType: string }; readonly body?: ReadableStream<Uint8Array> }>;
}

/** What a tree's preview is handed, and what it hands back. */
type CreatePreview = (host: {
  readonly openDriver: () => BunSqliteDriver;
  readonly openStore: () => TreeStore;
  readonly samples: unknown;
  readonly version: string;
}) => Promise<{ readonly fetch: (request: Request) => Promise<Response>; readonly token: () => string }>;

/** One object as a store keeps it. */
export interface StoredObject {
  readonly key: string;
  readonly bytes: Uint8Array;
  readonly contentType: string;
}

/** An install a tree's code made and filled. */
export interface Seeded {
  /** The database the install's records are in. */
  readonly driver: BunSqliteDriver;

  /** A token of the install's admin. */
  readonly token: string;

  /** The install's dashboard, its API under `/api`, and each site under `/served/<host label>/`. */
  readonly fetch: (request: Request) => Promise<Response>;

  /** Every object the install's store holds now. */
  readonly objects: () => Promise<readonly StoredObject[]>;
}

async function objectsOf(store: TreeStore): Promise<readonly StoredObject[]> {
  const objects: StoredObject[] = [];
  let cursor: string | undefined;

  do {
    const page = await store.list({ prefix: "", ...(cursor === undefined ? {} : { cursor }) });

    for (const { key } of page.objects) {
      const read = await store.read(key);
      if (read.info === undefined || read.body === undefined) throw new Error(`the store listed ${key} and holds no such object`);

      objects.push({ key, bytes: new Uint8Array(await new Response(read.body).arrayBuffer()), contentType: read.info.contentType });
    }

    cursor = page.more ? page.cursor : undefined;
  } while (cursor !== undefined);

  return objects;
}

/** Take a value out of a holder, so that it is handed out once. */
function take<Holder, Key extends keyof Holder>(holder: Holder, key: Key): Holder[Key] | undefined {
  const value = holder[key];
  delete holder[key];

  return value;
}

/**
 * Make an install with a tree's code and fill it with the tree's own sample data.
 *
 * @returns the install; nothing of it outlives the test process
 * @throws {Error} the tree lacks a module this check reads it through, or its seed was refused
 */
export async function seedInstall(tree: Tree): Promise<Seeded> {
  const createPreview = await part<CreatePreview>(tree, ...SEAMS.preview);
  const readSamples = await part<() => Promise<unknown>>(tree, ...SEAMS.samples);
  const Store = await part<new () => TreeStore>(tree, ...SEAMS.store);
  const [driver, store] = [new BunSqliteDriver(), new Store()];
  // The preview opens its seeded install first and one that holds nothing after it: these two are for the first.
  const first: { driver?: BunSqliteDriver; store?: TreeStore } = { driver, store };

  const preview = await createPreview({
    openDriver: () => take(first, "driver") ?? new BunSqliteDriver(),
    openStore: () => take(first, "store") ?? new Store(),
    samples: await readSamples(),
    version: VERSION,
  });

  return { driver, token: preview.token(), fetch: preview.fetch, objects: () => objectsOf(store) };
}
