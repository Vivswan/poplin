// The upgrade from the last release: an install that release made and filled must open, read, serve, and take every command under this code.
// Drift: a schema step edited after its release, a new setting no stored row holds, a changed object key, backup, login file, or request leaves every install of that release broken by its update, and no test of this code alone sees it.

import { describe, expect, test } from "bun:test";

import config from "../../release-please-config.json" with { type: "json" };
import manifest from "../../.release-please-manifest.json" with { type: "json" };
import { upgradeFindings } from "./support/upgrade";
import { checkOut, HERE, lastRelease } from "./support/trees";

/** The last release this checkout descends from; none before the first. */
const RELEASE = lastRelease(HERE.root);

/** The versions the release manifest holds while no release has a tag: the one it starts at, and the first one while its release is being cut. */
const BEFORE_THE_FIRST: readonly string[] = ["0.0.0", config.packages["."]["initial-version"]];

/** How long the upgrade may take, in milliseconds: the release's code installed, two installs, and some eighty runs of the command. */
const UPGRADE_MS = 180_000;

describe("the upgrade from the last release", () => {
  if (RELEASE === undefined) {
    test("nothing is released yet, so there is no install to upgrade from, and the release manifest says the same: without this a checkout that lost its tags passes as unreleased", () => {
      expect(BEFORE_THE_FIRST).toContain(manifest["."]);
    });
  } else {
    test(
      `an install ${RELEASE} made and filled upgrades to this code with no finding`,
      async () => {
        await using tree = checkOut(HERE.root, RELEASE);

        expect(await upgradeFindings(tree)).toEqual([]);
      },
      UPGRADE_MS,
    );
  }

  test.skip("the MCP tools of the last release's command against this code's install: needs an MCP client among the root package's own dependencies", () =>
    undefined);

  test.skip("an argument of the module changed so that a plan replaces a resource: needs a plan over a state the last release's module made, and the provider plans nothing without an account", () =>
    undefined);
});
