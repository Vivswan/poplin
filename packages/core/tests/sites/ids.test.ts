import { describe, expect, test } from "bun:test";

import { mintSiteId, parseSiteId } from "../../src/sites/ids";

/** A random source that hands out the given bytes in order, then zeros. */
function scripted(bytes: readonly number[]): (target: Uint8Array) => void {
  let at = 0;

  return (target) => {
    for (let slot = 0; slot < target.length; slot += 1) {
      target[slot] = bytes[at] ?? 0;
      at += 1;
    }
  };
}

describe("parseSiteId", () => {
  // Drift: the id is the whole of an unlisted site's protection and the key of its record; a looser form would read a record under a key no mint can make.
  test.each([
    ["k3f9x2ab71qz", { ok: true, value: "k3f9x2ab71qz" }],
    ["000000000000", { ok: true, value: "000000000000" }],
    ["summerreport", { ok: true, value: "summerreport" }],
    ["", { ok: false, refusal: "bad-id" }],
    ["k3f9x2ab71q", { ok: false, refusal: "bad-id" }],
    ["k3f9x2ab71qzz", { ok: false, refusal: "bad-id" }],
    ["K3F9X2AB71QZ", { ok: false, refusal: "bad-id" }],
    ["k3f9x2-b71qz", { ok: false, refusal: "bad-id" }],
    ["k3f9x2ab71qz\n", { ok: false, refusal: "bad-id" }],
    ["report--k3f9x2ab71qz", { ok: false, refusal: "bad-id" }],
  ] as ReadonlyArray<readonly [string, unknown]>)("decides %j", (raw, outcome) => {
    expect<unknown>(parseSiteId(raw)).toEqual(outcome);
  });
});

describe("mintSiteId", () => {
  test("drift: ids are the only thing telling apart sites that share a name, so 1000 mints must give 1000 ids, each one the parser accepts, drawing every symbol", () => {
    const ids = Array.from({ length: 1000 }, () => mintSiteId());
    const symbols = [...new Set(ids.join(""))].sort().join("");

    expect({ distinct: new Set(ids).size, accepted: ids.filter((id) => parseSiteId(id).ok).length, symbols }).toEqual({
      distinct: 1000,
      accepted: 1000,
      symbols: "0123456789abcdefghijklmnopqrstuvwxyz",
    });
  });

  test("drift: 256 is not a multiple of 36, so a byte from 252 up must be thrown away, or the first four symbols would come up more often", () => {
    const id = mintSiteId(scripted([0, 35, 36, 251, 252, 253, 254, 255, 1, 2, 3, 4, 5, 6, 7, 8]));

    expect<string>(id).toBe("0z0z12345678");
  });
});
