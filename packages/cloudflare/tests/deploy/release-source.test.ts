import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { projectReleases, sourceAddress } from "../../src/deploy/release-source";

/** The workflow that packs a release's files and adds them to its page. */
const RELEASE_WORKFLOW = join(import.meta.dir, "..", "..", "..", "..", ".github", "workflows", "update-release.yml");

/** A digest of the published form. */
const DIGEST = "9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08";

/** The website's file with one release. */
const ONE_RELEASE = JSON.stringify({ "0.3.1": { source: DIGEST } });

/** What a source asked of the world: each address, in order. */
type Asked = string[];

function answering(asked: Asked, answer: () => Promise<Response>): (url: string) => Promise<Response> {
  return (url) => {
    asked.push(url);

    return answer();
  };
}

function body(status: number, text: string | Uint8Array<ArrayBuffer>): () => Promise<Response> {
  return () => Promise.resolve(new Response(text, { status }));
}

describe("projectReleases", () => {
  const files: readonly { readonly name: string; readonly answer: () => Promise<Response>; readonly pins: unknown }[] = [
    { name: "200 with the file", answer: body(200, ONE_RELEASE), pins: { "0.3.1": { source: DIGEST } } },
    { name: "200 with a file that names no release", answer: body(200, "{}"), pins: {} },
    { name: "200 with a page that is not the file", answer: body(200, "<!doctype html><title>poplin</title>"), pins: undefined },
    { name: "200 with a list", answer: body(200, "[]"), pins: undefined },
    { name: "200 with a file above a megabyte", answer: body(200, `${" ".repeat(1_048_576)}{}`), pins: undefined },
    { name: "404 with the file as its body", answer: body(404, ONE_RELEASE), pins: undefined },
    { name: "503", answer: body(503, ""), pins: undefined },
    { name: "no answer in time", answer: () => Promise.reject(new DOMException("The operation timed out.", "TimeoutError")), pins: undefined },
    { name: "no answer at all", answer: () => Promise.reject(new Error("offline")), pins: undefined },
  ];

  // Drift: "no release" deploys the copy's own files, so only the file's own empty answer may read as it; a near miss read as "none" would put old code on a newer database.
  test.each(files)("the website's $name is read as $pins, from the one file beside latest.json", async ({ answer, pins }) => {
    const asked: Asked = [];

    expect<unknown>([await projectReleases({ fetch: answering(asked, answer) }).pins(), asked]).toEqual([pins, ["https://vivswan.github.io/poplin/releases.json"]]);
  });

  const archive = new Uint8Array([31, 139, 8, 0]);

  const fetches: readonly { readonly name: string; readonly answer: () => Promise<Response>; readonly bytes: Uint8Array<ArrayBuffer> | undefined }[] = [
    { name: "200", answer: body(200, archive), bytes: archive },
    { name: "404, as for a version with no release", answer: body(404, "Not Found"), bytes: undefined },
    { name: "503", answer: body(503, ""), bytes: undefined },
    { name: "no answer at all", answer: () => Promise.reject(new Error("offline")), bytes: undefined },
  ];

  test.each(fetches)("GitHub's $name for a release's files answers $bytes, and nothing here decides whether they are taken", async ({ answer, bytes }) => {
    const asked: Asked = [];

    expect<unknown>([await projectReleases({ fetch: answering(asked, answer) }).fetch("0.2.0"), asked]).toEqual([bytes, ["https://github.com/Vivswan/poplin/releases/download/v0.2.0/poplin-0.2.0.tar.gz"]]);
  });

  // Drift: the workflow names the archive and its folder in shell, the deploy in code; apart, every build answers that the release cannot be fetched.
  test("the release workflow packs the archive under the name a build fetches, with its files in the folder a build unpacks", () => {
    const workflow = readFileSync(RELEASE_WORKFLOW, "utf8");
    const packed = /git archive --format=tar\.gz --prefix=(\S+) --output="(\S+)" HEAD/.exec(workflow);

    expect([packed?.[1], packed?.[2]?.replaceAll("$version", "0.2.0")]).toEqual(["poplin/", sourceAddress("0.2.0").split("/").at(-1)]);
  });
});
