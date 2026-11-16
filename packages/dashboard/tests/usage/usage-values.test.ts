// What a line of the Usage screen says of a number beside its limit.

import { expect, test } from "bun:test";

import { raisedBytes, shareOf } from "../../src/usage/usage-values";

// Drift: a number just under its limit would read as fine, one at it as under it, or a line with no limit would show a share.
test.each([
  [72_000, 250_000, { percent: 28, state: "fine", words: null }],
  [199_999, 250_000, { percent: 79, state: "fine", words: null }],
  [200_000, 250_000, { percent: 80, state: "near", words: "Near the limit" }],
  [249_999, 250_000, { percent: 99, state: "near", words: "Near the limit" }],
  [250_000, 250_000, { percent: 100, state: "at", words: "At the limit" }],
  [300_000, 250_000, { percent: 120, state: "over", words: "Over the limit" }],
  [5, null, undefined],
  [5, 0, undefined],
] as const)("%d of %s is %j", (used, limit, share) => {
  expect(shareOf(used, limit)).toEqual(share);
});

// Drift: a size is written with its decimals cut; a count cut down and written after "at most" says the account held less than it did.
test.each([
  [0, 0],
  [999, 999],
  [1000, 1000],
  [1001, 1100],
  [1_000_000, 1_000_000],
  [1_000_001, 1_100_000],
  [1_000_000_001, 1_100_000_000],
  [5_000_000, 5_000_000],
  [5_099_999, 5_100_000],
  [999_950_001, 1_000_000_000],
  [9_999_999_999, 10_000_000_000],
  [9_000_000_000_000_001, 9_000_000_000_000_001],
])("after at most, %i bytes are raised to %i", (bytes, raised) => {
  expect(raisedBytes(bytes)).toBe(raised);
});
