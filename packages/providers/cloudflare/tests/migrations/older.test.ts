// The parts of the older build an upgrade uses are looked for in this checkout, by the paths and names the older build is known to hold them under.
// Without it a part that moves or is renamed here goes unseen until a release is the older build, and the upgrade of the release after it fails where it loads.

import { describe, expect, spyOn, test } from "bun:test";
import { join } from "node:path";

import { liveAddresses } from "../../live/addresses";
import { openBench } from "../../live/bench";
import { seedToken } from "../../scripts/live/tokens";
import { openOlder, runChild } from "../../migrations/older";
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

  // Drift: an upgrade runs the older build's install again on the row of a bucket name Cloudflare still holds, which it reads from what the child printed. Lines that went to the log alone would end every such upgrade at its first run.
  test("a child's lines are answered beside its exit code, and printed on this process's own, which stays open", async () => {
    const printed: string[] = [];
    const written = spyOn(process.stdout, "write").mockImplementation((chunk, ...rest) => {
      printed.push(typeof chunk === "string" ? chunk : new TextDecoder().decode(chunk));
      const done = rest.at(-1);
      if (typeof done === "function") done();

      return true;
    });
    const script = "console.log('R2 bucket: failed (refused with status 409 and codes 10073)'); console.log(process.env.SAID); process.exit(3)";

    try {
      const ran = await runChild([process.execPath, "-e", script], { SAID: "a second line" });
      const lines = ["R2 bucket: failed (refused with status 409 and codes 10073)", "a second line", ""];

      expect([ran, printed.join(""), process.stdout.writable]).toEqual([{ code: 3, said: lines }, lines.join("\n"), true]);
    } finally {
      written.mockRestore();
    }
  });
});
