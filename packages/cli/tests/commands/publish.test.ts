import { afterEach, describe, expect, test } from "bun:test";
import { writeFileSync } from "node:fs";
import { join } from "node:path";

import { type Bench, cleanUp, folderOf, jsonOf, openBench } from "./support/harness";

/** The pages of the fixture site. The test install takes files of at most 64 bytes. */
const PAGES = { "index.html": "<title>Field notes</title><h1>notes</h1>", "css/site.css": "body{}", ".env": "KEY=1" };

/** A JSON answer in the install's place. */
function answer(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

/** What the install holds that only a finished publish may change: the sites, and the keys of the store. */
async function stateOf(bench: Bench): Promise<unknown> {
  const sites = await bench.install.call("listSites", {});

  return [sites.body, await bench.install.keys()];
}

/** Publish the fixture folder as a new site; answers its label. */
async function publishedLabel(bench: Bench, folder: string): Promise<string> {
  const made = jsonOf(await bench.run(`${folder} --json`));

  return (made.site as { label: string }).label;
}

afterEach(cleanUp);

describe("publish", () => {
  test("a folder becomes a new site, and --site makes the next version of it: without this the two commands could send the same request", async () => {
    const bench = await openBench();
    const folder = folderOf("notes", PAGES);

    const made = await bench.run(folder);
    const label = made.out[1]?.split("  ")[1] ?? "";

    expect(made).toMatchObject({
      code: 0,
      out: ["uploaded 2 files, 46 B (1 skipped as hidden or node_modules)", `made  ${label}  private`, `https://${label}-p-poplin.example.com`],
      err: [],
      status: [],
    });
    expect(label).toMatch(/^notes--[0-9a-z]{12}$/);

    writeFileSync(join(folder, "index.html"), "<title>Second</title>");
    const updated = jsonOf(await bench.run(`${folder} --site ${label} --unlisted --json`));

    expect(updated.site).toMatchObject({ label, created: false, live_version: 2, access: "unlisted", title: "Second", title_typed: false, files: 4 });
    expect(updated.before).toMatchObject({ live_version: 1, access: "private", title: "Field notes" });

    const human = await bench.run(`${folder} --site ${label}`);

    expect(human.out).toEqual(["uploaded 2 files, 27 B (1 skipped as hidden or node_modules)", `updated  ${label}  version 3  unlisted`, `https://${label}-u-poplin.example.com`]);
  });

  test("an update leaves a typed title alone, takes a new one only from --title, and --title \"\" goes back to the page's own: without this every update undoes set --title", async () => {
    const bench = await openBench();
    const folder = folderOf("notes", PAGES);
    const label = await publishedLabel(bench, folder);
    const titles: unknown[] = [];

    for (const command of [`set ${label} --title "Q3 sales"`, `${folder} --site ${label}`, `${folder} --site ${label} --title "Q4 sales"`, `${folder} --site ${label} --title ""`, `${folder} --site ${label}`]) {
      const { site } = jsonOf(await bench.run(`${command} --json`)) as { site: { title: string; title_typed: boolean } };
      titles.push([site.title, site.title_typed]);
    }

    expect(titles).toEqual([
      ["Q3 sales", true],
      ["Q3 sales", true],
      ["Q4 sales", true],
      ["Field notes", false],
      ["Field notes", false],
    ]);
  });

  test("the settings and the name typed go into the publish, and a typed title wins over the page's own: without this a flag is read and then dropped", async () => {
    const bench = await openBench();
    const page = join(folderOf("pages", { "report.html": "<title>The page</title>" }), "report.html");

    const { site } = jsonOf(await bench.run(`${page} --name sales --public --title "Q3 sales" --search-engines on --embeddable off --expires never --json`));

    expect(site).toMatchObject({ name: "sales", public_name: "sales", access: "public", title: "Q3 sales", search_engines: true, embeddable: false, expires: "never", created: true });
    expect((site as { url: string }).url).toBe("https://sales-page.example.com");
  });

  test("--dry-run says what would be sent and calls no install, so it runs with no login and changes nothing", async () => {
    const bench = await openBench();
    const folder = folderOf("notes", PAGES);
    const before = await stateOf(bench);

    const human = await bench.run(`${folder} --dry-run --unlisted`, { env: {} });
    const json = jsonOf(await bench.run(`${folder} --dry-run --site k3f9x2ab71qz --json`, { env: {} }));

    expect(human).toMatchObject({
      code: 0,
      out: [
        "would make a new site named notes",
        "would upload 2 files, 46 B (1 skipped as hidden or node_modules)",
        "  css/site.css  6 B   text/css",
        "  index.html    40 B  text/html",
        "nothing was sent: --dry-run calls no install",
      ],
    });
    expect(json).toEqual({
      dry_run: true,
      site: "k3f9x2ab71qz",
      page_title: "Field notes",
      count: 2,
      bytes: 46,
      skipped: 1,
      files: [
        { path: "css/site.css", size: 6, content_type: "text/css" },
        { path: "index.html", size: 40, content_type: "text/html" },
      ],
    });
    expect(bench.sent).toEqual([]);
    expect(await stateOf(bench)).toEqual(before);
  });

  test("a file whose upload fails is sent again, up to three times, and the publish goes through: without this one dropped connection loses a whole publish", async () => {
    const bench = await openBench();
    const folder = folderOf("notes", PAGES);
    let failures = 2;

    bench.hook = (request) => {
      if (request.method !== "PUT" || !request.url.includes("index.html") || failures === 0) return undefined;

      failures -= 1;
      if (failures === 1) throw new Error("the connection broke");

      return answer(500, { error: { code: "internal", message: "the install failed to do that" } });
    };

    const made = await bench.run(folder);

    expect(made.code).toBe(0);
    expect(bench.sent.filter((line) => line.includes("index.html")).length).toBe(3);
    expect((await bench.install.keys()).length).toBe(2);
  });

  test("a publish the install says lacks a file sends that file again and finishes: without this a file lost after its upload fails every later finish", async () => {
    const bench = await openBench();
    const folder = folderOf("notes", PAGES);
    let dropped = false;

    bench.hook = async (request) => {
      if (dropped || request.method !== "POST" || !request.url.endsWith("/finish")) return undefined;

      dropped = true;
      const key = (await bench.install.keys()).find((stored) => stored.endsWith("site.css")) ?? "";
      await bench.install.store.delete(key as never);

      return undefined;
    };

    const made = await bench.run(folder);

    expect(made.code).toBe(0);
    expect(bench.sent.map((line) => line.split(" ")[0]).join(" ")).toBe("POST PUT PUT POST GET PUT POST");
    expect((await bench.install.keys()).length).toBe(2);
  });

  test.each([
    ["a file that is never stored", (request: Request) => (request.method === "PUT" ? answer(500, { error: { code: "internal", message: "no" } }) : undefined), "the install failed to do that", 1],
    ["a file the install refuses", (request: Request) => (request.method === "PUT" ? answer(400, { error: { code: "size_mismatch", message: "no", about: "index.html" } }) : undefined), "a file changed while it was sent: index.html", 1],
    ["a finish that is never answered", (request: Request) => (request.url.endsWith("/finish") ? new Response("<html>bad gateway</html>", { status: 502 }) : undefined), "the answer is not the install's: status 502", 5],
  ])("%s gives the upload up, changes no site, and says so: without this a failed publish leaves files and a pending upload behind", async (_name, hook, sentence, code) => {
    const bench = await openBench();
    const folder = folderOf("notes", PAGES);
    const label = await publishedLabel(bench, folder);
    const before = await stateOf(bench);
    bench.sent.length = 0;
    bench.hook = hook;

    const failed = await bench.run(`${folder} --site ${label} --public --json`);

    expect(failed.code).toBe(code);
    expect(failed.err[0]).toBe(sentence);
    expect(failed.err[1]).toStartWith("the upload was given up and no site changed");
    expect(jsonOf(failed)).toMatchObject({ error: { message: sentence.split(":")[0] } });
    expect(bench.sent.at(-1)).toStartWith("DELETE /api/uploads/");
    expect(await stateOf(bench)).toEqual(before);
  });

  test("a publish whose finish went through with its answer lost is reported as done: without this a live site is reported as a failure", async () => {
    const bench = await openBench();
    const folder = folderOf("notes", PAGES);
    let lost = false;

    bench.hook = async (request) => {
      if (lost || !request.url.endsWith("/finish")) return undefined;

      lost = true;
      await bench.install.api.fetch(request);

      throw new Error("the connection broke");
    };

    const made = await bench.run(folder);

    expect(made.code).toBe(0);
    expect(made.out[1]).toMatch(/^made {2}notes--[0-9a-z]{12} {2}private$/);
  });

  test.each([
    ["a path that is not there", "./nowhere-at-all", /^nothing can be published: ".*nowhere-at-all" does not exist$/],
    ["a folder with no index.html", "", /^nothing can be published: the folder .* has no index\.html at its top$/],
  ])("%s is refused before any install is called", async (_name, path, sentence) => {
    const bench = await openBench();
    const target = path === "" ? folderOf("empty", { "page.html": "x" }) : path;

    const refused = await bench.run(target);

    expect(refused.code).toBe(1);
    expect(refused.err[0]).toMatch(sentence);
    expect(bench.sent).toEqual([]);
  });

  test("a publish whose first answer is lost says an upload may have begun, since there is no id to give it up by", async () => {
    const bench = await openBench();
    const folder = folderOf("notes", PAGES);
    const before = await stateOf(bench);
    bench.hook = async (request) => {
      await bench.install.api.fetch(request);

      return new Response("<html>bad gateway</html>", { status: 502 });
    };

    const lost = await bench.run(folder);

    expect(lost.code).toBe(5);
    expect(lost.err[0]).toBe("the answer is not the install's: status 502");
    expect(lost.err[1]).toStartWith("no site changed; an upload the install began all the same runs out by itself within a day");
    expect(bench.sent).toEqual(["POST /api/uploads"]);
    expect(await stateOf(bench)).toEqual(before);
  });

  test("the progress line counts each file once up to the total and is cleared at the end, and where no progress is shown nothing is written", async () => {
    const bench = await openBench();
    const folder = folderOf("notes", PAGES);

    const piped = await bench.run(folder);
    const watched = await bench.run(folder, { terminal: { asks: true, progress: true } });

    expect(piped.status).toEqual([]);
    expect(watched.status.at(-2)).toBe("uploading 2/2 files, 46 B of 46 B");
    expect(watched.status.at(-1)).toBe("");
    expect(watched.out.length).toBe(3);
  });
});
