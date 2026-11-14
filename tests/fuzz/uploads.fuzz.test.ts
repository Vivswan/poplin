// A file request names its file by a path the publisher wrote: whatever characters a storable path holds, the database must answer that file and no other, and hand the manifest back as it was declared.

import { expect } from "bun:test";
import fc from "fast-check";

import { checkFilePath } from "../../packages/core/src/actions/files";
import type { TokenId } from "../../packages/core/src/auth/tokens";
import { openDatabase } from "../../packages/core/src/database/open";
import { mintSiteFolder } from "../../packages/core/src/records/site";
import { mintUploadId } from "../../packages/core/src/records/upload";
import { isContentType } from "../../packages/core/src/storage/storage";
import { BunSqliteDriver } from "../../packages/core/tests/database/support/bun-sqlite-driver";
import { fuzzTarget } from "./config";

const NOW = 1_700_000_000_000;
const OWNER = "00000000000000aa" as TokenId;
const ROOM = { own: 1_000_000, folderBytes: Number.MAX_SAFE_INTEGER, staying: 0, totalBytes: Number.MAX_SAFE_INTEGER, sites: null, day: "2026-11-13", dayFiles: Number.MAX_SAFE_INTEGER };

const property = fuzzTarget(import.meta.file);

const signs = fc.constantFrom("2024", "0", "-1", "1e3", "$", "$.a", "$[0]", "[0]", "a.b", '"', "'", "%", "_", "{}", "[]", ":", ",", "__proto__", "constructor", "length", " ", "\u00E9", "\u{1F600}", "x".repeat(240));
const segments = fc.oneof(signs, fc.string({ unit: "grapheme", minLength: 1, maxLength: 8 }), fc.tuple(signs, signs).map(([one, other]) => `${one}${other}`));
const paths = fc.array(segments, { minLength: 1, maxLength: 4 }).map((path) => path.join("/")).filter((path) => checkFilePath(path).ok);
const types = fc.oneof(fc.constantFrom("text/html", 'text/html; charset="utf-8"', "a/b;c=[1,2]"), fc.string({ unit: "grapheme", minLength: 1, maxLength: 20 }).filter(isContentType));
const files = fc.record({ path: paths, size: fc.oneof(fc.nat(), fc.constantFrom(0, 2 ** 40)), content_type: types });
const manifests = fc.uniqueArray(files, { minLength: 1, maxLength: 12, selector: (file) => file.path });

async function opened(): Promise<Awaited<ReturnType<typeof openDatabase>> & { kind: "open" }> {
  const database = await openDatabase(new BunSqliteDriver(), NOW);
  if (database.kind !== "open") throw new Error(`the database did not open: ${database.kind}`);

  return database;
}

const { database } = await opened();

property(
  "every declared path answers its own file, a path not declared answers none, and the manifest reads back in its order",
  fc.asyncProperty(manifests, fc.array(paths, { maxLength: 6 }), async (manifest, others) => {
    const id = mintUploadId();
    await database.addUpload({ id, folder: mintSiteFolder(), number: 2, owner: OWNER, plan: { kind: "update", details: {} }, manifest, created_at: NOW }, ROOM);
    const declared = new Map(manifest.map((file) => [file.path, file]));
    const asked = [...declared.keys(), ...others];
    const answered = await Promise.all(asked.map(async (path) => (await database.getUploadFile(id, path))?.file));
    const whole = await database.getUpload(id);
    await database.abandonUpload(id);

    expect(answered).toEqual(asked.map((path) => declared.get(path)));
    expect(whole?.manifest).toEqual(manifest);
  }),
);
