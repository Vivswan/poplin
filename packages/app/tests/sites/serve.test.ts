import { beforeAll, describe, expect, test } from "bun:test";
import type { Site } from "@poplin/core/src/records/site";
import { serveSite } from "../../src/sites/serve";
import { type Install, labelHost, NOW, openInstall, typedHost } from "./support/install";

const HTML = "text/html; charset=utf-8";
const SCRIPT = "text/javascript";
const LONGEST_NAME = "a".repeat(999);
const BINARY_SIZE = 1_000_000;
const BINARY = new Uint8Array(BINARY_SIZE).map((_byte, at) => (at * 31 + (at >> 8)) % 256);
const SAME_SITE_IMAGE = { "Sec-Fetch-Site": "same-site", "Sec-Fetch-Mode": "no-cors", "Sec-Fetch-Dest": "image" };
const CROSS_SITE_SUBREQUEST = { "Sec-Fetch-Site": "cross-site", "Sec-Fetch-Mode": "no-cors", "Sec-Fetch-Dest": "image" };

const PLAIN_HEADERS = {
  "cache-control": "no-store",
  "content-security-policy": "frame-ancestors 'none'",
  "referrer-policy": "no-referrer",
  "strict-transport-security": "max-age=15552000",
  "x-content-type-options": "nosniff",
  "x-robots-tag": "noindex",
};

const MISSING_ID = "000000000000";
const HOMES = ["hidden home", "report home", "shop home", "", "", ""];

const NOT_FOUND = { status: 404, body: "Not found\n", headers: { ...PLAIN_HEADERS, "content-type": "text/plain; charset=utf-8" } };
const NO_FILE = { ...NOT_FOUND, headers: { ...NOT_FOUND.headers, "cache-control": "public, max-age=86400" } };

const HARDENING = { "accept-ranges": "bytes", "referrer-policy": "no-referrer", "strict-transport-security": "max-age=15552000", "x-content-type-options": "nosniff" };
const BLOCKING = { "content-security-policy": "frame-ancestors https://*.example.com", vary: "Sec-Fetch-Site, Sec-Fetch-Mode, Sec-Fetch-Dest, Origin, Referer" };
const SITE_HEADERS = { ...HARDENING, ...BLOCKING, "x-robots-tag": "noindex" };

/** The sites every case asks for. */
interface World {
  readonly install: Install;
  readonly report: Site;
  readonly secret: Site;
  readonly shop: Site;
  readonly sealed: Site;
  readonly trashed: Site;
  readonly expired: Site;
}

type Serving = Install["serving"];
type Typed = "p" | "u" | "no letter";
type Outcome = "file" | "to p" | "to u" | "404";
type Ask = (world: World) => Request;

let world: World;

function ask(host: string, path: string, headers: Record<string, string> = {}, method = "GET"): Request {
  return new Request(`https://${host}${path}`, { method, headers });
}

function withProof(world: World, extra: Record<string, string> = {}): Record<string, string> {
  return { ...world.install.ownerProof, ...extra };
}

async function whole(response: Response): Promise<{ status: number; body: string; headers: Record<string, string> }> {
  return { status: response.status, body: await response.text(), headers: Object.fromEntries([...response.headers].sort()) };
}

/** The headers of a file answer without the two that differ per object. */
function fixedHeaders(response: Response): Record<string, string> {
  const headers = Object.fromEntries([...response.headers].sort());
  delete headers.etag;
  delete headers["content-length"];

  return headers;
}

function prefixOf(site: Site): string {
  return `${site.folder}/v${site.live_version}/`;
}

async function buildWorld(): Promise<World> {
  const install = await openInstall();

  const report = await install.publish({
    name: "report",
    access: "unlisted",
    files: {
      "index.html": ["report home", HTML],
      "about.html": ["about page", HTML],
      "docs/index.html": ["docs folder", HTML],
      "notes/index.html": ["notes folder", HTML],
      "blog.html": ["blog page", HTML],
      "blog/index.html": ["blog folder", HTML],
      "app.js": ["let a = 1;", SCRIPT],
      "data.bin": [BINARY, "application/octet-stream"],
      LICENSE: ["license terms", "text/plain"],
      terms: ["terms file", "text/plain"],
      "terms.html": ["terms page", HTML],
      "digits.txt": ["0123456789", "text/plain"],
      "padded.html": ["padded page", " text/html "],
      "split.txt": ["split file", "text/plain\nx-added: yes"],
      [`${LONGEST_NAME}.html`]: ["longest page", HTML],
    },
  });
  const secret = await install.publish({ name: "secret", access: "private", files: { "index.html": ["hidden home", HTML], "app.js": ["let b = 2;", SCRIPT] } });
  const shop = await install.publish({ name: "shop", access: "public", search_engines: true, files: { "index.html": ["shop home", HTML] } });
  const sealed = await install.publish({ name: "sealed", access: "unlisted", embeddable: false, files: { "index.html": ["sealed home", HTML] } });
  const trashed = await install.publish({ name: "trashed", access: "unlisted", files: { "index.html": ["trashed home", HTML] } });
  const expired = await install.publish({ name: "expired", access: "unlisted", expires: NOW - 1, files: { "index.html": ["expired home", HTML] } });
  await install.database.trashSite(trashed.id, { by: install.owner, at: NOW });

  return { install, report, secret, shop, sealed, trashed, expired };
}

function serve(request: Request, changes: Partial<Serving> = {}): Promise<Response> {
  return serveSite(request, { ...world.install.serving, ...changes });
}

function settingsWith(changes: Partial<Serving["settings"]>): Partial<Serving> {
  return { settings: { ...world.install.serving.settings, ...changes } };
}

beforeAll(async () => {
  world = await buildWorld();
});

describe("methods", () => {
  // Drift: a site would start answering writes or preflights, and a script of another origin would get a say.
  test.each(["POST", "PUT", "PATCH", "DELETE", "OPTIONS"])("%s is refused with 405 and the allowed methods, on a site and on no site alike", async (method) => {
    const onSite = await whole(await serve(ask(labelHost(world.report), "/", {}, method)));
    const onNone = await whole(await serve(ask("elsewhere.example.com", "/", {}, method)));
    const refusal = { status: 405, body: "Method not allowed\n", headers: { ...PLAIN_HEADERS, allow: "GET, HEAD", "content-type": "text/plain; charset=utf-8" } };

    expect([onSite, onNone]).toEqual([refusal, refusal]);
  });

  // Drift: a HEAD would carry the page, or cost a body read from the bucket.
  test("HEAD sends the headers of the file and no body, and never opens the object", async () => {
    const before = world.install.bodies.length;
    const response = await serve(ask(labelHost(world.report), "/about", {}, "HEAD"));

    expect({ ...(await whole(response)), opened: world.install.bodies.length - before }).toEqual({
      status: 200,
      body: "",
      headers: { ...SITE_HEADERS, "cache-control": "public, max-age=300, must-revalidate", "content-length": "10", "content-type": HTML, etag: expect.stringMatching(/^"v1-[0-9a-z]+"$/) },
      opened: 0,
    });
  });

  // Drift: a refusal to a HEAD would carry a body, which HTTP forbids.
  test("HEAD of nothing is the 404 without its body", async () => {
    expect(await whole(await serve(ask(labelHost(world.report), "/nothing.txt", {}, "HEAD")))).toEqual({ ...NO_FILE, body: "" });
  });
});

describe("not found", () => {
  const cases: readonly (readonly [string, Ask])[] = [
    ["a hostname outside the domain", () => ask("report-page.example.org", "/")],
    ["a hostname without the marker", () => ask("report.example.com", "/")],
    ["the domain itself", () => ask("example.com", "/")],
    ["a label that is no name", () => ask("a_b-page.example.com", "/")],
    ["a hostname one level deeper", (w) => ask(`www.${labelHost(w.report)}`, "/")],
    ["a public name no site holds", () => ask("nobody-page.example.com", "/")],
    ["the public name of a site that is not public", () => ask("report-page.example.com", "/")],
    ["a missing file of a private site, asked by the owner", (w) => ask(labelHost(w.secret), "/nothing.txt", withProof(w))],
  ];

  // Drift: one cause would get its own status, header, or wording, and a visitor could tell a private site from no site.
  test.each(cases)("%s answers the one 404", async (_why, request) => {
    expect(await whole(await serve(request(world)))).toEqual(NOT_FOUND);
  });
});

describe("a missing file", () => {
  const cases: readonly (readonly [string, Ask, string])[] = [
    ["an unlisted site", (w) => ask(labelHost(w.report), "/favicon.ico"), "public, max-age=86400"],
    ["an unlisted site, as a page", (w) => ask(labelHost(w.report), "/nothing"), "public, max-age=86400"],
    ["a public site at its public name", () => ask("shop-page.example.com", "/favicon.ico"), "public, max-age=86400"],
    ["a private site, under p with the owner's proof", (w) => ask(labelHost(w.secret), "/favicon.ico", withProof(w)), "no-store"],
  ];

  // Drift: a browser would ask the Worker for a missing icon on every page view, or would keep a 404 past the day a file was published in, or a 404 under p would be kept at all.
  test.each(cases)("of %s is the 404 with the cache rule %3$s", async (_why, request, cache) => {
    expect(await whole(await serve(request(world)))).toEqual({ ...NOT_FOUND, headers: { ...NOT_FOUND.headers, "cache-control": cache } });
  });
});

describe("access", () => {
  // The six outcomes of a row stand for the record states: private, unlisted, public, missing, trashed, expired.
  const table: readonly (readonly [Typed, boolean, readonly Outcome[]])[] = [
    ["u", false, ["to p", "file", "file", "to p", "to p", "to p"]],
    ["u", true, ["to p", "file", "file", "to p", "to p", "to p"]],
    ["no letter", false, ["to p", "file", "file", "to p", "to p", "to p"]],
    ["no letter", true, ["to p", "file", "file", "to p", "to p", "to p"]],
    ["p", false, ["404", "404", "404", "404", "404", "404"]],
    ["p", true, ["file", "to u", "to u", "404", "404", "404"]],
  ];

  // Drift: a private site's bytes would go out under the open letter or without the login's proof, a redirect would tell a real private id from a made-up one, or a name before the id would start to matter.
  test.each(table)("under %s, with the owner's proof %p, the six record states answer %j, whatever name is typed", async (letter, proven, outcomes) => {
    const sites = [world.secret, world.report, world.shop, { id: MISSING_ID, name: "nobody" }, world.trashed, world.expired];
    const names = (site: (typeof sites)[number]): (string | undefined)[] => [site.name, "other", undefined];
    const asked = sites.flatMap((site, at) => names(site).map((name) => ({ typed: { id: site.id, ...(name === undefined ? {} : { name }) }, outcome: outcomes[at] ?? "404", home: HOMES[at] ?? "" })));
    const before = world.install.keys.length;

    for (const { typed, outcome, home } of asked) {
      const response = await serve(ask(typedHost(typed, letter === "no letter" ? undefined : letter), "/index.html?x=1", proven ? world.install.ownerProof : {}));
      const moved = (to: "p" | "u"): unknown => ({ status: 302, body: "", headers: { ...PLAIN_HEADERS, location: `https://${typedHost(typed, to)}/index.html?x=1` } });
      const answers = { file: { status: 200, body: home }, "to p": moved("p"), "to u": moved("u"), "404": NOT_FOUND };
      const answered = await whole(response);

      expect<unknown>([typed, outcome === "file" ? { status: answered.status, body: answered.body } : answered]).toEqual([typed, answers[outcome]]);
    }

    expect(world.install.keys.length - before).toBe(asked.filter(({ outcome }) => outcome === "file").length);
  });

  // Drift: a request that came around the login would cost a database query, and a flood of them would be paid for by the install.
  test("under p, a request without the proof is refused before anything is looked up", async () => {
    const asked: unknown[] = [];
    const database = { findServed: async (address: unknown) => void asked.push(address) };

    expect([(await serve(ask(typedHost(world.secret, "p"), "/"), { database: database as never })).status, asked]).toEqual([404, []]);
  });

  // Drift: a redirect would drop the page or the query a link named, or carry a second slash into another host.
  test.each([
    ["/docs/page.html?x=1&y=%2F", "/docs/page.html?x=1&y=%2F"],
    ["//evil.example/", "//evil.example/"],
    ["/a\\b?q=a\\b", "/a/b?q=a\\b"],
  ])("a redirect to the other letter keeps the path and the query: %s", async (path, kept) => {
    const response = await serve(ask(typedHost(world.secret, "u"), path));

    expect([response.status, response.headers.get("Location")]).toEqual([302, `https://${labelHost(world.secret)}${kept}`]);
  });

  const open: readonly (readonly [string, Ask, string])[] = [
    ["an unlisted site at its label", (w) => ask(labelHost(w.report), "/"), "report home"],
    ["a public site at its label", (w) => ask(labelHost(w.shop), "/"), "shop home"],
    ["a public site at its public name", () => ask("shop-page.example.com", "/"), "shop home"],
  ];

  // Drift: a shared link would start asking for a login, or a public site would lose one of its two addresses.
  test.each(open)("%s opens without a session", async (_why, request, body) => {
    const response = await serve(request(world));

    expect([response.status, await response.text()]).toEqual([200, body]);
  });

  // Drift: a leaked address would keep working after the owner asked for a new one.
  test("after a new id the old address is gone and the new one serves", async () => {
    const install = await openInstall();
    const before = await install.publish({ name: "moved", access: "unlisted", files: { "index.html": ["moved home", HTML] } });
    const changed = await install.database.giveNewId(before.id, { by: install.owner, at: NOW });
    if (changed.kind !== "done") throw new Error(`the id did not change: ${changed.kind}`);

    const old = await serveSite(ask(typedHost(before, "p"), "/", install.ownerProof), install.serving);
    const fresh = await serveSite(ask(labelHost(changed.site), "/"), install.serving);

    expect([await whole(old), fresh.status, await fresh.text()]).toEqual([NOT_FOUND, 200, "moved home"]);
  });

  // Drift: a rename is promised to break no link; an address that compared the name it carries would lose every label sent out before the rename.
  test("after a rename the address with the old name still serves, and so does the one with the new name", async () => {
    const install = await openInstall();
    const before = await install.publish({ name: "drafts", access: "unlisted", files: { "index.html": ["renamed home", HTML] } });
    const changed = await install.database.changeDetails(before.id, { name: "notes" as Site["name"] }, { by: install.owner, at: NOW });
    if (changed.kind !== "done") throw new Error(`the name did not change: ${changed.kind}`);

    const old = await serveSite(ask(labelHost(before), "/"), install.serving);
    const fresh = await serveSite(ask(labelHost(changed.site), "/"), install.serving);

    expect([old.status, await old.text(), fresh.status, await fresh.text()]).toEqual([200, "renamed home", 200, "renamed home"]);
  });
});

describe("paths", () => {
  const found: readonly (readonly [string, readonly string[], string])[] = [
    ["/", ["index.html"], "report home"],
    ["/docs/", ["docs/index.html"], "docs folder"],
    ["/index.html", ["index.html"], "report home"],
    ["/app.js", ["app.js"], "let a = 1;"],
    ["/about", ["about", "about.html"], "about page"],
    ["/about.html", ["about.html"], "about page"],
    ["/notes", ["notes", "notes.html", "notes/index.html"], "notes folder"],
    ["/LICENSE", ["LICENSE"], "license terms"],
    ["/terms", ["terms"], "terms file"],
    ["/terms.html", ["terms.html"], "terms page"],
    ["/blog", ["blog", "blog.html"], "blog page"],
    ["/blog/", ["blog/index.html"], "blog folder"],
    ["/docs/index", ["docs/index", "docs/index.html"], "docs folder"],
    ["/app.js?v=2", ["app.js"], "let a = 1;"],
    ["/%61bout", ["about", "about.html"], "about page"],
    ["/docs/%2e%2e/app.js", ["app.js"], "let a = 1;"],
    [`/${LONGEST_NAME}`, [LONGEST_NAME, `${LONGEST_NAME}.html`], "longest page"],
  ];

  // Drift: a clean URL would cost a redirect hop or a fourth bucket read, a file without an extension would be unreachable, or the order (the exact file, the page, the folder) would change.
  test.each(found)("%s is answered at once from the keys %j", async (path, keys, body) => {
    const before = world.install.keys.length;
    const response = await serve(ask(labelHost(world.report), path));

    expect({ status: response.status, body: await response.text(), keys: world.install.keys.slice(before) }).toEqual({
      status: 200,
      body,
      keys: keys.map((key) => `${prefixOf(world.report)}${key}`),
    });
  });

  const missing: readonly (readonly [string, readonly string[]])[] = [
    ["/nothing", ["nothing", "nothing.html", "nothing/index.html"]],
    ["/nothing.txt", ["nothing.txt"]],
    ["/nothing/", ["nothing/index.html"]],
  ];

  // Drift: a miss would cost more reads than the published bound, three for a path without an extension and one otherwise.
  test.each(missing)("%s is the 404 after reading only %j", async (path, keys) => {
    const before = world.install.keys.length;
    const response = await serve(ask(labelHost(world.report), path));

    expect({ ...(await whole(response)), keys: world.install.keys.slice(before) }).toEqual({ ...NO_FILE, keys: keys.map((key) => `${prefixOf(world.report)}${key}`) });
  });

  const hostile: readonly (readonly [string, (w: World) => string])[] = [
    ["an encoded slash climbing out", (w) => `/..%2f..%2f${prefixOf(w.secret)}index.html`],
    ["an encoded slash inside a segment", () => "/docs%2findex.html"],
    ["a twice-encoded dot segment", (w) => `/%252e%252e/%252e%252e/${prefixOf(w.secret)}index.html`],
    ["a twice-encoded dot", () => "/%252e/index.html"],
    ["an encoded backslash climbing out", (w) => `/..%5c..%5c${w.secret.folder}%5cv1%5cindex.html`],
    ["an encoded backslash", () => "/docs%5cindex.html"],
    ["an empty segment", () => "/docs//index.html"],
    ["a leading empty segment", () => "//index.html"],
    ["a control character", () => "/app%00.js"],
    ["a line break", () => "/app%0a.js"],
    ["a malformed escape", () => "/app%zz.js"],
    ["a lone percent sign", () => "/100%"],
    ["bytes that are not UTF-8", () => "/%c0%ae%c0%ae/index.html"],
    ["text that is not normalized", () => "/e%CC%81.html"],
    ["a key past the store's limit", () => `/${"a".repeat(1100)}.html`],
  ];

  // Drift: a path could name a key the store would refuse or resolve into another site's folder.
  test.each(hostile)("%s is the 404 without a bucket read", async (_why, path) => {
    const before = world.install.keys.length;
    const response = await serve(ask(labelHost(world.report), path(world)));

    expect({ ...(await whole(response)), keys: world.install.keys.slice(before) }).toEqual({ ...NO_FILE, keys: [] });
  });

  const climbing: readonly (readonly [string, (w: World) => string])[] = [
    ["dot segments", (w) => `/../../${prefixOf(w.secret)}index.html`],
    ["encoded dot segments", (w) => `/%2e%2e/%2E%2E/${prefixOf(w.secret)}index.html`],
    ["half-encoded dot segments", (w) => `/.%2e/%2e./${prefixOf(w.secret)}index.html`],
    ["a backslash, which a URL reads as a slash", (w) => `/..\\..\\${prefixOf(w.secret)}index.html`],
  ];

  // Drift: a path a URL parser resolves would reach another site's folder: it must stay a path under this site's own live version.
  test.each(climbing)("%s aimed at another site's folder read only this site's folder and find nothing", async (_why, path) => {
    const before = world.install.keys.length;
    const response = await serve(ask(labelHost(world.report), path(world)));
    const keys = world.install.keys.slice(before);

    expect({ ...(await whole(response)), outside: keys.filter((key) => !key.startsWith(prefixOf(world.report))), reads: keys.length }).toEqual({ ...NO_FILE, outside: [], reads: 1 });
  });
});

describe("ranges and validators", () => {
  const ranges: readonly (readonly [string, number, string, string | null])[] = [
    ["bytes=0-3", 206, "0123", "bytes 0-3/10"],
    ["bytes=7-", 206, "789", "bytes 7-9/10"],
    ["bytes=-3", 206, "789", "bytes 7-9/10"],
    ["bytes=0-", 206, "0123456789", "bytes 0-9/10"],
    ["bytes=4-99999999999999999999", 206, "456789", "bytes 4-9/10"],
    ["bytes=10-", 416, "Range not satisfiable\n", "bytes */10"],
    ["bytes=-0", 416, "Range not satisfiable\n", "bytes */10"],
    ["bytes=0-1,4-5", 200, "0123456789", null],
    ["bytes=5-2", 200, "0123456789", null],
    ["items=0-3", 200, "0123456789", null],
    ["bytes=", 200, "0123456789", null],
  ];

  // Drift: a resumed download or a media seek would get the wrong bytes, or a list of ranges would get a multipart body nobody wrote.
  test.each(ranges)("Range: %s answers %d", async (range, status, body, contentRange) => {
    const response = await serve(ask(labelHost(world.report), "/digits.txt", { Range: range }));

    expect([response.status, response.headers.get("Content-Range"), response.headers.get("Accept-Ranges"), await response.text()]).toEqual([
      status,
      contentRange,
      status === 416 ? null : "bytes",
      body,
    ]);
  });

  // Drift: a range checked against a validator nobody compared would splice two versions of a file together.
  test("a range sent with If-Range gets the whole file", async () => {
    const response = await serve(ask(labelHost(world.report), "/digits.txt", { Range: "bytes=0-3", "If-Range": '"another"' }));

    expect([response.status, await response.text()]).toEqual([200, "0123456789"]);
  });

  const validators: readonly (readonly [string, (etag: string) => string, number])[] = [
    ["the file's own tag", (etag) => etag, 304],
    ["its weak form", (etag) => `W/${etag}`, 304],
    ["a list holding it", (etag) => `"other", ${etag}`, 304],
    ["the wildcard", () => "*", 304],
    ["another tag", () => '"other"', 200],
    ["the tag without its quotes", (etag) => etag.slice(1, -1), 200],
  ];

  // Drift: a browser's revalidation would download the file again, or a stale copy would be confirmed.
  test.each(validators)("If-None-Match with %s answers as the validator says", async (_why, header, status) => {
    const host = labelHost(world.report);
    const first = await serve(ask(host, "/app.js"));
    const etag = first.headers.get("ETag") ?? "";
    const again = await serve(ask(host, "/app.js", { "If-None-Match": header(etag) }));
    const head = await serve(ask(host, "/app.js", { "If-None-Match": header(etag) }, "HEAD"));

    expect([again.status, head.status, await again.text()]).toEqual([status, status, status === 304 ? "" : "let a = 1;"]);
  });

  // Drift: a 304 would drop the cache rule or the validator, and the browser would keep the stale ones.
  test("a 304 carries the headers of the file and no body", async () => {
    const host = labelHost(world.report);
    const etag = (await serve(ask(host, "/app.js"))).headers.get("ETag") ?? "";

    expect(await whole(await serve(ask(host, "/app.js", { "If-None-Match": etag })))).toEqual({
      status: 304,
      body: "",
      headers: { ...SITE_HEADERS, "cache-control": "public, max-age=86400", "content-type": SCRIPT, etag },
    });
  });
});

describe("a page and the version it was published in", () => {
  /** A request for the report's home page that holds the given tag, as a browser sends one back. */
  const holding = (tag: string, method = "GET"): Request => ask(labelHost(world.report), "/", { "If-None-Match": tag }, method);

  /** The tag of the report's live version, as its home page carries it. */
  const liveTag = async (): Promise<string> => (await serve(ask(labelHost(world.report), "/"))).headers.get("ETag") ?? "";

  // Drift: a page would carry the tag of its file, and an unchanged page would cost a read of the bucket on every revalidation.
  test("every page of a site carries one tag, a file carries its own, and a first visit is told to drop nothing", async () => {
    const answers = await Promise.all(["/", "/about", "/docs/", "/app.js"].map((path) => serve(ask(labelHost(world.report), path))));
    const [home, about, docs, script] = answers.map((answer) => answer.headers.get("ETag"));

    expect<unknown>([home, about === home, docs === home, script === home, answers.map((answer) => answer.headers.get("Clear-Site-Data"))]).toEqual([
      expect.stringMatching(/^"v1-[0-9a-z]+"$/),
      true,
      true,
      false,
      [null, null, null, null],
    ]);
  });

  // Drift: a revalidation would read the bucket, or its 304 would overwrite the kept page's content type, drop its cache rule, or tell the browser to drop its files.
  test.each(["GET", "HEAD"])("a %s that holds the live version's tag gets the 304 with the page's headers, no content type, and no read of the bucket", async (method) => {
    const tag = await liveTag();
    const before = world.install.keys.length;
    const answers = [await serve(holding(tag, method)), await serve(holding(`W/${tag}`, method)), await serve(holding(`"other", ${tag}`, method))];
    const kept = { ...BLOCKING, "referrer-policy": "no-referrer", "strict-transport-security": "max-age=15552000", "x-content-type-options": "nosniff", "x-robots-tag": "noindex" };
    const unchanged = { status: 304, body: "", headers: { ...kept, "cache-control": "public, max-age=300, must-revalidate", etag: tag } };

    expect({ answers: await Promise.all(answers.map(whole)), reads: world.install.keys.length - before }).toEqual({ answers: [unchanged, unchanged, unchanged], reads: 0 });
  });

  const others: readonly (readonly [string, string])[] = [
    ["an older version", '"v0-lx2a"'],
    ["a newer version, as after a rollback", '"v2-zzzzzzzz"'],
    ["the same number published at another moment, as after an import", '"v1-1"'],
    ["another version in its weak form", 'W/"v7-abc"'],
    ["another version beside a tag that is no version", '"memory-1", "v7-abc"'],
  ];

  // Drift: a visitor who holds an older page would keep that version's styles and scripts for a day beside the new page.
  test.each(others)("a request that holds the tag of %s gets the page again and is told to drop its cached files", async (_what, tag) => {
    const response = await serve(holding(tag));

    expect([response.status, response.headers.get("Clear-Site-Data"), response.headers.get("ETag"), await response.text()]).toEqual([200, '"cache"', await liveTag(), "report home"]);
  });

  const quiet: readonly (readonly [string, Ask])[] = [
    ["a tag that is no version", () => holding('"memory-1"')],
    ["a version without its quotes", () => holding("v0-lx2a")],
    ["a HEAD that holds another version", () => holding('"v0-lx2a"', "HEAD")],
    ["a file asked for with another version's tag", (w) => ask(labelHost(w.report), "/app.js", { "If-None-Match": '"v0-lx2a"' })],
    ["a part of a page asked for with another version's tag", (w) => ask(labelHost(w.report), "/", { "If-None-Match": '"v0-lx2a"', Range: "bytes=0-3" })],
    ["a missing file asked for with another version's tag", (w) => ask(labelHost(w.report), "/nothing.txt", { "If-None-Match": '"v0-lx2a"' })],
    ["a private site's address under the open letter", (w) => ask(typedHost(w.secret, "u"), "/", { "If-None-Match": '"v0-lx2a"' })],
  ];

  // Drift: the signal would go out on an answer that brings no page, and a browser would empty its cache on every image, or for a site it may not open.
  test.each(quiet)("%s is told to drop nothing", async (_what, request) => {
    const response = await serve(request(world));
    await response.body?.cancel();

    expect(response.headers.get("Clear-Site-Data")).toBeNull();
  });

  // Drift: a private site would lose the signal or the 304, and its owner would see old styles beside a new page or pay a bucket read on every open.
  test("a private site's page answers the same two ways under p: the 304 for the live tag, and the page with the signal for another", async () => {
    const page = (tag?: string): Request => ask(labelHost(world.secret), "/", withProof(world, tag === undefined ? {} : { "If-None-Match": tag }));
    const tag = (await serve(page())).headers.get("ETag") ?? "";
    const before = world.install.keys.length;
    const same = await serve(page(tag));
    const reads = world.install.keys.length - before;
    const other = await serve(page('"v0-lx2a"'));

    expect([same.status, same.headers.get("Cache-Control"), reads, other.status, other.headers.get("Clear-Site-Data"), other.headers.get("Cache-Control")]).toEqual([304, "private, no-cache", 0, 200, '"cache"', "private, no-cache"]);
  });

  // Drift: a tag made from the version's number alone would call a version gone back to, or a site imported again, unchanged.
  test("the tag changes when another version goes live and when the same number was published at another moment", async () => {
    const [first] = world.report.versions;
    if (first === undefined) throw new Error("the test's site has no version");

    const as = (changes: Partial<Site>): Partial<Serving> => ({ database: { findServed: async () => ({ ...world.report, ...changes }) as Site } });
    const records = [{}, { live_version: 2, versions: [first, { ...first, number: 2 }] }, { versions: [{ ...first, published_at: first.published_at + 1 }] }];
    const tags = await Promise.all(records.map(async (changes) => (await serve(holding('"none"', "HEAD"), as(changes))).headers.get("ETag")));

    expect(new Set(tags).size).toBe(3);
  });
});

describe("headers", () => {
  const cases: readonly (readonly [string, Ask, Partial<Serving["settings"]>, Record<string, string>])[] = [
    ["an unlisted page", (w) => ask(labelHost(w.report), "/"), {}, { ...SITE_HEADERS, "cache-control": "public, max-age=300, must-revalidate", "content-type": HTML }],
    ["an unlisted file", (w) => ask(labelHost(w.report), "/app.js"), {}, { ...SITE_HEADERS, "cache-control": "public, max-age=86400", "content-type": SCRIPT }],
    ["a private page", (w) => ask(labelHost(w.secret), "/", withProof(w)), {}, { ...SITE_HEADERS, "cache-control": "private, no-cache", "content-type": HTML }],
    ["a private file", (w) => ask(labelHost(w.secret), "/app.js", withProof(w)), {}, { ...SITE_HEADERS, "cache-control": "private, max-age=86400", "content-type": SCRIPT }],
    [
      "a public page that search engines may list, on an install that lets them in",
      () => ask("shop-page.example.com", "/"),
      { search_engines_allowed: true },
      { ...HARDENING, ...BLOCKING, "cache-control": "public, max-age=300, must-revalidate", "content-type": HTML },
    ],
    [
      "a public page that asks for search engines, on an install that keeps them out",
      () => ask("shop-page.example.com", "/"),
      {},
      { ...SITE_HEADERS, "cache-control": "public, max-age=300, must-revalidate", "content-type": HTML },
    ],
    [
      "an unlisted page, on an install that lets search engines in",
      (w) => ask(labelHost(w.report), "/"),
      { search_engines_allowed: true },
      { ...SITE_HEADERS, "cache-control": "public, max-age=300, must-revalidate", "content-type": HTML },
    ],
    [
      "a page of a site that may not be framed",
      (w) => ask(labelHost(w.sealed), "/"),
      {},
      { ...SITE_HEADERS, "cache-control": "public, max-age=300, must-revalidate", "content-security-policy": "frame-ancestors 'none'", "content-type": HTML },
    ],
    [
      "a page while outside pages are allowed",
      (w) => ask(labelHost(w.report), "/"),
      { outside_pages: "allowed" },
      { ...HARDENING, "cache-control": "public, max-age=300, must-revalidate", "content-type": HTML, "x-robots-tag": "noindex" },
    ],
    [
      "a page that may not be framed while outside pages are allowed",
      (w) => ask(labelHost(w.sealed), "/"),
      { outside_pages: "allowed" },
      { ...HARDENING, "cache-control": "public, max-age=300, must-revalidate", "content-security-policy": "frame-ancestors 'none'", "content-type": HTML, "x-robots-tag": "noindex" },
    ],
    ["a page without an extension in its address", (w) => ask(labelHost(w.report), "/about"), {}, { ...SITE_HEADERS, "cache-control": "public, max-age=300, must-revalidate", "content-type": HTML }],
    ["a page whose stored type has spaces around it", (w) => ask(labelHost(w.report), "/padded.html"), {}, { ...SITE_HEADERS, "cache-control": "public, max-age=300, must-revalidate", "content-type": "text/html" }],
    ["a file whose stored type no header can carry", (w) => ask(labelHost(w.report), "/split.txt"), {}, { ...SITE_HEADERS, "cache-control": "public, max-age=86400", "content-type": "application/octet-stream" }],
    ["a file without an extension, under its stored type", (w) => ask(labelHost(w.report), "/LICENSE"), {}, { ...SITE_HEADERS, "cache-control": "public, max-age=86400", "content-type": "text/plain" }],
  ];

  // Drift: a header would go missing or a new one appear: a page framed from outside, a private file kept by a shared cache, an unlisted site indexed, a script of another origin let in, or a first visit told to drop its cache.
  test.each(cases)("%s goes out with exactly its headers", async (_why, request, settings, headers) => {
    const response = await serve(request(world), settingsWith(settings));

    expect([response.status, fixedHeaders(response)]).toEqual([200, headers]);
  });
});

describe("other pages", () => {
  const requests: readonly (readonly [string, Record<string, string>, number, number])[] = [
    ["another site's image", { "Sec-Fetch-Site": "cross-site", "Sec-Fetch-Mode": "no-cors", "Sec-Fetch-Dest": "image" }, 403, 200],
    ["another site's script", { "Sec-Fetch-Site": "cross-site", "Sec-Fetch-Mode": "no-cors", "Sec-Fetch-Dest": "script" }, 403, 200],
    ["another site's fetch", { "Sec-Fetch-Site": "cross-site", "Sec-Fetch-Mode": "cors", "Sec-Fetch-Dest": "empty" }, 403, 200],
    ["another site's frame", { "Sec-Fetch-Site": "cross-site", "Sec-Fetch-Mode": "navigate", "Sec-Fetch-Dest": "iframe" }, 403, 200],
    ["a cross-site request that names no mode", { "Sec-Fetch-Site": "cross-site" }, 403, 200],
    ["a link followed from another site", { "Sec-Fetch-Site": "cross-site", "Sec-Fetch-Mode": "navigate", "Sec-Fetch-Dest": "document" }, 200, 200],
    ["a file of the same site", { "Sec-Fetch-Site": "same-origin", "Sec-Fetch-Mode": "no-cors", "Sec-Fetch-Dest": "image" }, 200, 200],
    ["another site of the install, which sends no referrer", SAME_SITE_IMAGE, 200, 200],
    ["another site of the install that names itself", { ...SAME_SITE_IMAGE, Origin: "https://shop-page.example.com" }, 200, 200],
    ["another site of the install, by its referrer", { ...SAME_SITE_IMAGE, Referer: "https://shop-page.example.com/" }, 200, 200],
    ["a page of the domain that is no site, by its referrer", { ...SAME_SITE_IMAGE, Referer: "https://www.example.com/page" }, 403, 200],
    ["a page of the domain that is no site, by its origin", { ...SAME_SITE_IMAGE, Origin: "https://www.example.com" }, 403, 200],
    ["the dashboard's hostname", { ...SAME_SITE_IMAGE, Origin: "https://poplin.example.com" }, 403, 200],
    ["a hostname that only ends like a site", { ...SAME_SITE_IMAGE, Origin: "https://homepage.example.com" }, 403, 200],
    ["a frame in a page of the domain that is no site", { "Sec-Fetch-Site": "same-site", "Sec-Fetch-Mode": "navigate", "Sec-Fetch-Dest": "iframe", Referer: "https://www.example.com/" }, 403, 200],
    ["an origin that names a site beside a referrer that does not", { ...SAME_SITE_IMAGE, Origin: "https://shop-page.example.com", Referer: "https://www.example.com/" }, 200, 200],
    ["an opaque origin with no referrer", { ...SAME_SITE_IMAGE, Origin: "null" }, 200, 200],
    ["an opaque origin beside a referrer that is no site", { ...SAME_SITE_IMAGE, Origin: "null", Referer: "https://www.example.com/" }, 403, 200],
    ["a link followed from a page of the domain that is no site", { "Sec-Fetch-Site": "same-site", "Sec-Fetch-Mode": "navigate", "Sec-Fetch-Dest": "document", Referer: "https://www.example.com/" }, 200, 200],
    ["a file of the same site with a referrer from elsewhere", { "Sec-Fetch-Site": "same-origin", "Sec-Fetch-Mode": "no-cors", "Sec-Fetch-Dest": "image", Referer: "https://www.example.com/" }, 200, 200],
    ["an address typed by hand", { "Sec-Fetch-Site": "none", "Sec-Fetch-Mode": "navigate", "Sec-Fetch-Dest": "document" }, 200, 200],
    ["a client that sends no such header", {}, 200, 200],
  ];

  // Drift: a page outside the install would load a site's files while the owner has them blocked, or the owner's own visit would be refused.
  test.each(requests)("%s answers by the outside_pages setting", async (_why, headers, blocked, allowed) => {
    const request = (): Request => ask(labelHost(world.report), "/app.js", headers);

    expect([(await serve(request())).status, (await serve(request(), settingsWith({ outside_pages: "allowed" }))).status]).toEqual([blocked, allowed]);
  });

  // Drift: the refusal would tell a private or missing site from an open one, or cost a query.
  test("the refusal is the same for every site address, and reads nothing", async () => {
    const before = world.install.keys.length;
    const refusal = { status: 403, body: "Forbidden\n", headers: { ...PLAIN_HEADERS, "content-type": "text/plain; charset=utf-8" } };
    const hosts = [labelHost(world.report), typedHost(world.secret, "u"), typedHost({ id: MISSING_ID, name: "secret" }, "u"), "shop-page.example.com"];
    const answers = await Promise.all(hosts.map(async (host) => whole(await serve(ask(host, "/", CROSS_SITE_SUBREQUEST)))));

    expect({ answers, reads: world.install.keys.length - before }).toEqual({ answers: hosts.map(() => refusal), reads: 0 });
  });
});

describe("the body", () => {
  // Drift: the handler would start buffering, decoding, or rewriting a site's files instead of handing the store's bytes on.
  test("a large binary file goes out as the very stream the store gave", async () => {
    const before = world.install.bodies.length;
    const response = await serve(ask(labelHost(world.report), "/data.bin"));
    const handedOut = world.install.bodies.slice(before);
    const same = response.body === handedOut[0];
    const bytes = new Uint8Array(await response.arrayBuffer());

    expect({ streams: handedOut.length, same, length: response.headers.get("Content-Length"), equal: Buffer.compare(bytes, BINARY) === 0 }).toEqual({
      streams: 1,
      same: true,
      length: String(BINARY_SIZE),
      equal: true,
    });
  });

  // Drift: a 304 would leave the object's stream open, holding the store's connection.
  test("a body that is not sent is cancelled, not left open", async () => {
    const host = labelHost(world.report);
    const etag = (await serve(ask(host, "/data.bin"))).headers.get("ETag") ?? "";
    const before = world.install.bodies.length;
    await serve(ask(host, "/data.bin", { "If-None-Match": etag }));
    const [unsent] = world.install.bodies.slice(before);

    expect(await unsent?.getReader().read()).toEqual({ done: true, value: undefined });
  });
});
