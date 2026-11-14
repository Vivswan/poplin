import { beforeAll, describe, expect, test } from "bun:test";
import type { Site } from "@poplin/core/src/records/site";
import { serveSite } from "../../src/sites/serve";
import { type Install, labelHost, NOW, openInstall } from "./support/install";

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
  "x-content-type-options": "nosniff",
  "x-robots-tag": "noindex",
};

const NOT_FOUND = { status: 404, body: "Not found\n", headers: { ...PLAIN_HEADERS, "content-type": "text/plain; charset=utf-8" } };

const HARDENING = { "accept-ranges": "bytes", "referrer-policy": "no-referrer", "x-content-type-options": "nosniff" };
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
type Ask = (world: World) => Request;

let world: World;

function ask(host: string, path: string, headers: Record<string, string> = {}, method = "GET"): Request {
  return new Request(`https://${host}${path}`, { method, headers });
}

function withCookie(world: World, extra: Record<string, string> = {}): Record<string, string> {
  return { Cookie: world.install.ownerCookie, ...extra };
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
      headers: { ...SITE_HEADERS, "cache-control": "public, max-age=60", "content-length": "10", "content-type": HTML, etag: expect.stringMatching(/^"[^"]+"$/) },
      opened: 0,
    });
  });

  // Drift: a refusal to a HEAD would carry a body, which HTTP forbids.
  test("HEAD of nothing is the 404 without its body", async () => {
    expect(await whole(await serve(ask(labelHost(world.report), "/nothing.txt", {}, "HEAD")))).toEqual({ ...NOT_FOUND, body: "" });
  });
});

describe("not found", () => {
  const cases: readonly (readonly [string, Ask])[] = [
    ["a hostname outside the domain", () => ask("report-page.example.org", "/")],
    ["a hostname without the suffix", () => ask("report.example.com", "/")],
    ["the domain itself", () => ask("example.com", "/")],
    ["a label that is no name", () => ask("a_b-page.example.com", "/")],
    ["a hostname one level deeper", (w) => ask(`www.${labelHost(w.report)}`, "/")],
    ["a public name no site holds", () => ask("nobody-page.example.com", "/")],
    ["the public name of a site that is not public", () => ask("report-page.example.com", "/")],
    ["the gallery with no handler", () => ask("gallery-page.example.com", "/")],
    ["an id no site has, asked by the owner", (w) => ask("report--000000000000-page.example.com", "/", withCookie(w))],
    ["another name before a real id, asked by the owner", (w) => ask(`other--${w.report.id}-page.example.com`, "/", withCookie(w))],
    ["another name before a private id, asked by the owner", (w) => ask(`other--${w.secret.id}-page.example.com`, "/", withCookie(w))],
    ["a site in the trash, asked by the owner", (w) => ask(labelHost(w.trashed), "/", withCookie(w))],
    ["a site past its expiry, asked by the owner", (w) => ask(labelHost(w.expired), "/", withCookie(w))],
    ["a missing file of an unlisted site", (w) => ask(labelHost(w.report), "/nothing.txt")],
    ["a missing page of an unlisted site", (w) => ask(labelHost(w.report), "/nothing")],
    ["a missing file of a private site, asked by the owner", (w) => ask(labelHost(w.secret), "/nothing.txt", withCookie(w))],
    ["a missing file of a public site at its public name", () => ask("shop-page.example.com", "/nothing.txt")],
  ];

  // Drift: one cause would get its own status, header, or wording, and a visitor could tell a private site from no site.
  test.each(cases)("%s answers the one 404", async (_why, request) => {
    expect(await whole(await serve(request(world)))).toEqual(NOT_FOUND);
  });
});

describe("access", () => {
  const strangers: readonly (readonly [string, (w: World) => string, string, Record<string, string>])[] = [
    ["a private site", (w) => labelHost(w.secret), "/", {}],
    ["a private site's file", (w) => labelHost(w.secret), "/app.js", {}],
    ["a private site's missing file", (w) => labelHost(w.secret), "/nothing.txt?x=1", {}],
    ["an id no site has", () => "secret--000000000000-page.example.com", "/", {}],
    ["another name before a private id", (w) => `other--${w.secret.id}-page.example.com`, "/", {}],
    ["a site in the trash", (w) => labelHost(w.trashed), "/", {}],
    ["a site past its expiry", (w) => labelHost(w.expired), "/", {}],
    ["a private site with a cookie nobody signed", (w) => labelHost(w.secret), "/", { Cookie: "__Secure-poplin-session=b3duZXJAZXhhbXBsZS5jb20.1700000000000.AAAA" }],
  ];

  // Drift: a stranger could tell a real private id from a made-up one, or the redirect would name a place the request chose.
  test.each(strangers)("without a session, %s answers only the login redirect back to the address asked for", async (_why, host, path, headers) => {
    const hostname = host(world);
    const before = world.install.keys.length;
    const response = await serve(ask(hostname, path, headers));

    expect({ ...(await whole(response)), reads: world.install.keys.length - before }).toEqual({
      status: 302,
      body: "",
      headers: { ...PLAIN_HEADERS, location: `https://admin.example.com/login?return=${encodeURIComponent(`https://${hostname}${path}`)}` },
      reads: 0,
    });
  });

  // Drift: the login would set a cookie that never reaches a site hostname, and every private site would bounce forever.
  test("the cookie the login mints for the parent domain opens a private site", async () => {
    const response = await serve(ask(labelHost(world.secret), "/", { Cookie: `theme=dark; ${world.install.ownerCookie}` }));

    expect(world.install.setCookie).toEndWith("; Domain=example.com");
    expect({ ...(await whole(response)), headers: fixedHeaders(response) }).toEqual({
      status: 200,
      body: "hidden home",
      headers: { ...SITE_HEADERS, "cache-control": "private, no-cache", "content-type": HTML },
    });
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

    const old = await serveSite(ask(labelHost(before), "/", { Cookie: install.ownerCookie }), install.serving);
    const fresh = await serveSite(ask(labelHost(changed.site), "/"), install.serving);

    expect([await whole(old), fresh.status, await fresh.text()]).toEqual([NOT_FOUND, 200, "moved home"]);
  });

  // Drift: the gallery's hostname would be read as a public name, or its handler would be skipped.
  test("the gallery's hostname goes to the handler it was given", async () => {
    const response = await serve(ask("gallery-page.example.com", "/"), { gallery: async () => new Response("the gallery") });

    expect(await response.text()).toBe("the gallery");
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

    expect({ ...(await whole(response)), keys: world.install.keys.slice(before) }).toEqual({ ...NOT_FOUND, keys: keys.map((key) => `${prefixOf(world.report)}${key}`) });
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

    expect({ ...(await whole(response)), keys: world.install.keys.slice(before) }).toEqual({ ...NOT_FOUND, keys: [] });
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

    expect({ ...(await whole(response)), outside: keys.filter((key) => !key.startsWith(prefixOf(world.report))), reads: keys.length }).toEqual({ ...NOT_FOUND, outside: [], reads: 1 });
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
      headers: { ...SITE_HEADERS, "cache-control": "public, max-age=3600", "content-type": SCRIPT, etag },
    });
  });
});

describe("headers", () => {
  const cases: readonly (readonly [string, Ask, Partial<Serving["settings"]>, Record<string, string>])[] = [
    ["an unlisted page", (w) => ask(labelHost(w.report), "/"), {}, { ...SITE_HEADERS, "cache-control": "public, max-age=60", "content-type": HTML }],
    ["an unlisted file", (w) => ask(labelHost(w.report), "/app.js"), {}, { ...SITE_HEADERS, "cache-control": "public, max-age=3600", "content-type": SCRIPT }],
    ["a private page", (w) => ask(labelHost(w.secret), "/", withCookie(w)), {}, { ...SITE_HEADERS, "cache-control": "private, no-cache", "content-type": HTML }],
    ["a private file", (w) => ask(labelHost(w.secret), "/app.js", withCookie(w)), {}, { ...SITE_HEADERS, "cache-control": "private, no-cache", "content-type": SCRIPT }],
    [
      "a public page that search engines may list",
      () => ask("shop-page.example.com", "/"),
      {},
      { ...HARDENING, ...BLOCKING, "cache-control": "public, max-age=60", "content-type": HTML },
    ],
    [
      "a page of a site that may not be framed",
      (w) => ask(labelHost(w.sealed), "/"),
      {},
      { ...SITE_HEADERS, "cache-control": "public, max-age=60", "content-security-policy": "frame-ancestors 'none'", "content-type": HTML },
    ],
    [
      "a page while outside pages are allowed",
      (w) => ask(labelHost(w.report), "/"),
      { outside_pages: "allowed" },
      { ...HARDENING, "cache-control": "public, max-age=60", "content-type": HTML, "x-robots-tag": "noindex" },
    ],
    [
      "a page that may not be framed while outside pages are allowed",
      (w) => ask(labelHost(w.sealed), "/"),
      { outside_pages: "allowed" },
      { ...HARDENING, "cache-control": "public, max-age=60", "content-security-policy": "frame-ancestors 'none'", "content-type": HTML, "x-robots-tag": "noindex" },
    ],
    ["a page with the HTML cache off", (w) => ask(labelHost(w.report), "/"), { cache_html: { count: 0, unit: "s" } }, { ...SITE_HEADERS, "cache-control": "no-store", "content-type": HTML }],
    ["a page whose stored type has spaces around it", (w) => ask(labelHost(w.report), "/padded.html"), { cache_html: { count: 0, unit: "s" } }, { ...SITE_HEADERS, "cache-control": "no-store", "content-type": "text/html" }],
    ["a file whose stored type no header can carry", (w) => ask(labelHost(w.report), "/split.txt"), {}, { ...SITE_HEADERS, "cache-control": "public, max-age=3600", "content-type": "application/octet-stream" }],
    ["a file without an extension, under its stored type", (w) => ask(labelHost(w.report), "/LICENSE"), {}, { ...SITE_HEADERS, "cache-control": "public, max-age=3600", "content-type": "text/plain" }],
    ["a file with the file cache off", (w) => ask(labelHost(w.report), "/app.js"), { cache_files: "off" }, { ...SITE_HEADERS, "cache-control": "no-store", "content-type": SCRIPT }],
    ["a file cached for days", (w) => ask(labelHost(w.report), "/app.js"), { cache_files: { count: 2, unit: "d" } }, { ...SITE_HEADERS, "cache-control": "public, max-age=172800", "content-type": SCRIPT }],
    ["a private page with every cache off", (w) => ask(labelHost(w.secret), "/", withCookie(w)), { cache_html: { count: 0, unit: "s" }, cache_files: "off" }, { ...SITE_HEADERS, "cache-control": "private, no-cache", "content-type": HTML }],
  ];

  // Drift: a header would go missing or a new one appear: a page framed from outside, a private file kept by a shared cache, an unlisted site indexed, or a script of another origin let in.
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
    ["the gallery of the install", { ...SAME_SITE_IMAGE, Referer: "https://gallery-page.example.com/" }, 200, 200],
    ["a page of the domain that is no site, by its referrer", { ...SAME_SITE_IMAGE, Referer: "https://www.example.com/page" }, 403, 200],
    ["a page of the domain that is no site, by its origin", { ...SAME_SITE_IMAGE, Origin: "https://www.example.com" }, 403, 200],
    ["the dashboard's hostname", { ...SAME_SITE_IMAGE, Origin: "https://admin.example.com" }, 403, 200],
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
    const hosts = [labelHost(world.report), labelHost(world.secret), "secret--000000000000-page.example.com", "shop-page.example.com", "gallery-page.example.com"];
    const gallery = async (): Promise<Response> => new Response("the gallery");
    const answers = await Promise.all(hosts.map(async (host) => whole(await serve(ask(host, "/", withCookie(world, CROSS_SITE_SUBREQUEST)), { gallery }))));

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
