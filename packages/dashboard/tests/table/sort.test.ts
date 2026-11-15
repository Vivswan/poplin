// The order of a table in its address: what an order writes, and what is read back.

import { describe, expect, test } from "bun:test";

import { type Orders, sortIn, sortKeys } from "../../src/table/sort";

/** A table ordered by two columns: the newest change first when nobody sorted it. */
const ORDERS: Orders = { first: { name: "asc", updated: "desc" }, unsorted: { key: "updated", descending: true } };

describe("the order in the address", () => {
  // Drift: the table's own order would leave keys in a shared link, or an order would be written the wrong way round.
  test.each([
    ["a column in its first direction", { key: "name", descending: false }, { sort: "name", dir: "asc" }],
    ["a column turned around", { key: "name", descending: true }, { sort: "name", dir: "desc" }],
    ["the unsorted table's own column, turned around", { key: "updated", descending: false }, { sort: "updated", dir: "asc" }],
    ["the table's own order", { key: "updated", descending: true }, { sort: "", dir: "" }],
    ["no order", undefined, { sort: "", dir: "" }],
  ])("%s writes its keys", (_what, next, keys) => {
    expect(sortKeys(next, ORDERS)).toEqual(keys);
  });

  // Drift: an address typed by hand could ask the server for an order it does not have, or a missing direction would flip the table.
  test.each([
    ["", { key: "updated", descending: true }],
    ["sort=name", { key: "name", descending: false }],
    ["sort=name&dir=desc", { key: "name", descending: true }],
    ["sort=colour&dir=asc", { key: "updated", descending: true }],
    ["sort=toString", { key: "updated", descending: true }],
  ])("%p is read as its order", (address, sort) => {
    expect(sortIn(new URLSearchParams(address), ORDERS)).toEqual(sort);
  });
});
