// This pins which releases the website names: a rule dropped here publishes the digest of a file nobody released, and every install then takes that file as poplin.

import { describe, expect, test } from "bun:test";
import { mkdtempDisposableSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { releaseDigest } from "@poplin/core/src/records/release";

import { pinReleases } from "../../src/deploy/pin-releases";

const ENCODER = new TextEncoder();

/** The archive of a version, as bytes that differ by version. */
function archiveOf(version: string): Uint8Array<ArrayBuffer> {
  return ENCODER.encode(`the archive of poplin ${version}`);
}

/** What GitHub holds: the status it answers for each version's archive, and which archives carry the release workflow's attestation. */
interface Hub {
  readonly status: Readonly<Record<string, number>>;
  readonly attested: readonly string[];
}

/** Pin the given versions against a GitHub stand-in. Answers the pins, what was asked, each attestation check with the bytes its file held, and what was said. */
async function pinned(versions: readonly string[], hub: Hub): Promise<{ readonly pins: unknown; readonly asked: readonly string[]; readonly verified: readonly (readonly string[])[]; readonly said: readonly string[] }> {
  using scratch = mkdtempDisposableSync(join(tmpdir(), "poplin-pins-test-"));
  const asked: string[] = [];
  const verified: string[][] = [];
  const said: string[] = [];

  const pins = await pinReleases(versions, {
    scratch: scratch.path,
    say: (line) => said.push(line),
    fetch: (url) => {
      asked.push(url);
      const version = /\/v([^/]+)\//.exec(url)?.[1] ?? "";
      const status = hub.status[version] ?? 404;

      return Promise.resolve(new Response(status === 200 ? archiveOf(version) : "", { status }));
    },
    run: (command) => {
      const held = new TextDecoder().decode(readFileSync(command[3] ?? ""));
      verified.push([...command.slice(0, 3), held, ...command.slice(4)]);

      return Promise.resolve(hub.attested.some((version) => held === `the archive of poplin ${version}`) ? 0 : 1);
    },
  });

  return { pins, asked, verified, said };
}

describe("pinReleases", () => {
  // Drift: this is the whole of what the website trusts a file for; a flag dropped from the check names a file attested by any workflow, or in a run of any branch.
  test("a published archive is named with the digest of its bytes only after GitHub's command line checked, on those bytes, that the release workflow attested them in a run of main", async () => {
    const policy = ["--repo", "Vivswan/poplin", "--signer-workflow", "Vivswan/poplin/.github/workflows/update-release.yml", "--source-ref", "refs/heads/main", "--deny-self-hosted-runners"];

    expect(await pinned(["0.2.0"], { status: { "0.2.0": 200 }, attested: ["0.2.0"] })).toEqual({
      pins: { "0.2.0": { source: await releaseDigest(archiveOf("0.2.0")) } },
      asked: ["https://github.com/Vivswan/poplin/releases/download/v0.2.0/poplin-0.2.0.tar.gz"],
      verified: [["gh", "attestation", "verify", "the archive of poplin 0.2.0", ...policy]],
      said: [`release 0.2.0: named, with the digest ${await releaseDigest(archiveOf("0.2.0"))}`],
    });
  });

  const cases: readonly { readonly name: string; readonly versions: readonly string[]; readonly hub: Hub; readonly named: readonly string[]; readonly said: readonly string[] }[] = [
    { name: "no version released", versions: [], hub: { status: {}, attested: [] }, named: [], said: [] },
    { name: "two releases, both attested", versions: ["0.2.0", "0.1.0"], hub: { status: { "0.1.0": 200, "0.2.0": 200 }, attested: ["0.1.0", "0.2.0"] }, named: ["0.2.0", "0.1.0"], said: [] },
    {
      name: "a newest release whose page has no archive yet, as while it is a draft",
      versions: ["0.2.0", "0.1.0"],
      hub: { status: { "0.1.0": 200 }, attested: ["0.1.0"] },
      named: ["0.1.0"],
      said: ["release 0.2.0: no source archive is published, so it is not named"],
    },
    { name: "a version before its release", versions: ["0.2.0-rc.1"], hub: { status: { "0.2.0-rc.1": 200 }, attested: ["0.2.0-rc.1"] }, named: [], said: [] },
  ];

  test.each(cases)("with $name, exactly $named are named", async ({ versions, hub, named, said }) => {
    const made = await pinned(versions, hub);

    expect([Object.keys(made.pins as object), made.said.filter((line) => !line.includes(": named, "))]).toEqual([[...named], [...said]]);
  });

  // Drift: an archive that did not pass is never named, and it must not be dropped either: the command line fails the same way while GitHub's service is down, and a file that lost every release sends each build back to its copy's own files.
  test("an archive put on a release's page by hand, which no run of the release workflow attested, stops the run", async () => {
    const hub = { status: { "0.1.0": 200, "0.2.0": 200 }, attested: ["0.1.0"] };

    await expect(pinned(["0.2.0", "0.1.0"], hub)).rejects.toThrow("release 0.2.0: its source archive did not pass as attested by the release workflow in a run of main");
  });

  // Drift: a site built with a release missing only because GitHub was down would have every install refuse that release for a day; the site deployed before names it still.
  test.each([500, 503, 429, 302])("GitHub's %i for an archive stops the run, so no site is built from half an answer", async (status) => {
    await expect(pinned(["0.2.0", "0.1.0"], { status: { "0.1.0": 200, "0.2.0": status }, attested: ["0.1.0", "0.2.0"] })).rejects.toThrow(`release 0.2.0: GitHub answered ${status} for its source archive`);
  });
});
