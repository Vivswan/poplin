import { describe, expect, test } from "bun:test";

import { randomText } from "../../src/records/random-text";

const BASE36 = "0123456789abcdefghijklmnopqrstuvwxyz";
const DRAWS = 2000;

describe("randomText", () => {
  // Drift: a site id is the secret of an unlisted link, a code is compared by eye, and stored folders and uploads are read back by their form; a shorter text or a smaller alphabet would pass every caller and weaken or break each.
  test.each([
    ["site-id", BASE36, 12],
    ["site-folder", BASE36, 16],
    ["upload-id", BASE36, 16],
    ["login-code", "BCDFGHJKLMNPQRSTVWXZ", 8],
  ] as const)("%s is drawn from all of %j and nothing else, %d characters at a time", (kind, alphabet, length) => {
    const texts = Array.from({ length: DRAWS }, () => randomText(kind));

    const drawn = {
      lengths: [...new Set(texts.map((text) => text.length))],
      symbols: [...new Set(texts.join(""))].sort().join(""),
    };

    expect(drawn).toEqual({ lengths: [length], symbols: alphabet });
  });
});
