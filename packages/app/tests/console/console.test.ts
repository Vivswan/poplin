// The console's server side: the shell page and its policy, the client's files, the session on every data route, the guard on changes, and how a refusal reaches the client.

import { describe, expect, test } from "bun:test";
import { html } from "hono/html";

import { openConsole } from "./support/console";
import { readShell } from "./support/shell";

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
    expect(response.headers.get("Cache-Control")).toBe("no-store");
  });

  // Drift: the client would start without knowing who is logged in, where it sits, or that the data is a sample.
  test("hands the client its start values in a data block the browser does not run", async () => {
    const opened = await openConsole("/next");
    const page = await (await opened.get("/")).text();

    expect((await readShell(page)).boot).toMatchObject({ base: "/next", email: opened.base.owner, version: "1.0.0", demo: { reset: "/reset" } });
  });

  // Drift: a page asked for without a session would be drawn, or the login would lose the address to come back to.
  test("sends a visitor without a session to the login, to come back to the same address", async () => {
    const opened = await openConsole("/next");
    const response = await opened.getLoggedOut("/sites/a-site?q=x");

    expect(response.status).toBe(302);
    expect(response.headers.get("Location")).toBe("https://poplin.example.com/login?return=%2Fnext%2Fsites%2Fa-site%3Fq%3Dx");
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
  // Drift: the login page's visitor could not load the files, a name the build did not write would answer something, or every page load would ask the host for the whole script again.
  test("are answered without a session for a browser to keep for good, and a file that is not there is 404", async () => {
    const opened = await openConsole("/next");
    const script = await opened.getLoggedOut("/assets/app-4f1c.js");

    expect([script.status, script.headers.get("Content-Type"), await script.text()]).toEqual([200, "text/javascript; charset=utf-8", "// the client"]);
    expect(script.headers.get("Cache-Control")).toBe("public, max-age=31536000, immutable");
    expect((await opened.getLoggedOut("/assets/other.js")).status).toBe(404);
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
    for (const site of all.sites) await database.changeDetails(site.id, { title: "\u0000" }, { by: opened.base.owner, at: opened.base.clock.now });

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

  // Drift: data would be read without a session, or the client would be sent a login page where it expects JSON.
  test("answer 401 in JSON without a session", async () => {
    const opened = await openConsole();
    const response = await opened.getLoggedOut("/data/sites");

    expect(response.status).toBe(401);
    expect(await response.json()).toMatchObject({ ok: false, code: "no_session" });
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

  // Drift: a page of another origin could change a site with the owner's session: a form is all it can send without this origin's leave.
  test.each([
    ["a form from another site", { "Content-Type": "application/x-www-form-urlencoded", Origin: "https://evil.example", "Sec-Fetch-Site": "cross-site" }, 403],
    ["plain text from another site", { "Content-Type": "text/plain", Origin: "https://evil.example", "Sec-Fetch-Site": "cross-site" }, 403],
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

  // Drift: a change without a session would be done.
  test("without a session answers 401 and changes nothing", async () => {
    const opened = await openConsole();
    const site = await opened.base.publish("first-name", "private");
    const response = await opened.change(`/data/sites/${site.name}--${site.id}/naming`, { name: "second-name" }, { Cookie: "" });

    const listed = (await (await opened.get("/data/sites")).json()) as Listed;

    expect(response.status).toBe(401);
    expect(listed.sites.map((entry) => entry.name)).toEqual(["first-name"]);
  });
});
