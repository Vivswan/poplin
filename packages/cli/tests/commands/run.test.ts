import { afterEach, describe, expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { join } from "node:path";

import type { Code } from "../../../app/src/api/respond";
import { ORIGIN } from "../../../app/tests/api/support/install";
import { saveLogin } from "../../src/local/login-file";
import type { Login } from "../../src/local/login";
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
  too_large: true,
  internal: true,
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
  return [(await bench.install.call("listSites", {})).body, (await bench.install.call("listSites", { trash: true })).body, await bench.install.keys()];
}

function summary(ran: Ran): { code: number; out: string[]; err: string[] } {
  return { code: ran.code, out: ran.out, err: ran.err };
}

afterEach(cleanUp);

describe("run", () => {
  test("each command about one site prints what was done and the address the install answered, and --json prints the install's answer whole", async () => {
    const { bench, label } = await withSite();
    const url = `https://${label}-page.example.com`;

    expect((await bench.run(`set ${label} --unlisted --search-engines on`)).out).toEqual([`unlisted  ${label}`, url]);
    expect((await bench.run(`set ${label} --public --name docs`)).out).toEqual([`public  ${label}  public name "docs"`, "https://docs-page.example.com"]);
    expect((await bench.run(`set docs --private`)).out).toEqual([`private  ${label}`, url]);
    expect((await bench.run(`delete ${label}`)).out).toEqual([`in the trash  ${label}  gone for good on 2023-11-21`, `to take it back: poplin restore ${label}`]);
    expect((await bench.run("list --trash")).out).toEqual([`${label}  gone for good on 2023-11-21  Report`]);
    expect((await bench.run(`restore ${label}`)).out).toEqual([`restored  ${label}  private`, url]);
    expect((await bench.run("list")).out).toEqual([`${label}  private  ${url}  Report`]);

    const shown = await bench.run(`show ${label}`);
    const json = jsonOf(await bench.run(`show ${label} --json`));

    expect(shown.out.slice(0, 4)).toEqual([label, url, `id              ${label.slice(-12)}`, "name            report"]);
    expect(shown.out.at(-1)).toMatch(/^version 1 {2}2023-11-14 {2}by [0-9a-f]{16} {2}live$/);
    expect(json).toEqual((await bench.install.call("getSite", { site: label })).body);
  });

  test("rollback and new-link print the version now live and the new label: the old label is dead, so the new one must be on stdout", async () => {
    const { bench, label } = await withSite();
    const folder = folderOf("report", { "index.html": "<title>Second</title>" });
    await bench.run(`${folder} --site ${label}`);

    expect((await bench.run(`rollback ${label}`)).out).toEqual([`rolled back  ${label}  version 1 is live`, `https://${label}-page.example.com`]);
    expect((await bench.run(`rollback ${label} --to 2`)).out[0]).toBe(`rolled back  ${label}  version 2 is live`);

    const linked = await bench.run(`new-link ${label}`);
    const fresh = linked.out[0]?.split("  ")[1] ?? "";

    expect(fresh).toMatch(/^report--[0-9a-z]{12}$/);
    expect(fresh).not.toBe(label);
    expect(linked.out).toEqual([`new link  ${fresh}`, `https://${fresh}-page.example.com`, `the old label ${label} and its address https://${label}-page.example.com stopped working`]);
    expect((await bench.run(`show ${label}`)).code).toBe(1);
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
    expect(doctor.out.map((line) => line.split(/ {2,}/).slice(0, 2).join(" "))).toEqual(["ok install", "ok login", "ok settings", "ok sites", "ok trash", "nothing was changed"]);
    expect(asPublisher.out[2]).toBe("ok  settings  not read: this token is no admin's");
    expect((await bench.run("config trash_days")).out).toEqual(["7"]);
    expect((await bench.run("config")).out).toContain("max_site_size                200MB");
    expect(await stateOf(bench)).toEqual(before);
    expect(bench.sent.every((line) => line.startsWith("GET "))).toBe(true);

    expect((await bench.run("config trash_days 9")).out).toEqual(["trash_days  9"]);
    expect(jsonOf(await bench.run("config trash_days --json"))).toMatchObject({ values: { trash_days: 9 } });
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
      await bench.run(`set ${label} --public --name gallery`),
      await bench.run(`delete ${label} --forever`),
      await bench.run(`delete ${label} --forever`, { terminal: { asks: true, progress: true }, typed: "report" }),
    ];

    expect(refused.map((ran) => [ran.code, ran.err[0]])).toEqual([
      [1, "no site with that id or public name"],
      [1, "no site with that id or public name"],
      [1, "no site with that id or public name"],
      [1, "the site keeps no such version"],
      [1, "the site is not in the trash"],
      [1, "the install keeps that public name for itself: public_name"],
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
    ["an address that is not https", undefined, "list --server http://localhost:8787", 2, "--server takes an https:// address with nothing after the host"],
    ["login", {}, "login", 4, "this build of poplin cannot do that: poplin login"],
    ["setup", {}, "setup", 4, "this build of poplin cannot do that: poplin setup"],
    ["export", {}, "export", 4, "this build of poplin cannot do that: poplin export"],
    ["import", {}, "import ./backup.zip", 4, "this build of poplin cannot do that: poplin import"],
    ["config --reset", undefined, "config trash_days --reset", 4, "this build of poplin cannot do that: config --reset"],
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
    bench.hook = () => new Response(`{"token":{"id":"0000000000000000","scope":"admin","note":"","created":0,"expires":"never"},"more":${deep}}`, { status: 200 });

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

  test("the question of delete --forever hides a token an install put where the label goes: the harness would fail this run otherwise", async () => {
    const { bench, label } = await withSite();
    const real = (await bench.install.call("getSite", { site: label })).body as { site: object };
    bench.hook = (request) => (request.method === "GET" ? answer(200, { ...real, site: { ...real.site, label: bench.install.tokens.admin } }) : undefined);

    const asked = await bench.run(`delete ${label} --forever`, { terminal: { asks: true, progress: true }, typed: label });

    expect(asked.asked).toEqual(["This removes [token] and every file of it for good. Type its label to go on: "]);
    expect(asked.code).toBe(1);
  });

  test("list stops after ten pages when an install never ends its listing: without this the command asks forever", async () => {
    const bench = await openBench();
    bench.hook = () => answer(200, { sites: [], next: { updated_at: 1_700_000_000_000, id: "k3f9x2ab71qz" } });

    const listed = await bench.run("list");

    expect(bench.sent.length).toBe(10);
    expect(summary(listed)).toEqual({ code: 0, out: ["no sites"], err: ["the first 0 sites are shown, and the install holds more"] });
  });

  test("doctor exits 1 when a check fails, with its report still printed: without this a script reads a failed check as health", async () => {
    const bench = await openBench();
    bench.hook = (request) => (request.url.endsWith("/api/config") ? answer(500, { error: { code: "internal", message: "no" } }) : undefined);

    const report = await bench.run("doctor");

    expect(report.code).toBe(1);
    expect(report.out[2]).toBe("failed  settings  the install failed to do that");
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
