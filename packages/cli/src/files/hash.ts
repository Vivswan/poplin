// The SHA-256 of a file's bytes, taken as they stream: no file is held in memory whole.

import { createHash } from "node:crypto";

/**
 * Hash the bytes a file opens, a piece at a time, with the platform's own SHA-256.
 *
 * @param open - starts a read of the file from its first byte
 * @returns the hash in base64, as a publish declares it
 * @throws {Error} the file could not be read to its end
 */
export async function sha256Of(open: () => ReadableStream<Uint8Array> | Promise<ReadableStream<Uint8Array>>): Promise<string> {
  const hash = createHash("sha256");
  const bytes = await open();

  await bytes.pipeTo(
    new WritableStream<Uint8Array>({
      write(piece): void {
        hash.update(piece);
      },
    }),
  );

  return hash.digest("base64");
}
