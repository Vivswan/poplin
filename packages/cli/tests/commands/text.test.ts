import { describe, expect, test } from "bun:test";

import { columns } from "../../src/commands/text";

/** A file name of three letters that each take two cells of a terminal. */
const WIDE_NAME = "\u8cc7\u6599\u96c6.txt";

describe("columns", () => {
  // Drift: a cell measured by its count of letters puts the next column of a row with a wide name, such as a file named in Chinese, to the right of where every other row has it.
  test("a column is as wide as the cells of a terminal its widest cell takes, so a wide name moves no column", () => {
    const lines = columns([
      [WIDE_NAME, "12 B", "text/plain"],
      ["a.txt", "3 B", "text/plain"],
      ["notes", "", ""],
    ]);

    expect(lines).toEqual([`${WIDE_NAME}  12 B  text/plain`, "a.txt       3 B   text/plain", "notes"]);
  });
});
