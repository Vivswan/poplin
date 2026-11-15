// A list's pages: what the address keeps of a page's place as the list is changed.

import { describe, expect, test } from "bun:test";

import { queryWith } from "@/shared/pages";

describe("a list's address", () => {
  // Drift: a new filter would keep the place of the page before, and show an empty or a wrong page under a row count of another list.
  test.each([
    ["kind=sites&after=40&from=51", { site: "notes" }, "kind=sites&site=notes"],
    ["kind=sites&site=notes", { kind: "" }, "site=notes"],
    ["kind=sites", { after: "40", from: "51" }, "kind=sites&after=40&from=51"],
    ["kind=sites&after=40&from=51", {}, "kind=sites"],
    ["sort=when&dir=asc&after=40&from=51", { kind: "access" }, "sort=when&dir=asc&kind=access"],
  ])("%s changed by %j is %s", (from, changes, to) => {
    expect(queryWith(new URLSearchParams(from), changes).toString()).toBe(to);
  });
});
