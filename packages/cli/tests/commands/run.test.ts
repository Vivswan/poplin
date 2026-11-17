import { afterEach, describe, expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { stripVTControlCharacters } from "node:util";

import type { Code } from "../../../app/src/api/respond";
import type { Login as Email } from "../../../core/src/auth/logins";
import { OWN_SCHEMA } from "../../../core/src/database/open";
import { answered, INSTALL_VERSION, NOW, ORIGIN } from "../../../app/tests/api/support/install";
import { refusalSentence } from "../../../app/src/console/notices";
import { saveLogin } from "../../src/local/login-file";
import type { Login } from "../../src/local/login";
import { VERSION } from "../../src/poplin";
import { type Bench, cleanUp, folderOf, jsonOf, openBench, type Ran } from "./support/harness";

/** Every code the API refuses with. A code the API gains does not compile until it is listed here, and so is run through the table. */
const CODES: Readonly<Record<Code, true>> = {
  not_logged_in: true,
  not_allowed: true,
  not_found: true,
  no_such_version: true,
  method_not_allowed: true,
  unsupported_media_type: true,
  bad_argument: true,
  bad_name: true,
  reserved_name: true,
  bad_path: true,
  no_index: true,
  size_mismatch: true,
  hash_mismatch: true,
  name_taken: true,
  id_taken: true,
  backup_too_new: true,
  in_trash: true,
  not_in_trash: true,
  stale_version: true,
  missing_files: true,
  upload_finished: true,
  too_many_sites: true,
  not_set_up: true,
  no_working_login: true,
  needs_update_check: true,
  already_a_login: true,
  not_a_login: true,
  no_update: true,
  update_unreachable: true,
  no_key: true,
  key_refused: true,
  lacks_right: true,
  release_refused: true,
  version_refused: true,
  logins_not_ended: true,
  too_large: true,
  too_many_requests: true,
  internal: true,
  allowance_spent: true,
};

/** Every reason an install refuses a release for, and whether asking again can end otherwise: a release that is not published, changes the database, or needs a new part is refused the same way each time. */
const RELEASE_REASONS = [
  ["no_digest", "stays"],
  ["unreachable", "passes"],
  ["digest_differs", "passes"],
  ["other_version", "stays"],
  ["database", "stays"],
  ["needs_hand", "stays"],
  ["host", "passes"],
] as const;

/** The hint of a refused release whose reason the table does not hold. */
const NO_REASON_HINT = "poplin update --dry-run says which version the install runs";

/** An id in the form of a site id that no site has. */
const NO_SITE = "zzzzzzzzzzzz";

/** The layout of an install whose public addresses end in `page`. */
const PAGE = { kind: "hostname", public_word: "page" } as const;

/** The layout of an install whose public addresses end in `site`. */
const SITE = { kind: "hostname", public_word: "site" } as const;

/** The layout of an install that keeps its sites at paths on two hosts. */
const PATHS = { kind: "path", sites_host: "sites.example.net", private_host: "private.example.net" } as const;

function answer(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

/** A bench with one published site; answers the site's label too. */
async function withSite(): Promise<{ readonly bench: Bench; readonly label: string }> {
  const bench = await openBench();
  const made = jsonOf(await bench.run(`${folderOf("report", { "index.html": "<title>Report</title>" })} --json`));
  bench.sent.length = 0;

  return { bench, label: (made.site as { label: string }).label };
}

/** The sites and the trash as the install holds them. */
async function stateOf(bench: Bench): Promise<unknown> {
  return [(await answered(bench.install.routes.sites.$get())).body, (await answered(bench.install.routes.sites.$get({ query: { trash: "true" } }))).body, await bench.install.keys()];
}

function summary(ran: Ran): { code: number; out: string[]; err: string[] } {
  return { code: ran.code, out: ran.out, err: ran.err };
}

afterEach(cleanUp);

describe("run", () => {
  // Drift: the help was the one text of the CLI that stayed plain on a terminal, and one painted for a terminal must not reach a pipe.
  test("the help is painted and as wide as the stream it goes to shows it, and plain at 80 where that stream is no terminal", async () => {
    const bench = await openBench();
    const wide = { width: 60, colour: true };
    const plain = { width: 80, colour: false };
    const painted = (ran: Ran, stream: "out" | "err"): boolean => ran[stream].join("\n").includes("\x1b[1mUsage:\x1b[22m");
    const widest = (ran: Ran, stream: "out" | "err"): number => Math.max(...stripVTControlCharacters(ran[stream].join("\n")).split("\n").map((line) => line.length));

    const asked = await bench.run("help config", { looks: { out: wide, err: plain } });
    const piped = await bench.run("help config", { looks: { out: plain, err: wide } });
    const unasked = await bench.run("", { looks: { out: plain, err: { width: 200, colour: true } } });
    const nowhere = await bench.run("help config");

    expect([painted(asked, "out"), widest(asked, "out") <= 60, painted(piped, "out"), widest(piped, "out") > 60 && widest(piped, "out") <= 80, nowhere.out]).toEqual([true, true, false, true, piped.out]);
    expect([unasked.code, unasked.out, painted(unasked, "err")]).toEqual([2, [], true]);
  });
  test("each command about one site prints what was done and the address the install answered, and --json prints the install's answer whole", async () => {
    const { bench, label } = await withSite();
    const url = `https://${label}-p-poplin.example.com`;
    const open = `https://${label}-u-poplin.example.com`;

    expect((await bench.run(`set ${label} --unlisted --search-engines on`)).out).toEqual([`changed   ${label}  access and search engines`, `moved     from ${url}`, "unlisted  anyone with the link can open it", "", open]);
    expect((await bench.run(`set ${label} --public --public-name docs`)).out).toEqual([`changed   ${label}  access and public name`, 'public    anyone can open it, as "docs"', "", "https://docs-page.example.com"]);
    expect((await bench.run("set docs --private")).out).toEqual([`changed   ${label}  access and public name`, `moved     from ${open}`, "private   only your users can open it", "", url]);
    expect((await bench.run(`set ${label} --private --embeddable off`)).out[0]).toBe(`changed   ${label}  embeddable`);
    expect((await bench.run(`set ${label} --private`)).out[0]).toBe(`changed   ${label}  nothing: it was so already`);
    expect((await bench.run(`delete ${label}`)).out).toEqual([`in the trash  ${label}  gone for good on 2023-11-21`, `to take it back: poplin restore ${label}`]);
    expect((await bench.run("list --trash")).out).toEqual([`${label}  gone for good on 2023-11-21  Report`]);
    expect((await bench.run(`restore ${label}`)).out).toEqual([`restored  ${label}`, "private   only your users can open it", "", url]);
    expect((await bench.run("list")).out).toEqual([`${label}  private  Report`, `  ${url}`]);

    const shown = await bench.run(`show ${label}`);
    const json = jsonOf(await bench.run(`show ${label} --json`));

    expect(shown.out.slice(0, 5)).toEqual([label, url, "", `id              ${label.slice(-12)}`, "name            report"]);
    expect(shown.out.at(-1)).toMatch(/^version 1 {2}2023-11-14 {2}by [0-9a-f]{16} {2}live$/);
    expect(shown.out.filter((line) => line.startsWith("visits"))).toEqual(["visits          about 10 or fewer times today, about 10 or fewer in the last 7 days"]);
    expect(json).toEqual((await answered(bench.install.routes.sites[":site"].$get({ param: { site: label } }))).body);
  });

  // Drift: only the install knows how its addresses are laid out. A command that guessed would delete the site at `notes-page` when given `notes-site.example.com`, or take the first path segment of any host for a site of this install.
  test.each([
    [PAGE, "https://LABEL-p-poplin.example.com/", ["GET /api/sites/LABEL"]],
    [PAGE, "https://LABEL-u-poplin.example.com/", ["GET /api/sites/LABEL"]],
    [PAGE, "https://notes-page.example.com/", ["GET /api/whoami", "GET /api/sites/notes"]],
    [SITE, "https://notes-site.example.com/guide", ["GET /api/whoami", "GET /api/sites/notes"]],
    [SITE, "ID", ["GET /api/sites/ID"]],
    [SITE, "LABEL", ["GET /api/sites/LABEL"]],
    [SITE, "notes", ["GET /api/sites/notes"]],
    [PATHS, "https://private.example.net/LABEL/", ["GET /api/whoami", "GET /api/sites/LABEL"]],
    [PATHS, "sites.example.net/ID/pages/1.html?x=1#top", ["GET /api/whoami", "GET /api/sites/ID"]],
    [PATHS, "https://sites.example.net/notes/guide", ["GET /api/whoami", "GET /api/sites/notes"]],
    [PATHS, "LABEL", ["GET /api/sites/LABEL"]],
    [PAGE, "https://notes-site.example.com/", "https://poplin.example.com"],
    [SITE, "https://notes-page.example.com/", "https://poplin.example.com"],
    [PAGE, "https://notes-page.example.org/", "example.org"],
    [PAGE, "https://sites.example.net/LABEL/", "sites.example.net is not the address of a site of https://poplin.example.com"],
    [PAGE, "https://notes-page.example.org/guide", "notes-page.example.org is not the address of a site of https://poplin.example.com"],
    [PATHS, "https://private.example.net/notes/", "private.example.net/notes is not the address of a site of https://poplin.example.com"],
    [PATHS, "https://sites.example.org/LABEL/", "sites.example.org/LABEL is not the address of a site of https://poplin.example.com"],
    [PATHS, "https://sites.example.net:8443/LABEL/", "sites.example.net:8443/LABEL is not the address of a site of https://poplin.example.com"],
    [PATHS, "https://notes-page.example.com/", "notes-page.example.com is not the address of a site of https://poplin.example.com"],
  ] as const)("on an install laid out as %j, %s names the one site, or none: %j", async (layout, form, outcome) => {
    const bench = await openBench(layout);
    const label = (jsonOf(await bench.run(`${folderOf("report", { "index.html": "<title>Report</title>" })} --public --public-name notes --json`)).site as { label: string }).label;
    const typed = form.replace("LABEL", label).replace("ID", label.slice(-12));
    const before = await stateOf(bench);
    bench.sent.length = 0;

    const shown = await bench.run(`show ${typed}`);
    const asked = [...bench.sent];
    const deleted = await bench.run(`delete ${typed} --json`);

    if (typeof outcome === "string") {
      const said = shown.err[0] ?? "";

      expect([shown.code, shown.out, said.startsWith("no site with that id or public name: "), said.includes(outcome.replace("LABEL", label)), shown.err[1]]).toEqual([1, [], true, true, "poplin list shows every site"]);
      expect(jsonOf(deleted).error).toEqual(expect.objectContaining({ code: "not_found" }));
      expect([asked, await stateOf(bench)]).toEqual([outcome === "example.org" ? [] : ["GET /api/whoami"], before]);

      return;
    }

    expect([shown.code, shown.out[0], asked]).toEqual([0, label, outcome.map((request) => request.replace("LABEL", label).replace("ID", label.slice(-12)))]);
    expect((jsonOf(deleted).site as { label: string }).label).toBe(label);
  });

  // Drift: a dry run is read as calling no install; one that asks how an address reads must say so, and still change nothing.
  test("a dry run that names a public site by its address asks the install how the address reads and nothing else, and says so", async () => {
    const bench = await openBench();
    const folder = folderOf("report", { "index.html": "<title>Report</title>" });
    await bench.run(`${folder} --public --public-name notes`);
    const before = await stateOf(bench);
    bench.sent.length = 0;

    const dry = await bench.run(`${folder} --site notes-page.example.com --dry-run`);
    const none = await bench.run(`${folder} --site notes-site.example.com --dry-run`);
    const noZip = await bench.run(`import ${join(folder, "none.zip")} --site notes-page.example.com --dry-run`);

    expect([dry.code, dry.out[0], dry.out.at(-1)]).toEqual([0, "would update notes", "nothing was sent: --dry-run asked the install only how it reads the site's address"]);
    expect([noZip.code, noZip.err[1]]).toEqual([1, "nothing of the backup was sent: the install was asked only how it reads the site's address"]);
    expect([none.code, none.out, bench.sent, await stateOf(bench)]).toEqual([1, [], ["GET /api/whoami", "GET /api/whoami", "GET /api/whoami"], before]);
  });

  // Drift: an install that cannot start says why in plain text on every path. Printed as `not_json` with the hint about the address, the sentence is lost and the person checks an address that is right.
  test("an install that cannot start is quoted: its sentence is printed with the status, and no hint puts the address in doubt", async () => {
    const bench = await openBench();
    const sentence = "This install's database was made by another build of poplin, so its records are not the ones this build reads. Roll the Worker back to that build, or run `npx poplin uninstall` and install anew.";
    bench.hook = () => new Response(`${sentence}\n`, { status: 503, headers: { "Content-Type": "text/plain; charset=utf-8" } });

    const listed = await bench.run("list");
    const json = await bench.run("doctor --json");
    bench.hook = () => new Response("<html>502</html>", { status: 502, headers: { "Content-Type": "text/html" } });
    const page = await bench.run("list");

    expect([listed.code, listed.out, listed.err]).toEqual([5, [], [`the answer is plain text, status 503: ${sentence}`]]);
    expect(jsonOf(json).error).toEqual({ code: "not_json", message: "the answer is plain text, status 503", about: sentence });
    expect(page.err).toEqual([`the answer is not the install's: status 502 from ${ORIGIN}`, "is that the address of your poplin install?"]);
  });

  // Drift: a person holds the address, not the label. Each form must ask the install for the same site by its label, and an address of another install must reach no install at all.
  test("a site named by its address is asked for by its label, and an address under another domain or port is refused before anything is sent", async () => {
    const { bench, label } = await withSite();
    await bench.run(`set ${label} --public --public-name docs`);
    const shown = (await bench.run(`show ${label}`)).out;
    const byPublicName = (await bench.run("show docs")).out;
    bench.sent.length = 0;

    const typed = [`https://${label}-p-poplin.example.com/pages/1.html?x=1#top`, `${label}-u-poplin.example.com/`, `"<https://${label}-u-poplin.EXAMPLE.com./>"`, `${label}-p-poplin`];
    for (const address of typed) expect((await bench.run(`show ${address}`)).out).toEqual(shown);

    expect((await bench.run("show https://docs-page.example.com/guide")).out).toEqual(byPublicName);
    expect(bench.sent).toEqual([...typed.map(() => `GET /api/sites/${label}`), "GET /api/whoami", "GET /api/sites/docs"]);

    bench.sent.length = 0;
    const foreign = [`https://${label}-p-poplin.example.org/`, `https://${label}-p-poplin.evil.example/`, `https://${label}-p-poplin.example.com:8443/`, "https://docs-page.example.com.evil.example/"];
    const refused = await Promise.all(foreign.map(async (address) => summary(await bench.run(`delete ${address}`))));

    expect(refused).toEqual(
      ["example.org", "evil.example", "example.com:8443", "example.com.evil.example"].map((under) => ({
        code: 1,
        out: [],
        err: [`no site with that id or public name: the address is under ${under}, which is not where https://poplin.example.com keeps its sites`, "poplin list shows every site"],
      })),
    );
    expect(bench.sent).toEqual([]);
  });

  test("set --name prints the new label and the name it had, and the label typed before the rename still names the site: an agent holds the old label", async () => {
    const { bench, label } = await withSite();
    const renamed = `notes--${label.slice(-12)}`;

    const moved = `moved     from https://${label}-p-poplin.example.com`;

    expect((await bench.run(`set ${label} --name notes`)).out).toEqual([`changed   ${renamed}  name`, "renamed   from report", moved, "private   only your users can open it", "", `https://${renamed}-p-poplin.example.com`]);
    expect((await bench.run(`set ${label} --unlisted`)).out[0]).toBe(`changed   ${renamed}  access`);
    expect((await bench.run(`${folderOf("report", { "index.html": "<title>Second</title>" })} --site ${label} --name q3-report`)).out[1]).toBe(`updated   q3-report--${label.slice(-12)}  version 2`);
  });

  test("rollback and new-link print the version now live and the new label: the old label is dead, so the new one must be on stdout", async () => {
    const { bench, label } = await withSite();
    const folder = folderOf("report", { "index.html": "<title>Second</title>" });
    await bench.run(`${folder} --site ${label}`);

    expect((await bench.run(`rollback ${label}`)).out).toEqual([`rolled back  ${label}  version 1 is live`, "private      only your users can open it", "", `https://${label}-p-poplin.example.com`]);
    expect((await bench.run(`rollback ${label} --to 2`)).out[0]).toBe(`rolled back  ${label}  version 2 is live`);

    const linked = await bench.run(`new-link ${label}`);
    const fresh = linked.out[0]?.split(/ {2,}/)[1] ?? "";

    expect(fresh).toMatch(/^report--[0-9a-z]{12}$/);
    expect(fresh).not.toBe(label);
    expect(linked.out).toEqual([`new link  ${fresh}`, `stopped   ${label}  https://${label}-p-poplin.example.com`, "private   only your users can open it", "", `https://${fresh}-p-poplin.example.com`]);
    expect((await bench.run(`show ${label}`)).code).toBe(1);
  });

  test("duplicate calls until the copy is whole and prints the copy's own label and private address: a copy of 130 files takes two calls, of 112 files at most, and a loop that stopped early would print no site", async () => {
    const bench = await openBench();
    const pages = Object.fromEntries(Array.from({ length: 129 }, (_page, at) => [`pages/${at}.html`, `<p>${at}</p>`]));
    const made = jsonOf(await bench.run(`${folderOf("report", { "index.html": "<title>Report</title>", ...pages })} --unlisted --json`));
    const { label } = made.site as { label: string };
    bench.sent.length = 0;

    const copied = await bench.run(`duplicate ${label} --name report-draft`);
    const fresh = copied.out[0]?.split(/ {2,}/)[1] ?? "";

    expect(fresh).toMatch(/^report-draft--[0-9a-z]{12}$/);
    expect(summary(copied)).toEqual({ code: 0, out: [`copied    ${fresh}  130 files`, "private   only your users can open it", "", `https://${fresh}-p-poplin.example.com`], err: [] });
    expect(bench.sent).toEqual(Array.from({ length: 2 }, () => `POST /api/sites/${label}/duplicate`));
    expect((await bench.run("list")).out).toHaveLength(4);
    expect(summary(await bench.run("duplicate zzzzzzzzzzzz"))).toMatchObject({ code: 1, out: [] });
  });

  // Drift: a copy that is not finished is a pending upload; left behind by a command that failed, it holds a place under max_sites, max_total_size, and the pending uploads for a day.
  test.each<[string, () => Response, number]>([
    ["the install fails", () => answer(500, { error: { code: "internal", message: "no" } }), 1],
    [
      "nothing answers",
      () => {
        throw new Error("the connection broke");
      },
      5,
    ],
  ])("a duplicate whose second call ends because %s gives the copy up and says so, as a publish that fails does", async (_name, fail, code) => {
    const bench = await openBench();
    const pages = Object.fromEntries(Array.from({ length: 129 }, (_page, at) => [`pages/${at}.html`, `<p>${at}</p>`]));
    const made = jsonOf(await bench.run(`${folderOf("report", { "index.html": "<title>Report</title>", ...pages })} --json`));
    const { label } = made.site as { label: string };
    const before = await stateOf(bench);
    bench.sent.length = 0;
    bench.hook = (request) => (bench.sent.length > 1 && request.url.endsWith("/duplicate") ? fail() : undefined);

    const failed = await bench.run(`duplicate ${label}`);
    const uploads = await bench.install.database.listUploads({ before: Number.MAX_SAFE_INTEGER, limit: 10 });

    expect([failed.code, failed.out, failed.err[1]?.split(";")[0]]).toEqual([code, [], "the copy was given up and no site was made"]);
    expect(bench.sent.map((sent) => sent.replace(/[0-9a-z]{16}$/, ":upload"))).toEqual([`POST /api/sites/${label}/duplicate`, `POST /api/sites/${label}/duplicate`, "DELETE /api/uploads/:upload"]);
    expect(uploads.uploads.filter((upload) => upload.plan.kind === "duplicate").map((upload) => upload.state)).toEqual(["abandoned"]);
    expect(await stateOf(bench)).toEqual(before);
  });

  // Drift: an install that copies by itself answers no count of files; read as a copy that did not move on, it would be given up while its job runs, and asked after with no wait it would send a call as fast as the last is answered.
  test.each<[string, "interrupted" | undefined, number, number[]]>([
    ["waits between two calls and prints the copy once a call answers the site", undefined, 0, [2000]],
    ["is given up when the person stops the command during the wait", "interrupted", 1, [2000]],
  ])("a duplicate the install makes by itself %s", async (_name, stop, code, waits) => {
    const bench = await openBench();
    const pages = Object.fromEntries(Array.from({ length: 129 }, (_page, at) => [`pages/${at}.html`, `<p>${at}</p>`]));
    const made = jsonOf(await bench.run(`${folderOf("report", { "index.html": "<title>Report</title>", ...pages })} --json`));
    const { label } = made.site as { label: string };
    bench.sent.length = 0;
    bench.paused = async () => stop;
    bench.hook = async (request) => {
      if (bench.sent.length !== 2 || !request.url.endsWith("/duplicate")) return undefined;

      const { uploads } = await bench.install.database.listUploads({ before: Number.MAX_SAFE_INTEGER, limit: 10 });
      const copy = uploads.find((upload) => upload.plan.kind === "duplicate");

      return answer(200, { before: null, site: null, copy: { upload: copy?.id, copied: null, files: 130 } });
    };

    const copied = await bench.run(`duplicate ${label} --name report-draft`);
    const sent = bench.sent.map((line) => line.replace(/[0-9a-z]{16}$/, ":upload"));

    expect([copied.code, copied.waits, copied.out[0]?.replace(/--[0-9a-z]{12}/, "--:id"), copied.err.join(" ").includes("the copy was given up and no site was made")]).toEqual(
      stop === undefined ? [code, waits, "copied    report-draft--:id  130 files", false] : [code, waits, undefined, true],
    );
    expect(sent).toEqual([...Array.from({ length: stop === undefined ? 3 : 2 }, () => `POST /api/sites/${label}/duplicate`), ...(stop === undefined ? [] : ["DELETE /api/uploads/:upload"])]);
  });

  // Drift: a copy whose job ended with no site is answered as gone; worded as a site that was not found, the person would look for a wrong label. The copy is still given up: an upload refused for another reason may be running.
  test("a duplicate the install makes by itself and then refuses as gone says that the copy stopped, exits 1, and is given up all the same", async () => {
    const bench = await openBench();
    const pages = Object.fromEntries(Array.from({ length: 129 }, (_page, at) => [`pages/${at}.html`, `<p>${at}</p>`]));
    const made = jsonOf(await bench.run(`${folderOf("report", { "index.html": "<title>Report</title>", ...pages })} --json`));
    const { label } = made.site as { label: string };
    bench.sent.length = 0;
    bench.paused = async () => undefined;
    bench.hook = async (request) => {
      if (bench.sent.length < 2 || !request.url.endsWith("/duplicate")) return undefined;

      const { uploads } = await bench.install.database.listUploads({ before: Number.MAX_SAFE_INTEGER, limit: 10 });
      const copy = uploads.find((upload) => upload.plan.kind === "duplicate");
      if (bench.sent.length === 2) return answer(200, { before: null, site: null, copy: { upload: copy?.id, copied: null, files: 130 } });

      return answer(404, { error: { code: "not_found", message: "there is no such thing here", about: "upload" } });
    };

    const failed = await bench.run(`duplicate ${label} --name report-draft`);

    const { uploads } = await bench.install.database.listUploads({ before: Number.MAX_SAFE_INTEGER, limit: 10 });

    expect([failed.code, failed.out, failed.err, failed.waits]).toEqual([
      1,
      [],
      ["the copy stopped", "if poplin list does not show the site, copy it again: poplin duplicate <site>"],
      [2000],
    ]);
    expect(bench.sent.map((sent) => sent.replace(/[0-9a-z]{16}$/, ":upload"))).toEqual([...Array.from({ length: 3 }, () => `POST /api/sites/${label}/duplicate`), "DELETE /api/uploads/:upload"]);
    expect(uploads.filter((upload) => upload.plan.kind === "duplicate").map((upload) => upload.state)).toEqual(["abandoned"]);
  });

  test("a duplicate whose last call went through with its answer lost is reported as done: without this a copy that is a site is reported as a failure", async () => {
    const bench = await openBench();
    const pages = Object.fromEntries(Array.from({ length: 129 }, (_page, at) => [`pages/${at}.html`, `<p>${at}</p>`]));
    const made = jsonOf(await bench.run(`${folderOf("report", { "index.html": "<title>Report</title>", ...pages })} --json`));
    const { label } = made.site as { label: string };
    bench.sent.length = 0;
    bench.hook = async (request) => {
      if (bench.sent.length !== 2) return undefined;

      await bench.install.api.fetch(request);

      throw new Error("the connection broke");
    };

    const copied = await bench.run(`duplicate ${label} --name report-draft`);

    expect([copied.code, copied.out[0]?.replace(/--[0-9a-z]{12}/, "--:id"), copied.err]).toEqual([0, "copied    report-draft--:id  130 files", []]);
  });

  test("list follows every page of the install: without this a listing stops at the first hundred sites", async () => {
    const { bench } = await withSite();
    const folder = folderOf("more", { "index.html": "x" });
    for (let made = 0; made < 2; made += 1) await bench.run(folder);

    const pages: string[] = [];
    bench.hook = (request) => {
      const url = new URL(request.url);
      if (url.pathname !== "/api/sites") return undefined;

      pages.push(url.searchParams.get("after_id") ?? "first");
      url.searchParams.set("limit", "1");

      return bench.install.api.fetch(new Request(url, request));
    };

    const listed = jsonOf(await bench.run("list --json"));

    expect((listed.sites as unknown[]).length).toBe(3);
    expect(listed.next).toBeUndefined();
    expect(pages.length).toBe(3);
  });

  test("whoami, config, and doctor print what the install answers and change nothing", async () => {
    const { bench } = await withSite();
    const before = await stateOf(bench);

    const who = await bench.run("whoami");
    const doctor = await bench.run("doctor");
    const asPublisher = await bench.run("doctor", { env: { POPLIN_SERVER: ORIGIN, POPLIN_TOKEN: bench.install.tokens.owner } });

    expect(who.out.slice(0, 2)).toEqual([`install  ${ORIGIN}`, "role     admin"]);
    expect(jsonOf(await bench.run("whoami --json"))).toMatchObject({ server: ORIGIN, token: { scope: "admin", note: "a test" } });
    expect(doctor.out.map((line) => line.split(/ {2,}/).slice(0, 2).join(" "))).toEqual(["ok install", "ok version", "ok login", "ok settings", "ok sites", "ok trash", "ok problems", "nothing was changed"]);
    expect(asPublisher.out[3]).toBe("ok  settings  not read: this token is no admin's");
    expect((await bench.run("config trash_days")).out).toEqual(["7"]);
    expect((await bench.run("config")).out).toContain("max_site_size                200MB");
    expect(await stateOf(bench)).toEqual(before);
    expect(bench.sent.every((line) => line.startsWith("GET "))).toBe(true);

    expect((await bench.run("config trash_days 9")).out).toEqual(["trash_days  9"]);
    // Drift: with a key, `--json` printed every setting, so a script could not tell from the output which one it had read or changed.
    expect([jsonOf(await bench.run("config trash_days --json")), jsonOf(await bench.run("config versions_kept 4 --json"))]).toEqual([
      { key: "trash_days", value: 9 },
      { key: "versions_kept", value: 4 },
    ]);
    expect(Object.keys(jsonOf(await bench.run("config --json")).values as object)).toContain("versions_kept");

    // Drift: the stored logins and the login page's own list are two lists; a change that printed the first alone would leave a new person stopped at the login with nothing saying why.
    // An install that carried the change to the login page by itself has no step left, and naming one would send a person to paste a token for nothing.
    await bench.install.database.keepDomainCheck({ ran_at: bench.install.clock.now, by: "ada@example.com" as Email, run: "repair", pieces: [] }, {});
    bench.install.users.takes = true;
    const carried = await bench.run("config logins ada@example.com,cy@example.com");
    bench.install.users.takes = false;
    const added = await bench.run("config logins ada@example.com,second@example.com");

    const step = "one more step: on the dashboard's Domain screen, paste an account token and press Repair, so the login page lets a new email in; until then only an email that was already a login gets in";

    expect([added.out, added.err, carried.out, carried.err]).toEqual([["logins  ada@example.com,second@example.com"], [step], ["logins  ada@example.com,cy@example.com"], []]);

    // Drift: a token names no email, so the one login known to pass the login page is one that was a login already; a list of new emails alone would shut the dashboard on everyone.
    const replaced = await bench.run("config logins third@example.com");

    expect([replaced.code, replaced.err[0], (await bench.run("config logins")).out]).toEqual([1, "the change would leave no login that works: logins", ["ada@example.com,second@example.com"]]);
  });

  // Drift: `poplin update` is the one command that replaces the install's own code. A check that started an update, or a start that did not say why it was refused, would leave a person guessing.
  test("update --dry-run says what a start would come to and starts nothing, an install with no key is told where to get one, and update takes the release once a minute", async () => {
    const bench = await openBench();
    const notes = "https://example.com/changelog/#v7-9-0";
    await bench.install.database.keepUpdateCheck({ checked_at: NOW, news: { version: "7.9.0", released: "2026-12-01", notes, schema: OWN_SCHEMA } });

    bench.install.host.key = false;
    const keyless = await bench.run("update --dry-run");
    const refused = await bench.run("update");
    bench.install.host.key = true;
    const checked = await bench.run("update --dry-run --json");
    const before = [...bench.install.host.put];
    const started = await bench.run("update");
    const again = await bench.run("update --json");

    expect([keyless.code, keyless.out]).toEqual([
      0,
      [`7.9.0 is out; the install runs ${INSTALL_VERSION}`, "the install holds no key, so it cannot update itself: open Domain on the dashboard and press Repair", "nothing was started"],
    ]);
    expect([refused.code, refused.err]).toEqual([1, ["the install holds no key of its host, so it cannot update itself", "open Domain on the dashboard and press Repair"]]);
    expect([jsonOf(checked), before]).toEqual([{ version: INSTALL_VERSION, update: { current: INSTALL_VERSION, newest: "7.9.0", notes }, key: true, back: null }, []]);
    expect([started.out, bench.install.host.put]).toEqual([[`the install now runs 7.9.0; it ran ${INSTALL_VERSION}`], ["7.9.0"]]);
    expect([again.code, jsonOf(again)]).toEqual([1, { error: { code: "too_many_requests", message: "the install is asked too often", about: "update", hint: "wait a minute, then try again" } }]);
  });

  // Drift: `--to` is the one way a terminal goes back after an update. A flag the command dropped would take the newest release, and a check that did not name the version before would leave a person to guess it.
  test("update --dry-run names the version an install can go back to, and update --to takes that version, not the newest", async () => {
    const bench = await openBench();
    bench.install.host.last = { from: "7.7.0", to: INSTALL_VERSION, schema: OWN_SCHEMA, at: NOW };
    const checked = await bench.run("update --dry-run");
    const back = await bench.run("update --to 7.7.0");

    expect([checked.out, back.out, bench.install.host.put]).toEqual([
      [`no newer version is known; the install runs ${INSTALL_VERSION}`, "the install holds its key", "the install can go back to 7.7.0: poplin update --to 7.7.0", "nothing was started"],
      [`the install now runs 7.7.0; it ran ${INSTALL_VERSION}`],
      ["7.7.0"],
    ]);
  });

  test.each(Object.keys(CODES))("the code %s has a sentence of its own in the one table, exits 1, and is the error object under --json", async (code) => {
    const bench = await openBench();
    bench.hook = () => answer(400, { error: { code, message: "the install's own words", about: "max_site_size" } });

    const human = await bench.run(`show ${NO_SITE}`);
    const json = await bench.run(`show ${NO_SITE} --json`);
    const { error } = jsonOf(json) as { error: { code: string; message: string; about: string } };

    expect(human.code).toBe(1);
    expect(human.out).toEqual([]);
    expect(human.err[0]).toBe(`${error.message}: max_site_size`);
    expect([error.code, error.about, error.message === "the install's own words"]).toEqual([code, "max_site_size", false]);
    expect(json.err).toEqual(human.err);
  });

  // Drift: the reasons are worded twice, here and on the dashboard. A reason one of them lacks is a bare word in a terminal, or a hint to try again where trying again never helps.
  test.each([...RELEASE_REASONS, ["moon_phase", "unknown"] as const])("a release refused for %s is told with its reason, and with a hint of its own that says try again only where that helps", async (reason, again) => {
    const bench = await openBench();
    bench.hook = () => answer(409, { error: { code: "release_refused", message: "the install's own words", about: reason } });

    const [sentence, hint, ...rest] = (await bench.run("update")).err;
    const known = again !== "unknown";

    expect([sentence, rest]).toEqual([`the release cannot be taken, and nothing was changed, for this reason: ${reason}`, []]);
    expect([hint !== NO_REASON_HINT, hint?.includes("try again") === true]).toEqual([known, again === "passes"]);
    expect(refusalSentence("release_refused", reason) !== refusalSentence("release_refused")).toBe(known);
  });

  // Drift: one command takes a release the install cannot take by itself. A hint that named another, or other words than the dashboard's, would send a person to a command that takes no such release.
  test("a release the install cannot take by itself is told with the repair that takes it, in the words the dashboard says", async () => {
    const bench = await openBench();
    bench.hook = () => answer(409, { error: { code: "release_refused", message: "the install's own words", about: "needs_hand" } });

    const [, hint = "no hint"] = (await bench.run("update")).err;

    expect([hint.endsWith("To take it, run: npx poplin doctor --repair --update"), refusalSentence("release_refused", "needs_hand").endsWith(hint)]).toEqual([true, true]);
  });

  test.each([
    ["a code the table does not hold keeps the install's sentence", () => answer(418, { error: { code: "teapot", message: "the install is a teapot" } }), "the install is a teapot", 1],
    ["an install that cannot be reached", () => Promise.reject(new Error("no route to host")), `the install could not be reached: ${ORIGIN}`, 5],
    ["an answer that is no JSON", () => new Response("<html>login</html>", { status: 200 }), `the answer is not the install's: status 200 from ${ORIGIN}`, 5],
    ["a redirect to a login page", () => new Response(null, { status: 302, headers: { Location: "https://login.example.com" } }), `the answer is not the install's: status 302 from ${ORIGIN}`, 5],
    ["a done answer of another form", () => answer(200, { site: "report" }), "the install answered in a form this poplin does not know: status 200", 5],
  ])("%s is a sentence and an exit code, never a stack", async (_name, hook, sentence, code) => {
    const bench = await openBench();
    bench.hook = hook;

    const failed = await bench.run(`show ${NO_SITE}`);

    expect(failed.code).toBe(code);
    expect(failed.err[0]).toBe(sentence);
    expect(failed.err.join("\n")).not.toMatch(/\n\s+at /);
  });

  test("a command that is refused or fails changes nothing on the install", async () => {
    const { bench, label } = await withSite();
    const before = await stateOf(bench);
    const asStranger = { env: { POPLIN_SERVER: ORIGIN, POPLIN_TOKEN: bench.install.tokens.stranger } };

    const refused = [
      await bench.run(`set ${label} --public`, asStranger),
      await bench.run(`delete ${label}`, asStranger),
      await bench.run(`new-link ${label}`, asStranger),
      await bench.run(`rollback ${label} --to 7`),
      await bench.run(`restore ${label}`),
      await bench.run(`delete ${label} --no-trash`),
      await bench.run(`delete ${label} --no-trash`, { terminal: { asks: true, progress: true }, typed: "report" }),
      await bench.run(`delete ${label} --no-trash`, { terminal: { asks: true, progress: true }, typed: { stop: true } }),
    ];

    const warned = `This removes ${label} and every file of it for good.`;

    expect(refused.map((ran) => [ran.code, ran.err.find((line) => line !== warned)])).toEqual([
      [1, "no site with that id or public name"],
      [1, "no site with that id or public name"],
      [1, "no site with that id or public name"],
      [1, "the site keeps no such version"],
      [1, "the site is not in the trash"],
      [1, "delete --no-trash asks for the site's label to be typed, and there is no terminal to ask on"],
      [1, "what was typed is not the site's label, so nothing was deleted"],
      [1, "the command was stopped: nothing was deleted"],
    ]);
    expect(await stateOf(bench)).toEqual(before);
  });

  // Drift: --dry-run was taken by half the commands that change something, and the rest refused the flag: a person could not ask what a delete or a new link would do before the act nothing undoes.
  test("a dry run of each command that changes something says in the run's own rows what would be, ends in the line of a dry run, exits 0, and changes nothing", async () => {
    const { bench, label } = await withSite();
    const url = `https://${label}-p-poplin.example.com`;
    const open = `https://${label}-u-poplin.example.com`;
    const before = [await stateOf(bench), jsonOf(await bench.run("config --json"))];
    const last = "nothing was changed: --dry-run asked the install what this would come to";

    const dry = [
      await bench.run(`set ${label} --unlisted --name q3-report --dry-run`),
      await bench.run(`rollback ${label} --to 1 --dry-run`),
      await bench.run(`new-link ${label} --dry-run`),
      await bench.run(`duplicate ${label} --name report-draft --dry-run`),
      await bench.run(`delete ${label} --dry-run`),
      await bench.run(`delete ${label} --no-trash --dry-run`),
      await bench.run("config trash_days 9 --dry-run"),
      await bench.run("logout --dry-run"),
    ];

    expect(dry.map(summary)).toEqual([
      { code: 0, out: [`would change  q3-report--${label.slice(-12)}  name and access`, "would rename  from report", `would move    from ${url}`, "unlisted      anyone with the link can open it", "", open.replace("report", "q3-report"), last], err: [] },
      { code: 0, out: [`would roll back  ${label}  version 1 would be live`, "private          only your users can open it", "", url, last], err: [] },
      { code: 0, out: [`would get a new link  ${label}`, `would stop            ${label}  ${url}`, "the new id, and so the new address, is drawn when the link is made", last], err: [] },
      { code: 0, out: [`would copy  ${label}  1 file, to a new private site named report-draft`, last], err: [] },
      { code: 0, out: [`would go to the trash  ${label}  gone for good on 2023-11-21`, last], err: [] },
      { code: 0, out: [`would delete for good  ${label}`, "would go: 1 file in 1 kept version; nothing could restore them", `would stop working: ${url}`, `a run asks you to type ${label} first`, last], err: [] },
      { code: 0, out: ["would set  trash_days  9", last], err: [] },
      { code: 0, out: [`would log out of ${ORIGIN}`, "the token would be revoked", "POPLIN_SERVER and POPLIN_TOKEN would still be set in this shell", last], err: [] },
    ]);
    expect([await stateOf(bench), jsonOf(await bench.run("config --json"))]).toEqual(before);
  });

  // Drift: a dry run that passed where the run is refused is a promise the run breaks; the install judges both, so both say the same and exit the same.
  test("a dry run is refused as the run after it is, with the run's sentence and exit code, and --json marks an answer as a dry run", async () => {
    const { bench, label } = await withSite();
    await bench.run(`${folderOf("notes", { "index.html": "<h1>notes</h1>" })} --public --public-name docs`);
    const asStranger = { env: { POPLIN_SERVER: ORIGIN, POPLIN_TOKEN: bench.install.tokens.stranger } };
    const lines: readonly (readonly [string, object?])[] = [
      [`set ${label} --public --public-name docs`],
      [`set ${label} --title Late`, asStranger],
      [`rollback ${label}`],
      [`rollback ${label} --to 7`],
      [`restore ${label}`],
      ["new-link zzzzzzzzzzzz"],
      [`duplicate ${label}`, asStranger],
      [`delete ${label} --no-trash`, asStranger],
      ["config logins nobody@example.com"],
      ["config trash_days 9", asStranger],
    ];
    const before = await stateOf(bench);
    const refused = [];
    for (const [line, options] of lines) refused.push([summary(await bench.run(`${line} --dry-run`, options)), await bench.run(`${line} --json --dry-run`, options)] as const);
    const unchanged = await stateOf(bench);
    const run = [];
    for (const [line, options] of lines.slice(0, 5)) run.push(summary(await bench.run(line, options)));

    expect(refused.map(([said, json]) => [said.code, said.out, json.code])).toEqual(refused.map(() => [1, [], 1]));
    expect(refused.slice(0, 5).map(([said]) => said)).toEqual(run);
    expect(unchanged).toEqual(before);
    expect(jsonOf(await bench.run(`set ${label} --unlisted --json --dry-run`))).toMatchObject({ dry_run: true, before: { access: "private" }, site: { access: "unlisted" } });
    expect(jsonOf(await bench.run("config trash_days 9 --json --dry-run"))).toEqual({ dry_run: true, key: "trash_days", value: 9 });
    expect(jsonOf(await bench.run("logout --json --dry-run"))).toEqual({ dry_run: true, server: ORIGIN, revoked: true });
    expect(summary(await bench.run("config trash_days --dry-run")).err[0]).toBe("poplin config changes nothing unless it is given a value: --dry-run goes with one");
    expect(jsonOf(await bench.run("logout --json --dry-run", { env: {} }))).toEqual({ dry_run: true, revoked: false });
    expect((await bench.run("logout --dry-run", { env: {} })).out).toEqual(["no login is saved on this machine", "nothing was sent: --dry-run calls no install"]);
    expect((await bench.run(`set ${label} --search-engines on --dry-run`)).err).toEqual(["search engines list a site only once it is public; the setting would be stored"]);
    expect((await bench.run("config logins ada@example.com,new@example.com --dry-run")).err).toEqual(["a run may need one more step, which it names: a Repair on the dashboard's Domain screen, so the login page lets a new email in"]);
  });

  // Drift: a copy's calls are made again after the rest an install asks for; a dry run that gave up at the first such answer failed where the copy after it goes through.
  test("a dry run of a copy that is answered too many requests rests as long as the answer says, asks again, and exits 0", async () => {
    const { bench, label } = await withSite();
    let asked = 0;
    bench.hook = async (request) => {
      asked += request.method === "POST" ? 1 : 0;

      return request.method === "POST" && asked === 1 ? Response.json({ error: { code: "too_many_requests", message: "the install is asked too often" } }, { status: 429, headers: { "Retry-After": "7" } }) : undefined;
    };

    const dry = await bench.run(`duplicate ${label} --dry-run`);

    expect([dry.code, dry.out[0], dry.waits, asked]).toEqual([0, `would copy  ${label}  1 file, to a new private site named report`, [7000], 2]);
  });

  // Drift: the one act nothing undoes ended in silence, and the person could not tell a removed site from a command that did nothing.
  test("delete --no-trash removes the site once its label is typed, and says what is gone in the words the agent's tool has for the same act", async () => {
    const { bench, label } = await withSite();
    const { site } = jsonOf(await bench.run(`show ${label} --json`)) as { site: { addresses: { site: string } } };

    const deleted = await bench.run(`delete ${label.slice(-12)} --no-trash`, { terminal: { asks: true, progress: true }, typed: `${label}\n` });

    expect(summary(deleted)).toEqual({ code: 0, out: [`deleted for good  ${label}`, "gone: 1 file in 1 kept version; nothing can restore them", `stopped working: ${site.addresses.site}`], err: [`This removes ${label} and every file of it for good.`] });
    expect(deleted.asked).toEqual([`Type ${label} to go on:`]);
    expect(await stateOf(bench)).toEqual([{ sites: [] }, { sites: [] }, []]);
  });

  // Drift: with the install down every command sent the person to `poplin whoami` for the address, which then failed the same way and showed none; and a change that never left this computer was said to have been made, maybe.
  test.each<[string, string, () => Error, string[]]>([
    ["a read", "whoami", () => new Error("no route to host"), ["check the address and the network; to log in at another address: poplin login --server <address>"]],
    ["a change that left this computer", `set ${NO_SITE} --private`, () => new Error("socket closed"), ["the answer was lost, so the change may have been made all the same; poplin list shows the sites as they are"]],
    [
      "a change that never left this computer",
      `set ${NO_SITE} --private`,
      () => Object.assign(new TypeError("refused"), { code: "ConnectionRefused" }),
      ["nothing was sent, so nothing was changed; check the address and the network"],
    ],
  ])("%s that gets no answer names the address it tried, and hints at nothing that needs the install", async (_name, line, thrown, hint) => {
    const bench = await openBench();
    bench.hook = () => Promise.reject(thrown());

    const failed = await bench.run(line);

    expect([failed.code, failed.err.slice(-2)]).toEqual([5, [`the install could not be reached: ${ORIGIN}`, ...hint]]);
  });

  test.each([
    ["no login", {}, "list", 3, "not logged in"],
    ["half a login", { POPLIN_SERVER: ORIGIN }, "list", 3, "the login cannot be used: POPLIN_SERVER is set and POPLIN_TOKEN is not; set POPLIN_TOKEN too, or unset POPLIN_SERVER to use the saved login"],
    ["another install than the login's", undefined, "list --server https://other.example.com", 3, "there is no token for that install: https://other.example.com"],
    ["an address that is not https", undefined, "list --server http://poplin.example.com:8787", 2, "--server takes an https:// address with nothing after the host"],
    ["login with no install to ask", {}, "login", 3, "login needs the address of the install"],
    ["login at an address that is not https", {}, "login --server http://poplin.example.com:8787", 2, "--server takes an https:// address with nothing after the host"],
  ])("%s sends nothing and exits with its own code", async (_name, env, line, code, sentence) => {
    const bench = await openBench();

    const ended = await bench.run(line, env === undefined ? {} : { env });

    expect([ended.code, ended.err[0], ended.out]).toEqual([code, sentence, []]);
    expect(bench.sent).toEqual([]);
  });

  test("--server that names the login's own install is taken, and the saved login is used when the environment holds none", async () => {
    const bench = await openBench();
    const machine = { env: { POPLIN_CONFIG_DIR: join(bench.home, "config") }, platform: process.platform, home: bench.home };
    await saveLogin({ server: ORIGIN, token: bench.install.tokens.admin } as Login, machine);

    const listed = await bench.run(`list --server ${ORIGIN}`, { env: {} });

    expect(summary(listed)).toEqual({ code: 0, out: ["no sites"], err: [] });
  });

  test("logout revokes the token and removes the saved login, and removes it even when the install is down", async () => {
    const bench = await openBench();
    const machine = { env: { POPLIN_CONFIG_DIR: join(bench.home, "config") }, platform: process.platform, home: bench.home };
    const file = join(bench.home, "config", "login.json");
    await saveLogin({ server: ORIGIN, token: bench.install.tokens.owner } as Login, machine);

    const out = await bench.run("logout", { env: {} });

    expect(summary(out)).toEqual({ code: 0, out: [`logged out of ${ORIGIN}`, "the token is revoked"], err: [] });
    expect(existsSync(file)).toBe(false);
    expect((await bench.run("whoami", { env: { POPLIN_SERVER: ORIGIN, POPLIN_TOKEN: bench.install.tokens.owner } })).code).toBe(1);
    expect(summary(await bench.run("logout", { env: {} }))).toEqual({ code: 0, out: ["no login is saved on this machine"], err: [] });

    await saveLogin({ server: ORIGIN, token: bench.install.tokens.stranger } as Login, machine);
    bench.hook = () => Promise.reject(new Error("the install is down"));
    const down = await bench.run("logout", { env: {} });

    expect(summary(down)).toEqual({
      code: 5,
      out: [],
      err: [`the install could not be reached: ${ORIGIN}`, "the saved login was removed from this machine; if the install still stands, the token may still be live: revoke it on the install's dashboard"],
    });
    expect(existsSync(file)).toBe(false);
  });

  test("a command line the parser refuses still answers --json with one error object, and hides a token typed into it", async () => {
    const bench = await openBench();

    const bare = await bench.run("show --json");
    const typed = await bench.run(`show ${bench.install.tokens.admin} --json`);

    expect([bare.code, jsonOf(bare)]).toEqual([2, { error: { code: "usage-error", message: "poplin show needs a site", hint: "poplin show <site>" } }]);
    expect(typed.code).toBe(2);
    expect(typed.err[0]).toStartWith('<site> "[token]" is not a site');
    expect(bench.sent).toEqual([]);
  });

  test("the saved login's token is hidden in a command that never reads the login, and a very deep answer is still written as JSON", async () => {
    const bench = await openBench();
    const token = bench.install.tokens.owner;
    const machine = { env: { POPLIN_CONFIG_DIR: join(bench.home, "config") }, platform: process.platform, home: bench.home };
    await saveLogin({ server: ORIGIN, token } as Login, machine);
    const deep = `${'{"a":'.repeat(10_000)}1${"}".repeat(10_000)}`;
    bench.hook = () => new Response(`{"token":{"id":"0000000000000000","scope":"admin","note":"","created":0,"expires":"never"},"version":"1.0.0","layout":{"kind":"hostname","public_word":"page"},"more":${deep}}`, { status: 200 });

    const typed = await bench.run(`show ${token} --json`, { env: {} });
    const dry = await bench.run(`${folderOf("report", { "index.html": "x" })} --dry-run --title ${token}`, { env: {} });
    const who = await bench.run("whoami --json", { env: {} });

    expect(typed.err[0]).toStartWith('<site> "[token]" is not a site');
    expect(dry.out.join("\n")).not.toContain(token);
    expect([who.code, who.out.length, (who.out[0]?.length ?? 0) > 60_000]).toEqual([0, 1, true]);
  });

  test("a token that holds a quote is taken out of the value before it is written, so --json stays JSON and the token is not in it", async () => {
    const bench = await openBench();
    const token = 'a"b';
    bench.hook = (request) => answer(400, { error: { code: "bad_argument", message: "no", about: request.headers.get("Authorization") } });

    const echoed = jsonOf(await bench.run("list --json", { env: { POPLIN_SERVER: ORIGIN, POPLIN_TOKEN: token } }));

    expect(echoed).toMatchObject({ error: { code: "bad_argument", about: "Bearer [token]" } });
  });

  test("delete --no-trash asks nothing about a site whose label an install filled with a token: the question would show it to whoever watches the terminal", async () => {
    const { bench, label } = await withSite();
    const real = (await answered(bench.install.routes.sites[":site"].$get({ param: { site: label } }))).body as { site: object };
    bench.hook = (request) => (request.method === "GET" ? answer(200, { ...real, site: { ...real.site, label: bench.install.tokens.admin } }) : undefined);

    const asked = await bench.run(`delete ${label} --no-trash`, { terminal: { asks: true, progress: true }, typed: label });

    expect([asked.asked, asked.code]).toEqual([[], 5]);
  });

  test("list stops after ten pages when an install never ends its listing: without this the command asks forever", async () => {
    const bench = await openBench();
    bench.hook = () => answer(200, { sites: [], next: { updated_at: 1_700_000_000_000, id: "k3f9x2ab71qz" } });

    const listed = await bench.run("list");

    expect(bench.sent.length).toBe(10);
    expect(summary(listed)).toEqual({ code: 0, out: ["no sites"], err: ["the first 0 sites are shown, and the install holds more"] });
  });

  // Drift: the install is built from one release and the command from another, and this line is the one place a person reads both.
  test.each([
    ["the same version", VERSION, `ok  version   install ${VERSION}, this poplin ${VERSION}`],
    ["another version", INSTALL_VERSION, `ok  version   install ${INSTALL_VERSION}, this poplin ${VERSION}: the install and this poplin are of two versions; update the older one`],
  ])("doctor names the install's version beside its own, on an install of %s", async (_name, installed, line) => {
    const bench = await openBench();
    bench.hook = async (request) => {
      if (!request.url.endsWith("/api/whoami")) return undefined;

      return Response.json({ ...(await (await bench.install.api.fetch(request)).json()), version: installed });
    };

    const report = await bench.run("doctor");

    expect([report.code, report.out[1]]).toEqual([0, line]);
    expect(jsonOf(await bench.run("doctor --json"))).toMatchObject({ version: installed, poplin: VERSION });
  });

  // Drift: the install learns of a newer release by itself, and this row is where a person at a terminal hears of it. A row printed with nothing to say would teach them to skip it.
  test("doctor names a newer release with its notes once the install has learned of one, and prints no such row before", async () => {
    const bench = await openBench();
    const before = await bench.run("doctor");
    const unknown = jsonOf(await bench.run("doctor --json"));
    await bench.install.database.keepUpdateCheck({ checked_at: 1_700_000_000_000, news: { version: "7.9.0", released: "2026-12-01", notes: "https://example.com/changelog/#v7-9-0", schema: OWN_SCHEMA } });

    const report = await bench.run("doctor");

    expect(before.out.map((line) => line.split(/ {2,}/)[1])).not.toContain("update");
    expect(unknown).toMatchObject({ update: null });
    expect([report.code, report.out[2]]).toEqual([0, `ok  update    7.9.0 is out (this install runs ${INSTALL_VERSION}): https://example.com/changelog/#v7-9-0`]);
    expect(jsonOf(await bench.run("doctor --json"))).toMatchObject({ update: { current: INSTALL_VERSION, newest: "7.9.0", notes: "https://example.com/changelog/#v7-9-0" } });
    expect(jsonOf(await bench.run("whoami --json"))).toMatchObject({ update: { newest: "7.9.0" } });
  });

  // Drift: the install remembers what its last check of the domain left broken, and this row is where a person at a terminal hears of it. A row with nothing to say would teach them to skip it, and a missing one would leave locked private sites unsaid.
  // An install that keeps its sites at paths has no domain, and a row that spoke of one would send its owner looking for it.
  test.each([
    { name: "a broken login", state: "needs_repair", part: "login", ago: 0, line: "The login for private sites is missing or changed, so private sites may be locked. Open Domain and press Repair.", code: "login_broken" },
    { name: "a broken record", state: "needs_repair", part: "reach", ago: 0, line: "The Sample piece is missing or changed, so sites may not open. Open Domain and press Repair.", code: "sites_unreachable" },
    { name: "another broken piece", state: "needs_repair", part: "rest", ago: 0, line: "A piece of the domain is missing or changed. Open Domain and press Repair.", code: "needs_repair" },
    { name: "a broken login found 31 days ago", state: "needs_repair", part: "login", ago: 31, line: "The last check of the domain is over 30 days old. Open Domain and press Check.", code: "check_again" },
    { name: "another broken piece, with no domain", layout: PATHS, state: "needs_repair", part: "rest", ago: 0, line: "A piece of the install is missing or changed. Open Domain and press Repair.", code: "needs_repair" },
    { name: "a broken login found 31 days ago, with no domain", layout: PATHS, state: "needs_repair", part: "login", ago: 31, line: "The last check of the install is over 30 days old. Open Domain and press Check.", code: "check_again" },
    { name: "every piece ok", state: "ok", part: "login", ago: 0, line: undefined, code: undefined },
  ] as const)("doctor says what the last check of the domain left to act on, in one row and not as a failure: $name", async ({ layout, state, part, ago, line, code }) => {
    const bench = await openBench(layout);
    const before = jsonOf(await bench.run("doctor --json"));
    const ran_at = bench.install.clock.now - ago * 86_400_000;
    await bench.install.database.keepDomainCheck({ ran_at, by: "ada@example.com" as Email, run: "check", pieces: [{ piece: "Sample piece", detail: "sample", part, state }] }, {});

    const report = await bench.run("doctor");
    const asPublisher = await bench.run("doctor", { env: { POPLIN_SERVER: ORIGIN, POPLIN_TOKEN: bench.install.tokens.owner } });
    const rows = (out: readonly string[]): string[] => out.filter((row) => row.split(/ {2,}/)[1] === "domain");

    expect([before.domain, report.code, rows(report.out), rows(asPublisher.out)]).toEqual(["none", 0, line === undefined ? [] : [`ok  domain    ${line}`], []]);
    expect(jsonOf(await bench.run("doctor --json")).domain).toEqual(code === undefined ? "none" : { code, about: code === "check_again" ? null : "Sample piece" });
  });

  // Drift: what the install noted as gone wrong is shown on the dashboard, and this row is where a person at a terminal, or a script, hears of it.
  // A problem of today that read as `ok` would pass a health check; one of last week that read as `failed` would fail it for good.
  test.each([
    { name: "nothing in the week", noted: [], code: 0, row: "ok  problems  none in 7 days", json: { today: [], week: [] } },
    { name: "a problem of an earlier day", noted: [["sweep_failed", 2]], code: 0, row: "ok  problems  none today; in 7 days: sweep_failed", json: { today: [], week: ["sweep_failed"] } },
    { name: "a problem of over a week ago", noted: [["sweep_failed", 8]], code: 0, row: "ok  problems  none in 7 days", json: { today: [], week: [] } },
    {
      name: "two kinds today, one of them also earlier",
      noted: [["request_failed", 3], ["sweep_failed", 0], ["request_failed", 0]],
      code: 1,
      row: "failed  problems  2 kinds today: request_failed, sweep_failed",
      json: { today: ["request_failed", "sweep_failed"], week: ["request_failed", "sweep_failed"] },
    },
  ] as const)("doctor says what went wrong in the install's last week, and fails for a problem of today alone: $name", async ({ noted, code, row, json }) => {
    const bench = await openBench();
    const { now } = bench.install.clock;
    for (const [kind, daysAgo] of noted) await bench.install.database.noteProblem({ kind, at: now - daysAgo * 86_400_000, count: 1, more: false, name: null, message: null });

    const report = await bench.run("doctor");
    const asPublisher = await bench.run("doctor", { env: { POPLIN_SERVER: ORIGIN, POPLIN_TOKEN: bench.install.tokens.owner } });
    const rows = (out: readonly string[]): string[] => out.filter((line) => line.split(/ {2,}/)[1] === "problems").map((line) => line.replace(/ {2,}/g, "  "));

    expect([report.code, rows(report.out), rows(asPublisher.out)]).toEqual([code, [row], []]);
    expect(jsonOf(await bench.run("doctor --json")).problems).toEqual(json);
  });

  test("doctor exits 1 when a check fails, with its report still printed: without this a script reads a failed check as health", async () => {
    const bench = await openBench();
    bench.hook = (request) => (request.url.endsWith("/api/config") ? answer(500, { error: { code: "internal", message: "no" } }) : undefined);

    const report = await bench.run("doctor");

    expect(report.code).toBe(1);
    expect(report.out[3]).toBe("failed  settings  the install failed to do that");
    expect(report.out.at(-1)).toBe("nothing was changed");
  });

  test("a change whose answer is lost says the change may have been made: the install rotated the link though the command failed; a dry run, which changes nothing, puts nothing in doubt", async () => {
    const { bench, label } = await withSite();
    bench.hook = async (request) => {
      if (request.method !== "POST") return undefined;

      await bench.install.api.fetch(request);

      return new Response("<html>bad gateway</html>", { status: 502 });
    };

    const lost = await bench.run(`new-link ${label}`);

    expect(summary(lost)).toEqual({
      code: 5,
      out: [],
      err: [`the answer is not the install's: status 502 from ${ORIGIN}`, "the answer was lost, so the change may have been made all the same; poplin list shows the sites as they are"],
    });
    expect(summary(await bench.run(`new-link ${label} --dry-run`))).toEqual({ code: 5, out: [], err: [`the answer is not the install's: status 502 from ${ORIGIN}`, "is that the address of your poplin install?"] });
  });

  test("a token the install echoes back is taken out of what is printed: the harness would fail this run otherwise", async () => {
    const bench = await openBench();
    const token = bench.install.tokens.admin;
    bench.hook = (request) => answer(400, { error: { code: "bad_argument", message: "no", about: request.headers.get("Authorization") } });

    const echoed = await bench.run("list --json");

    expect(echoed.err[0]).toBe("an argument is missing, unknown, or of the wrong form: Bearer [token]");
    expect(JSON.stringify(jsonOf(echoed))).not.toContain(token);
  });
});
