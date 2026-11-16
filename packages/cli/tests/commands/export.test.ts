import { afterEach, describe, expect, test } from "bun:test";
import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

import { readZip } from "../backup/support/zips";
import { type Bench, cleanUp, folderOf, jsonOf, openBench, scratch } from "./support/harness";

/** A JSON answer in the install's place. */
function answer(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

/** Publish a site of two versions; answers its label. */
async function publishedTwice(bench: Bench, name: string): Promise<string> {
  const folder = folderOf(name, { "index.html": "<title>First</title>", "css/site.css": "body{}" });
  const label = (jsonOf(await bench.run(`${folder} --json`)).site as { label: string }).label;
  writeFileSync(join(folder, "index.html"), "<title>Second</title>");
  await bench.run(`${folder} --site ${label}`);

  return label;
}

function isFileRequest(request: Request): boolean {
  return new URL(request.url).pathname.endsWith("/file") && request.method === "GET";
}

/** An answer that never comes, with the command stopped a moment after it was asked for. */
function heldUntilStopped(bench: Bench): Promise<Response> {
  setTimeout(bench.stop, 5);

  return new Promise<Response>(() => undefined);
}

/** A file that arrives in part and breaks off when the command is stopped, a moment later: what the platform does to a download on its way. */
function brokenOffByStop(bench: Bench, request: Request): Response {
  const body = new ReadableStream<Uint8Array>({
    start: (controller) => {
      controller.enqueue(new TextEncoder().encode("bo"));
      request.signal.addEventListener("abort", () => controller.error(request.signal.reason));
      setTimeout(bench.stop, 5);
    },
  });

  return new Response(body, { headers: { "Content-Length": "6", "Poplin-Content-Type": "text%2Fcss" } });
}

afterEach(cleanUp);

describe("export", () => {
  test("an export holds each site's live version, --all-versions every kept one, and a named site that site alone without the settings: without this a flag or the argument is read and dropped", async () => {
    const bench = await openBench();
    const notes = await publishedTwice(bench, "notes");
    const docs = (jsonOf(await bench.run(`${folderOf("docs", { "index.html": "<title>Docs</title>" })} --public --json`)).site as { label: string }).label;
    const folder = scratch();
    const namesIn = async (zip: string): Promise<string[]> => (await readZip(join(folder, zip))).map(([name]) => name.replace(/^sites\/([a-z]+)--[a-z0-9]+/, "sites/$1"));

    const live = await bench.run(`export --out ${join(folder, "live.zip")}`);
    const all = jsonOf(await bench.run(`export --all-versions --out ${join(folder, "all.zip")} --json`));
    const one = await bench.run(`export docs --out ${join(folder, "one.zip")}`);

    expect(live).toMatchObject({ code: 0, err: [] });
    expect(live.out.map((line) => line.replace(/ {2,}/g, "  ").replace(/, [\d.]+ k?B$/, ", <size>")).sort()).toEqual([
      `exported  ${docs}  1 version  1 file  19 B`,
      `exported  ${notes}  1 version  2 files  27 B`,
      `wrote ${join(folder, "live.zip")}: 2 sites, 3 files, <size>`,
    ]);
    expect((await namesIn("live.zip")).filter((name) => name.startsWith("sites/notes/"))).toEqual(["sites/notes/site.json", "sites/notes/versions/2/files/css/site.css", "sites/notes/versions/2/files/index.html", "sites/notes/versions/2/files.json"]);
    expect(all).toMatchObject({ file: join(folder, "all.zip"), format: 1, all_versions: true, settings: true, files: 5, bytes: 72, zip_bytes: readFileSync(join(folder, "all.zip")).length });
    expect((all.sites as { label: string; versions: number }[]).map((site) => [site.label, site.versions]).sort()).toEqual([[docs, 1], [notes, 2]].sort());
    expect([one.out.at(-1)?.split(": ")[1]?.split(", ").slice(0, 2), await namesIn("one.zip")]).toEqual([["1 site", "1 file"], ["sites/docs/site.json", "sites/docs/versions/1/files/index.html", "sites/docs/versions/1/files.json", "manifest.json"]]);
  });

  // Drift: the local preview sends each file with no `Content-Length`; an export that needed the header ended in `unexpected_answer: status 200` there.
  test("an export of files that come with no length writes the same zip as one of files that name it", async () => {
    const bench = await openBench();
    await publishedTwice(bench, "notes");
    const folder = scratch();
    const whole = await bench.run(`export --all-versions --out ${join(folder, "whole.zip")}`);
    bench.hook = async (request) => {
      if (!isFileRequest(request)) return undefined;

      const answered = await bench.install.api.fetch(request);
      const headers = new Headers(answered.headers);
      headers.delete("Content-Length");

      return new Response(answered.body, { status: answered.status, headers });
    };

    const streamed = await bench.run(`export --all-versions --out ${join(folder, "streamed.zip")}`);
    const entries = async (zip: string): Promise<unknown> => (await readZip(join(folder, zip))).filter(([name]) => name !== "manifest.json");

    expect([streamed.code, streamed.err, streamed.out.at(-1)?.split(": ")[1]]).toEqual([0, [], whole.out.at(-1)?.split(": ")[1]]);
    expect(await entries("streamed.zip")).toEqual(await entries("whole.zip"));
  });

  test("a zip that is already there is refused before the install is asked, and --overwrite replaces it: without this an export could silently eat an older backup", async () => {
    const bench = await openBench();
    await publishedTwice(bench, "notes");
    const zip = join(scratch(), "backup.zip");
    writeFileSync(zip, "an older backup");
    bench.sent.length = 0;

    const refused = await bench.run(`export --out ${zip}`);
    const asked = [...bench.sent];
    const replaced = await bench.run(`export --out ${zip} --overwrite`);

    expect([refused.code, refused.err, asked, readdirSync(dirname(zip))]).toEqual([1, [`a file is already there: ${zip}`, "to replace it: --overwrite; to write another: --out <file>"], [], ["backup.zip"]]);
    expect([replaced.code, (await readZip(zip)).at(-1)?.[0]]).toEqual([0, "manifest.json"]);
  });

  // Drift: a folder under the target's name was called a file and --overwrite was offered for it, which then failed in the system's words; a folder that is not there was said as an error about a file the person never typed.
  test("a target that is a folder, or in a folder that is not there, is refused in the command's words before the install is asked, and --overwrite is offered for neither", async () => {
    const bench = await openBench();
    await publishedTwice(bench, "notes");
    const folder = scratch();
    bench.sent.length = 0;

    const onto = [await bench.run(`export --out ${folder}`), await bench.run(`export --out ${folder} --overwrite`)];
    const nowhere = await bench.run(`export --out ${join(folder, "none", "backup.zip")}`);

    expect(onto.map((ran) => [ran.code, ran.err])).toEqual(Array(2).fill([1, [`the backup cannot be written: "${folder}" is a folder; --out names the file to write`]]));
    expect([nowhere.code, nowhere.err]).toEqual([1, [`the backup cannot be written: the folder "${join(folder, "none")}" does not exist`]]);
    expect([bench.sent, readdirSync(folder)]).toEqual([[], []]);
  });

  test.each<[string, () => Response, RegExp, number]>([
    ["a refusal half way", () => answer(500, { error: { code: "internal", message: "no" } }), /^the install failed to do that/, 1],
    ["a file that stops arriving", () => new Response(new ReadableStream({ pull: (controller) => controller.error(new Error("reset")) }), { headers: { "Content-Length": "6", "Poplin-Content-Type": "text%2Fcss" } }), /^the backup cannot be written: /, 1],
    ["a file shorter than the install said", () => new Response("bo", { headers: { "Content-Length": "6", "Poplin-Content-Type": "text%2Fcss" } }), /^the backup cannot be written: /, 1],
    ["a streamed file shorter than the listing said", () => new Response("bo", { headers: { "Poplin-Content-Type": "text%2Fcss" } }), /^the backup cannot be written: /, 1],
  ])("an export that meets %s leaves no file, and an older backup under --overwrite keeps its bytes: without this half a backup would stand under the name of a whole one", async (_what, respond, said, code) => {
    const bench = await openBench();
    await publishedTwice(bench, "notes");
    await publishedTwice(bench, "more");
    const folder = scratch();
    const zip = join(folder, "backup.zip");
    let files = 0;
    bench.hook = (request) => {
      if (!isFileRequest(request)) return undefined;

      files += 1;

      return files === 3 ? respond() : undefined;
    };

    const fresh = await bench.run(`export --all-versions --out ${zip}`);
    const left = readdirSync(folder);
    writeFileSync(zip, "an older backup");
    files = 0;
    const over = await bench.run(`export --all-versions --out ${zip} --overwrite`);

    expect([fresh.code, fresh.out, left]).toEqual([code, [], []]);
    expect(fresh.err[0]).toMatch(said);
    expect([over.code, readdirSync(folder), readFileSync(zip, "utf8")]).toEqual([code, ["backup.zip"], "an older backup"]);
  });

  // Drift: a stop that broke a file off half way ended as "the backup cannot be written", which names a fault of the disk and says nothing of the zip.
  test.each<[string, (bench: Bench, request: Request, files: number) => Response | Promise<Response> | undefined]>([
    ["at its first call", (bench, _request, files) => (files === 0 ? heldUntilStopped(bench) : undefined)],
    ["half way through its first file", (bench, request, files) => (files === 1 ? brokenOffByStop(bench, request) : undefined)],
    ["at its last file", (bench, _request, files) => (files === 4 ? heldUntilStopped(bench) : undefined)],
  ])("an export stopped %s ends as a stopped command that wrote no backup, and leaves no file, and an older backup under --overwrite keeps its bytes", async (_when, respond) => {
    const bench = await openBench();
    await publishedTwice(bench, "notes");
    await publishedTwice(bench, "more");
    const folder = scratch();
    const zip = join(folder, "backup.zip");
    const stopped = [1, [`the command was stopped: the backup was given up and nothing was written to ${zip}`], []];
    let files = 0;
    bench.hook = (request) => {
      if (isFileRequest(request)) files += 1;

      return respond(bench, request, files);
    };

    const fresh = await bench.run(`export --out ${zip}`);
    const left = readdirSync(folder);
    writeFileSync(zip, "an older backup");
    files = 0;
    const over = await bench.run(`export --out ${zip} --overwrite`);

    expect([[fresh.code, fresh.err, fresh.out], left]).toEqual([stopped, []]);
    expect([[over.code, over.err, over.out], readdirSync(folder), readFileSync(zip, "utf8")]).toEqual([stopped, ["backup.zip"], "an older backup"]);
  });
});
