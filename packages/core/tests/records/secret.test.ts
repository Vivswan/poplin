import { describe, expect, test } from "bun:test";

import { signingKeyFromRow, signingKeyToText } from "../../src/records/secret";

const KEY = Uint8Array.from({ length: 32 }, (_, at) => (at * 8 + 7) % 256);
const KEY_TEXT = "070f171f272f373f474f575f676f777f878f979fa7afb7bfc7cfd7dfe7eff7ff";

describe("the stored signing key", () => {
  // Drift: installs hold their key in this text already; an encoder that dropped a leading zero or wrote capitals would hand back another key and sign every owner out.
  test.each([
    [KEY, KEY_TEXT],
    [new Uint8Array(32), "00".repeat(32)],
    [new Uint8Array(33).fill(255), "ff".repeat(33)],
  ])("the key %j is stored as %j and read back whole", (key, text) => {
    expect({ text: signingKeyToText(key), key: signingKeyFromRow({ value: text }) }).toEqual({ text, key });
  });
});
