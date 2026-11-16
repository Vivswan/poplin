// What an entry of the audit log says was done: the sentence the Activity screen and the downloaded file both show.

import { describe, expect, test } from "bun:test";
import { noteWentBack } from "@poplin/core/src/actions/go-back";
import type { Database } from "@poplin/core/src/database/database";

import { whatOf } from "../../src/console/activity-what";

describe("what an entry says", () => {
  // Drift: an entry would say less than it holds, name a token by its secret-looking id, call a failed repair a repair, or speak of a domain on an install that has none.
  test.each([
    ["publish", { version: 3 }, "Published version 3"],
    ["publish", {}, "Published a version"],
    ["live_version", { version: 2 }, "Made version 2 live"],
    ["access", { access: "public", public_name: null }, "Made it public"],
    ["details", { expires: 1_800_000_000_000 }, "Set when it deletes itself"],
    ["details", { expires: "never" }, "Set it to never delete itself"],
    ["details", { expires: "never", title: "Trip notes" }, "Changed the site's settings"],
    ["token_added", { token: "a1", scope: "publisher", note: "the laptop" }, 'Added the token "the laptop"'],
    ["token_added", { token: "a1", scope: "publisher", note: "" }, "Added a token"],
    ["token_revoked", { token: "a1", note: "the laptop" }, 'Removed the token "the laptop"'],
    ["login_allowed", { computer: "studio" }, 'Allowed the token "studio"'],
    ["update_started", { from: "1.0.0", to: "1.1.0" }, "Started an update to 1.1.0"],
    ["update_started", { from: "1.0.0", to: "1.1.0", automatic: true }, "Started an update to 1.1.0 by itself"],
    ["domain_synced", { run: "check" }, "Checked the install"],
    ["domain_synced", { run: "repair", failed: [] }, "Repaired the install"],
    ["domain_synced", { run: "repair", failed: ["the login page: refused", "the rules: refused"] }, "Repair failed at the login page"],
  ] as const)("%s with %j says %s", (action, detail, words) => {
    expect(whatOf({ action, detail }, "the install")).toBe(words);
  });

  // Drift: the entry of a going back is written by core and worded here, by the same two keys. With one side renamed, Activity would say only that the install went back, and name neither version.
  test("the entry core writes when the install goes back by itself names both versions", async () => {
    const written: Parameters<typeof whatOf>[0][] = [];
    const database = { appendAudit: async (entry: Parameters<typeof whatOf>[0]) => void written.push(entry), noteProblem: async () => true } as unknown as Database;
    await noteWentBack({ database, now: () => 0 }, { from: "1.1.0", to: "1.0.0" });

    expect(written.map((entry) => whatOf(entry, "the install"))).toEqual(["Went back to 1.0.0: the update to 1.1.0 could not change the database"]);
  });
});
