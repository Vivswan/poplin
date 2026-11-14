// A visitor chooses the hostname, the path, and every header. The serving handler must answer each of them without throwing and without reading outside the addressed site's live version.
// It must never show a private site under the open letter or to a request the login does not vouch for.

import { expect } from "bun:test";
import fc from "fast-check";

import { serveSite } from "../../packages/app/src/sites/serve";
import { NOW, openInstall, typedHost } from "../../packages/app/tests/sites/support/install";
import { fuzzTarget } from "./config";
import { hostile } from "./hostile";

const HTML = "text/html; charset=utf-8";
const FILES = { LICENSE: ["terms", "text/plain"], "index.html": ["home", HTML], "about.html": ["about", HTML], "docs/index.html": ["docs", HTML], "app.js": ["let a = 1;", "text/javascript"] } as const;
const ANSWERS = [200, 206, 302, 304, 403, 404, 405, 416];
const SHOWN = [200, 206, 304, 416];
const MAX_READS = 3;
const AROUND_LOGIN = [404, 405];
const MISSING_ID = "000000000000";
const TYPED_NAMES = ["other", "abc", "a-b-c", "zzz9"];
const LETTERS = ["p", "u", undefined] as const;
const METHODS = ["GET", "GET", "GET", "HEAD", "POST", "OPTIONS", "DELETE"];
const FETCH_SITES = ["cross-site", "same-site", "same-origin", "none", "CROSS-SITE", ""];
const FETCH_MODES = ["navigate", "no-cors", "cors", "same-origin", "websocket"];
const FETCH_DESTS = ["document", "iframe", "image", "script", "empty", "style"];
const OUTSIDE_PAGES = ["https://www.example.com/", "https://poplin.example.com/sites"];
const OWN_PAGES = ["https://shop-page.example.com", "https://gallery-page.example.com/"];
const NO_ADDRESSES = ["null", "", "//", "not a url"];
const REQUESTERS = [...OUTSIDE_PAGES, ...OWN_PAGES, ...NO_ADDRESSES];
const RANGES = ["bytes=0-1", "bytes=2-", "bytes=-1", "bytes=9-", "bytes=0-0,2-3", "bytes=-0", "bytes=5-2", "items=0-1", "bytes=99999999999999999999-", "bytes=0-99999999999999999999"];
const VALIDATORS = ["*", '"memory-1"', 'W/"memory-2", "memory-3"', '"other"', ",,,", '"v0-1"', 'W/"v9-zz"', '"memory-1", "v2-abc"', "v1-abc"];
const VERSION_TAG = /^"v[0-9]+-[0-9a-z]+"$/;

const property = fuzzTarget(import.meta.file);

const install = await openInstall();
const unlisted = await install.publish({ name: "report", access: "unlisted", files: FILES });
const hidden = await install.publish({ name: "secret", access: "private", files: FILES });
const shown = await install.publish({ name: "shop", access: "public", files: FILES });
const trashed = await install.publish({ name: "trashed", access: "unlisted", files: FILES });
const expired = await install.publish({ name: "expired", access: "unlisted", expires: NOW - 1, files: FILES });
await install.database.trashSite(trashed.id, { by: install.owner, at: NOW });

const SITES = [unlisted, hidden, shown, trashed, expired];
const BY_ID = new Map(SITES.map((site) => [site.id as string, site] as const));
const PREFIXES = SITES.map((site) => `${site.folder}/v${site.live_version}/`);
const ALIKE_UNDER_U = [hidden.id, trashed.id, expired.id, MISSING_ID];
const { addresses } = install.serving;
const LIVE_TAGS = new Map(SITES.map((site) => [site.id as string, `"v${site.live_version}-${(site.versions[0]?.published_at ?? 0).toString(36)}"`] as const));

const liveTags = [...LIVE_TAGS.values()];
const validators = fc.constantFrom(...VALIDATORS, ...liveTags, ...liveTags.map((tag) => `W/${tag}`), ...liveTags.map((tag) => `"v0-1", ${tag}`));
const ids = fc.constantFrom(...BY_ID.keys(), MISSING_ID);
const names = fc.option(fc.constantFrom(...TYPED_NAMES, ...SITES.map((site) => site.name as string)), { nil: undefined });
const letters = fc.constantFrom(...LETTERS);
const typedHosts = fc.tuple(ids, names, letters).map(([id, name, letter]) => typedHost(name === undefined ? { id } : { id, name }, letter));
const otherHosts = fc.constantFrom("shop-page.example.com", "gallery-page.example.com", "poplin.example.com", "example.com", "report-page.example.com");
const knownHosts = fc.oneof({ arbitrary: typedHosts, weight: 4 }, { arbitrary: otherHosts, weight: 1 });
const hosts = fc.oneof({ arbitrary: knownHosts, weight: 3 }, { arbitrary: hostile(knownHosts), weight: 2 });
const climbs = fc.array(fc.constantFrom("..", "%2e%2e", ".%2E", "..%2f", "..%5c", "%252e%252e", ".", "", "docs"), { maxLength: 6 }).map((parts) => parts.join("/"));
const targets = fc.constantFrom(...Object.keys(FILES), "about", "docs", "docs/", "", ...PREFIXES.map((prefix) => `${prefix}index.html`));
const plainPaths = fc.tuple(climbs, targets).map(([climb, target]) => `/${climb}/${target}`.replace("//", "/"));
const paths = fc.oneof({ arbitrary: plainPaths, weight: 2 }, { arbitrary: targets.map((target) => `/${target}`), weight: 2 }, { arbitrary: hostile(plainPaths), weight: 3 });

const headers = fc.record(
  {
    "X-Test-Login": fc.constantFrom(install.owner as string, `${install.owner}x`, "guest@example.com", ""),
    "Sec-Fetch-Site": fc.constantFrom(...FETCH_SITES),
    "Sec-Fetch-Mode": fc.constantFrom(...FETCH_MODES),
    "Sec-Fetch-Dest": fc.constantFrom(...FETCH_DESTS),
    Origin: fc.constantFrom(...REQUESTERS),
    Referer: fc.constantFrom(...REQUESTERS),
    Range: fc.constantFrom(...RANGES),
    "If-Range": fc.constantFrom(...VALIDATORS),
    "If-None-Match": validators,
  },
  { requiredKeys: [] },
);

const settings = fc.record({ outside_pages: fc.constantFrom("blocked" as const, "allowed" as const), search_engines_allowed: fc.boolean() });

const requests = fc.record({ path: paths, method: fc.constantFrom(...METHODS), sent: headers, chosen: settings });

// The page a same-site request names: its origin, or its referrer when the origin holds no address.
function isOutsideSubrequest(sent: Readonly<Record<string, string>>): boolean {
  if (sent["Sec-Fetch-Mode"] === "navigate" && sent["Sec-Fetch-Dest"] === "document") return false;

  if (sent["Sec-Fetch-Site"] === "cross-site") return true;

  const requester = [sent.Origin, sent.Referer].find((page) => page !== undefined && !NO_ADDRESSES.includes(page));

  return sent["Sec-Fetch-Site"] === "same-site" && requester !== undefined && OUTSIDE_PAGES.includes(requester);
}

// The site a request names: by its id under a label, whatever name is typed, or by its public name.
function siteOf(url: URL): (typeof SITES)[number] | undefined {
  const address = addresses.resolve(url);
  if (address.kind === "site") return BY_ID.get(address.id);

  return address.kind === "public-name" && address.name === "shop" ? shown : undefined;
}

// Where a redirect of a label address may lead: the same typed name and id under the other letter, with the path and the query.
function otherLetter(url: URL): string | undefined {
  const address = addresses.resolve(url);
  if (address.kind !== "site") return undefined;

  return `${addresses.letterFormOf(address, address.letter === "p" ? "u" : "p")}${url.pathname}${url.search}`;
}

// Whether a request holds a page of a version of the site that is no longer live: it sent a version tag, and none it sent is the live one.
function holdsAnotherVersion(site: (typeof SITES)[number] | undefined, sent: Readonly<Record<string, string>>): boolean {
  const tags = (sent["If-None-Match"] ?? "").split(",").map((tag) => tag.trim().replace(/^W\//, ""));

  return site !== undefined && !tags.includes(LIVE_TAGS.get(site.id) ?? "") && tags.some((tag) => VERSION_TAG.test(tag));
}

async function answered(address: string, request: { readonly method: string; readonly sent: Readonly<Record<string, string>>; readonly chosen: Parameters<typeof serveSite>[1]["settings"] }): Promise<unknown> {
  const response = await serveSite(new Request(address, { method: request.method, headers: request.sent }), { ...install.serving, settings: request.chosen });
  const location = response.headers.get("Location");
  response.headers.delete("Location");

  return { status: response.status, headers: [...response.headers].sort(), body: await response.text(), moved: location === null ? null : location === otherLetter(new URL(address)) };
}

/** One request of the main property, with what the test itself knows of the address it names. */
interface Asked {
  readonly url: URL;
  readonly method: string;
  readonly sent: Readonly<Record<string, string>>;
  readonly site: (typeof SITES)[number] | undefined;
  readonly underLogin: boolean;
}

function askedOf(url: URL, method: string, sent: Readonly<Record<string, string>>): Asked {
  const resolved = addresses.resolve(url);

  return { url, method, sent, site: siteOf(url), underLogin: resolved.kind === "site" && resolved.letter === "p" };
}

// Who was shown what: each fact is true when the answer breaks the letter rule.
function accessFacts(asked: Asked, response: Response, keys: readonly string[]): Record<string, boolean> {
  const { site, underLogin } = asked;
  const vouched = asked.sent["X-Test-Login"] === install.owner;
  const shown = SHOWN.includes(response.status) || keys.length > 0;

  return {
    redirectElsewhere: response.status === 302 && response.headers.get("Location") !== otherLetter(asked.url),
    privateShown: site?.access === "private" && !(underLogin && vouched) && shown,
    openShownUnderLogin: site !== undefined && site.access !== "private" && underLogin && shown,
    aroundLogin: underLogin && !vouched && !(AROUND_LOGIN.includes(response.status) && keys.length === 0),
    goneShown: (site?.state === "trash" || site === expired) && SHOWN.includes(response.status),
  };
}

// What a browser is told to keep or drop: each fact is true when the answer breaks the cache rule.
function cacheFacts(asked: Asked, response: Response): Record<string, boolean> {
  const pageShown = asked.method === "GET" && response.status === 200 && (response.headers.get("Content-Type") ?? "").startsWith("text/html");
  const signal = pageShown && holdsAnotherVersion(asked.site, asked.sent) ? '"cache"' : null;
  const tellsNothing = response.status === 302 || (response.status === 404 && (asked.site === undefined || asked.underLogin));

  return {
    signalWrong: response.headers.get("Clear-Site-Data") !== signal,
    keptWhereNothingIs: tellsNothing && response.headers.get("Cache-Control") !== "no-store",
  };
}

property(
  "any hostname, path, and headers get a published answer, read only the addressed site, show no private site without the login, and clear the cache only with a page for a request that holds another version",
  fc.asyncProperty(hosts, paths, fc.constantFrom(...METHODS), headers, settings, async (host, path, method, sent, chosen) => {
    const address = `https://${host}${path}`;
    fc.pre(URL.canParse(address));

    const asked = askedOf(new URL(address), method, sent);
    const prefix = asked.site === undefined ? "no site, so no read" : `${asked.site.folder}/v${asked.site.live_version}/`;
    const before = install.keys.length;
    const response = await serveSite(new Request(address, { method, headers: sent }), { ...install.serving, settings: chosen });
    await response.body?.cancel();

    const keys = install.keys.slice(before);
    const facts = {
      published: ANSWERS.includes(response.status),
      outside: keys.filter((key) => !key.startsWith(prefix)),
      reads: keys.length <= MAX_READS,
      blockedShown: chosen.outside_pages === "blocked" && isOutsideSubrequest(sent) && SHOWN.includes(response.status),
      crossOriginOpened: [...response.headers.keys()].some((name) => name.startsWith("access-control-")),
      broken: Object.entries({ ...accessFacts(asked, response, keys), ...cacheFacts(asked, response) }).filter(([, isBroken]) => isBroken).map(([fact]) => fact),
    };

    expect(facts).toEqual({ published: true, outside: [], reads: true, blockedShown: false, crossOriginOpened: false, broken: [] });
  }),
);

property(
  "under the open letter or none, a private site, a site in the trash, an expired one, and no site answer alike",
  fc.asyncProperty(names, fc.constantFrom("u" as const, undefined), requests, async (name, letter, request) => {
    const asked = ALIKE_UNDER_U.map((id) => `https://${typedHost(name === undefined ? { id } : { id, name }, letter)}${request.path}`);
    fc.pre(asked.every((address) => URL.canParse(address)));

    const [first, ...rest] = await Promise.all(asked.map((address) => answered(address, request)));

    expect(rest).toEqual(rest.map(() => first));
  }),
);

property(
  "the name typed before an id changes nothing but the name in a redirect",
  fc.asyncProperty(ids, fc.tuple(names, names), letters, requests, async (id, typed, letter, request) => {
    const asked = typed.map((name) => `https://${typedHost(name === undefined ? { id } : { id, name }, letter)}${request.path}`);
    fc.pre(asked.every((address) => URL.canParse(address)));

    const [one, other] = await Promise.all(asked.map((address) => answered(address, request)));

    expect(one).toEqual(other);
  }),
);
