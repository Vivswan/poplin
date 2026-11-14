import { describe, expect, test } from "bun:test";

import { toHex } from "../../src/records/hex";

describe("toHex", () => {
  // Drift: a token's hash, the stored signing key, and a visitor key are compared as this text; an encoder that dropped a leading zero or wrote capitals would match none of what is stored.
  test.each([
    [[], ""],
    [[0], "00"],
    [[0x0a, 0xff, 0x10], "0aff10"],
    [[0xde, 0xad, 0xbe, 0xef], "deadbeef"],
  ])("the bytes %j are written %j", (bytes, text) => {
    expect(toHex(Uint8Array.from(bytes))).toBe(text);
  });
});
