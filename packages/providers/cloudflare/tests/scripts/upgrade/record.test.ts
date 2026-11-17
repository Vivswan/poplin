// What differs between an install as the older build ran it and as this commit's build runs it is told from two readings written by hand.
// Without it a check that compares nothing, or one whose line names a site or the value of a setting, passes the upgrade on the fake, where nothing differs.

import { describe, expect, test } from "bun:test";

import { logFaults, type Reading, settingFaults, siteFaults } from "../../../scripts/upgrade/record";

/** A page as a stranger is served it. */
const SERVED = { status: 200, digest: "a".repeat(64), type: "text/html; charset=utf-8" };

/** A site's answer to a stranger who may not open it. */
const REFUSED = { status: 302, digest: undefined, type: undefined };

/** The files a backup of the first site holds, of both its versions, and of the second. */
const [TWO_VERSIONS, ONE_VERSION] = [{ "version 1, index.html": "1".repeat(64), "version 2, index.html": "2".repeat(64) }, { "version 1, index.html": "3".repeat(64) }];

/** An install with two sites, the two settings an upgrade changes, and two entries of the log. */
const BEFORE: Reading = {
  sites: [
    { access: "private", shown: { id: "one", label: "a--one", access: "private", url: "https://a.example.com", live_version: 2, state: "live" }, visit: REFUSED, stored: TWO_VERSIONS },
    { access: "public", shown: { id: "two", label: "b--two", access: "public", url: "https://b.example.com", live_version: 1, state: "live" }, visit: SERVED, stored: ONE_VERSION },
  ],
  listed: 2,
  settings: { versions_kept: 5, trash_days: 7, logins: ["owner@example.com", "upgrade-check@example.com"] },
  log: [
    { seq: 2, action: "settings_changed", detail: { keys: ["versions_kept"] }, by: "owner@example.com" },
    { seq: 1, action: "create", detail: {}, by: "owner@example.com" },
  ],
};

/** The entry a start of the update wrote. */
const STARTED = { seq: 3, action: "update_started", detail: { from: "0.1.0", to: "0.2.0" } };

/** The same install after an update that changed nothing. */
const AFTER: Reading = { ...BEFORE, log: [STARTED, ...BEFORE.log] };

/** The update both readings are of. */
const UPDATE = { from: "0.1.0", to: "0.2.0" };

/** The reading after the update, with one of its sites changed. */
function withSite(place: 0 | 1, change: Partial<Reading["sites"][number]>): Reading {
  return { ...AFTER, sites: AFTER.sites.map((site, at) => (at === place ? { ...site, ...change } : site)) };
}

describe("what an update changed of an install", () => {
  test("an install that answers as before has no fault", () => {
    expect([siteFaults(BEFORE, AFTER), settingFaults(BEFORE, AFTER), logFaults(BEFORE, AFTER, UPDATE)]).toEqual([[], [], []]);
  });

  // Drift: each row is a way an update can break a site that a status alone, or the holder's view alone, does not show.
  test.each([
    ["other bytes at the same status", withSite(1, { visit: { ...SERVED, digest: "b".repeat(64) } }), ["site 2 (public): a stranger was answered 200 and is answered 200, with other bytes or another media type"]],
    ["a public site a stranger is refused", withSite(1, { visit: REFUSED }), ["site 2 (public): a stranger was answered 200 and is answered 302"]],
    ["a live version that moved, and another address", withSite(1, { shown: { ...BEFORE.sites[1]?.shown, live_version: 2, url: "https://c.example.com" } }), ["site 2 (public): its url changed, its live_version changed"]],
    ["a private site whose older version lost its file", withSite(0, { stored: { "version 2, index.html": "2".repeat(64) } }), ["site 1 (private): the files of its versions are not the 2 it held, byte for byte"]],
    [
      "a site that is gone, and one listed less",
      { ...AFTER, sites: AFTER.sites.slice(0, 1), listed: 1 },
      [expect.stringMatching(/^site 2 \(public\): its id changed, .* a stranger was answered 200 and is answered undefined, the files of its versions are not the 1 it held, byte for byte$/), "the install listed 2 sites and lists 1"],
    ],
  ] as const)("%s is told by the site's place and access, with no name and no address", (_what, after, faults) => {
    expect(siteFaults(BEFORE, after)).toEqual([...faults]);
  });

  // Drift: a setting's value may be a login, so only its key is told.
  test.each([
    ["a setting that went back to its default", { ...BEFORE.settings, versions_kept: 3 }, ["versions_kept changed", "versions_kept is not the value it was given"]],
    ["a user that is gone", { ...BEFORE.settings, logins: ["owner@example.com"] }, ["logins changed", "the user that was added is not among the logins"]],
    ["a setting the newer build does not answer", { versions_kept: 5, logins: BEFORE.settings.logins }, ["trash_days changed"]],
    ["a setting the newer build added", { ...BEFORE.settings, added: true }, []],
  ] as const)("%s is told by its key alone", (_what, settings, faults) => {
    expect(settingFaults(BEFORE, { ...AFTER, settings })).toEqual([...faults]);
  });

  // Drift: an update that lost the log, or whose entry names another version, would pass a check that only counts entries.
  test.each([
    ["no entry of the update", BEFORE.log, ["no update_started entry names the update"]],
    ["an entry of another update", [{ ...STARTED, detail: { from: "0.1.0", to: "0.3.0" } }, ...BEFORE.log], ["no update_started entry names the update"]],
    ["an entry from before that is gone", [STARTED, ...BEFORE.log.slice(0, 1)], ["1 of the 2 entries from before the update are gone or changed"]],
    ["an entry from before whose detail was emptied", [STARTED, { ...BEFORE.log[0], seq: 2, action: "settings_changed", detail: {} }, ...BEFORE.log.slice(1)], ["1 of the 2 entries from before the update are gone or changed"]],
    ["an entry from before under another action", [STARTED, { seq: 2, action: "delete", detail: {} }, ...BEFORE.log.slice(1)], ["1 of the 2 entries from before the update are gone or changed"]],
  ] as const)("a log with %s is told", (_what, log, faults) => {
    expect(logFaults(BEFORE, { ...AFTER, log: [...log] }, UPDATE)).toEqual([...faults]);
  });
});
