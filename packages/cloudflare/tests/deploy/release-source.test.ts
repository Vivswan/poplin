import { describe, expect, test } from "bun:test";

import { githubReleases, type Latest } from "../../src/deploy/release-source";

/** A run that must not happen: finding the newest release starts no command. */
const noRun = (): Promise<number> => Promise.reject(new Error("no command is expected"));

function answer(status: number, location?: string): () => Promise<Response> {
  return () => Promise.resolve(new Response(null, { status, headers: location === undefined ? {} : { location } }));
}

describe("githubReleases", () => {
  const answers: readonly { readonly name: string; readonly fetch: () => Promise<Response>; readonly latest: Latest }[] = [
    { name: "302 to a release's page", fetch: answer(302, "https://github.com/Vivswan/poplin/releases/tag/v0.3.1"), latest: { kind: "release", version: "0.3.1" } },
    { name: "302 to the list of releases, which GitHub sends while none is published", fetch: answer(302, "https://github.com/Vivswan/poplin/releases"), latest: { kind: "none" } },
    { name: "301 to the list of releases", fetch: answer(301, "https://github.com/Vivswan/poplin/releases"), latest: { kind: "unknown" } },
    { name: "200 that names the list of releases", fetch: answer(200, "https://github.com/Vivswan/poplin/releases"), latest: { kind: "unknown" } },
    { name: "302 to the list of releases with a slash after it", fetch: answer(302, "https://github.com/Vivswan/poplin/releases/"), latest: { kind: "unknown" } },
    { name: "302 to a page of the list of releases", fetch: answer(302, "https://github.com/Vivswan/poplin/releases?page=2"), latest: { kind: "unknown" } },
    { name: "302 to the list of releases of another repository", fetch: answer(302, "https://github.com/example/poplin/releases"), latest: { kind: "unknown" } },
    { name: "302 to the list of releases as a path alone", fetch: answer(302, "/Vivswan/poplin/releases"), latest: { kind: "unknown" } },
    { name: "302 with no address", fetch: answer(302), latest: { kind: "unknown" } },
    { name: "301 to a release's page", fetch: answer(301, "https://github.com/Vivswan/poplin/releases/tag/v0.3.1"), latest: { kind: "unknown" } },
    { name: "302 to a tag that is no version", fetch: answer(302, "https://github.com/Vivswan/poplin/releases/tag/nightly"), latest: { kind: "unknown" } },
    { name: "302 to a version of another repository", fetch: answer(302, "https://github.com/example/poplin/releases/tag/v9.9.9"), latest: { kind: "unknown" } },
    { name: "302 to a login page", fetch: answer(302, "https://github.com/login"), latest: { kind: "unknown" } },
    { name: "404, as for a repository that is gone", fetch: answer(404), latest: { kind: "unknown" } },
    { name: "429, as for too many requests", fetch: answer(429), latest: { kind: "unknown" } },
    { name: "503", fetch: answer(503), latest: { kind: "unknown" } },
    { name: "no answer in time", fetch: () => Promise.reject(new DOMException("The operation timed out.", "TimeoutError")), latest: { kind: "unknown" } },
    { name: "no answer at all", fetch: () => Promise.reject(new Error("offline")), latest: { kind: "unknown" } },
  ];

  // Drift: "no release" deploys the copy's own files, so only GitHub's one exact answer may read as it; a near miss read as "none" would put old code on a newer database.
  test.each(answers)("$name is read as $latest", async ({ fetch, latest }) => {
    expect(await githubReleases({ fetch, run: noRun, env: {} }).latest()).toEqual(latest);
  });

  const clones: readonly { readonly name: string; readonly exit: number; readonly fetched: boolean }[] = [
    { name: "a clone that ends well", exit: 0, fetched: true },
    { name: "a clone git refuses, as for a version with no tag", exit: 128, fetched: false },
  ];

  test.each(clones)("$name answers $fetched, and the clone is of the tag release-please-config.json makes for that version, `v` and the version with no component: another form finds no tag", async ({ exit, fetched }) => {
    const commands: (readonly string[])[] = [];
    const run = (command: readonly string[]): Promise<number> => {
      commands.push(command);
      return Promise.resolve(exit);
    };

    expect(await githubReleases({ fetch: answer(200), run, env: {} }).fetchInto("0.2.0", "/scratch/poplin")).toBe(fetched);
    expect(commands).toEqual([["git", "-c", "advice.detachedHead=false", "clone", "--depth", "1", "--branch", "v0.2.0", "https://github.com/Vivswan/poplin", "/scratch/poplin"]]);
  });
});
