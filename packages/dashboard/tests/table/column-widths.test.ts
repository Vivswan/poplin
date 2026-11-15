// The widths a table is drawn with: what a person set, what the content needs, and the groups a table too wide for its room scrolls by.

import { describe, expect, test } from "bun:test";

import { type SizedColumn, widthsForRoom } from "@/table/column-widths";

/** The test table's columns: the first fixed. */
const COLUMNS: readonly SizedColumn[] = [{ id: "name", fixed: true }, { id: "colour" }, { id: "weight" }, { id: "origin" }];

/** The width each column's content needs. */
const FITTED = new Map([
  ["name", 120],
  ["colour", 100],
  ["weight", 80],
  ["origin", 700],
]);

/** What the widths come to, as plain values. */
function widthsOf(columns: readonly SizedColumn[], sizes: Readonly<Record<string, number>>, free: number): unknown {
  const { drawn, gaps, stops } = widthsForRoom(columns, FITTED, sizes, free);

  return { drawn: Object.fromEntries(drawn), gaps: Object.fromEntries(gaps), stops };
}

describe("the widths of a table's columns", () => {
  // Drift: a column would be wider than its content by a fixed number again, or one long value would push the others out.
  test("are what the content needs, up to a cap, and the room left over stays empty after the last column", () => {
    expect(widthsOf(COLUMNS, {}, 1000)).toEqual({ drawn: { name: 120, colour: 100, weight: 80, origin: 320 }, gaps: { origin: 380 }, stops: [] });
  });

  // Drift: a width a person set would lose to the fitted one, or a column could not be made narrower than its content.
  test.each([
    ["a narrower width than the content", { colour: 50 }, { name: 120, colour: 50, weight: 80, origin: 320 }],
    ["a wider width than the cap", { origin: 500 }, { name: 120, colour: 100, weight: 80, origin: 500 }],
  ])("keep %s", (_, sizes, drawn) => {
    expect(widthsOf(COLUMNS, sizes, 1000)).toMatchObject({ drawn, stops: [] });
  });

  // Drift: the edge of the room would fall inside a column again: each group must be exactly as wide as the room beside the fixed column.
  test("lay columns that do not fit out in groups of whole columns, each as wide as the room beside the fixed column", () => {
    expect(widthsOf(COLUMNS, {}, 420)).toEqual({
      drawn: { name: 120, colour: 100, weight: 80, origin: 300 },
      gaps: { weight: 120 },
      stops: ["colour", "origin"],
    });
  });

  // Drift: a long column that misses its room by a little would leave the group, and most of the room empty behind it.
  test("draw a column that gives way in the room its group has left, down to what it gives way to", () => {
    const columns = COLUMNS.map((column) => (column.id === "origin" ? { ...column, gives: 150 } : column));

    expect(widthsOf(columns, {}, 500)).toEqual({ drawn: { name: 120, colour: 100, weight: 80, origin: 200 }, gaps: {}, stops: [] });
    expect(widthsOf(columns, {}, 440)).toMatchObject({ drawn: { origin: 320 }, gaps: { weight: 140 }, stops: ["colour", "origin"] });
    expect(widthsOf(columns, { origin: 250 }, 500)).toMatchObject({ drawn: { origin: 250 }, stops: ["colour", "origin"] });
  });

  // Drift: a column whose values fill their cell would be left at its heading's width with the room empty beside it.
  test("give the room left over to the column that grows, unless a person gave it a width", () => {
    const columns = COLUMNS.map((column) => (column.id === "weight" ? { ...column, grows: true } : column));

    expect(widthsOf(columns, {}, 1000)).toMatchObject({ drawn: { weight: 460 }, gaps: {} });
    expect(widthsOf(columns, { weight: 90 }, 1000)).toMatchObject({ drawn: { weight: 90 }, gaps: { origin: 370 } });
  });

  // Drift: a fixed column dragged very wide would cover every other column, with no way to reach them.
  test("leave room beside a fixed column for the narrowest of another column", () => {
    expect(widthsOf(COLUMNS, { name: 900 }, 400)).toMatchObject({
      drawn: { name: 352, colour: 48, weight: 48, origin: 48 },
      stops: ["colour", "weight", "origin"],
    });
    expect(widthsOf(COLUMNS, { name: 250 }, 400)).toMatchObject({ drawn: { name: 250, colour: 100 } });
  });

  // Drift: a table with only its fixed column would be drawn narrower than its room, with rows that stop short.
  test("leave the room after a lone fixed column empty", () => {
    expect(widthsOf([{ id: "name", fixed: true }], {}, 600)).toEqual({ drawn: { name: 120 }, gaps: { name: 480 }, stops: [] });
  });
});
