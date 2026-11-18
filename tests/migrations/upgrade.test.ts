// The upgrade from the last release: an install that release made and filled must open, read, serve, and take every command under this code.
// Drift: a schema step edited after its release, a new setting no stored row holds, a changed object key, backup, login file, or request leaves every install of that release broken by its update, and no test of this code alone sees it.

import { describe, expect, test } from "bun:test";

import { upgradeFindings } from "./support/upgrade";
import { checkOut, HERE, lastRelease } from "./support/trees";

/** The last release this checkout descends from. */
const RELEASE = lastRelease(HERE.root);

/** How long the upgrade may take, in milliseconds: the release's code installed, two installs, and some eighty runs of the command. */
const UPGRADE_MS = 180_000;

describe("the upgrade from the last release", () => {
  test(
    `an install ${RELEASE} made and filled upgrades to this code with no finding`,
    async () => {
      await using tree = checkOut(HERE.root, RELEASE);

      expect(await upgradeFindings(tree)).toEqual([]);
    },
    UPGRADE_MS,
  );

  test.skip("the MCP tools of the last release's command against this code's install: needs an MCP client among the root package's own dependencies", () =>
    undefined);
});
