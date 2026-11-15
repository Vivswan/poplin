// The words of the Activity screen: what an entry says was done, and what the log's address keeps as it is narrowed and put in another order.

import { describe, expect, test } from "bun:test";

import { emptyWords, kindOf, sortedQuery, sortOf, whatOf } from "../../src/activity/activity-words";

describe("what an entry says", () => {
  // Drift: an entry would say less than it holds, name a token by its secret-looking id, or call a failed repair a repair.
  test.each([
    ["publish", { version: 3 }, "Published version 3"],
    ["publish", {}, "Published a version"],
    ["live_version", { version: 2 }, "Made version 2 live"],
    ["access", { access: "public", public_name: null }, "Made it public"],
    ["token_added", { token: "a1", scope: "publisher", note: "the laptop" }, 'Added the token "the laptop"'],
    ["token_added", { token: "a1", scope: "publisher", note: "" }, "Added a token"],
    ["token_revoked", { token: "a1", note: "the laptop" }, 'Removed the token "the laptop"'],
    ["login_allowed", { computer: "studio" }, 'Allowed the computer "studio"'],
    ["update_started", { from: "1.0.0", to: "1.1.0" }, "Started an update to 1.1.0"],
    ["update_started", { from: "1.0.0", to: "1.1.0", automatic: true }, "Started an update to 1.1.0 by itself"],
    ["domain_synced", { run: "check" }, "Checked the domain"],
    ["domain_synced", { run: "repair", failed: [] }, "Repaired the domain"],
    ["domain_synced", { run: "repair", failed: ["the login page: refused", "the rules: refused"] }, "Repair failed at the login page"],
  ] as const)("%s with %j says %s", (action, detail, words) => {
    expect(whatOf({ action, detail })).toBe(words);
  });
});

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
