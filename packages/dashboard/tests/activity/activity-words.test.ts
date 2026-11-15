// The words of the Activity screen: what the log's address keeps as it is narrowed and put in another order.

import { describe, expect, test } from "bun:test";

import { emptyWords, kindOf, sortedQuery, sortOf } from "../../src/activity/activity-words";

describe("the log's address", () => {
  // Drift: a turned order would go on from a place of the order before, which skips every entry between; or the log's own order would leave keys in a shared link.
  test.each([
    ["kind=sites&after=40", { key: "when", descending: false }, "kind=sites&sort=when&dir=asc"],
    ["kind=sites&sort=when&dir=asc&after=12", { key: "when", descending: true }, "kind=sites"],
    ["sort=when&dir=asc&after=12", undefined, ""],
  ])("%s put in the order %j is %s", (from, next, to) => {
    expect(sortedQuery(new URLSearchParams(from), next).toString()).toBe(to);
  });

  // Drift: an address typed by hand would name an order the log does not have, and the heading would show an order the rows are not in.
  test.each([
    ["", true],
    ["sort=when&dir=asc", false],
    ["sort=when", true],
    ["dir=asc", true],
    ["sort=who&dir=asc", true],
  ])("%p is read as the newest first: %p", (address, descending) => {
    expect(sortOf(new URLSearchParams(address))).toEqual({ key: "when", descending });
  });

  // Drift: a crafted kind would reach the server and the whole screen would be a refusal.
  test("names every entry for a kind it does not know", () => {
    expect(["kind=everything", "kind=access", ""].map((query) => kindOf(new URLSearchParams(query)))).toEqual(["all", "access", "all"]);
  });
});

describe("an empty page", () => {
  // Drift: an empty page under a filter would read as an install where nothing ever happened.
  test.each([
    ["all", "", "No activity yet"],
    ["access", "", "No activity of this kind"],
    ["all", "notes", 'No activity for "notes"'],
    ["sites", "notes", 'No activity for "notes"'],
  ] as const)("under %s and the search %j is titled %s", (kind, site, title) => {
    expect(emptyWords(kind, site).title).toBe(title);
  });
});
