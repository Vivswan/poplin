// Anyone can send the admin hostname any method, path, headers, and body: the dashboard must answer each without throwing or failing, show nothing without a session, and change nothing unless a logged-in page of its own sent the form.
//
// The paths that would do a change name their site by its public name: that stays a reference through a new link, so they keep working for the whole run.

import { expect } from "bun:test";
import fc from "fast-check";

import { LOGIN, ORIGIN, openDashboard } from "../../packages/app/tests/dashboard/support/install";
import { fuzzTarget } from "./config";
import { hostile } from "./hostile";

const ANSWERS = [200, 302, 303, 400, 403, 404, 405, 413, 415];
const METHODS = ["GET", "HEAD", "POST", "POST", "POST", "POST", "POST", "PUT", "DELETE", "OPTIONS"];
const FORM = "application/x-www-form-urlencoded";
const TYPES = [FORM, FORM, FORM, FORM, FORM, `${FORM}; charset=utf-8`, "multipart/form-data; boundary=x", "text/plain", "application/json", ""];
const ORIGINS = [ORIGIN, ORIGIN, ORIGIN, ORIGIN, ORIGIN, ORIGIN, ORIGIN, "https://evil.example.com", "https://shop-page.example.com", "null", "", "https://poplin.example.com:444", "HTTPS://POPLIN.EXAMPLE.COM"];
const FETCH_SITES = ["same-origin", "same-origin", "same-origin", "same-origin", "same-origin", "same-site", "cross-site", "none", ""];
const CHANGES = ["settings", "rollback", "new-link", "delete", "restore", "delete-forever", "constructor", "__proto__", ""];

const property = fuzzTarget(import.meta.file);

const opened = await openDashboard();
const report = await opened.publish("report");
const shop = await opened.publish("shop", "public");
const old = await opened.publish("old");
await opened.install.database.trashSite(old.id, { by: opened.owner, at: opened.clock.now });

const LABELS = [`report--${report.id}`, `shop--${shop.id}`, `old--${old.id}`, "shop", report.id, "report--000000000000", "nope"];
const token = await opened.token();
const signingKey = await opened.install.database.readSigningKey();

const knownPaths = fc.oneof(
  fc.constantFrom("/", "/?view=trash", "/settings", "/activity", "/usage", "/settings/save", "/settings/sign-everyone-out", "/login", "/api/sites", "/?after=1-000000000000", "/activity?before=3", "/?done=saved&refused=x&about=y"),
  fc.constantFrom(...LABELS).map((label) => `/sites/${label}`),
  fc.tuple(fc.constantFrom(...LABELS), fc.constantFrom(...CHANGES)).map(([label, change]) => `/sites/${label}/${change}`),
);
const changePaths = fc.constantFrom("/sites/shop/new-link", "/sites/shop/delete", "/sites/shop/restore", "/settings/sign-everyone-out");
const paths = fc.oneof({ arbitrary: changePaths, weight: 3 }, { arbitrary: knownPaths, weight: 3 }, { arbitrary: hostile(knownPaths), weight: 2 });
const cookies = fc.constantFrom(opened.cookie, opened.cookie, opened.cookie, opened.cookie, opened.cookie, opened.cookie, `${opened.cookie}x`, "__Secure-poplin-session=", "theme=dark", undefined);
const tokens = fc.oneof(
  { arbitrary: fc.constant(token), weight: 3 },
  { arbitrary: hostile(fc.constant(token)), weight: 2 },
  { arbitrary: fc.constantFrom("", "0.0", `1.${"0".repeat(64)}`, undefined), weight: 1 },
);
const words = fc.constantFrom("private", "unlisted", "public", "previous", "1", "2", "yes", "on", "off", "never", "7d", "2030-01-01", "9GB", "50GB", "docs", "gallery", ...LABELS);
const values = fc.oneof({ arbitrary: words, weight: 3 }, { arbitrary: hostile(words), weight: 1 }, { arbitrary: fc.string(), weight: 1 });
const fields = fc.dictionary(
  fc.constantFrom("access", "public_name", "title", "search_engines", "embeddable", "expires", "version", "confirm", "trash_days", "logins", "max_total_size", "dashboard_title", "csrf", "other"),
  values,
  { maxKeys: 6 },
);

/** Everything a change could touch, as text. */
async function stored(): Promise<string> {
  const { database } = opened.install;
  const state = [
    await database.listSites({ trash: false, limit: 100 }),
    await database.listSites({ trash: true, limit: 100 }),
    await database.readSettings(),
    Array.from((await database.readSigningKey()) ?? []),
    (await database.listAudit({ limit: 1 }))[0]?.seq,
  ];

  return JSON.stringify(state);
}

const requests = fc.record({
  path: paths,
  method: fc.constantFrom(...METHODS),
  cookie: cookies,
  origin: fc.constantFrom(...ORIGINS),
  fetchSite: fc.constantFrom(...FETCH_SITES),
  type: fc.constantFrom(...TYPES),
  csrf: tokens,
  sent: fields,
});

function requestOf(asked: typeof requests extends fc.Arbitrary<infer Asked> ? Asked : never): Request {
  const headers = new Headers({ Origin: asked.origin, "Sec-Fetch-Site": asked.fetchSite, "Content-Type": asked.type });
  if (asked.cookie !== undefined) headers.set("Cookie", asked.cookie);

  const form = new URLSearchParams(asked.sent);
  if (asked.csrf !== undefined) form.set("csrf", asked.csrf);

  const body = asked.method === "GET" || asked.method === "HEAD" ? undefined : form.toString();

  return new Request(`${ORIGIN}${asked.path}`, { method: asked.method, headers, body });
}

function isLoginRedirect(response: Response, page: string): boolean {
  return page === "" && [302, 303].includes(response.status) && (response.headers.get("Location") ?? "").startsWith(LOGIN);
}

function isGuarded(response: Response): boolean {
  const policy = response.headers.get("Content-Security-Policy") ?? "";

  return response.headers.get("X-Frame-Options") === "DENY" && response.headers.get("Cache-Control") === "no-store" && policy.startsWith("default-src 'none'");
}

property(
  "any request gets a published answer, a page only with a session, and a change only from a logged-in same-origin form with its token",
  fc.asyncProperty(requests, async (asked) => {
    const address = `${ORIGIN}${asked.path}`;
    fc.pre(URL.canParse(address) && new URL(address).origin === ORIGIN);

    // Whether the request carries the owner's session is decided here, apart from anything the dashboard answers: the cookie is the minted one and the owner is still a login.
    const logins = (await opened.install.database.readSettings())?.logins ?? [];
    const loggedIn = asked.cookie === opened.cookie && logins.includes(opened.owner);
    const fromOwnPage = asked.method === "POST" && asked.origin === ORIGIN && asked.fetchSite === "same-origin" && asked.type.startsWith(FORM) && asked.csrf === token;
    const before = await stored();
    const response = await opened.fetch(requestOf(asked));
    const page = await response.text();
    const after = await stored();

    const facts = {
      published: ANSWERS.includes(response.status),
      shownToStranger: !loggedIn && !isLoginRedirect(response, page),
      changedUnasked: !(loggedIn && fromOwnPage) && after !== before,
      guarded: isGuarded(response),
      script: /<script|href="javascript:/i.test(page),
    };

    expect(facts).toEqual({ published: true, shownToStranger: false, changedUnasked: false, guarded: true, script: false });

    // A sign-out that was rightly done would end the session of every later run, so the key the cookie was signed with goes back.
    const key = await opened.install.database.readSigningKey();
    if (signingKey !== undefined && String(key) !== String(signingKey)) await opened.install.database.rotateSigningKey(signingKey, { by: opened.owner, at: opened.clock.now });
  }),
);
