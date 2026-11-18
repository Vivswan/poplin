// The nightly reading of the website's release files, against a website a test answers for.
// Without it a website whose files no install can read, or that names an old release, would stay so with no red run: every install would find no update.

import { describe, expect, test } from "bun:test";

import { feedFaults } from "../../../scripts/live/feed-watch";

/** The tags of a repository whose newest release is 0.2.0: git lists them in no order of versions, with other tags among them. */
const TAGS: readonly string[] = ["v0.10.0-rc.1", "v0.2.0", "stable", "v0.1.0", "0.9.0", ""];

/** A digest as the website's file writes one. */
const DIGEST = "a".repeat(64);

/** What the website answers for each file: a body, a status that is not 200, or no answer at all. */
interface World {
  readonly releases: string | number | undefined;
  readonly latest: string | number | undefined;
}

function pins(...versions: readonly string[]): string {
  return JSON.stringify(Object.fromEntries(versions.map((version) => [version, { bundle: DIGEST, schema: 1 }])));
}

function latest(version: string): string {
  return JSON.stringify({ version, released: "2026-01-02", schema: 1, notes: `https://github.com/Vivswan/poplin/releases/tag/v${version}` });
}

/** Answer a fetch from a world, and keep what was asked. */
function reachOf(world: World, asked: string[] = []): { readonly fetch: (url: string) => Promise<Response> } {
  return {
    fetch: async (url) => {
      asked.push(url);
      const answer = url.endsWith("/releases.json") ? world.releases : world.latest;
      if (answer === undefined) throw new TypeError("fetch failed");

      return typeof answer === "number" ? new Response("no", { status: answer }) : new Response(answer);
    },
  };
}

describe("what is wrong with the website's release files", () => {
  test.each<readonly [string, World, readonly string[]]>([
    ["both files name the newest tag", { releases: pins("0.1.0", "0.2.0"), latest: latest("0.2.0") }, []],
    [
      "the website cannot be reached",
      { releases: undefined, latest: undefined },
      ["releases.json: the website gave no answer.", "latest.json: the website gave no answer."],
    ],
    [
      "the website answers with another status",
      { releases: 404, latest: 503 },
      ["releases.json: the website answered 404.", "latest.json: the website answered 503."],
    ],
    [
      "the files are not of the shape an install reads",
      { releases: JSON.stringify({ "0.2.0": { bundle: "short", schema: 1 } }), latest: JSON.stringify({ version: "0.2.0" }) },
      ["releases.json: the website's file is not one an install can read.", "latest.json: the website's file is not one an install can read."],
    ],
    [
      "the files name an older release",
      { releases: pins("0.1.0"), latest: latest("0.1.0") },
      ["releases.json: its newest release is 0.1.0, and the newest tag is v0.2.0.", "latest.json: it names 0.1.0, and the newest tag is v0.2.0."],
    ],
    [
      "the files name no release yet",
      { releases: "{}", latest: JSON.stringify({ version: null }) },
      ["releases.json: its newest release is none, and the newest tag is v0.2.0.", "latest.json: it names no release, and the newest tag is v0.2.0."],
    ],
    [
      "latest.json names the newest tag in more bytes than an install reads",
      { releases: pins("0.2.0"), latest: latest("0.2.0").padEnd(20_000) },
      ["latest.json: the website's file is not one an install can read."],
    ],
    ["one file alone is no file of the website's", { releases: pins("0.1.0", "0.2.0"), latest: "<html>" }, ["latest.json: the website's file is not one an install can read."]],
  ])("%s", async (_, world, faults) => {
    expect(await feedFaults(TAGS, reachOf(world))).toEqual([...faults]);
  });

  // Drift: a checkout without its tags would compare the website with nothing, and pass every night.
  test("a checkout with no tag of a release is a fault, and the website is not asked", async () => {
    const asked: string[] = [];

    expect(await feedFaults(["stable", ""], reachOf({ releases: pins("0.2.0"), latest: latest("0.2.0") }, asked))).toEqual([
      "This checkout holds no tag of a release: the website's files are compared with nothing.",
    ]);
    expect(asked).toEqual([]);
  });
});
