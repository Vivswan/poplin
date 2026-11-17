// The reading that starts a second build of the website after a release, against a website and a GitHub a test answers for.
// Without it a website that named no new release would stay so with no red run: an install would find no release to take, until some later push to main.

import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { feedOf } from "../../scripts/feed-behind";

/** The folder of the workflows. */
const WORKFLOWS = join(import.meta.dir, "..", "..", "..", "..", "..", ".github", "workflows");

/** A digest as the website's file writes one. */
const DIGEST = "a".repeat(64);

/** The website's file of releases with 0.1.0 in it. */
const NAMED = JSON.stringify({ "0.1.0": { bundle: DIGEST, schema: 1 } });

/** What the website answers for its file of releases, and GitHub for the manifest of a release's page: a body, or a status that is not 200. */
interface World {
  readonly website: string | number;
  readonly manifest: string | number;
}

/** Answer a fetch from a world, and keep what was asked. */
function reachOf(world: World, asked: string[]): { readonly fetch: (url: string) => Promise<Response> } {
  return {
    fetch: async (url) => {
      asked.push(url);
      const answer = url.endsWith("/releases.json") ? world.website : world.manifest;

      return typeof answer === "number" ? new Response("no", { status: answer }) : new Response(answer);
    },
  };
}

describe("whether the website lacks a release that is out", () => {
  test.each([
    ["the website names the version", "0.1.0", { website: NAMED, manifest: 500 }, "named", 1],
    ["the website names only an older version, and the release is a draft", "0.2.0", { website: NAMED, manifest: 404 }, "not_out", 2],
    ["the website names nothing, and the release is out", "0.1.0", { website: "{}", manifest: "{}" }, "behind", 2],
    ["the website names only an older version, and the release is out", "0.2.0", { website: NAMED, manifest: "{}" }, "behind", 2],
  ] as const)("%s", async (_, version, world, feed, asks) => {
    const asked: string[] = [];

    expect([await feedOf(version, reachOf(world, asked)), asked.length]).toEqual([feed, asks]);
  });

  test("the manifest is asked for where an install fetches it", async () => {
    const asked: string[] = [];
    await feedOf("0.1.0", reachOf({ website: "{}", manifest: 404 }, asked));

    expect(asked[1]).toBe("https://github.com/Vivswan/poplin/releases/download/v0.1.0/poplin-0.1.0-worker.json");
  });

  // Drift: a build of an older commit names only that commit's releases. Started on a website that did not answer, it would take a newer release off the file.
  test.each([
    ["the website gives no answer", { website: 503, manifest: "{}" }, "the website gave no file of releases that can be read"],
    ["the website's file cannot be read", { website: "<html>", manifest: "{}" }, "the website gave no file of releases that can be read"],
    ["GitHub answers for the manifest with neither the file nor a 404", { website: "{}", manifest: 503 }, "release 0.1.0: GitHub answered 503 for its manifest of built files"],
  ] as const)("%s: the run stops, and nothing is built on a guess", async (_, world, error) => {
    await expect(feedOf("0.1.0", reachOf(world, []))).rejects.toThrow(error);
  });
});

describe("the workflow that runs the reading", () => {
  // Drift: the trigger names the CI workflow by its `name`, which the managed ci.yml holds. A rename there would end every run of this one, with nothing red.
  test("it follows the workflow ci.yml is named as", () => {
    const named = (file: string): unknown => Bun.YAML.parse(readFileSync(join(WORKFLOWS, file), "utf8"));
    const feed = named("release-feed.yml") as { readonly on: { readonly workflow_run: { readonly workflows: readonly string[] } } };
    const ci = named("ci.yml") as { readonly name: string };

    expect(feed.on.workflow_run.workflows).toEqual([ci.name]);
  });
});
