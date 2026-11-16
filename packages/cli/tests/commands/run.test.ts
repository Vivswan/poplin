import { afterEach, describe, expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { join } from "node:path";

import type { Code } from "../../../app/src/api/respond";
import type { Login as Email } from "../../../core/src/auth/logins";
import { OWN_SCHEMA } from "../../../core/src/database/open";
import { answered, INSTALL_VERSION, NOW, ORIGIN, REBUILD_ADDRESS } from "../../../app/tests/api/support/install";
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
  already_a_login: true,
  not_a_login: true,
  no_update_address: true,
  no_update: true,
  update_refused: true,
  update_unreachable: true,
  too_large: true,
  too_many_requests: true,
  internal: true,
  allowance_spent: true,
};

/** An id in the form of a site id that no site has. */
const NO_SITE = "zzzzzzzzzzzz";

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
  test("each command about one site prints what was done and the address the install answered, and --json prints the install's answer whole", async () => {
    const { bench, label } = await withSite();
    const url = `https://${label}-p-poplin.example.com`;
    const open = `https://${label}-u-poplin.example.com`;

    expect((await bench.run(`set ${label} --unlisted --search-engines on`)).out).toEqual([`unlisted  ${label}`, open, `address changed: ${url} is now ${open}`]);
    expect((await bench.run(`set ${label} --public --public-name docs`)).out).toEqual([`public  ${label}  public name "docs"`, "https://docs-page.example.com"]);
    expect((await bench.run("set docs --private")).out).toEqual([`private  ${label}`, url, `address changed: ${open} is now ${url}`]);
    expect((await bench.run(`delete ${label}`)).out).toEqual([`in the trash  ${label}  gone for good on 2023-11-21`, `to take it back: poplin restore ${label}`]);
    expect((await bench.run("list --trash")).out).toEqual([`${label}  gone for good on 2023-11-21  Report`]);
    expect((await bench.run(`restore ${label}`)).out).toEqual([`restored  ${label}  private`, url]);
    expect((await bench.run("list")).out).toEqual([`${label}  private  ${url}  Report`]);

    const shown = await bench.run(`show ${label}`);
    const json = jsonOf(await bench.run(`show ${label} --json`));

    expect(shown.out.slice(0, 4)).toEqual([label, url, `id              ${label.slice(-12)}`, "name            report"]);
    expect(shown.out.at(-1)).toMatch(/^version 1 {2}2023-11-14 {2}by [0-9a-f]{16} {2}live$/);
    expect(shown.out.filter((line) => line.startsWith("pages opened"))).toEqual(["pages opened    about 10 or fewer times today, about 10 or fewer in the last 7 days"]);
    expect(json).toEqual((await answered(bench.install.routes.sites[":site"].$get({ param: { site: label } }))).body);
  });

  // Drift: only the install knows the word its public addresses end in. A command that guessed it would read `notes-site.example.com` as the public name `notes` on an install whose word is `page`, and delete the site at `notes-page`.
  test.each([
    ["page", "https://LABEL-p-poplin.example.com/", ["GET /api/sites/LABEL"]],
    ["page", "https://LABEL-u-poplin.example.com/", ["GET /api/sites/LABEL"]],
    ["page", "https://notes-page.example.com/", ["GET /api/whoami", "GET /api/sites/notes"]],
    ["site", "https://notes-site.example.com/guide", ["GET /api/whoami", "GET /api/sites/notes"]],
    ["site", "ID", ["GET /api/sites/ID"]],
    ["site", "LABEL", ["GET /api/sites/LABEL"]],
    ["site", "notes", ["GET /api/sites/notes"]],
    ["page", "https://notes-site.example.com/", "https://poplin.example.com"],
    ["site", "https://notes-page.example.com/", "https://poplin.example.com"],
    ["page", "https://notes-page.example.org/", "example.org"],
  ] as const)("on an install whose public word is %j, %s names the one site, or none: %j", async (publicWord, form, outcome) => {
    const bench = await openBench(publicWord);
    const label = (jsonOf(await bench.run(`${folderOf("report", { "index.html": "<title>Report</title>" })} --public --public-name notes --json`)).site as { label: string }).label;
    const typed = form.replace("LABEL", label).replace("ID", label.slice(-12));
    const before = await stateOf(bench);
    bench.sent.length = 0;

    const shown = await bench.run(`show ${typed}`);
    const asked = [...bench.sent];
    const deleted = await bench.run(`delete ${typed} --json`);

    if (typeof outcome === "string") {
      expect([shown.code, shown.out, shown.err[0]?.startsWith("no site with that id or public name: "), shown.err[0]?.includes(outcome), jsonOf(deleted).error]).toEqual([1, [], true, true, expect.objectContaining({ code: "not_found" })]);
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
    const sentence = "This install's database was made by another build of poplin, so its records are not the ones this build reads. Deploy the build that made it, or delete the database and poplin makes it anew.";
    bench.hook = () => new Response(`${sentence}\n`, { status: 503, headers: { "Content-Type": "text/plain; charset=utf-8" } });

    const listed = await bench.run("list");
    const json = await bench.run("doctor --json");
    bench.hook = () => new Response("<html>502</html>", { status: 502, headers: { "Content-Type": "text/html" } });
    const page = await bench.run("list");

    expect([listed.code, listed.out, listed.err]).toEqual([5, [], [`the answer is plain text, status 503: ${sentence}`]]);
    expect(jsonOf(json).error).toEqual({ code: "not_json", message: "the answer is plain text, status 503", about: sentence });
    expect(page.err).toEqual(["the answer is not the install's: status 502", "is the address the one of your poplin install? poplin whoami shows it"]);
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

    expect((await bench.run(`set ${label} --name notes`)).out.slice(0, 2)).toEqual([`private  ${renamed}  renamed from report`, `https://${renamed}-p-poplin.example.com`]);
    expect((await bench.run(`set ${label} --unlisted`)).out[0]).toBe(`unlisted  ${renamed}`);
    expect((await bench.run(`${folderOf("report", { "index.html": "<title>Second</title>" })} --site ${label} --name q3-report`)).out[1]).toBe(`updated  q3-report--${label.slice(-12)}  version 2  unlisted`);
  });

  test("rollback and new-link print the version now live and the new label: the old label is dead, so the new one must be on stdout", async () => {
    const { bench, label } = await withSite();
    const folder = folderOf("report", { "index.html": "<title>Second</title>" });
    await bench.run(`${folder} --site ${label}`);

    expect((await bench.run(`rollback ${label}`)).out).toEqual([`rolled back  ${label}  version 1 is live`, `https://${label}-p-poplin.example.com`]);
    expect((await bench.run(`rollback ${label} --to 2`)).out[0]).toBe(`rolled back  ${label}  version 2 is live`);

    const linked = await bench.run(`new-link ${label}`);
    const fresh = linked.out[0]?.split("  ")[1] ?? "";

    expect(fresh).toMatch(/^report--[0-9a-z]{12}$/);
    expect(fresh).not.toBe(label);
    expect(linked.out).toEqual([`new link  ${fresh}`, `https://${fresh}-p-poplin.example.com`, `the old label ${label} and its address https://${label}-p-poplin.example.com stopped working`]);
    expect((await bench.run(`show ${label}`)).code).toBe(1);
  });

  test("duplicate calls until the copy is whole and prints the copy's own label and private address: a copy of 130 files takes two calls, of 112 files at most, and a loop that stopped early would print no site", async () => {
    const bench = await openBench();
    const pages = Object.fromEntries(Array.from({ length: 129 }, (_page, at) => [`pages/${at}.html`, `<p>${at}</p>`]));
    const made = jsonOf(await bench.run(`${folderOf("report", { "index.html": "<title>Report</title>", ...pages })} --unlisted --json`));
    const { label } = made.site as { label: string };
    bench.sent.length = 0;

    const copied = await bench.run(`duplicate ${label} --name report-draft`);
    const fresh = copied.out[0]?.split("  ")[1] ?? "";

    expect(fresh).toMatch(/^report-draft--[0-9a-z]{12}$/);
    expect(summary(copied)).toEqual({ code: 0, out: [`copied  ${fresh}  private  130 files`, `https://${fresh}-p-poplin.example.com`], err: [] });
    expect(bench.sent).toEqual(Array.from({ length: 2 }, () => `POST /api/sites/${label}/duplicate`));
    expect((await bench.run("list")).out).toHaveLength(2);
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

    expect([copied.code, copied.out[0]?.replace(/--[0-9a-z]{12}/, "--:id"), copied.err]).toEqual([0, "copied  report-draft--:id  private  130 files", []]);
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
    expect(jsonOf(await bench.run("config trash_days --json"))).toMatchObject({ values: { trash_days: 9 } });

    // Drift: the stored logins and the login page's own list are two lists; a change that printed the first alone would leave a new person stopped at the login with nothing saying why.
    const added = await bench.run("config logins ada@example.com,second@example.com");

    const step = "one more step: on the dashboard's Domain tab, paste an account token and press Repair, so the login page lets a new email in; until then only an email that was already a login gets in";

    expect([added.out, added.err]).toEqual([["logins  ada@example.com,second@example.com"], [step]]);

    // Drift: a token names no email, so the one login known to pass the login page is one that was a login already; a list of new emails alone would shut the dashboard on everyone.
    const replaced = await bench.run("config logins third@example.com");

    expect([replaced.code, replaced.err[0], (await bench.run("config logins")).out]).toEqual([1, "the change would leave no login that works: logins", ["ada@example.com,second@example.com"]]);
  });

  // Drift: the update link is a credential a person pastes once. Each row is one `poplin update` line, what it prints, what the install then keeps, and what reached the provider: the address is in no line, even when the install hands it back.
  test("update saves the update link from the environment alone, says only that one is saved, starts one update, and never prints the link", async () => {
    const bench = await openBench();
    const login = { POPLIN_SERVER: ORIGIN, POPLIN_TOKEN: bench.install.tokens.admin };
    const withAddress = { env: { ...login, POPLIN_UPDATE_ADDRESS: REBUILD_ADDRESS } };
    await bench.install.database.keepUpdateCheck({ checked_at: NOW, news: { version: "7.9.0", released: "2026-12-01", notes: "https://example.com/changelog/#v7-9-0", schema: OWN_SCHEMA } });

    const none = await bench.run("update");
    const empty = await bench.run("update --save-address");
    const other = await bench.run("update --save-address", { env: { ...login, POPLIN_UPDATE_ADDRESS: "https://example.com/hooks/elsewhere" } });
    const saved = await bench.run("update --save-address", withAddress);
    const checked = await bench.run("update --check", withAddress);
    const started = await bench.run("update", withAddress);
    const again = await bench.run("update --json", withAddress);
    bench.hook = (request) => (request.url.endsWith("/update/address") ? answer(200, { set: true, since: NOW, address: REBUILD_ADDRESS.replace(".example", ".example:443") }) : undefined);
    const echoed = await bench.run("update --check --json", withAddress);
    bench.hook = undefined;
    const forgotten = await bench.run("update --forget-address", withAddress);
    const printed = [none, empty, other, saved, checked, started, again, echoed, forgotten].flatMap((ran) => [...ran.out, ...ran.err]);

    expect([none.code, none.err]).toEqual([1, ["the install has no update link", "put the update link in POPLIN_UPDATE_ADDRESS, then: poplin update --save-address"]]);
    expect([empty.code, empty.err[0], other.code, other.err[0]]).toEqual([1, "POPLIN_UPDATE_ADDRESS holds no update link", 1, "an argument is missing, unknown, or of the wrong form: POPLIN_UPDATE_ADDRESS"]);
    expect([saved.out, checked.out, started.out]).toEqual([
      ["the update link is saved; to update: poplin update"],
      [`7.9.0 is out; the install runs ${INSTALL_VERSION}`, "an update link is saved, since 2023-11-14", "nothing was started"],
      [`a build of the install has started; 7.9.0 is the newest version, and the install runs ${INSTALL_VERSION} until the build is done`],
    ]);
    expect([again.code, jsonOf(again)]).toEqual([1, { error: { code: "too_many_requests", message: "the install is asked too often", about: "update", hint: "wait a minute, then try again" } }]);
    expect(jsonOf(echoed).address).toEqual({ set: true, since: NOW });
    expect([forgotten.out, await bench.install.database.readUpdateAddress()]).toEqual([["the update link is removed"], undefined]);
    expect(bench.install.provider.sent).toEqual([["POST", "manual", "no body", REBUILD_ADDRESS]]);
    expect(printed.filter((line) => line.includes("3f9c2a7e5b") || line.includes("elsewhere") || line.includes("builds.provider"))).toEqual([]);
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

  test.each([
    ["a code the table does not hold keeps the install's sentence", () => answer(418, { error: { code: "teapot", message: "the install is a teapot" } }), "the install is a teapot", 1],
    ["an install that cannot be reached", () => Promise.reject(new Error("no route to host")), "the install could not be reached", 5],
    ["an answer that is no JSON", () => new Response("<html>login</html>", { status: 200 }), "the answer is not the install's: status 200", 5],
    ["a redirect to a login page", () => new Response(null, { status: 302, headers: { Location: "https://login.example.com" } }), "the answer is not the install's: status 302", 5],
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
      await bench.run(`delete ${label} --forever`),
      await bench.run(`delete ${label} --forever`, { terminal: { asks: true, progress: true }, typed: "report" }),
    ];

    expect(refused.map((ran) => [ran.code, ran.err[0]])).toEqual([
      [1, "no site with that id or public name"],
      [1, "no site with that id or public name"],
      [1, "no site with that id or public name"],
      [1, "the site keeps no such version"],
      [1, "the site is not in the trash"],
      [1, "delete --forever asks for the site's label to be typed, and there is no terminal to ask on"],
      [1, "what was typed is not the site's label, so nothing was deleted"],
    ]);
    expect(await stateOf(bench)).toEqual(before);
  });

  test("delete --forever removes the site once its label is typed, and prints nothing", async () => {
    const { bench, label } = await withSite();

    const deleted = await bench.run(`delete ${label.slice(-12)} --forever`, { terminal: { asks: true, progress: true }, typed: `${label}\n` });

    expect(summary(deleted)).toEqual({ code: 0, out: [], err: [] });
    expect(deleted.asked).toEqual([`This removes ${label} and every file of it for good. Type its label to go on: `]);
    expect(await stateOf(bench)).toEqual([{ sites: [] }, { sites: [] }, []]);
  });

  test.each([
    ["no login", {}, "list", 3, "not logged in"],
    ["half a login", { POPLIN_SERVER: ORIGIN }, "list", 3, "the login cannot be used: POPLIN_SERVER is set and POPLIN_TOKEN is not; set POPLIN_TOKEN too, or unset POPLIN_SERVER to use the saved login"],
    ["another install than the login's", undefined, "list --server https://other.example.com", 3, "there is no token for that install: https://other.example.com"],
    ["an address that is not https", undefined, "list --server http://poplin.example.com:8787", 2, "--server takes an https:// address with nothing after the host"],
    ["login with no install to ask", {}, "login", 3, "login needs the address of the install"],
    ["login at an address that is not https", {}, "login --server http://poplin.example.com:8787", 2, "--server takes an https:// address with nothing after the host"],
    ["setup with no install to ask", {}, "setup", 3, "setup needs the address of the install"],
    ["setup with no token to send", {}, "setup --server https://poplin.example.com", 1, "setup needs an account token of the install's provider, and POPLIN_SETUP_TOKEN holds none"],
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
      err: ["the install could not be reached", "the saved login was removed from this machine; the token may still be live: revoke it on the install's dashboard"],
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
    bench.hook = () => new Response(`{"token":{"id":"0000000000000000","scope":"admin","note":"","created":0,"expires":"never"},"version":"1.0.0","public_word":"page","more":${deep}}`, { status: 200 });

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

  test("delete --forever asks nothing about a site whose label an install filled with a token: the question would show it to whoever watches the terminal", async () => {
    const { bench, label } = await withSite();
    const real = (await answered(bench.install.routes.sites[":site"].$get({ param: { site: label } }))).body as { site: object };
    bench.hook = (request) => (request.method === "GET" ? answer(200, { ...real, site: { ...real.site, label: bench.install.tokens.admin } }) : undefined);

    const asked = await bench.run(`delete ${label} --forever`, { terminal: { asks: true, progress: true }, typed: label });

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
  test.each([
    { name: "a broken login", state: "needs_repair", part: "login", ago: 0, line: "The login for private sites is missing or changed, so private sites may be locked. Open Domain and press Repair.", code: "login_broken" },
    { name: "a broken record", state: "needs_repair", part: "reach", ago: 0, line: "A record or route of the domain is missing or changed, so sites may not open. Open Domain and press Repair.", code: "sites_unreachable" },
    { name: "another broken piece", state: "needs_repair", part: "rest", ago: 0, line: "A piece of the domain is missing or changed. Open Domain and press Repair.", code: "needs_repair" },
    { name: "a broken login found 31 days ago", state: "needs_repair", part: "login", ago: 31, line: "The last check of the domain is over 30 days old. Open Domain and press Check.", code: "check_again" },
    { name: "every piece ok", state: "ok", part: "login", ago: 0, line: undefined, code: undefined },
  ] as const)("doctor says what the last check of the domain left to act on, in one row and not as a failure: $name", async ({ state, part, ago, line, code }) => {
    const bench = await openBench();
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

  test("a change whose answer is lost says the change may have been made: the install rotated the link though the command failed", async () => {
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
      err: ["the answer is not the install's: status 502", "the answer was lost, so the change may have been made all the same; poplin list shows the sites as they are"],
    });
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
