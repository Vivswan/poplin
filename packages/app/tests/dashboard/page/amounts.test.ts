import { expect, test } from "bun:test";

import { showBytes, showMoment } from "../../../src/dashboard/page/amounts";

test("a size is shown in decimal units, as the settings count them, with one decimal at most", () => {
  const cases = [
    [0, "0 B"],
    [999, "999 B"],
    [1000, "1 KB"],
    [1_250_000, "1.3 MB"],
    [200_000_000, "200 MB"],
    [9_000_000_000, "9 GB"],
    [12_345_678_901, "12.3 GB"],
  ] as const;

  expect(cases.map(([bytes]) => showBytes(bytes))).toEqual(cases.map(([, shown]) => shown));
});

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
