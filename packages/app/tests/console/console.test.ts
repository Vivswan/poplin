// The console's server side: the shell page and its policy, the client's files, the admission of every request, the guard on changes, and how a refusal reaches the client.

import { describe, expect, test } from "bun:test";
import { html } from "hono/html";

import { ICON_FILE, shellPage } from "../../src/console/shell";
import { DEFAULT_ICON } from "../../src/sites/default-icon";
import { openConsole, SINCE_HEADER } from "./support/console";
import { LOGIN_HEADER, ORIGIN } from "./support/install";
import { readShell } from "./support/shell";

const DASHBOARD = ORIGIN;
const SIBLING = "https://notes--abcdefghijkl-u-poplin.example.com";
const JSON_TYPE = { "Content-Type": "application/json" };
const FORM_TYPE = { "Content-Type": "application/x-www-form-urlencoded" };

/** What a site's data route answers. */
interface Listed {
  readonly ok: boolean;
  readonly sites: readonly { readonly name: string; readonly label: string }[];
  readonly next: string | null;
}

/** What a refused request answers. */
interface Refusal {
  readonly ok: false;
  readonly code: string;
  readonly sentence: string;
}

describe("the shell page", () => {
  // Drift: a path the client draws would answer 404 from the server, the page would link its files outside the console's base path or under a name the build did not write, or a browser would keep the page itself.
  test.each(["/", "/sites/some-site--abcdefghijkl", "/anything/else"])("answers %s with the page that loads the client's files, by the names the build gave them, under the base path", async (path) => {
    const opened = await openConsole("/next");
    const response = await opened.get(path);
    const page = await response.text();

    expect(response.status).toBe(200);
    expect(page).toContain('<link rel="stylesheet" href="/next/assets/app-9d2e.css">');
    expect(page).toContain('<script type="module" src="/next/assets/app-4f1c.js"></script>');
    expect(page).toContain(`<link rel="icon" type="image/svg+xml" href="/next/assets/${ICON_FILE}">`);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
  });

  // Drift: the client would start without knowing who is logged in, where it sits, or that the data is a sample.
  test("hands the client its start values in a data block the browser does not run", async () => {
    const opened = await openConsole("/next");
    const page = await (await opened.get("/")).text();

    expect((await readShell(page)).boot).toMatchObject({ base: "/next", email: opened.base.owner, version: "1.0.0", demo: { reset: "/reset" } });
  });

  // Drift: a start value that holds markup would end the data block and run in the dashboard's page: a browser ends a script block at `</script>` whatever JSON says.
  test("writes a start value that holds markup so that a browser reads it back whole and runs nothing of it", async () => {
    const hostile = "</script><script>alert(1)</script><!-- & &amp; -->";
    const marked = { recent: [], marks: { usage: { count: 1, says: hostile }, domain: null, settings: null } };
    const boot = { base: "", email: hostile, title: hostile, version: "1.0.0", update: null, starts: false, back: null, demo: null, domain: true, domainNote: { label: hostile, sentence: hostile, quiet: false }, ...marked };
    const shell = readShell(String(await shellPage(boot, { script: "app-4f1c.js", style: "app-9d2e.css" })));

    expect([shell.boot, shell.runs, shell.scripts]).toEqual([boot, 0, ["/assets/app-4f1c.js"]]);
  });

  // Drift: one line would be written for every page a person opens, which a busy day pays for in rows, or a new login would leave no line, and the setup page would stay open after the first one.
  test("writes one Activity line for each login at the provider, from a page opened within five minutes of it, and none from a data route", async () => {
    const opened = await openConsole();
    const { clock, proof } = opened.base;
    const logins = async (): Promise<number> => (await opened.base.audit()).filter((entry) => entry.action === "login").length;
    const open = (path: string, since: number): Promise<Response> => opened.fetch(new Request(`${DASHBOARD}${path}`, { headers: { ...proof, [SINCE_HEADER]: String(since) } }));
    const first = clock.now - 1000;
    const counts: number[] = [];
    for (const [path, since, later] of [
      ["/data/frame", first, 0],
      ["/", first, 0],
      ["/settings", first, 1000],
      ["/", first - 3_600_000, 0],
      ["/", first + 60_000, 61_000],
      ["/", first + 60_000, 400_000],
    ] as const) {
      clock.now += later;
      await open(path, since);
      counts.push(await logins());
    }

    expect([counts, await opened.base.install.database.hasLoggedIn()]).toEqual([[0, 1, 1, 1, 2, 2], true]);
  });
});

describe("a request that is not admitted", () => {
  // Drift: a path of the dashboard would answer something of the install to a request no login vouches for, an email that is no user, or a login nobody could check; or a script's call would get a page where it reads JSON.
  test.each([
    ["no login behind it", "", { page: 403, data: 401, code: "no_login", sentence: "No login was checked for this request. Open the dashboard's address again.", wait: null }],
    ["a word that is no email where the login goes", "nobody", { page: 403, data: 401, code: "no_login", sentence: "No login was checked for this request. Open the dashboard's address again.", wait: null }],
    ["a verified email that is no user", "mallory@example.com", { page: 403, data: 403, code: "not_a_user", sentence: "This email is not a user of this install.", wait: null }],
    ["a login that cannot be checked now", "keys-down", { page: 503, data: 503, code: "login_unchecked", sentence: "The login cannot be checked right now. Try again.", wait: "60" }],
    ["an install with no login in front yet", "nothing-set", { page: 503, data: 503, code: "login_not_set_up", sentence: "The login is not set up yet. Finish the setup of this install first.", wait: null }],
  ])("with %s gets one sentence and nothing of the install, on a page, a file of the client, and a data route", async (_case, login, { page, data, code, sentence, wait }) => {
    const opened = await openConsole("/next");
    await opened.base.publish("a-site", "private");
    const ask = (path: string, method = "GET"): Promise<Response> =>
      opened.fetch(new Request(`${DASHBOARD}/next${path}`, { method, headers: { [LOGIN_HEADER]: login, Origin: DASHBOARD, "Content-Type": "application/json" }, ...(method === "POST" ? { body: "{}" } : {}) }));
    const pages = await Promise.all(["/", "/sites/a-site?q=x", "/assets/app-4f1c.js", "/favicon.ico", "/data"].map((path) => ask(path)));
    const calls = [await ask("/data/sites"), await ask("/data/frame"), await ask("/data/settings/sign-everyone-out", "POST")];

    expect(await Promise.all(pages.map(async (answer) => [answer.status, await answer.text()]))).toEqual(pages.map(() => [page, `${sentence}\n`]));
    expect(await Promise.all(calls.map(async (answer) => [answer.status, await answer.json()]))).toEqual(calls.map(() => [data, { ok: false, code, about: null, sentence }]));
    expect([...pages, ...calls].map((answer) => [answer.headers.get("Cache-Control"), answer.headers.get("Retry-After"), answer.headers.get("Set-Cookie"), answer.headers.get("Location")])).toEqual(
      [...pages, ...calls].map(() => ["no-store", wait, null, null]),
    );
    expect((await opened.base.audit()).map((entry) => entry.action)).not.toContain("signed_everyone_out");
  });

  // Drift: a user who was removed would go on reading and changing the install until some session of theirs ran out.
  test("is a user from the request after the one that removed them: nothing is kept between two requests", async () => {
    const opened = await openConsole();
    const { owner, proof } = opened.base;
    const second = { [LOGIN_HEADER]: "bo@example.com" };
    const asBo = (path: string): Promise<Response> => opened.fetch(new Request(`${DASHBOARD}${path}`, { headers: second }));
    const before = [(await asBo("/data/sites")).status, (await asBo("/")).status];
    await opened.change("/data/people/add", { login: "bo@example.com" });
    const during = [(await asBo("/data/sites")).status, (await asBo("/")).status];
    await opened.change("/data/people/remove", { login: "bo@example.com" });
    const after = [(await asBo("/data/sites")).status, (await asBo("/")).status, (await opened.fetch(new Request(`${DASHBOARD}/data/sites`, { headers: proof }))).status];

    expect([owner === "bo@example.com", before, during, after]).toEqual([false, [403, 403], [200, 200], [403, 403, 200]]);
  });
});

// Drift: a link that runs script under a scheme the reader does not know by its first letters counts as none, and a page that holds one passes for a page that runs nothing.
test.each([
  ["javascript:alert(1)", 1],
  [" JaVaScRiPt:alert(1)", 1],
  ["java\tscript:alert(1)", 1],
  ["data:text/html,<script>alert(1)</script>", 1],
  ["vbscript:msgbox(1)", 1],
  ["sites/some-site", 0],
  ["https://example.com/sites", 0],
])("the reader of the page counts a link to %j as %d that do more than load a page", (href, runs) => {
  expect(readShell(String(html`<a href="${href}">a link</a>`)).runs).toBe(runs);
});

describe("the client's files", () => {
  // Drift: a name the build did not write would answer something, or every page load would ask the host for the whole script again.
  test("are answered for a browser to keep for good, and a file that is not there is 404", async () => {
    const opened = await openConsole("/next");
    const script = await opened.get("/assets/app-4f1c.js");

    expect([script.status, script.headers.get("Content-Type"), await script.text()]).toEqual([200, "text/javascript; charset=utf-8", "// the client"]);
    expect(script.headers.get("Cache-Control")).toBe("public, max-age=31536000, immutable");
    expect((await opened.get("/assets/other.js")).status).toBe(404);
  });

  // Drift: the tab would show a browser's placeholder beside the dashboard's name, or a redrawn icon would keep the name a browser holds the old one under for good.
  test("hold poplin's icon under a name with the hash of its content, kept for good, and under the name a browser asks for unbidden, kept a day", async () => {
    const opened = await openConsole("/next");
    const [named, unbidden] = [await opened.get(`/assets/${ICON_FILE}`), await opened.get("/favicon.ico")];
    const hash = new Bun.CryptoHasher("sha256").update(DEFAULT_ICON).digest("hex").slice(0, 8);

    expect([named.status, named.headers.get("Content-Type"), named.headers.get("Cache-Control"), await named.text()]).toEqual([200, "image/svg+xml", "public, max-age=31536000, immutable", DEFAULT_ICON]);
    expect([unbidden.status, unbidden.headers.get("Content-Type"), unbidden.headers.get("Cache-Control"), await unbidden.text()]).toEqual([200, "image/svg+xml", "public, max-age=86400", DEFAULT_ICON]);
    expect(ICON_FILE).toBe(`icon-${hash}.svg`);
  });
});

describe("the data routes", () => {
  // Drift: the table would show another order than the one its heading names.
  test.each([
    ["?sort=name&dir=asc", ["alpha", "bravo", "charlie"]],
    ["?sort=name&dir=desc", ["charlie", "bravo", "alpha"]],
    ["?q=rav", ["bravo"]],
    ["?access=public", ["alpha"]],
  ])("list the sites for %p", async (query, names) => {
    const opened = await openConsole();
    await opened.base.publish("bravo", "private");
    await opened.base.publish("alpha", "public");
    await opened.base.publish("charlie", "unlisted");
    const listed = (await (await opened.get(`/data/sites${query}`)).json()) as Listed;

    expect(listed.sites.map((site) => site.name)).toEqual(names);
  });

  // Drift: a table ordered by a column would end at its first page, or its second page would repeat or skip sites.
  test.each(["?sort=name&dir=asc", "?sort=access&dir=asc", "?sort=title&dir=asc", ""])("go on to the following page in the order of %p", async (query) => {
    const opened = await openConsole();
    const accesses = ["private", "unlisted", "public"] as const;
    for (let index = 0; index < 27; index += 1) await opened.base.publish(`site-${String(index).padStart(2, "0")}`, accesses[index % 3] ?? "private");

    const first = (await (await opened.get(`/data/sites${query}`)).json()) as Listed;
    const joiner = query === "" ? "?" : "&";
    const second = (await (await opened.get(`/data/sites${query}${joiner}after=${encodeURIComponent(first.next ?? "")}`)).json()) as Listed;
    const names = [...first.sites, ...second.sites].map((site) => site.name);

    expect([first.sites.length, second.sites.length, second.next, new Set(names).size]).toEqual([25, 2, null, 27]);
    if (query.includes("sort=name")) expect(names).toEqual([...names].sort());
  });

  // Drift: the engine cuts a title at a NUL, so one that begins with it is ordered by nothing. A cursor refused for holding nothing after its tilde would end a table by title at its first page.
  test("go on to the following page from a title the order holds nothing of", async () => {
    const opened = await openConsole();
    for (let index = 0; index < 26; index += 1) await opened.base.publish(`site-${String(index).padStart(2, "0")}`, "private");

    const { database } = opened.base.install;
    const all = await database.listSites({ trash: false, limit: 100 });
    for (const site of all.sites) await database.changeDetails(site.id, { title: "\u0000" }, { as: "person", by: opened.base.owner, at: opened.base.clock.now });

    const first = (await (await opened.get("/data/sites?sort=title")).json()) as Listed;
    const second = (await (await opened.get(`/data/sites?sort=title&after=${encodeURIComponent(first.next ?? "")}`)).json()) as Listed;

    expect([first.sites.length, first.next?.endsWith("~"), second.sites.length, second.next]).toEqual([25, true, 1, null]);
  });

  // Drift: a cursor kept from another order would be read as a place in this one, and the page would start somewhere it never ended.
  test("refuse a cursor that does not carry what the order goes by", async () => {
    const opened = await openConsole();
    for (let index = 0; index < 27; index += 1) await opened.base.publish(`site-${String(index).padStart(2, "0")}`, "private");

    const first = (await (await opened.get("/data/sites")).json()) as Listed;
    const response = await opened.get(`/data/sites?sort=name&after=${encodeURIComponent(first.next ?? "")}`);

    expect([response.status, await response.json()]).toMatchObject([400, { ok: false, code: "bad_argument", about: "after" }]);
  });

  // Drift: data would be read without a login, or the client would be sent a login page where it expects JSON.
  test("answer 401 in JSON without a login", async () => {
    const opened = await openConsole();
    const response = await opened.getLoggedOut("/data/sites");

    expect(response.status).toBe(401);
    expect(await response.json()).toMatchObject({ ok: false, code: "no_login" });
  });

  // Drift: a page of a site of the same install, which a browser counts as the same site as the dashboard and sends the login along for, would be answered the owner's data. Nothing but the browser would then stand between that page and the answer.
  test.each([
    ["the dashboard's own page", { "Sec-Fetch-Site": "same-origin" }, 200],
    ["the dashboard's own page, which names itself in `Origin` too", { Origin: DASHBOARD, "Sec-Fetch-Site": "same-origin" }, 200],
    ["neither header, as a host hands it over that takes a page's request before the browser wrote them", {}, 200],
    ["an address a person typed, by `Sec-Fetch-Site: none`", { "Sec-Fetch-Site": "none" }, 200],
    ["a site of the same install", { Origin: SIBLING, "Sec-Fetch-Site": "same-site" }, 403],
    ["a site of the same install, by `Origin` alone", { Origin: SIBLING }, 403],
    ["a site of the same install, by `Sec-Fetch-Site` alone", { "Sec-Fetch-Site": "same-site" }, 403],
    ["another domain", { Origin: "https://elsewhere.example.net", "Sec-Fetch-Site": "cross-site" }, 403],
    ["a page with no origin of its own", { Origin: "null" }, 403],
    ["a page that says `same-origin` but names a site", { Origin: SIBLING, "Sec-Fetch-Site": "same-origin" }, 403],
    ["a page that says `none` but names a site", { Origin: SIBLING, "Sec-Fetch-Site": "none" }, 403],
  ])("answer a read from %s with the data only when no header names a page of another origin", async (_case, headers, status) => {
    const opened = await openConsole();
    await opened.base.publish("first-name", "private");
    const answers = await Promise.all(["/data/sites", "/data/frame", "/data/nothing"].map((path) => opened.fetch(new Request(`${DASHBOARD}${path}`, { headers: { ...headers, ...opened.base.proof } }))));
    const pages = await Promise.all(answers.map((answer) => answer.text()));

    expect(answers.map((answer) => answer.status)).toEqual(status === 200 ? [200, 200, 404] : [403, 403, 403]);
    expect(status === 200 ? pages[0]?.includes("first-name") : pages).toEqual(status === 200 ? true : ["Forbidden", "Forbidden", "Forbidden"]);
  });

  // Drift: a data route nobody wrote would answer the shell page, and the client would fail on HTML.
  test("answer 404 in JSON for a route that is not there", async () => {
    const opened = await openConsole();
    const response = await opened.get("/data/nothing");

    expect([response.status, ((await response.json()) as Refusal).code]).toEqual([404, "no_page"]);
  });
});

describe("a change", () => {
  // Drift: a change would be done, and the client told nothing of the site after it.
  test("is done and answers the site after it", async () => {
    const opened = await openConsole();
    const site = await opened.base.publish("first-name", "private");
    const label = `${site.name}--${site.id}`;
    const response = await opened.change(`/data/sites/${label}/naming`, { name: "second-name" });
    const listed = (await (await opened.get("/data/sites")).json()) as Listed;

    expect([response.status, ((await response.json()) as { site: { name: string } }).site.name]).toEqual([200, "second-name"]);
    expect(listed.sites.map((entry) => entry.name)).toEqual(["second-name"]);
  });

  // Drift: a refusal would reach the client without the sentence it shows, or under a status that hides what it is.
  test.each([
    ["a name that breaks the rules", "naming", { name: "Not A Name" }, 400, "bad_name"],
    ["a change that is not there", "explode", {}, 404, "no_page"],
  ])("refused for %s says why", async (_case, change, body, status, code) => {
    const opened = await openConsole();
    const site = await opened.base.publish("first-name", "private");
    const response = await opened.change(`/data/sites/${site.name}--${site.id}/${change}`, body);
    const refusal = (await response.json()) as Refusal;

    expect([response.status, refusal.code]).toEqual([status, code]);
    expect(refusal.sentence.length).toBeGreaterThan(10);
  });

  // Drift: a site no label names would be answered as a plain bad request.
  test("of a site that is not there answers 404", async () => {
    const opened = await openConsole();
    const response = await opened.change("/data/sites/no-site--abcdefghijkl/naming", { name: "second-name" });

    expect(response.status).toBe(404);
  });

  // Drift: a page of a site of the same install, which a browser counts as the same site as the dashboard and sends the login along for, could change a site as the owner; so could a page of any other origin.
  test.each([
    ["JSON from the dashboard's own page", { ...JSON_TYPE, Origin: DASHBOARD, "Sec-Fetch-Site": "same-origin" }, 200],
    ["JSON that names the dashboard in `Origin` alone", { ...JSON_TYPE, Origin: DASHBOARD }, 200],
    ["JSON that says `same-origin` and sends no `Origin`", { ...JSON_TYPE, "Sec-Fetch-Site": "same-origin" }, 200],
    ["JSON with neither header, as a host hands it over that takes a page's request before the browser wrote them", JSON_TYPE, 200],
    ["JSON from a site of the same install", { ...JSON_TYPE, Origin: SIBLING, "Sec-Fetch-Site": "same-site" }, 403],
    ["JSON from a site of the same install, by `Origin` alone", { ...JSON_TYPE, Origin: SIBLING }, 403],
    ["JSON from a site of the same install, by `Sec-Fetch-Site` alone", { ...JSON_TYPE, "Sec-Fetch-Site": "same-site" }, 403],
    ["JSON from another domain", { ...JSON_TYPE, Origin: "https://elsewhere.example.net", "Sec-Fetch-Site": "cross-site" }, 403],
    ["JSON from a page with no origin of its own", { ...JSON_TYPE, Origin: "null" }, 403],
    ["JSON from the dashboard's hostname over plain http", { ...JSON_TYPE, Origin: DASHBOARD.replace("https:", "http:") }, 403],
    ["JSON from the dashboard's hostname on another port", { ...JSON_TYPE, Origin: `${DASHBOARD}:8443` }, 403],
    ["JSON that names the dashboard but says `same-site`", { ...JSON_TYPE, Origin: DASHBOARD, "Sec-Fetch-Site": "same-site" }, 403],
    ["JSON that says `same-origin` but names a site", { ...JSON_TYPE, Origin: SIBLING, "Sec-Fetch-Site": "same-origin" }, 403],
    ["JSON that no page sent, by `Sec-Fetch-Site: none`", { ...JSON_TYPE, "Sec-Fetch-Site": "none" }, 403],
    ["a form from a site of the same install", { ...FORM_TYPE, Origin: SIBLING, "Sec-Fetch-Site": "same-site" }, 403],
    ["a form from another domain", { ...FORM_TYPE, Origin: "https://elsewhere.example.net", "Sec-Fetch-Site": "cross-site" }, 403],
    ["plain text from a site of the same install", { "Content-Type": "text/plain", Origin: SIBLING, "Sec-Fetch-Site": "same-site" }, 403],
    ["a form with neither header", FORM_TYPE, 415],
  ])("sent as %s: only a request that names no page but the dashboard's own changes anything", async (_case, headers, status) => {
    const opened = await openConsole();
    const site = await opened.base.publish("first-name", "private");
    const body = headers["Content-Type"] === "application/json" ? JSON.stringify({ name: "second-name" }) : "name=second-name";
    const address = `${DASHBOARD}/data/sites/${site.name}--${site.id}/naming`;
    const response = await opened.fetch(new Request(address, { method: "POST", headers: { ...headers, ...opened.base.proof }, body }));
    const listed = (await (await opened.get("/data/sites")).json()) as Listed;

    expect([response.status, listed.sites.map((entry) => entry.name)]).toEqual([status, [status === 200 ? "second-name" : "first-name"]]);
  });

  // Drift: a change that is no JSON, or is too large, would be read.
  test.each([
    ["a form from this origin", { "Content-Type": "application/x-www-form-urlencoded" }, 415],
    ["a type that only starts like JSON", { "Content-Type": "application/json-not-real" }, 415],
    ["a body that declares two megabytes", { "Content-Length": "2000000" }, 413],
  ])("sent as %s is refused and changes nothing", async (_case, headers, status) => {
    const opened = await openConsole();
    const site = await opened.base.publish("first-name", "private");
    const response = await opened.change(`/data/sites/${site.name}--${site.id}/naming`, "name=second-name", headers);
    const listed = (await (await opened.get("/data/sites")).json()) as Listed;

    expect(response.status).toBe(status);
    expect(listed.sites.map((entry) => entry.name)).toEqual(["first-name"]);
  });

  // Drift: a change without a login would be done.
  test("without a login answers 401 and changes nothing", async () => {
    const opened = await openConsole();
    const site = await opened.base.publish("first-name", "private");
    const response = await opened.change(`/data/sites/${site.name}--${site.id}/naming`, { name: "second-name" }, { [LOGIN_HEADER]: "" });

    const listed = (await (await opened.get("/data/sites")).json()) as Listed;

    expect(response.status).toBe(401);
    expect(listed.sites.map((entry) => entry.name)).toEqual(["first-name"]);
  });
});
