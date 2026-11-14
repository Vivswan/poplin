// A backup is a file anyone may hand to `poplin import`. No bytes may crash the reader, reach the install before the whole file passed its checks, name a path outside a site, or put a file anywhere.

import { afterAll, expect } from "bun:test";
import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import fc from "fast-check";

import { parseObjectKey } from "../../packages/core/src/storage/storage";
import { openBackup } from "../../packages/cli/src/backup/read";
import { run } from "../../packages/cli/src/commands/run";
import { backupEntries, writeZip } from "../../packages/cli/tests/backup/support/zips";
import { fuzzTarget } from "./config";

const SERVER = "https://poplin.example.com";
const TOKEN = `poplin_${"0".repeat(16)}_${"a".repeat(64)}`;
const CRASHED = "poplin failed in a way it has no word for";
const REFUSED = "the file is not a backup";
const IMPORT_PATH = "/api/import/sites";
const UPLOAD_NAME = /^v[1-9]\d*\/.+$/;
const SCRATCH = mkdtempSync(join(tmpdir(), "poplin-fuzz-"));
const ZIP = join(SCRATCH, "backup.zip");
const NOT_LOGGED_IN = JSON.stringify({ error: { code: "not_logged_in", message: "no token was sent" } });
const VALID = readFileSync(await writeZip(join(SCRATCH, "valid.zip"), backupEntries({ settings: { trash_days: "9" } })));
const KEPT = readdirSync(SCRATCH).sort();

type Edit =
  | { readonly kind: "flip"; readonly at: number; readonly byte: number }
  | { readonly kind: "cut"; readonly at: number }
  | { readonly kind: "drop"; readonly at: number; readonly length: number }
  | { readonly kind: "insert"; readonly at: number; readonly bytes: Uint8Array };

const property = fuzzTarget(import.meta.file);

const places = fc.nat({ max: VALID.length });
const edits: fc.Arbitrary<Edit> = fc.oneof(
  fc.record({ kind: fc.constant("flip" as const), at: places, byte: fc.integer({ min: 0, max: 255 }) }),
  fc.record({ kind: fc.constant("cut" as const), at: places }),
  fc.record({ kind: fc.constant("drop" as const), at: places, length: fc.integer({ min: 1, max: 64 }) }),
  fc.record({ kind: fc.constant("insert" as const), at: places, bytes: fc.uint8Array({ minLength: 1, maxLength: 64 }) }),
);
const backups = fc.oneof(
  { arbitrary: fc.array(edits, { minLength: 0, maxLength: 4 }).map((made) => made.reduce(edited, new Uint8Array(VALID))), weight: 6 },
  { arbitrary: fc.uint8Array({ maxLength: 2048 }), weight: 1 },
  { arbitrary: fc.uint8Array({ maxLength: 512 }).map((tail) => Uint8Array.from([0x50, 0x4b, 0x03, 0x04, ...tail])), weight: 1 },
  { arbitrary: fc.bigInt({ min: 0n, max: 2n ** 64n - 1n }).map(sentTo), weight: 1 },
);

/** A zip of two records and nothing else: the ZIP64 locator that names where the directory is, anywhere up to 2^64, and the end record that sends a reader to it. */
function sentTo(offset: bigint): Uint8Array {
  const locator = Buffer.from("504b0607000000000000000000000000".padEnd(40, "0"), "hex");
  locator.writeBigUInt64LE(offset, 8);
  locator.writeUInt32LE(1, 16);

  return Buffer.concat([locator, Buffer.from("504b050600000000ffffffffffffffffffffffff0000", "hex")]);
}

function edited(bytes: Uint8Array, edit: Edit): Uint8Array {
  const at = Math.min(edit.at, bytes.length);

  if (edit.kind === "cut") return bytes.slice(0, at);

  if (edit.kind === "drop") return Uint8Array.from([...bytes.slice(0, at), ...bytes.slice(at + edit.length)]);

  if (edit.kind === "insert") return Uint8Array.from([...bytes.slice(0, at), ...edit.bytes, ...bytes.slice(at)]);

  const flipped = new Uint8Array(bytes);
  if (at < flipped.length) flipped[at] = edit.byte;

  return flipped;
}

/** Whether the reader takes the file as a backup; when it does, every file of it must sit at a path a site can hold. */
async function passes(path: string): Promise<boolean> {
  const opened = await openBackup(path);
  if (!opened.ok) {
    expect(opened.reason).not.toBe("");

    return false;
  }

  try {
    for await (const site of opened.backup.sites()) {
      const paths = site.versions.flatMap((version) => version.files.map((file) => file.path));

      expect(paths.filter((file) => !parseObjectKey(file).ok)).toEqual([]);
      expect(site.label).toBe(`${site.record.name}--${site.record.id}`);
    }
  } finally {
    await opened.backup.close();
  }

  return true;
}

afterAll(() => rmSync(SCRATCH, { recursive: true, force: true }));

property(
  "whatever bytes a backup holds, the reader answers with a backup or a reason, and writes no file",
  fc.asyncProperty(backups, async (bytes) => {
    writeFileSync(ZIP, bytes);

    await passes(ZIP);

    expect(readdirSync(SCRATCH).sort()).toEqual([ZIP.slice(SCRATCH.length + 1), ...KEPT].sort());
  }),
);

property(
  "whatever bytes a backup holds, import ends without a crash, asks the install nothing unless the whole file passed, and names every file under a version",
  fc.asyncProperty(backups, fc.boolean(), async (bytes, loggedIn) => {
    writeFileSync(ZIP, bytes);
    const printed: string[] = [];
    const sent: URL[] = [];

    const code = await run(["import", ZIP], {
      out: (text) => printed.push(text),
      err: (text) => printed.push(text),
      status: (text) => printed.push(text),
      fetch: async (input, init) => {
        sent.push(new URL(input));
        if (!loggedIn) return new Response(NOT_LOGGED_IN, { status: 401 });

        const declared = new URL(input).pathname === IMPORT_PATH ? (JSON.parse(String(init.body)) as { files: { path: string }[] }).files : [];
        expect(declared.filter((file) => !UPLOAD_NAME.test(file.path) || !parseObjectKey(file.path).ok)).toEqual([]);

        return new Response(JSON.stringify({ error: { code: "id_taken", message: "taken", about: "id" } }), { status: 409 });
      },
      machine: { env: { POPLIN_SERVER: SERVER, POPLIN_TOKEN: TOKEN, POPLIN_CONFIG_DIR: join(SCRATCH, "config") }, platform: process.platform, home: SCRATCH },
      terminal: { asks: false, progress: true },
      ask: async () => "",
      timeoutMs: 1000,
      computer: "laptop",
      open: () => undefined,
      pause: async () => "over",
    });
    const text = printed.join("\n");

    expect([0, 1]).toContain(code);
    expect(text).not.toContain(CRASHED);
    expect(text).not.toContain(TOKEN);
    if (text.includes(REFUSED)) expect(sent).toEqual([]);

    if (sent.length > 0) expect(await passes(ZIP)).toBe(true);

    expect(readdirSync(SCRATCH).sort()).toEqual([ZIP.slice(SCRATCH.length + 1), ...KEPT].sort());
  }),
);
