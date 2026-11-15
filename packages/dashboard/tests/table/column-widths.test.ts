// The widths a table is drawn with: what a person set, what the content needs, what a value gives to a room a little too narrow, and where the room left over goes.

import { describe, expect, test } from "bun:test";

import { type Fitted, type SizedColumn, widthsForRoom } from "@/table/column-widths";

/** The test table's columns: the first fixed. */
const COLUMNS: readonly SizedColumn[] = [{ id: "name", fixed: true }, { id: "colour" }, { id: "weight" }, { id: "origin" }];

/** What each column's content needs, and the least it can be drawn at: the values of `colour` alone give, 40 pixels. */
const FITTED: Fitted = {
  needs: new Map([
    ["name", 120],
    ["colour", 100],
    ["weight", 80],
    ["origin", 700],
  ]),
  least: new Map([
    ["name", 120],
    ["colour", 60],
    ["weight", 80],
    ["origin", 700],
  ]),
};

/** What the widths come to, as plain values. */
function widthsOf(columns: readonly SizedColumn[], sizes: Readonly<Record<string, number>>, free: number): unknown {
  const { drawn, spare } = widthsForRoom(columns, FITTED, sizes, free);

  return { drawn: Object.fromEntries(drawn), spare };
}

describe("the widths of a table's columns", () => {
  // Drift: a column would be wider than its content by a fixed number again, or one long value would push the others out.
  test("are what the content needs, up to a cap, and the room left over stays empty after the last column", () => {
    expect(widthsOf(COLUMNS, {}, 1000)).toEqual({ drawn: { name: 120, colour: 100, weight: 80, origin: 320 }, spare: 380 });
  });

  // Drift: a width a person set would lose to the fitted one, or a column could not be made narrower than its content.
  test.each([
    ["a narrower width than the content", { colour: 50 }, { name: 120, colour: 50, weight: 80, origin: 320 }],
    ["a wider width than the cap", { origin: 500 }, { name: 120, colour: 100, weight: 80, origin: 500 }],
  ])("keep %s", (_, sizes, drawn) => {
    expect(widthsOf(COLUMNS, sizes, 1000)).toMatchObject({ drawn });
  });

  // Drift: a table too narrow for its columns would squeeze one under what its values give, or keep a value whole that gives, so the dots of a hidden link would stay at their longest in the very room that is shortest.
  test.each([420, 300, 579])("draw each column at the least its values give and leave no room empty in a room of %d, which they do not fit", (free) => {
    expect(widthsOf(COLUMNS, {}, free)).toEqual({ drawn: { name: 120, colour: 60, weight: 80, origin: 320 }, spare: 0 });
  });

  // Drift: a table a few pixels wider than its room would scroll sideways with a column cut under the rows' actions, where the end of one value was all it took to fit; or a width a person set would be taken back for the room's sake.
  test.each([
    ["by what a value gives, in a room a little too narrow", {}, 600, { name: 120, colour: 80, weight: 80, origin: 320 }],
    ["by all a value gives, and no more", {}, 580, { name: 120, colour: 60, weight: 80, origin: 320 }],
    ["by nothing where a person set the width of the column that gives", { colour: 100 }, 600, { name: 120, colour: 100, weight: 80, origin: 320 }],
  ])("fit the room %s", (_, sizes, free, drawn) => {
    expect(widthsOf(COLUMNS, sizes, free)).toEqual({ drawn, spare: 0 });
  });

  // Drift: a column whose values fill their cell would be left at its heading's width with the room empty beside it.
  test("give the room left over to the column that grows, or to the last column where a person gave that one a width", () => {
    const columns = COLUMNS.map((column) => (column.id === "weight" ? { ...column, grows: true } : column));

    expect(widthsOf(columns, {}, 1000)).toMatchObject({ drawn: { weight: 460 }, spare: 0 });
    expect(widthsOf(columns, { weight: 90 }, 1000)).toMatchObject({ drawn: { weight: 90, origin: 690 }, spare: 0 });
    expect(widthsOf(columns, { name: 100, colour: 100, weight: 90, origin: 300 }, 1000)).toMatchObject({ drawn: { weight: 90, origin: 710 }, spare: 0 });
  });

  // Drift: a fixed column dragged very wide would cover every other column, with no way to reach them.
  test("leave room beside a fixed column for the narrowest of another column", () => {
    expect(widthsOf(COLUMNS, { name: 900 }, 400)).toMatchObject({ drawn: { name: 352, colour: 60 }, spare: 0 });
    expect(widthsOf(COLUMNS, { name: 250 }, 400)).toMatchObject({ drawn: { name: 250, colour: 60 } });
  });

  // Drift: a table with only its fixed column would be drawn narrower than its room, with rows that stop short.
  test("leave the room after a lone fixed column empty", () => {
    expect(widthsOf([{ id: "name", fixed: true }], {}, 600)).toEqual({ drawn: { name: 120 }, spare: 480 });
  });
});
