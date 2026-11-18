// The parts of the older build an upgrade uses are looked for in this checkout, by the paths and names the older build is known to hold them under.
// Without it a part that moves or is renamed here goes unseen until a release is the older build, and the upgrade of the release after it fails where it loads.

import { describe, expect, test } from "bun:test";
import { join } from "node:path";

import { liveAddresses } from "../../live/addresses";
import { openBench } from "../../live/bench";
import { seedToken } from "../../scripts/live/tokens";
import { openOlder } from "../../migrations/older";
import { versionOf } from "../../migrations/older-build";

/** The repository's folder, which stands in for the older build's. */
const ROOT = join(import.meta.dir, "..", "..", "..", "..", "..");

describe("the older build's own code", () => {
  test("every part is found in a tree laid out as this checkout is, and is that tree's own", async () => {
    const older = await openOlder(ROOT, {});

    expect([older.version, older.seedToken, older.openBench, older.liveAddresses]).toEqual([versionOf(ROOT), seedToken, openBench, liveAddresses]);
  });

  test("a tree that lacks a part is refused by the path of that part", async () => {
    expect(openOlder(join(ROOT, "docs"), {})).rejects.toThrow("the older build has no packages/core/src/actions/start-update.ts that loads");
  });
});
