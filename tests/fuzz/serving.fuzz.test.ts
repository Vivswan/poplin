// A visitor chooses the hostname, the path, and every header: the serving handler must answer each of them without throwing, without reading outside the addressed site's live version, and without showing a private site to a stranger.

import { expect } from "bun:test";
import fc from "fast-check";

import { serveSite } from "../../packages/app/src/sites/serve";
import { labelHost, NOW, openInstall } from "../../packages/app/tests/sites/support/install";
import { fuzzTarget } from "./config";
import { hostile } from "./hostile";

const HTML = "text/html; charset=utf-8";
const FILES = { LICENSE: ["terms", "text/plain"], "index.html": ["home", HTML], "about.html": ["about", HTML], "docs/index.html": ["docs", HTML], "app.js": ["let a = 1;", "text/javascript"] } as const;
const ANSWERS = [200, 206, 302, 304, 403, 404, 405, 416];
const SHOWN = [200, 206, 304, 416];
const MAX_READS = 3;
const LOGIN = "https://admin.example.com/login?return=";
const METHODS = ["GET", "GET", "GET", "HEAD", "POST", "OPTIONS", "DELETE"];
const FETCH_SITES = ["cross-site", "same-site", "same-origin", "none", "CROSS-SITE", ""];
const FETCH_MODES = ["navigate", "no-cors", "cors", "same-origin", "websocket"];
const FETCH_DESTS = ["document", "iframe", "image", "script", "empty", "style"];
const OUTSIDE_PAGES = ["https://www.example.com/", "https://admin.example.com/sites"];
const OWN_PAGES = ["https://shop-page.example.com", "https://gallery-page.example.com/"];
const NO_ADDRESSES = ["null", "", "//", "not a url"];
const REQUESTERS = [...OUTSIDE_PAGES, ...OWN_PAGES, ...NO_ADDRESSES];
const RANGES = ["bytes=0-1", "bytes=2-", "bytes=-1", "bytes=9-", "bytes=0-0,2-3", "bytes=-0", "bytes=5-2", "items=0-1", "bytes=99999999999999999999-", "bytes=0-99999999999999999999"];
const VALIDATORS = ["*", '"memory-1"', 'W/"memory-2", "memory-3"', '"other"', ",,,"];

const property = fuzzTarget(import.meta.file);

const install = await openInstall();
const unlisted = await install.publish({ name: "report", access: "unlisted", files: FILES });
const hidden = await install.publish({ name: "secret", access: "private", files: FILES });
const shown = await install.publish({ name: "shop", access: "public", files: FILES });
const trashed = await install.publish({ name: "trashed", access: "unlisted", files: FILES });
await install.database.trashSite(trashed.id, { by: install.owner, at: NOW });

const SITES = [unlisted, hidden, shown, trashed];
const BY_HOST = new Map([...SITES.map((site) => [labelHost(site), site] as const), ["shop-page.example.com", shown] as const]);
const PREFIXES = SITES.map((site) => `${site.folder}/v${site.live_version}/`);

const knownHosts = fc.constantFrom(...BY_HOST.keys(), "gallery-page.example.com", "admin.example.com", "example.com", "report-page.example.com", "secret--000000000000-page.example.com");
const hosts = fc.oneof({ arbitrary: knownHosts, weight: 3 }, { arbitrary: hostile(knownHosts), weight: 2 });
const climbs = fc.array(fc.constantFrom("..", "%2e%2e", ".%2E", "..%2f", "..%5c", "%252e%252e", ".", "", "docs"), { maxLength: 6 }).map((parts) => parts.join("/"));
const targets = fc.constantFrom(...Object.keys(FILES), "about", "docs", "docs/", "", ...PREFIXES.map((prefix) => `${prefix}index.html`));
const plainPaths = fc.tuple(climbs, targets).map(([climb, target]) => `/${climb}/${target}`.replace("//", "/"));
const paths = fc.oneof({ arbitrary: plainPaths, weight: 2 }, { arbitrary: targets.map((target) => `/${target}`), weight: 2 }, { arbitrary: hostile(plainPaths), weight: 3 });

const headers = fc.record(
  {
    Cookie: fc.constantFrom(install.ownerCookie, `${install.ownerCookie}x`, "__Secure-poplin-session=", "theme=dark"),
    "Sec-Fetch-Site": fc.constantFrom(...FETCH_SITES),
    "Sec-Fetch-Mode": fc.constantFrom(...FETCH_MODES),
    "Sec-Fetch-Dest": fc.constantFrom(...FETCH_DESTS),
    Origin: fc.constantFrom(...REQUESTERS),
    Referer: fc.constantFrom(...REQUESTERS),
    Range: fc.constantFrom(...RANGES),
    "If-Range": fc.constantFrom(...VALIDATORS),
    "If-None-Match": fc.constantFrom(...VALIDATORS),
  },
  { requiredKeys: [] },
);

const settings = fc.record({
  cache_html: fc.record({ count: fc.constantFrom(0, 60), unit: fc.constantFrom("s" as const, "d" as const) }),
  cache_files: fc.oneof(fc.constant("off" as const), fc.record({ count: fc.constantFrom(1, 7), unit: fc.constantFrom("h" as const, "m" as const) })),
  outside_pages: fc.constantFrom("blocked" as const, "allowed" as const),
});

// The page a same-site request names: its origin, or its referrer when the origin holds no address.
function isOutsideSubrequest(sent: Readonly<Record<string, string>>): boolean {
  if (sent["Sec-Fetch-Mode"] === "navigate" && sent["Sec-Fetch-Dest"] === "document") return false;

  if (sent["Sec-Fetch-Site"] === "cross-site") return true;

  const requester = [sent.Origin, sent.Referer].find((page) => page !== undefined && !NO_ADDRESSES.includes(page));

  return sent["Sec-Fetch-Site"] === "same-site" && requester !== undefined && OUTSIDE_PAGES.includes(requester);
}

property(
  "any hostname, path, and headers get one of the published answers, read only the addressed site, and never show a private site or a blocked subrequest",
  fc.asyncProperty(hosts, paths, fc.constantFrom(...METHODS), headers, settings, async (host, path, method, sent, chosen) => {
    const address = `https://${host}${path}`;
    fc.pre(URL.canParse(address));

    const site = BY_HOST.get(new URL(address).hostname);
    const prefix = site === undefined ? "no site, so no read" : `${site.folder}/v${site.live_version}/`;
    const before = install.keys.length;
    const response = await serveSite(new Request(address, { method, headers: sent }), { ...install.serving, settings: chosen });
    await response.body?.cancel();

    const keys = install.keys.slice(before);
    const stranger = sent.Cookie !== install.ownerCookie;
    const facts = {
      published: ANSWERS.includes(response.status),
      outside: keys.filter((key) => !key.startsWith(prefix)),
      reads: keys.length <= MAX_READS,
      redirectIsLogin: response.status !== 302 || (response.headers.get("Location") ?? "").startsWith(LOGIN),
      privateShown: site?.access === "private" && stranger && SHOWN.includes(response.status),
      trashShown: site?.state === "trash" && SHOWN.includes(response.status),
      strangerRead: site?.access === "private" && stranger && keys.length > 0,
      blockedShown: chosen.outside_pages === "blocked" && isOutsideSubrequest(sent) && SHOWN.includes(response.status),
      crossOriginOpened: [...response.headers.keys()].some((name) => name.startsWith("access-control-")),
    };

    expect(facts).toEqual({ published: true, outside: [], reads: true, redirectIsLogin: true, privateShown: false, trashShown: false, strangerRead: false, blockedShown: false, crossOriginOpened: false });
  }),
);
