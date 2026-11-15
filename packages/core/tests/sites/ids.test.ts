import { describe, expect, test } from "bun:test";

import { mintSiteId, parseSiteId } from "../../src/sites/ids";

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
});
