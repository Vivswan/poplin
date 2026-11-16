// A visitor chooses the hostname, the path, and every header. The serving handler must answer each of them without throwing and without reading outside the addressed site's live version.
// It must never show a private site under the open letter or to a request the login does not vouch for.
// Every property runs under each address layout: what holds where a site has a hostname of its own must hold where it is a path.

import { expect } from "bun:test";
import fc from "fast-check";

import { parseRange } from "../../packages/app/src/sites/range";
import { MOST_STORE_CALLS, serveSite } from "../../packages/app/src/sites/serve";
import { NOW, openInstall, typedAt, typedHost } from "../../packages/app/tests/sites/support/install";
import { ADDRESSES, PATH_ADDRESSES } from "../../packages/app/tests/sites/support/layout";
import { fuzzTarget } from "./config";
import { hostile } from "./hostile";

const HTML = "text/html; charset=utf-8";
const FILES = { LICENSE: ["terms", "text/plain"], "index.html": ["home", HTML], "about.html": ["about", HTML], "docs/index.html": ["docs", HTML], "app.js": ["let a = 1;", "text/javascript"] } as const;
const ANSWERS = [200, 206, 302, 304, 403, 404, 405, 416];
const SHOWN = [200, 206, 304, 416];
const FILE_ANSWERS = [200, 206, 304];
const AROUND_LOGIN = [404, 405];
const MISSING_ID = "000000000000";
const TYPED_NAMES = ["other", "abc", "a-b-c", "zzz9"];
const METHODS = ["GET", "GET", "GET", "HEAD", "POST", "OPTIONS", "DELETE"];
const FETCH_SITES = ["cross-site", "same-site", "same-origin", "none", "CROSS-SITE", ""];
const FETCH_MODES = ["navigate", "no-cors", "cors", "same-origin", "websocket"];
const FETCH_DESTS = ["document", "iframe", "image", "script", "empty", "style"];
const NO_ADDRESSES = ["null", "", "//", "not a url"];
const RANGES = ["bytes=0-1", "bytes=2-", "bytes=-1", "bytes=9-", "bytes=0-0,2-3", "bytes=-0", "bytes=5-2", "items=0-1", "bytes=99999999999999999999-", "bytes=0-99999999999999999999"];
const VALIDATORS = ["*", '"memory-1"', 'W/"memory-2", "memory-3"', '"other"', ",,,", '"v0-1"', 'W/"v9-zz"', '"memory-1", "v2-abc"', "v1-abc"];
const VERSION_TAG = /^"v[0-9]+-[0-9a-z]+"$/;

/** One layout to run every property under. `typed` and `others` write addresses without a scheme and with nothing after what names the site; `outside` and `own` are pages a request may name as its requester. */
interface Bench {
  readonly layout: string;
  readonly addresses: typeof ADDRESSES;
  readonly letters: readonly ("p" | "u" | undefined)[];
  readonly typed: (typed: { readonly id: string; readonly name?: string }, letter: "p" | "u" | undefined) => string;
  readonly others: readonly string[];
  readonly outside: readonly string[];
  readonly own: readonly string[];
}

const BENCHES: readonly Bench[] = [
  {
    layout: "the hostname layout",
    addresses: ADDRESSES,
    letters: ["p", "u", undefined],
    typed: typedHost,
    others: ["shop-page.example.com", "docs-page.example.com", "poplin.example.com", "example.com", "report-page.example.com"],
    outside: ["https://www.example.com/", "https://poplin.example.com/sites"],
    own: ["https://shop-page.example.com", "https://docs-page.example.com/"],
  },
  {
    layout: "the path layout",
    addresses: PATH_ADDRESSES,
    letters: ["p", "u"],
    typed: (typed, letter) => typedAt(PATH_ADDRESSES, typed, letter ?? "u"),
    others: ["poplin-sites.example.net/shop", "poplin-sites.example.net/docs", "poplin-sites.example.net/report", "poplin-private.example.net/shop", "poplin.example.net/shop", "poplin-sites.example.net", "example.net/report"],
    outside: ["https://www.example.net/", "https://poplin.example.net/sites"],
    own: ["https://poplin-sites.example.net", "https://poplin-private.example.net/docs/"],
  },
];

const property = fuzzTarget(import.meta.file);

/** Register every property of the target under one layout, over an install of its own. */
async function registerUnder(bench: Bench): Promise<void> {
  const under: typeof property = (name, checked) => property(`${name}, under ${bench.layout}`, checked);
  const install = await openInstall(bench.addresses);
  const { addresses } = install.serving;
  const REQUESTERS = [...bench.outside, ...bench.own, ...NO_ADDRESSES];
  const unlisted = await install.publish({ name: "report", access: "unlisted", files: FILES });
  const hidden = await install.publish({ name: "secret", access: "private", files: FILES });
  const shown = await install.publish({ name: "shop", access: "public", files: FILES });
  const trashed = await install.publish({ name: "trashed", access: "unlisted", files: FILES });
  const loose = await install.publish({ name: "loose", access: "unlisted", files: { ...FILES, "404.html": ["lost", HTML] }, unlisted_files: true });
  const guided = await install.publish({ name: "guided", access: "unlisted", files: { ...FILES, "404.html": ["lost", HTML] } });
  const expired = await install.publish({ name: "expired", access: "unlisted", expires: NOW - 1, files: FILES });
  const sealed = await install.publish({ name: "sealed", access: "unlisted", embeddable: false, files: { ...FILES, "404.html": ["lost", HTML] } });
  const locked = await install.publish({ name: "locked", access: "private", embeddable: false, files: FILES });
  await install.database.trashSite(trashed.id, { by: install.owner, at: NOW });

  const SITES = [unlisted, hidden, shown, trashed, expired, loose, guided, sealed, locked];
  const BY_ID = new Map(SITES.map((site) => [site.id as string, site] as const));
  const PREFIXES = SITES.map((site) => `${site.folder}/v${site.live_version}/`);
  const ALIKE_UNDER_U = [hidden.id, trashed.id, expired.id, MISSING_ID];
  const LIVE_TAGS = new Map(SITES.map((site) => [site.id as string, `"v${site.live_version}-${(site.versions[0]?.published_at ?? 0).toString(36)}"`] as const));

  const liveTags = [...LIVE_TAGS.values()];
  const validators = fc.constantFrom(...VALIDATORS, ...liveTags, ...liveTags.map((tag) => `W/${tag}`), ...liveTags.map((tag) => `"v0-1", ${tag}`));
  const ids = fc.constantFrom(...BY_ID.keys(), MISSING_ID);
  const names = fc.option(fc.constantFrom(...TYPED_NAMES, ...SITES.map((site) => site.name as string)), { nil: undefined });
  const letters = fc.constantFrom(...bench.letters);
  const typedBases = fc.tuple(ids, names, letters).map(([id, name, letter]) => bench.typed(name === undefined ? { id } : { id, name }, letter));
  const otherBases = fc.constantFrom(...bench.others);
  const knownBases = fc.oneof({ arbitrary: typedBases, weight: 4 }, { arbitrary: otherBases, weight: 1 });
  const bases = fc.oneof({ arbitrary: knownBases, weight: 3 }, { arbitrary: hostile(knownBases), weight: 2 });
  const climbs = fc.array(fc.constantFrom("..", "%2e%2e", ".%2E", "..%2f", "..%5c", "%252e%252e", ".", "", "docs"), { maxLength: 6 }).map((parts) => parts.join("/"));
  const targets = fc.constantFrom(...Object.keys(FILES), "favicon.ico", "about", "docs", "docs/", "", ...PREFIXES.map((prefix) => `${prefix}index.html`));
  const plainPaths = fc.tuple(climbs, targets).map(([climb, target]) => `/${climb}/${target}`.replace("//", "/"));
  // The empty path is an address with nothing after what names the site.
  const paths = fc.oneof({ arbitrary: plainPaths, weight: 4 }, { arbitrary: targets.map((target) => `/${target}`), weight: 4 }, { arbitrary: hostile(plainPaths), weight: 6 }, { arbitrary: fc.constant(""), weight: 1 });

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

    return sent["Sec-Fetch-Site"] === "same-site" && requester !== undefined && bench.outside.includes(requester);
  }

  // The site a request names: by its id under a label, whatever name is typed, or by its public name.
  function siteOf(url: URL): (typeof SITES)[number] | undefined {
    const address = addresses.resolve(url);
    if (address.kind === "site") return BY_ID.get(address.id);

    return address.kind === "public-name" && address.name === "shop" ? shown : undefined;
  }

  // Whether an address still names a site by an id once a path is written after it: a path that starts with no slash runs into what stands before it.
  function namesSite(address: string): boolean {
    return URL.canParse(address) && addresses.resolve(new URL(address)).kind === "site";
  }

  // Whether a redirect leads where one may: to an address that names the same site by the same typed name, with the query kept.
  // An address with nothing after what names the site moves to its own home page on its own host; any other label address moves to the other letter and keeps its path.
  function movesRight(url: URL, location: string | null): boolean {
    const from = addresses.resolve(url);
    const target = URL.parse(location ?? "");
    if (from.kind === "none" || target === null || target.search !== url.search) return false;

    const to = addresses.resolve(target);
    if (from.path === "") return target.host === url.host && Bun.deepEquals(to, { ...from, path: "/" });

    if (from.kind !== "site" || to.kind !== "site") return false;

    return to.id === from.id && to.name === from.name && to.letter === (from.letter === "p" ? "u" : "p") && to.path === from.path;
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

    return { status: response.status, headers: [...response.headers].sort(), body: await response.text(), moved: location === null ? null : movesRight(new URL(address), location) };
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
      redirectElsewhere: response.status === 302 && !movesRight(asked.url, response.headers.get("Location")),
      privateShown: site?.access === "private" && !(underLogin && vouched) && shown,
      openShownUnderLogin: site !== undefined && site.access !== "private" && underLogin && shown,
      aroundLogin: underLogin && !vouched && !(AROUND_LOGIN.includes(response.status) && keys.length === 0),
      goneShown: (site?.state === "trash" || site === expired) && SHOWN.includes(response.status),
    };
  }

  // What a browser is told to keep or drop: each fact is true when the answer breaks the cache rule.
  function cacheFacts(asked: Asked, response: Response): Record<string, boolean> {
    // A site's own 404 page is a page too, and one sent to a request for a part of a file tells it to drop nothing.
    const partAsked = !("If-Range" in asked.sent) && parseRange(asked.sent.Range ?? null) !== undefined;
    const shown = response.status === 200 || (response.status === 404 && !partAsked);
    const pageShown = asked.method === "GET" && shown && (response.headers.get("Content-Type") ?? "").startsWith("text/html");
    const signal = pageShown && holdsAnotherVersion(asked.site, asked.sent) ? '"cache"' : null;
    const tellsNothing = response.status === 302 || (response.status === 404 && (asked.site === undefined || asked.underLogin));

    return {
      signalWrong: response.headers.get("Clear-Site-Data") !== signal,
      keptWhereNothingIs: tellsNothing && response.headers.get("Cache-Control") !== "no-store",
    };
  }

  // What another origin's page may load: the rule goes out with every file of a site that is not embeddable, the site's own 404 page included, and with nothing else.
  function loadRule(asked: Asked, response: Response): string | null {
    const ownPage = response.status === 404 && (response.headers.get("Content-Type") ?? "").startsWith("text/html");
    const isFile = FILE_ANSWERS.includes(response.status) || ownPage;

    return isFile && asked.site?.embeddable === false ? "same-origin" : null;
  }

  under(
    "any hostname, path, and headers get a published answer, read only the addressed site in three calls, open no file they do not send, show no private site without the login, and clear the cache only with a page for a request that holds another version",
    fc.asyncProperty(bases, paths, fc.constantFrom(...METHODS), headers, settings, async (base, path, method, sent, chosen) => {
      const address = `https://${base}${path}`;
      fc.pre(URL.canParse(address));

      const asked = askedOf(new URL(address), method, sent);
      const prefix = asked.site === undefined ? "no site, so no read" : `${asked.site.folder}/v${asked.site.live_version}/`;
      const before = install.keys.length;
      const opened = install.bodies.length;
      const response = await serveSite(new Request(address, { method, headers: sent }), { ...install.serving, settings: chosen });
      await response.body?.cancel();

      const keys = install.keys.slice(before);
      // `loose` was made from no list of files, so nothing is known of what its version holds: a file at its third key is read before its tag is compared.
      const readsBeforeItsTag = asked.site === loose && method === "GET" && keys.length === MOST_STORE_CALLS;
      const facts = {
        published: ANSWERS.includes(response.status),
        outside: keys.filter((key) => !key.startsWith(prefix)),
        reads: keys.length <= MOST_STORE_CALLS,
        openedUnsent: (response.status === 304 || method === "HEAD") && install.bodies.length > opened && !readsBeforeItsTag,
        blockedShown: chosen.outside_pages === "blocked" && isOutsideSubrequest(sent) && SHOWN.includes(response.status),
        crossOriginOpened: [...response.headers.keys()].some((name) => name.startsWith("access-control-")),
        broken: Object.entries({ ...accessFacts(asked, response, keys), ...cacheFacts(asked, response) }).filter(([, isBroken]) => isBroken).map(([fact]) => fact),
      };

      expect(facts).toEqual({ published: true, outside: [], reads: true, openedUnsent: false, blockedShown: false, crossOriginOpened: false, broken: [] });
    }),
  );

  under(
    "every file of a site that is not embeddable, and no other answer, tells a browser to keep it out of the pages of other origins",
    fc.asyncProperty(bases, paths, fc.constantFrom(...METHODS), headers, settings, async (base, path, method, sent, chosen) => {
      const address = `https://${base}${path}`;
      fc.pre(URL.canParse(address));

      const response = await serveSite(new Request(address, { method, headers: sent }), { ...install.serving, settings: chosen });
      await response.body?.cancel();

      expect(response.headers.get("Cross-Origin-Resource-Policy")).toBe(loadRule(askedOf(new URL(address), method, sent), response));
    }),
  );

  under(
    "under the open letter or none, a private site, a site in the trash, an expired one, and no site answer alike",
    fc.asyncProperty(names, fc.constantFrom(...bench.letters.filter((letter) => letter !== "p")), requests, async (name, letter, request) => {
      const asked = ALIKE_UNDER_U.map((id) => `https://${bench.typed(name === undefined ? { id } : { id, name }, letter)}${request.path}`);
      fc.pre(asked.every(namesSite));

      const [first, ...rest] = await Promise.all(asked.map((address) => answered(address, request)));

      expect(rest).toEqual(rest.map(() => first));
    }),
  );

  under(
    "the name typed before an id changes nothing but the name in a redirect",
    fc.asyncProperty(ids, fc.tuple(names, names), letters, requests, async (id, typed, letter, request) => {
      const asked = typed.map((name) => `https://${bench.typed(name === undefined ? { id } : { id, name }, letter)}${request.path}`);
      fc.pre(asked.every(namesSite));

      const [one, other] = await Promise.all(asked.map((address) => answered(address, request)));

      expect(one).toEqual(other);
    }),
  );
}

for (const bench of BENCHES) await registerUnder(bench);
