import { afterEach, describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { writeFileSync } from "node:fs";
import { join } from "node:path";

import { type Bench, cleanUp, folderOf, jsonOf, openBench, stateOf } from "./support/harness";

/** The pages of the fixture site. The test install takes files of at most 64 bytes. */
const PAGES = { "index.html": "<title>Field notes</title><h1>notes</h1>", "css/site.css": "body{}", ".env": "KEY=1" };

/** The SHA-256 of a text's bytes in base64, by the runtime's own hash. */
function hashOf(text: string): string {
  return createHash("sha256").update(text).digest("base64");
}

/** A JSON answer in the install's place. */
function answer(status: number, body: unknown, headers: Readonly<Record<string, string>> = {}): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json", ...headers } });
}

/** The page a zone's rate rule answers with in the install's place: no JSON, and whatever headers the rule sends. */
function tooMany(headers: Readonly<Record<string, string>>): Response {
  return new Response("<html><title>Too many requests</title></html>", { status: 429, headers: { "Content-Type": "text/html", ...headers } });
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
        { path: "css/site.css", size: 6, content_type: "text/css", sha256: hashOf(PAGES["css/site.css"]) },
        { path: "index.html", size: 40, content_type: "text/html", sha256: hashOf(PAGES["index.html"]) },
      ],
    });
    expect(bench.sent).toEqual([]);
    expect(await stateOf(bench)).toEqual(before);
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

  // Drift: a 5xx on a file is sent again up to three times, which is right for a fault and a flood for an install whose database is spent until midnight UTC.
  test("a file refused because the day's allowance is used up is sent once, and the person is told when the allowance is back", async () => {
    const bench = await openBench();
    const folder = folderOf("notes", { "index.html": "<title>Field notes</title>" });
    const refused = { error: { code: "allowance_spent", message: "no", about: "writing" } };
    bench.hook = (request) => (request.method === "PUT" ? answer(503, refused, { "Retry-After": "3600" }) : undefined);

    const failed = await bench.run(folder);

    expect(bench.sent.filter((line) => line.startsWith("PUT ")).length).toBe(1);
    expect([failed.code, failed.err[0]]).toEqual([1, "a day's allowance of the install is used up until 00:00 UTC: writing"]);
    expect(failed.err[1]).toEndWith("wait until then: asking again sooner is refused the same way");
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
    // A pipe is sent one line for each pause before a file is sent again; what the publish came to follows them.
    const said = failed.err.slice(failed.waits.length);

    expect(said[0]).toBe(sentence);
    expect(said[1]).toStartWith("the upload was given up and no site changed");
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

  // Drift: the 429 here is the zone's and no code of this repository's: its page is no JSON, its rule counts every request to the zone, and nothing but these rows says what the upload makes of it.
  test.each<[string, (request: Request) => Response | undefined, number[], number]>([
    ["a zone's page that names a wait, three times", (request) => (request.method === "PUT" ? tooMany({ "Retry-After": "7" }) : undefined), [7000, 7000, 7000], 3],
    ["a zone's page that names none, three times", (request) => (request.method === "PUT" ? tooMany({}) : undefined), [2000, 4000, 8000], 3],
    ["the install's own refusal that names an hour", (request) => (request.method === "PUT" ? answer(429, { error: { code: "too_many_requests", message: "no" } }, { "Retry-After": "3600" }) : undefined), [60_000], 1],
    ["a finish the zone refuses", (request) => (request.url.endsWith("/finish") ? tooMany({ "Retry-After": "3" }) : undefined), [3000], 1],
  ])("an upload answered 429 by %s rests that long and goes through: without this a large publish on a zone that counts its requests is given up", async (_name, refuse, waits, times) => {
    const bench = await openBench();
    const folder = folderOf("notes", { "index.html": "<h1>notes</h1>" });
    let left = times;

    bench.hook = (request) => {
      const refused = left === 0 ? undefined : refuse(request);
      if (refused !== undefined) left -= 1;

      return refused;
    };

    const made = await bench.run(folder, { terminal: { asks: false, progress: true } });

    expect([made.code, made.err, made.waits]).toEqual([0, [], waits]);
    expect(made.status.filter((line) => line.startsWith("the install asks for a pause"))).toEqual(waits.map((ms) => `the install asks for a pause: going on in ${ms / 1000} s (Ctrl-C stops)`));
    expect((await bench.install.keys()).length).toBe(1);
  });

  // Drift: four files are on their way at once; a rest of each lane's own would tell one refusal four times, and send three more requests into a full count.
  test("four uploads refused at once share one rest", async () => {
    const bench = await openBench();
    const folder = folderOf("notes", { "index.html": "<h1>notes</h1>", "a.css": "a{}", "b.css": "b{}", "c.css": "c{}" });
    let left = 4;

    bench.hook = (request) => {
      if (request.method !== "PUT" || left === 0) return undefined;

      left -= 1;

      return tooMany({ "Retry-After": "5" });
    };
    // The rest ends only once every lane has had its answer.
    bench.paused = () => new Promise((resolve) => setTimeout(() => resolve(undefined), 20));

    const made = await bench.run(folder);

    expect([made.code, made.waits, bench.sent.filter((line) => line.startsWith("PUT")).length]).toEqual([0, [5000], 8]);
  });

  // Drift: the lanes rest together but ask apart; a stop that ended one lane's rest alone would leave the others to rest and send for two minutes more after Ctrl-C.
  test("a rest the person stops ends every lane: no rest begins and no file is sent after it", async () => {
    const bench = await openBench();
    const folder = folderOf("notes", { "index.html": "<h1>notes</h1>", "a.css": "a{}", "b.css": "b{}", "c.css": "c{}", "d.css": "d{}" });
    const before = await stateOf(bench);
    let first = true;

    bench.hook = async (request) => {
      if (request.method !== "PUT") return undefined;

      // The first lane is refused at once; the others are still on their way when its rest is stopped.
      if (!first) await new Promise((resolve) => setTimeout(resolve, 20));
      first = false;

      return tooMany({});
    };
    bench.paused = async (ran) => (ran.waits.length === 1 ? "interrupted" : "over");

    const failed = await bench.run(folder);

    expect([failed.code, failed.waits, bench.sent.filter((line) => line.startsWith("PUT")).length]).toEqual([1, [2000], 4]);
    expect(await stateOf(bench)).toEqual(before);
  });

  // Drift: a file that arrives while another lane rests rewrites the one progress line; the line that says why nothing moves would be gone for the rest of the wait.
  test("a file that arrives during a rest is counted after it, so the line of the rest stays until the rest is over", async () => {
    const bench = await openBench();
    const folder = folderOf("notes", { "index.html": "<h1>notes</h1>", "a.css": "a{}" });
    let first = true;

    bench.hook = async (request) => {
      if (request.method !== "PUT") return undefined;

      if (first) {
        first = false;

        return tooMany({ "Retry-After": "4" });
      }

      return undefined;
    };
    const shown: string[][] = [];
    // The rest ends only once the other lane's file has arrived; what the line showed until then is kept.
    bench.paused = (ran) =>
      new Promise((resolve) => {
        setTimeout(() => {
          shown.push([...ran.status]);
          resolve(undefined);
        }, 20);
      });

    const made = await bench.run(folder, { terminal: { asks: false, progress: true } });

    expect([made.code, shown, made.status[1]]).toEqual([0, [["the install asks for a pause: going on in 4 s (Ctrl-C stops)"]], "uploading 1/2 files, 14 B of 17 B"]);
  });

  // Drift: a zone that never lets up, or a person who stops the command, must end the upload; a rest with no bound would hang a script for good.
  test.each<[string, "over" | "interrupted", number[], number, number, string]>([
    ["never lets up", "over", [2000, 4000, 8000, 16_000, 32_000, 60_000], 7, 5, "the answer is not the install's: status 429"],
    ["is stopped by the person during the first rest", "interrupted", [2000], 1, 1, "the command was stopped: the upload was given up and no site changed"],
  ])("an upload whose zone %s is given up after its rests and says why", async (_name, paused, waits, puts, code, line) => {
    const bench = await openBench();
    const folder = folderOf("notes", { "index.html": "<h1>notes</h1>" });
    const before = await stateOf(bench);
    bench.hook = (request) => (request.method === "PUT" ? tooMany({}) : undefined);
    bench.paused = async () => paused;

    const failed = await bench.run(folder);

    expect([failed.code, failed.err.slice(0, waits.length), failed.err[waits.length], failed.waits]).toEqual([code, waits.map((wait) => `the install asks for a pause: going on in ${wait / 1000} s`), line, waits]);
    expect(bench.sent.filter((line) => line.startsWith("PUT")).length).toBe(puts);
    expect(bench.sent.at(-1)).toStartWith("DELETE /api/uploads/");
    expect(await stateOf(bench)).toEqual(before);
  });
});
