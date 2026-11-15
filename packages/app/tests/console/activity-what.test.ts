// What an entry of the audit log says was done: the sentence the Activity screen and the downloaded file both show.

import { describe, expect, test } from "bun:test";

import { whatOf } from "../../src/console/activity-what";

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
    ["login_allowed", { computer: "studio" }, 'Allowed the token "studio"'],
    ["update_started", { from: "1.0.0", to: "1.1.0" }, "Started an update to 1.1.0"],
    ["update_started", { from: "1.0.0", to: "1.1.0", automatic: true }, "Started an update to 1.1.0 by itself"],
    ["domain_synced", { run: "check" }, "Checked the domain"],
    ["domain_synced", { run: "repair", failed: [] }, "Repaired the domain"],
    ["domain_synced", { run: "repair", failed: ["the login page: refused", "the rules: refused"] }, "Repair failed at the login page"],
  ] as const)("%s with %j says %s", (action, detail, words) => {
    expect(whatOf({ action, detail })).toBe(words);
  });
});
