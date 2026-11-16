import { describe, expect, test } from "bun:test";

import { sha256Of as coreSha256Of } from "../../../core/src/storage/storage";
import { sha256Of } from "../../src/files/hash";

/** A stream of so many pieces of 64 KiB, each filled with its own number, made as it is read: no test holds the whole. */
function pieces(count: number): ReadableStream<Uint8Array> {
  let made = 0;

  return new ReadableStream<Uint8Array>({
    pull(controller): void {
      if (made === count) {
        controller.close();

        return;
      }

      controller.enqueue(new Uint8Array(65_536).fill(made % 251));
      made += 1;
    },
  });
}

/** A stop that never comes. */
const NEVER = new AbortController().signal;

describe("the hash of a file", () => {
  // Drift: a stop that only ended the wait left the file open and its read running to the end, so a stopped publish of a large folder went on reading it, and a server that was told to stop waited for it.
  test("a stop while a file is hashed ends its read: the file is let go, no piece is asked for after it, and the hash is refused as the stop", async () => {
    const stopping = new AbortController();
    const read = { pieces: 0, cancelled: false };
    // Two thousand pieces, so a read that no stop ends still ends.
    const long = (): ReadableStream<Uint8Array> =>
      new ReadableStream<Uint8Array>({
        pull(controller): void {
          read.pieces += 1;
          controller.enqueue(new Uint8Array(1024));
          if (read.pieces === 3) stopping.abort(new Error("stopped by the person"));
          if (read.pieces === 2000) controller.close();
        },
        cancel(): void {
          read.cancelled = true;
        },
      });

    await expect(sha256Of(long, stopping.signal)).rejects.toThrow("stopped by the person");
    const after = read.pieces;
    await new Promise((resolve) => setTimeout(resolve, 20));

    expect([read.cancelled, read.pieces === after, after < 10]).toEqual([true, true, true]);
  });

  test("a file is not opened once the stop has come", async () => {
    let opened = 0;
    const open = (): ReadableStream<Uint8Array> => {
      opened += 1;

      return new Blob(["abc"]).stream();
    };

    await expect(sha256Of(open, AbortSignal.abort(new Error("stopped by the person")))).rejects.toThrow("stopped by the person");
    expect(opened).toBe(0);
  });

  // Drift: the store checks the bytes against the hash a publish declares. A hash in another spelling, or of another function, would have every file refused; the vectors are the standard's own.
  test.each([
    ["nothing", "", "47DEQpj8HBSa+/TImW+5JCeuQeRkm5NMpJWZG3hSuFU="],
    ["abc", "abc", "ungWv48Bz+pBQUDeXa4iI7ADYaOWF3qctBD/YfIAFa0="],
  ])("the SHA-256 of %s is the standard's, in base64 with its pad", async (_what, text, hash) => {
    expect(await sha256Of(() => new Blob([text]).stream(), NEVER)).toBe(hash);
  });

  // Drift: a file is hashed a piece at a time. A hash that depended on where the pieces break, or that differed from the one the install computes, would refuse a whole file.
  test("a file of 300 pieces hashes to what the same bytes in one piece do, and to what the install's own hash gives", async () => {
    const whole = new Uint8Array(await new Response(pieces(300)).arrayBuffer());

    expect([await sha256Of(() => pieces(300), NEVER), await sha256Of(async () => new Blob([whole]).stream(), NEVER)]).toEqual([await coreSha256Of(whole), await coreSha256Of(whole)]);
  });
});
