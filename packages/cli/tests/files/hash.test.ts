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

describe("the hash of a file", () => {
  // Drift: the store checks the bytes against the hash a publish declares. A hash in another spelling, or of another function, would have every file refused; the vectors are the standard's own.
  test.each([
    ["nothing", "", "47DEQpj8HBSa+/TImW+5JCeuQeRkm5NMpJWZG3hSuFU="],
    ["abc", "abc", "ungWv48Bz+pBQUDeXa4iI7ADYaOWF3qctBD/YfIAFa0="],
  ])("the SHA-256 of %s is the standard's, in base64 with its pad", async (_what, text, hash) => {
    expect(await sha256Of(() => new Blob([text]).stream())).toBe(hash);
  });

  // Drift: a file is hashed a piece at a time. A hash that depended on where the pieces break, or that differed from the one the install computes, would refuse a whole file.
  test("a file of 300 pieces hashes to what the same bytes in one piece do, and to what the install's own hash gives", async () => {
    const whole = new Uint8Array(await new Response(pieces(300)).arrayBuffer());

    expect([await sha256Of(() => pieces(300)), await sha256Of(async () => new Blob([whole]).stream())]).toEqual([await coreSha256Of(whole), await coreSha256Of(whole)]);
  });
});
