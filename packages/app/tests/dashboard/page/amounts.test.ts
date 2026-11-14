import { expect, test } from "bun:test";

import { showMoment } from "../../../src/dashboard/page/amounts";

test("a moment is shown to the minute in UTC inside a time element; one no calendar holds is shown as its number and never throws", async () => {
  const cases = [
    [1_700_000_000_000, '<time datetime="2023-11-14T22:13:20.000Z">2023-11-14 22:13 UTC</time>'],
    [0, '<time datetime="1970-01-01T00:00:00.000Z">1970-01-01 00:00 UTC</time>'],
    [865_700_000_000_000, '<time datetime="+029402-12-10T22:13:20.000Z">+029402-12-10 22:13 UTC</time>'],
    [8_640_000_000_000_001, "8640000000000001"],
    [Number.MAX_SAFE_INTEGER, "9007199254740991"],
  ] as const;

  for (const [moment, shown] of cases) expect(String(await showMoment(moment))).toBe(shown);
});
