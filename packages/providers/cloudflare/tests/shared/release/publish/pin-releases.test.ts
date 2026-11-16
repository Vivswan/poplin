// This pins which releases the website names: a rule dropped here publishes the digest of a file nobody released, and every install then takes that file as poplin.

import { describe, expect, test } from "bun:test";
import { mkdtempDisposableSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";

import { releaseDigest } from "@poplin/core/src/records/release";

import { pinReleases } from "../../../../src/shared/release/publish/pin-releases";

/** Turns a text into the bytes of a file. */
const ENCODER = new TextEncoder();

/** The flags every check of an attestation carries. */
const POLICY = ["--repo", "Vivswan/poplin", "--signer-workflow", "Vivswan/poplin/.github/workflows/update-release.yml", "--source-ref", "refs/heads/main", "--deny-self-hosted-runners"];

/** One file of a release's page, as bytes that differ by release and by file. */
function bytesOf(version: string, file: string): Uint8Array<ArrayBuffer> {
  return ENCODER.encode(`${file} of poplin ${version}`);
}

/** The manifest of a version's two built files as the release run writes it, with any part replaced. */
async function manifestOf(version: string, replaced: Readonly<Record<string, unknown>> = {}): Promise<string> {
  const stated = async (file: string): Promise<object> => ({ sha256: await releaseDigest(bytesOf(version, file)), bytes: bytesOf(version, file).byteLength });

  return JSON.stringify({ version, schema: 2, files: { "worker.js": await stated("worker.js"), "worker.js.map": await stated("worker.js.map") }, deploy: { main_module: "worker.js" }, ...replaced });
}

/** A release's page as GitHub answers for it: each file by its name, as bytes or as a status that is not 200. A file left out is a 404. */
type Page = Readonly<Record<string, Uint8Array<ArrayBuffer> | string | number>>;

/** The page of a release that is out whole, with any file replaced. */
async function pageOf(version: string, replaced: Page = {}): Promise<Page> {
  return {
    [`poplin-${version}-worker.json`]: await manifestOf(version),
    [`poplin-${version}-worker.js`]: bytesOf(version, "worker.js"),
    [`poplin-${version}-worker.js.map`]: bytesOf(version, "worker.js.map"),
    ...replaced,
  };
}

/** What GitHub holds: every release's page under its version, and the names of the files that carry no attestation of the release workflow. */
interface Hub {
  readonly pages: Readonly<Record<string, Page>>;
  readonly unattested?: readonly string[];
}

/** Pin the given versions against a GitHub stand-in. Answers the pins, what was asked, each attestation check with the name of its file, and what was said. */
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
      const [, version = "", name = ""] = /\/download\/v([^/]+)\/([^/]+)$/.exec(url) ?? [];
      const held = hub.pages[version]?.[name] ?? 404;

      return Promise.resolve(typeof held === "number" ? new Response("", { status: held }) : new Response(held));
    },
    run: (command) => {
      const file = command[3] ?? "";
      const name = basename(file);
      const version = /^poplin-(\d+\.\d+\.\d+)/.exec(name)?.[1] ?? "";
      const held = hub.pages[version]?.[name];
      const onDisk = readFileSync(file);
      const same = typeof held !== "number" && held !== undefined && Buffer.from(held).equals(onDisk);
      verified.push([...command.slice(0, 3), same ? name : `other bytes than ${name}`, ...command.slice(4)]);

      return Promise.resolve(hub.unattested?.includes(name) === true ? 1 : 0);
    },
  });

  return { pins, asked, verified, said };
}

describe("pinReleases", () => {
  // Drift: this is the whole of what the website trusts a file for; a flag dropped from the check names a file attested by any workflow, or in a run of any branch, and a file left unchecked is one anybody may have put on the page.
  test("a release is named with the digest of its manifest, and the manifest's schema, only after GitHub's command line checked each of its three files, on the fetched bytes", async () => {
    const page = await pageOf("0.2.0");
    const bundle = await releaseDigest(ENCODER.encode(await manifestOf("0.2.0")));
    const names = ["poplin-0.2.0-worker.json", "poplin-0.2.0-worker.js", "poplin-0.2.0-worker.js.map"];

    expect(await pinned(["0.2.0"], { pages: { "0.2.0": page } })).toEqual({
      pins: { "0.2.0": { bundle, schema: 2 } },
      asked: names.map((name) => `https://github.com/Vivswan/poplin/releases/download/v0.2.0/${name}`),
      verified: names.map((name) => ["gh", "attestation", "verify", name, ...POLICY]),
      said: [`release 0.2.0: named, with the digest ${bundle} of its built files, and schema 2`],
    });
  });

  test("with no version released, none is named", async () => {
    expect(await pinned([], { pages: {} })).toEqual({ pins: {}, asked: [], verified: [], said: [] });
  });

  test("with two releases out whole, both are named, and a version before its release is not", async () => {
    const made = await pinned(["0.2.0", "0.2.0-rc.1", "0.1.0"], { pages: { "0.1.0": await pageOf("0.1.0"), "0.2.0": await pageOf("0.2.0"), "0.2.0-rc.1": await pageOf("0.2.0-rc.1") } });

    expect(Object.keys(made.pins as object)).toEqual(["0.2.0", "0.1.0"]);
  });

  test("a newest release whose page has no manifest yet, as while it is a draft, is left out with a line, and no other file of it is asked for", async () => {
    const made = await pinned(["0.2.0", "0.1.0"], { pages: { "0.1.0": await pageOf("0.1.0") } });

    expect([Object.keys(made.pins as object), made.said[0], made.asked.filter((url) => url.includes("/v0.2.0/")).length]).toEqual([["0.1.0"], "release 0.2.0: no manifest of built files is published, so it is not named", 1]);
  });

  // Drift: a release that was out and lost its manifest would be dropped from the file with one line, and every install would refuse it as one that was never published. The site deployed before names it still.
  test.each([
    { name: "between two releases that are out", versions: ["0.3.0", "0.2.0", "0.1.0"], out: ["0.3.0", "0.1.0"] },
    { name: "behind a newest release that is not out yet", versions: ["0.3.0", "0.2.0"], out: [] },
  ])("an older release whose page has no manifest, $name, stops the run", async ({ versions, out }) => {
    const pages = Object.fromEntries(await Promise.all(out.map(async (version) => [version, await pageOf(version)] as const)));

    await expect(pinned(versions, { pages })).rejects.toThrow("release 0.2.0: no manifest of built files is published, and a newer version is named");
  });

  const refused: readonly { readonly name: string; readonly hub: (version: string) => Promise<Hub>; readonly thrown: string }[] = [
    {
      name: "a manifest nobody attested",
      hub: async (version) => ({ pages: { [version]: await pageOf(version) }, unattested: [`poplin-${version}-worker.json`] }),
      thrown: "release 0.2.0: its manifest of built files did not pass as attested by the release workflow in a run of main",
    },
    {
      name: "an attested manifest that names a module the page lacks",
      hub: async (version) => ({ pages: { [version]: await pageOf(version, { [`poplin-${version}-worker.js`]: 404 }) } }),
      thrown: "release 0.2.0: its page holds a manifest of built files and no built file worker.js",
    },
    {
      name: "a module swapped for one nobody attested, beside an attested manifest",
      hub: async (version) => ({ pages: { [version]: await pageOf(version) }, unattested: [`poplin-${version}-worker.js`] }),
      thrown: "release 0.2.0: its built file worker.js did not pass as attested by the release workflow in a run of main",
    },
    {
      name: "a source map nobody attested",
      hub: async (version) => ({ pages: { [version]: await pageOf(version) }, unattested: [`poplin-${version}-worker.js.map`] }),
      thrown: "release 0.2.0: its built file worker.js.map did not pass as attested by the release workflow in a run of main",
    },
    {
      name: "an attested module of another release, which is not the one the manifest states",
      hub: async (version) => ({ pages: { [version]: await pageOf(version, { [`poplin-${version}-worker.js`]: bytesOf("0.1.0", "worker.js") }) } }),
      thrown: "release 0.2.0: its built file worker.js has another SHA-256 digest than the manifest says",
    },
    {
      name: "an attested module longer than the manifest states",
      hub: async (version) => ({ pages: { [version]: await pageOf(version, { [`poplin-${version}-worker.js`]: bytesOf(version, "worker.js and more") }) } }),
      thrown: "release 0.2.0: its built file worker.js holds 34 bytes, and the manifest says 25",
    },
    {
      name: "an attested manifest of another release",
      hub: async (version) => ({ pages: { [version]: await pageOf(version, { [`poplin-${version}-worker.json`]: await manifestOf("0.1.0") }) } }),
      thrown: "release 0.2.0: its manifest of built files says it is of 0.1.0",
    },
    {
      name: "an attested manifest with no schema",
      hub: async (version) => ({ pages: { [version]: await pageOf(version, { [`poplin-${version}-worker.json`]: await manifestOf(version, { schema: undefined }) }) } }),
      thrown: "release 0.2.0: its manifest of built files gives a schema that is not a whole number from 1 up",
    },
    {
      name: "an attested manifest that names no file",
      hub: async (version) => ({ pages: { [version]: await pageOf(version, { [`poplin-${version}-worker.json`]: await manifestOf(version, { files: {} }) }) } }),
      thrown: "release 0.2.0: its manifest of built files names no file",
    },
    {
      name: "an attested file that is no manifest",
      hub: async (version) => ({ pages: { [version]: await pageOf(version, { [`poplin-${version}-worker.json`]: "<!doctype html>" }) } }),
      thrown: "release 0.2.0: its manifest of built files is not a manifest",
    },
  ];

  // Drift: a file that did not pass is never named, and its release must not be dropped either: the command line fails the same way while GitHub's service is down, and a file that lost every release leaves no install one to update to.
  // A release named over an unchecked file would publish a digest anybody could have made.
  test.each(refused)("$name stops the run, and names nothing", async ({ hub, thrown }) => {
    const pages = { ...(await hub("0.2.0")).pages, "0.1.0": await pageOf("0.1.0") };

    await expect(pinned(["0.2.0", "0.1.0"], { ...(await hub("0.2.0")), pages })).rejects.toThrow(thrown);
  });

  // Drift: a site built with a release missing only because GitHub was down would have every install refuse that release for a day; the site deployed before names it still.
  test.each([
    ["poplin-0.2.0-worker.json", 500, "manifest of built files"],
    ["poplin-0.2.0-worker.json", 429, "manifest of built files"],
    ["poplin-0.2.0-worker.json", 302, "manifest of built files"],
    ["poplin-0.2.0-worker.json", 503, "manifest of built files"],
    ["poplin-0.2.0-worker.js", 500, "built file worker.js"],
    ["poplin-0.2.0-worker.js.map", 403, "built file worker.js.map"],
  ] as const)("GitHub's answer for %s of %i stops the run, so no site is built from half an answer", async (name, status, what) => {
    const hub = { pages: { "0.1.0": await pageOf("0.1.0"), "0.2.0": await pageOf("0.2.0", { [name]: status }) } };

    await expect(pinned(["0.2.0", "0.1.0"], hub)).rejects.toThrow(`release 0.2.0: GitHub answered ${status} for its ${what}`);
  });
});
