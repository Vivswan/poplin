// The SHA-256 of a file's bytes, taken as they stream: no file is held in memory whole, and a stop ends the read.

import { createHash } from "node:crypto";

/**
 * Hash the bytes a file opens, a piece at a time, with the platform's own SHA-256.
 *
 * @param open - starts a read of the file from its first byte
 * @param stopped - aborts when the person stops the command: a file is then not opened, and one being read is let go
 * @returns the hash in base64, as a publish declares it
 * @throws {Error} the file could not be read to its end, or the stop came first, which throws the signal's own reason
 */
export async function sha256Of(open: () => ReadableStream<Uint8Array> | Promise<ReadableStream<Uint8Array>>, stopped: AbortSignal): Promise<string> {
  stopped.throwIfAborted();

  const hash = createHash("sha256");
  const bytes = await open();

  await bytes.pipeTo(
    new WritableStream<Uint8Array>({
      write(piece): void {
        hash.update(piece);
      },
    }),
    { signal: stopped },
  );

  return hash.digest("base64");
}
