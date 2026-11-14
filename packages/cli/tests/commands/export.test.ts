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
    expect(live.out.map((line) => line.replace(/ {2,}/g, "  ").replace(/, [\d.]+ K?B$/, ", <size>")).sort()).toEqual([
      `exported  ${docs}  1 version  1 file  19 B`,
      `exported  ${notes}  1 version  2 files  27 B`,
      `wrote ${join(folder, "live.zip")}: 2 sites, 3 files, <size>`,
    ]);
    expect((await namesIn("live.zip")).filter((name) => name.startsWith("sites/notes/"))).toEqual(["sites/notes/site.json", "sites/notes/versions/2/files/css/site.css", "sites/notes/versions/2/files/index.html", "sites/notes/versions/2/files.json"]);
    expect(all).toMatchObject({ file: join(folder, "all.zip"), format: 1, all_versions: true, settings: true, files: 5, bytes: 72, zip_bytes: readFileSync(join(folder, "all.zip")).length });
    expect((all.sites as { label: string; versions: number }[]).map((site) => [site.label, site.versions]).sort()).toEqual([[docs, 1], [notes, 2]].sort());
    expect([one.out.at(-1)?.split(": ")[1]?.split(", ").slice(0, 2), await namesIn("one.zip")]).toEqual([["1 site", "1 file"], ["sites/docs/site.json", "sites/docs/versions/1/files/index.html", "sites/docs/versions/1/files.json", "manifest.json"]]);
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

  test.each<[string, () => Response, RegExp, number]>([
    ["a refusal half way", () => answer(500, { error: { code: "internal", message: "no" } }), /^the install failed to do that/, 1],
    ["a file that stops arriving", () => new Response(new ReadableStream({ pull: (controller) => controller.error(new Error("reset")) }), { headers: { "Content-Length": "6", "Poplin-Content-Type": "text%2Fcss" } }), /^the backup cannot be written: /, 1],
    ["a file shorter than the install said", () => new Response("bo", { headers: { "Content-Length": "6", "Poplin-Content-Type": "text%2Fcss" } }), /^the backup cannot be written: /, 1],
    ["a file without its length", () => new Response("body{}", { headers: { "Poplin-Content-Type": "text%2Fcss" } }), /^the install answered in a form this poplin does not know/, 5],
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
});
