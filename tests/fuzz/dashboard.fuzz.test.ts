// Anyone can send the admin hostname any method, path, headers, and body: the dashboard must answer each without throwing or failing, show nothing of the install without a session, and change nothing unless a logged-in request sent the change as JSON.
//
// JSON is the whole guard of a change: a page of another origin cannot make a browser send JSON with the session unless this origin lets it, which it never does. So the property holds whatever `Origin` a request names.
// The paths that would do a change name their site by its public name: that stays a reference through a new link, so they keep working for the whole run.

import { expect, test } from "bun:test";
import fc from "fast-check";

import { openConsole } from "../../packages/app/tests/console/support/console";
import { readShell } from "../../packages/app/tests/console/support/shell";
import { ORIGIN } from "../../packages/app/tests/console/support/install";
import { fuzzTarget } from "./config";
import { hostile } from "./hostile";

/** Every status the dashboard answers with. */
const ANSWERS = [200, 302, 400, 401, 403, 404, 415, 429];

const METHODS = ["GET", "HEAD", "POST", "POST", "POST", "POST", "POST", "PUT", "DELETE", "OPTIONS"];
const JSON_TYPE = "application/json";
const FORM = "application/x-www-form-urlencoded";
const TYPES = [JSON_TYPE, JSON_TYPE, JSON_TYPE, JSON_TYPE, `${JSON_TYPE}; charset=utf-8`, "Application/JSON", FORM, "multipart/form-data; boundary=x", "text/plain", "application/jsonx", ""];
const ORIGINS = [ORIGIN, ORIGIN, ORIGIN, ORIGIN, ORIGIN, ORIGIN, ORIGIN, "https://evil.example.com", "https://shop-page.example.com", "null", "", "https://poplin.example.com:444", "HTTPS://POPLIN.EXAMPLE.COM"];
const FETCH_SITES = ["same-origin", "same-origin", "same-origin", "same-origin", "same-origin", "same-site", "cross-site", "none", ""];
const CHANGES = ["settings", "make-live", "new-link", "delete", "restore", "rename", "access", "constructor", "__proto__", ""];

/** The login address a request without a session is sent to, up to the place to return to. */
const LOGIN = `${ORIGIN}/login?return=`;

/** What a data route answers a request without a session. */
const LOGGED_OUT = JSON.stringify({ ok: false, code: "no_session", about: null, sentence: "Log in again." });

const property = fuzzTarget(import.meta.file);

const opened = await openConsole();
const { base } = opened;
const report = await base.publish("report");
const shop = await base.publish("shop", "public");
const old = await base.publish("old");
await base.install.database.trashSite(old.id, { by: base.owner, at: base.clock.now });

const LABELS = [`report--${report.id}`, `shop--${shop.id}`, `old--${old.id}`, "shop", report.id, "report--000000000000", "nope"];
const signingKey = await base.install.database.readSigningKey();

const knownPaths = fc.oneof(
  fc.constantFrom("/", "/?view=trash", "/tokens", "/tokens/allow?code=WDJB-MJHT", "/settings", "/activity", "/usage", "/domain", "/login", "/api/sites", "/*", "/assets/app-4f1c.js", "/assets/other.js"),
  fc.constantFrom("/data/sites", "/data/sites?view=trash", "/data/sites?after=1-000000000000", "/data/activity?after=3", "/data/usage", "/data/settings", "/data/frame", "/data/tokens", "/data/people", "/data/logins", "/data/*", "/data/update"),
  fc.constantFrom(...LABELS).map((label) => `/sites/${label}`),
  fc.constantFrom(...LABELS).map((label) => `/data/sites/${label}`),
  fc.tuple(fc.constantFrom(...LABELS), fc.constantFrom(...CHANGES)).map(([label, change]) => `/data/sites/${label}/${change}`),
);
const changePaths = fc.constantFrom("/data/sites/shop/new-link", "/data/sites/shop/delete", "/data/sites/shop/restore", "/data/sites/shop/settings", "/data/settings", "/data/settings/sign-everyone-out", "/data/people/add");
const paths = fc.oneof({ arbitrary: changePaths, weight: 3 }, { arbitrary: knownPaths, weight: 3 }, { arbitrary: hostile(knownPaths), weight: 2 });
const cookies = fc.constantFrom(base.cookie, base.cookie, base.cookie, base.cookie, base.cookie, base.cookie, `${base.cookie}x`, "__Secure-poplin-session=", "theme=dark", undefined);
const words = fc.constantFrom("private", "unlisted", "public", "previous", "1", "2", "yes", "on", "off", "never", "7d", "2030-01-01", "9GB", "50GB", "docs", "gallery", "<script>alert(1)</script>", "next@example.com", ...LABELS);
const values = fc.oneof({ arbitrary: words, weight: 3 }, { arbitrary: hostile(words), weight: 1 }, { arbitrary: fc.string(), weight: 1 }, { arbitrary: fc.constantFrom(true, false, 1, null), weight: 1 });
const fields = fc.dictionary(
  fc.constantFrom("access", "public_name", "title", "search_engines", "embeddable", "expires", "version", "name", "login", "trash_days", "logins", "max_total_size", "dashboard_title", "values", "other"),
  values,
  { maxKeys: 6 },
);

/** What a request carries as its body: a JSON object, or text that is none. */
const bodies = fc.oneof({ arbitrary: fields.map((sent) => JSON.stringify(sent)), weight: 4 }, { arbitrary: fields.map((sent) => JSON.stringify({ values: sent })), weight: 2 }, { arbitrary: hostile(fc.constant("{}")), weight: 1 });

/** Everything a change could touch, as text. */
async function stored(): Promise<string> {
  const { database } = base.install;
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
  body: bodies,
});

/** One request of the property. */
type Asked = typeof requests extends fc.Arbitrary<infer Drawn> ? Drawn : never;

function requestOf(asked: Asked): Request {
  const headers = new Headers({ Origin: asked.origin, "Sec-Fetch-Site": asked.fetchSite, "Content-Type": asked.type });
  if (asked.cookie !== undefined) headers.set("Cookie", asked.cookie);

  const body = asked.method === "GET" || asked.method === "HEAD" ? undefined : asked.body;

  return new Request(`${ORIGIN}${asked.path}`, { method: asked.method, headers, body });
}

/** Whether a request is one the dashboard may change the install for: a POST whose media type is JSON, whatever parameters follow it. */
function isChange(asked: Pick<Asked, "method" | "type">): boolean {
  return asked.method === "POST" && asked.type.split(";")[0]?.trim().toLowerCase() === JSON_TYPE;
}

/** Whether an answer shows nothing of the install: the way to the login, a data route's refusal of a request without a session, or a file of the client, which holds nothing of it. */
function showsNothing(response: Response, page: string, address: URL): boolean {
  if (page === "" && response.status === 302 && (response.headers.get("Location") ?? "").startsWith(LOGIN)) return true;

  // A HEAD request gets the refusal's headers alone.
  if (response.status === 401 && (page === LOGGED_OUT || page === "")) return true;

  return address.pathname.startsWith("/assets/") && (response.status === 404 || page === "// the client" || page === "");
}

/** Whether an answer carries the dashboard's headers: never framed, its policy, and kept by no browser but for a file of the client. */
function isGuarded(response: Response, address: URL): boolean {
  const policy = response.headers.get("Content-Security-Policy") ?? "";
  const kept = response.headers.get("Cache-Control");

  return response.headers.get("X-Frame-Options") === "DENY" && policy.startsWith("default-src 'none'") && (kept === "no-store" || address.pathname.startsWith("/assets/"));
}

/** Whether an answer is a page that runs anything but a file of the dashboard's client: a script written into it, an address a browser would run, or a script loaded from elsewhere. An answer that is no page runs nothing. */
async function runsOther(response: Response, page: string): Promise<boolean> {
  if (!(response.headers.get("Content-Type") ?? "").toLowerCase().startsWith("text/html")) return false;

  const shell = await readShell(page);

  return shell.runs > 0 || shell.scripts.some((script) => !script.startsWith("/assets/"));
}

/** Send one request and say what the dashboard did with it. */
async function factsOf(asked: Asked): Promise<Readonly<Record<string, boolean>>> {
  const address = new URL(`${ORIGIN}${asked.path}`);

  // Whether the request carries the owner's session is decided here, apart from anything the dashboard answers: the cookie is the minted one and the owner is still a login.
  const logins = (await base.install.database.readSettings())?.logins ?? [];
  const loggedIn = asked.cookie === base.cookie && logins.includes(base.owner);
  const before = await stored();
  const response = await opened.fetch(requestOf(asked));
  const page = await response.text();
  const after = await stored();

  // A sign-out that was rightly done would end the session of every later run, so the key the cookie was signed with goes back.
  const key = await base.install.database.readSigningKey();
  if (signingKey !== undefined && String(key) !== String(signingKey)) await base.install.database.rotateSigningKey(signingKey, { by: base.owner, at: base.clock.now });

  return {
    published: ANSWERS.includes(response.status),
    shownToStranger: !loggedIn && !showsNothing(response, page, address),
    changedUnasked: !(loggedIn && isChange(asked)) && after !== before,
    guarded: isGuarded(response, address),
    script: await runsOther(response, page),
  };
}

property(
  "any request gets a published answer, a page only with a session, and a change only from a logged-in request sent as JSON",
  fc.asyncProperty(requests, async (asked) => {
    const address = `${ORIGIN}${asked.path}`;
    fc.pre(URL.canParse(address) && new URL(address).origin === ORIGIN);

    expect(await factsOf(asked)).toEqual({ published: true, shownToStranger: false, changedUnasked: false, guarded: true, script: false });
  }),
);

// Drift: the property once failed at random on the path `/*`, which a router reads as a pattern: the answer to it was no published one.
test.each([
  ["/*", 404],
  ["/data/*", 404],
] as const)("a change sent to the literal path %s by a logged-in page is answered %d and changes nothing", async (path, status) => {
  const asked = { path, method: "POST", cookie: base.cookie, origin: ORIGIN, fetchSite: "same-origin", type: JSON_TYPE, body: "{}" };
  const before = await stored();
  const response = await opened.fetch(requestOf(asked));

  expect([response.status, await stored()]).toEqual([status, before]);
});

// Control: the property would hold of a dashboard that changed nothing for anyone.
test("a change sent as JSON by a logged-in page is done", async () => {
  // A site made here: the property's own runs may have left any other in the trash, where a rename is refused.
  const fresh = await base.publish("control");
  const before = await stored();
  const facts = await factsOf({ path: `/data/sites/control--${fresh.id}/settings`, method: "POST", cookie: base.cookie, origin: ORIGIN, fetchSite: "same-origin", type: JSON_TYPE, body: JSON.stringify({ title: "A control" }) });

  expect([facts, (await stored()) === before]).toEqual([{ published: true, shownToStranger: false, changedUnasked: false, guarded: true, script: false }, false]);
});
