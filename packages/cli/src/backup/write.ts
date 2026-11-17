// The writer of a backup: a zip streamed to a file beside its target, which takes the target's name only once the whole zip is written.

import { randomBytes } from "node:crypto";
import { once } from "node:events";
import { createWriteStream, promises as fs } from "node:fs";
import { dirname } from "node:path";
import { Readable } from "node:stream";
import { finished, pipeline } from "node:stream/promises";
import yazl from "yazl";

/** What the file is called while it is written: the target's name, a random word, and this. */
const PART_SUFFIX = ".part";

/** The code of the system's error for a path whose folder is not there. */
const MISSING = "ENOENT";

/** How many random bytes name the file while it is written. */
const PART_BYTES = 4;

/** The file's mode, where the system has file modes: its owner reads and writes it and nobody else does, since it holds every private site. */
const FILE_MODE = 0o600;

/** Why a backup cannot be written where it was asked: a file is already there, or the file cannot be made. */
type NotWritable = { readonly ok: false; readonly reason: "exists" } | { readonly ok: false; readonly reason: "unwritable"; readonly why: string };

/**
 * A backup being written. Entries are added in the order they are to sit in the zip, and one at a time.
 *
 * Any of the three that write may throw, for a disk that is full or a stream that breaks off. The backup is then given up with `abandon`, and nothing is left under the target's name.
 */
export interface BackupWriter {
  /** Adds one entry that holds a JSON value. */
  readonly addJson: (name: string, value: unknown) => void;

  /** Adds one entry from a stream of exactly `size` bytes, and waits until the stream is read to its end. */
  readonly addFile: (name: string, body: ReadableStream<Uint8Array>, size: number) => Promise<void>;

  /** Ends the zip and gives the file the target's name. It answers the zip's size in bytes. */
  readonly finish: () => Promise<number>;

  /** Stops writing and removes the file being written. Safe to call after any failure, and twice. */
  readonly abandon: () => Promise<void>;
}

/** What stands under the name: nothing, a folder, or something a backup may replace, which is a file or a link, even one that leads nowhere. */
function standsAt(path: string): Promise<"nothing" | "folder" | "file"> {
  return fs.lstat(path).then(
    (found) => (found.isDirectory() ? "folder" : "file"),
    () => "nothing" as const,
  );
}

/** Why the file `part` cannot be made, in the command's words where the cause is known: a missing folder is named, not the system's error about a file the person never typed. */
function reasonOf(error: unknown, part: string): string {
  if (error instanceof Error && "code" in error && error.code === MISSING) return `folder "${dirname(part)}" does not exist`;

  return error instanceof Error ? error.message : String(error);
}

/** A stream of one piece that lets the piece go once it is read: the zip keeps every stream it was given until its end, and would keep the bytes with it. */
function givenOnce(bytes: Buffer): Readable {
  let left: Buffer | undefined = bytes;

  return new Readable({
    read() {
      if (left !== undefined) this.push(left);

      left = undefined;
      this.push(null);
    },
  });
}

/**
 * Begin a backup at `target`.
 *
 * The zip is written to a new file beside the target, so a backup that fails or is interrupted never stands under the target's name.
 *
 * @param overwrite - whether a file already at `target` is replaced when the backup is finished
 * @returns the writer, `exists` for a target that is there and may not be replaced, or `unwritable` with the reason the file beside it cannot be made. A folder under the target's name is never replaced
 */
export async function createBackup(target: string, overwrite: boolean): Promise<{ readonly ok: true; readonly writer: BackupWriter } | NotWritable> {
  const there = await standsAt(target);
  if (there === "folder") return { ok: false, reason: "unwritable", why: `"${target}" is a folder, and --out requires a file` };

  if (!overwrite && there === "file") return { ok: false, reason: "exists" };

  const part = `${target}.${randomBytes(PART_BYTES).toString("hex")}${PART_SUFFIX}`;
  const file = createWriteStream(part, { flags: "wx", mode: FILE_MODE });
  const refused = await once(file, "open").then(
    () => undefined,
    (error: unknown) => reasonOf(error, part),
  );
  if (refused !== undefined) return { ok: false, reason: "unwritable", why: refused };

  const zip = new yazl.ZipFile();
  const made = new Date();
  const written = pipeline(zip.outputStream, file);

  // Rejects once the zip or the file fails, and never resolves: a stream being added is raced against it, since the zip would read it no further.
  const broken = new Promise<never>((_resolve, reject) => {
    zip.once("error", reject);
    written.catch(reject);
  });
  broken.catch(() => undefined);

  const writer: BackupWriter = {
    addJson: (name, value) => {
      const bytes = Buffer.from(JSON.stringify(value, null, 2));
      zip.addReadStream(givenOnce(bytes), name, { size: bytes.length, mtime: made });
    },
    addFile: async (name, body, size) => {
      const source = Readable.fromWeb(body as unknown as Parameters<typeof Readable.fromWeb>[0]);
      zip.addReadStream(source, name, { size, mtime: made });

      try {
        await Promise.race([finished(source), broken]);
      } catch (error) {
        source.destroy();

        throw error;
      }
    },
    finish: async () => {
      zip.end();
      await Promise.race([written, broken]);

      if (!overwrite && (await standsAt(target)) !== "nothing") throw new Error(`a file appeared at "${target}" during the export`);

      await fs.rename(part, target);

      return (await fs.stat(target)).size;
    },
    abandon: async () => {
      file.destroy();
      await written.catch(() => undefined);
      await fs.rm(part, { force: true });
    },
  };

  return { ok: true, writer };
}
