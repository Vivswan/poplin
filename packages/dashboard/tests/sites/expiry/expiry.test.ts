// When a site deletes itself: what Undo sends, so the moment a site had before a change is the one the server sets again.

import { describe, expect, test } from "bun:test";
import { readExpires } from "@poplin/core/src/actions/sites/changes";

import { backTo } from "@/sites/expiry/expiry";

/** A moment the tests count from: a minute before a day ends in UTC. */
const NOW = Date.UTC(2026, 10, 30, 23, 59);

describe("when a site deletes itself", () => {
  // Drift: Undo would leave an expiry on a site that had none, or put a moment back early or late.
  test("what a site had before is put back: never, or the same moment as the server reads it", () => {
    expect([readExpires(backTo("never"), NOW), readExpires(backTo(NOW + 30_500), NOW + 20_000)]).toEqual(["never", NOW + 30_500]);
  });
});
