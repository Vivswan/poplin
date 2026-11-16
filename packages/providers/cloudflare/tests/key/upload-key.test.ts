// The upload key written for the Worker's secret from a new token, and read back.
// Without this the text a repair writes could be one the bucket refuses, or one the Worker then reads as no key.

import { describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { readUploadKey, uploadKeyText } from "../../src/key/upload-key";

/** A token as Cloudflare answers a new one, and nothing like a real one. */
const MADE = { id: "0123456789abcdef0123456789abcdef", value: "value-of-the-test-token" };

/** The SHA-256 of that value in hexadecimal, worked out by the runtime's own hash and not by the code under test. */
const SECRET = createHash("sha256").update(MADE.value).digest("hex");

/** A moment, in milliseconds since the epoch. */
const AT = 1_700_000_000_000;

describe("uploadKeyText", () => {
  // Drift: the bucket's own API takes the SHA-256 of the token's value as its secret. Another hash, or the value itself, is a key the bucket refuses for ever.
  test("writes the token's id and the SHA-256 of its value, never the value, and the reader reads back what was written", async () => {
    const plain = await uploadKeyText(MADE, { name: "poplin-sites" }, AT);
    const placed = await uploadKeyText(MADE, { name: "poplin-sites", jurisdiction: "eu" }, AT);

    expect([plain.secret, plain.text.includes(MADE.value)]).toEqual([SECRET, false]);
    expect([readUploadKey(plain.text), readUploadKey(placed.text)]).toEqual([
      { id: MADE.id, secret: SECRET, bucket: "poplin-sites", minted_at: AT },
      { id: MADE.id, secret: SECRET, bucket: "poplin-sites", jurisdiction: "eu", minted_at: AT },
    ]);
  });
});
