// The Worker's entry, driven as Cloudflare drives it, on the simulated bucket, database, and rate limiter.
// Without these the pieces could each pass their own tests and still not be joined into a product that publishes a site and serves it.

import { reset } from "cloudflare:test";
import { OPEN_ROUTES, ROUTES } from "@poplin/core/src/api/routes";
import { settingsFromText } from "@poplin/core/src/records/settings";
import { beforeEach, describe, expect, test, vi } from "vitest";
import manifest from "../../../cli/package.json?raw";
import built from "../../dist/worker.js";
import bundle from "../../dist/worker.js?raw";
import type { Bindings } from "../../src/worker/bindings";
import { signer } from "../login/support/access";
import { ADMIN, accessHeaders, ask, api, BINDINGS, cookieOf, countedBindings, done, installOf, instance, logIn, OWNER, type Published, page, publish, spentDatabase, tokenOf, type World, under, wait, world } from "./support/install";

/** The largest bundle that passes: three times today's, so a library pulled in whole fails here. */
const MOST_BUNDLE_BYTES = 1_000_000;

/** A file large enough that it cannot pass through in one piece: 5 MiB. */
const LARGE_BYTES = 5 * 1024 * 1024;

/** The first settings the tests' Worker starts from. */
const FIRST = BINDINGS.FIRST_SETTINGS as Readonly<Record<string, string>>;

/** The milliseconds of one minute, which is how long the rate limiting binding counts for. */
const MINUTE_MS = 60_000;

/** The end of a minute, in milliseconds: too little of it for a test that counts requests within one. */
const MINUTE_END_MS = 2000;

/** Values in the form of a site, an upload, a token's id, a path, and a version, for a request to every route. */
const NAMED = { site: "zzzzzzzzzzzz", upload: "zzzzzzzzzzzzzzzz", token: "00000000000000aa", path: "index.html", version: 1 };

/** What the API answers a computer that begins a login. */
interface Begun {
  readonly code: string;
  readonly secret: string;
  readonly verify_url: string;
}

/** The headers a dashboard form is posted with. */
const FORM = { "Content-Type": "application/x-www-form-urlencoded", Origin: ADMIN };

let w: World;

function withBindings(changed: Partial<Record<keyof Bindings, unknown>>): Bindings {
  return { ...BINDINGS, ...changed } as Bindings;
}

/** A database binding whose calls fail as `fails` says, by the count of the batch: 1 is the first. */
function failingDatabase(fails: (batch: number) => boolean): D1Database {
  let batches = 0;

  return new Proxy(BINDINGS.DB, {
    get(inner, name) {
      const member: unknown = Reflect.get(inner, name, inner);
      if (typeof member !== "function") return member;

      return (...given: unknown[]): unknown => {
        if (name !== "batch") return Reflect.apply(member, inner, given);

        batches += 1;
        if (fails(batches)) return Promise.reject(new Error("the database is away"));

        return Reflect.apply(member, inner, given);
      };
    },
  });
}

/** The bucket, with every byte counted as it is pulled out of a file's body. A body is pulled only when its reader asks. */
function meteredBucket(read: { bytes: number }): R2Bucket {
  const metered = (body: ReadableStream<Uint8Array>): ReadableStream<Uint8Array> => {
    const reader = body.getReader();

    return new ReadableStream<Uint8Array>(
      {
        async pull(controller) {
          const { done: ended, value } = await reader.read();
          if (ended) return controller.close();

          read.bytes += value.byteLength;
          controller.enqueue(value);
        },
        cancel: (reason) => reader.cancel(reason),
      },
      { highWaterMark: 0 },
    );
  };

  return new Proxy(BINDINGS.SITES, {
    get(inner, name) {
      const member: unknown = Reflect.get(inner, name, inner);
      if (typeof member !== "function") return member;

      return async (...given: unknown[]): Promise<unknown> => {
        const found: unknown = await Reflect.apply(member, inner, given);
        if (name !== "get" || found === null || typeof found !== "object" || !("body" in found)) return found;

        return new Proxy(found, { get: (object, key) => (key === "body" ? metered(object.body as ReadableStream<Uint8Array>) : Reflect.get(object, key, object)) });
      };
    },
  });
}

async function sha256(bytes: Uint8Array<ArrayBuffer>): Promise<string> {
  return Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", bytes)), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

beforeEach(async () => {
  await reset();
  w = await world();
});

describe("an instance's first request", () => {
  // Drift: two instances that start together would each store settings and a key of their own, and a dashboard session made by one would be no session at the other.
  test("two instances starting together on an empty database end with the schema, one settings record from FIRST_SETTINGS, and one signing key", async () => {
    const [one, other] = [instance(w), instance(w)];
    const started = await Promise.all([ask(one, `${ADMIN}/api/whoami`), ask(other, `${ADMIN}/api/whoami`)]);
    const { database } = await installOf(w);
    const first = settingsFromText(FIRST);
    if (!first.ok) throw new Error(`the example first settings are refused at ${first.key}`);

    const stored = (await database.listAudit({ limit: 100 })).filter((entry) => entry.action === "settings_set");

    const session = cookieOf(await logIn(one, w));
    const opened = await ask(other, `${ADMIN}/`, { headers: { Cookie: session } });

    expect(started.map((answer) => answer.status)).toEqual([401, 401]);
    expect(await database.readSettings()).toEqual(first.values);
    expect(stored.map((entry) => entry.by)).toEqual([OWNER]);
    expect(opened.status).toBe(200);
  });

  // Drift: a later apply of the module changes FIRST_SETTINGS; an instance that read the binding again would overwrite what the dashboard set.
  test("an instance that starts on stored settings never reads FIRST_SETTINGS: it starts without the binding and leaves the settings as they are", async () => {
    await ask(instance(w), `${ADMIN}/api/whoami`);
    const later = withBindings({ FIRST_SETTINGS: undefined });
    const answer = await ask(instance(w), `${ADMIN}/api/whoami`, {}, later);

    expect(answer.status).toBe(401);
    expect((await (await installOf(w)).database.readSettings())?.trash_days).toBe(7);
  });

  // Drift: the person who installs sets this variable by hand; one that had to carry every setting would be eighteen chances to mistype the install into not starting.
  test("FIRST_SETTINGS that names the logins alone starts the install with every other setting at its default, titled with its own address", async () => {
    const answer = await ask(instance(w), `${ADMIN}/api/whoami`, {}, withBindings({ FIRST_SETTINGS: { logins: " owner@example.com , second@example.com " } }));
    const stored = await (await installOf(w)).database.readSettings();
    const usual = settingsFromText(FIRST);

    expect(answer.status).toBe(401);
    expect(stored).toEqual(usual.ok ? { ...usual.values, logins: ["owner@example.com", "second@example.com"] as typeof usual.values.logins } : undefined);
  });

  const stopped: readonly { readonly name: string; readonly broken: () => Bindings; readonly status: number; readonly says: string; readonly hides: string }[] = [
    { name: "a ZONE binding with no domain", broken: () => withBindings({ ZONE: { public_word: "wiki" } }), status: 503, says: "  ZONE: bad-shape", hides: "wiki" },
    { name: "a ZONE binding whose public word is no word", broken: () => withBindings({ ZONE: { domain: "example.com", public_word: "my-wiki" } }), status: 503, says: "  ZONE: bad-public-word", hides: "my-wiki" },
    { name: "an ACCOUNT_ID that is no account id", broken: () => withBindings({ ACCOUNT_ID: "my-account" }), status: 503, says: "  ACCOUNT_ID: bad-shape", hides: "my-account" },
    { name: "a WORKER_NAME that is no Worker's name", broken: () => withBindings({ WORKER_NAME: "../poplin" }), status: 503, says: "  WORKER_NAME: bad-shape", hides: "../poplin" },
    {
      name: "an ACCESS binding whose audience is no tag",
      broken: () => withBindings({ ACCESS: { team_domain: "team.cloudflareaccess.com", audience: "not-a-tag" } }),
      status: 503,
      says: "  ACCESS: bad-audience",
      hides: "not-a-tag",
    },
    {
      name: "a first setting in no form its key takes",
      broken: () => withBindings({ FIRST_SETTINGS: { ...FIRST, trash_days: "soon" } }),
      status: 503,
      says: "  FIRST_SETTINGS: bad-form at trash_days",
      hides: "soon",
    },
    {
      name: "a first setting under a key that is no setting",
      broken: () => withBindings({ FIRST_SETTINGS: { ...FIRST, poplin_0123456789abcdef: "on" } }),
      status: 503,
      says: "  FIRST_SETTINGS: unknown-key",
      hides: "poplin_0123456789abcdef",
    },
    { name: "first settings with no logins", broken: () => withBindings({ FIRST_SETTINGS: { trash_days: "9" } }), status: 503, says: "  FIRST_SETTINGS: missing at logins", hides: "9" },
    { name: "first settings whose login is no email", broken: () => withBindings({ FIRST_SETTINGS: { logins: "the-owner" } }), status: 503, says: "  FIRST_SETTINGS: bad-form at logins", hides: "the-owner" },
    { name: "a schema step that fails", broken: () => withBindings({ DB: failingDatabase((batch) => batch === 2) }), status: 503, says: "could not be brought up to date. Try again.", hides: "away" },
    { name: "a database that is away", broken: () => withBindings({ DB: failingDatabase(() => true) }), status: 503, says: "Something went wrong. Try again.", hides: "away" },
  ];

  // Drift: a failed start kept by the instance would answer the error forever, and one half kept would serve with no settings or no key.
  test.each(stopped)("$name answers $status, uncached, without the value, and the same instance starts once the cause is gone", async ({ broken, status, says, hides }) => {
    const worker = instance(w);
    const failed = await ask(worker, "https://docs-page.example.com/", {}, broken());
    const text = await failed.text();
    const recovered = await ask(worker, `${ADMIN}/api/whoami`);

    expect({ status: failed.status, cache: failed.headers.get("Cache-Control"), type: failed.headers.get("Content-Type") }).toEqual({ status, cache: "no-store", type: "text/plain; charset=utf-8" });
    expect(text).toContain(says);
    expect(text).not.toContain(hides);
    expect(recovered.status).toBe(401);
  });

  // Drift: a database written by a newer poplin would be read with this code's idea of its tables.
  test("a database newer than the code is refused with the way out, and is served again once the code knows it", async () => {
    const worker = instance(w);
    await ask(instance(w), `${ADMIN}/api/whoami`);
    await BINDINGS.DB.exec("INSERT INTO schema_steps (step, description, applied_at) VALUES (999, 'a step of a newer poplin', 0)");
    const refused = await ask(worker, `${ADMIN}/api/whoami`);
    await BINDINGS.DB.exec("DELETE FROM schema_steps WHERE step = 999");
    const served = await ask(worker, `${ADMIN}/api/whoami`);

    expect({ status: refused.status, text: await refused.text() }).toEqual({ status: 503, text: "This install's database is newer than its code: update poplin.\n" });
    expect(served.status).toBe(401);
  });
});

describe("the product, from a token to an opened site", () => {
  // Drift: any one join could break alone: the API's install, the token check in front of serving, the login's cookie, or the address the API prints against the one serving reads.
  test("a site published through the API is private behind the letter p, public under its public name, and gone from an address a new link replaced", async () => {
    const worker = instance(w);
    const token = await tokenOf(w, "publisher");
    const site = await publish(worker, token, { name: "report" }, [page("<h1>report</h1>"), { path: "data/table.csv", body: new TextEncoder().encode("a,b\n1,2\n"), type: "text/csv" }]);
    const owner = await accessHeaders(w);
    const printed = site.addresses.site;

    const open = await ask(worker, `${under(site, "u")}/data/table.csv?x=1`);
    const around = await ask(worker, `${under(site, "p")}/`);
    const opened = await ask(worker, `${under(site, "p")}/`, { headers: owner });
    const file = await ask(worker, `${under(site, "p")}/data/table.csv`, { headers: owner });
    const login = await logIn(worker, w, `${ADMIN}/login?return=${encodeURIComponent(`${under(site, "p")}/`)}`);

    const shown = await done<{ site: Published }>(await api(worker, token, "PATCH", ROUTES.updateSite.path({ site: site.label }), { access: "public", public_name: "yearly" }));
    const named = await ask(worker, "https://yearly-page.example.com/");
    const stale = await ask(worker, `${under(site, "p")}/data/table.csv?x=1`, { headers: owner });
    const moved = await done<{ site: Published }>(await api(worker, token, "POST", ROUTES.newLink.path({ site: site.label })));
    const old = [await ask(worker, `${under(site, "p")}/`, { headers: owner }), await ask(worker, `${under(site, "u")}/`)];
    const fresh = await ask(worker, `${under(moved.site, "u")}/`);

    expect({ status: open.status, to: open.headers.get("Location") }).toEqual({ status: 302, to: `${under(site, "p")}/data/table.csv?x=1` });
    expect({ status: around.status, to: around.headers.get("Location"), text: await around.text() }).toEqual({ status: 404, to: null, text: "Not found\n" });
    expect({ status: opened.status, cache: opened.headers.get("Cache-Control"), text: await opened.text() }).toEqual({ status: 200, cache: "private, no-cache", text: "<h1>report</h1>" });
    expect({ status: file.status, type: file.headers.get("Content-Type"), text: await file.text() }).toEqual({ status: 200, type: "text/csv", text: "a,b\n1,2\n" });
    expect({ status: login.status, to: login.headers.get("Location"), cache: login.headers.get("Cache-Control") }).toEqual({ status: 302, to: "/", cache: "no-store" });
    expect(login.headers.get("Set-Cookie")).toMatch(/^__Secure-poplin-session=[^;]+; Secure; HttpOnly; SameSite=Lax; Path=\/; Max-Age=\d+$/);
    expect(shown.site.addresses.public).toBe("https://yearly-page.example.com");
    expect({ status: named.status, text: await named.text() }).toEqual({ status: 200, text: "<h1>report</h1>" });
    expect({ status: stale.status, to: stale.headers.get("Location") }).toEqual({ status: 302, to: `${under(site, "u")}/data/table.csv?x=1` });
    expect((await (await installOf(w)).database.listAudit({ limit: 100 })).filter((entry) => entry.action === "login").map((entry) => entry.by)).toEqual([OWNER]);
    expect([printed, shown.site.addresses.site, moved.site.id === site.id]).toEqual([under(site, "p"), under(site, "u"), false]);
    expect([...old.map((answer) => answer.status), old[1]?.headers.get("Location"), fresh.status]).toEqual([404, 302, `${under(site, "p")}/`, 200]);
  });

  const cameAround: readonly (readonly [string, (from: World) => Promise<Record<string, string>>])[] = [
    ["no token", async () => ({})],
    ["a token that is no token", async () => ({ "Cf-Access-Jwt-Assertion": "garbage" })],
    ["an empty token", async () => ({ "Cf-Access-Jwt-Assertion": "" })],
    ["a token another key signed under the team's key id", async (from) => accessHeaders(from, {}, await signer("stranger-key"))],
    ["a token of another application", (from) => accessHeaders(from, { aud: ["0000000000000000000000000000000000000000000000000000000000000000"] })],
    ["a token of another team", (from) => accessHeaders(from, { iss: "https://other.cloudflareaccess.com" })],
    ["a token past its expiry", (from) => accessHeaders(from, { exp: Math.floor(from.clock.now / 1000) - 3600 })],
    ["a token not yet valid", (from) => accessHeaders(from, { nbf: Math.floor(from.clock.now / 1000) + 3600 })],
    ["a token that names no email", (from) => accessHeaders(from, { email: undefined })],
    ["a token for an email that is not in the logins", (from) => accessHeaders(from, { email: "guest@example.com" })],
    ["the owner's dashboard session and no token", async (from) => ({ Cookie: cookieOf(await logIn(instance(from), from)) })],
    ["a claim to be the owner in a header Access never sets", async () => ({ "Cf-Access-Authenticated-User-Email": OWNER })],
  ];

  // Drift: a request that reached the Worker around Access would get a private site's file, or a redirect that confirms the site exists, or would cost the database a query.
  test.each(cameAround)("under p, %s gets the one 404 for a private site, an unlisted one, and no site alike, and no call to the database or the bucket", async (_what, headers) => {
    const tally = { calls: 0 };
    const worker = instance(w);
    await ask(worker, `${ADMIN}/api/whoami`, {}, countedBindings(tally));
    const token = await tokenOf(w, "publisher");
    const hidden = await publish(worker, token, { name: "report" }, [page("<h1>report</h1>")]);
    const linked = await publish(worker, token, { name: "notes", access: "unlisted" }, [page("<p>notes</p>")]);
    const sent = await headers(w);
    await ask(worker, `${under(hidden, "p")}/`, { headers: await accessHeaders(w) });

    tally.calls = 0;
    const answers = [await ask(worker, `${under(hidden, "p")}/`, { headers: sent }), await ask(worker, `${under(linked, "p")}/`, { headers: sent }), await ask(worker, `${under({ label: "nobody--000000000000" }, "p")}/`, { headers: sent })];
    const whole = await Promise.all(answers.map(async (answer) => ({ status: answer.status, to: answer.headers.get("Location"), cache: answer.headers.get("Cache-Control"), text: await answer.text() })));

    expect({ whole, calls: tally.calls }).toEqual({ whole: answers.map(() => ({ status: 404, to: null, cache: "no-store", text: "Not found\n" })), calls: 0 });
  });

  // Drift: a token check that fetched the team's keys, or read the logins, on every request would make a private page cost a network call or a second query.
  test("a private page view on a warm instance costs one site query, one request count, one file read, and no fetch of the team's keys", async () => {
    const tally = { calls: 0 };
    const worker = instance(w);
    await ask(worker, `${ADMIN}/api/whoami`, {}, countedBindings(tally));
    const site = await publish(worker, await tokenOf(w, "publisher"), { name: "report" }, [page("<h1>report</h1>")]);
    const owner = await accessHeaders(w);
    await ask(worker, `${under(site, "p")}/`, { headers: owner });

    tally.calls = 0;
    const fetched = w.certs.calls.length;
    const view = await ask(worker, `${under(site, "p")}/`, { headers: owner });

    expect({ status: view.status, text: await view.text(), calls: tally.calls, fetches: [fetched, w.certs.calls.length] }).toEqual({ status: 200, text: "<h1>report</h1>", calls: 3, fetches: [1, 1] });
  });

  // Drift: a token that cannot be checked would be let through, or a private site would look deleted for as long as the team's keys cannot be had.
  test("while the team's keys cannot be had, a request under p with a token is told to try again and gets no file", async () => {
    const worker = instance(w);
    const site = await publish(worker, await tokenOf(w, "publisher"), { name: "report" }, [page("<h1>report</h1>")]);
    w.certs.down = true;
    const answer = await ask(worker, `${under(site, "p")}/`, { headers: await accessHeaders(w) });

    expect({ status: answer.status, retry: answer.headers.get("Retry-After"), cache: answer.headers.get("Cache-Control"), text: await answer.text() }).toEqual({
      status: 503,
      retry: "60",
      cache: "no-store",
      text: "The login cannot be checked right now. Try again.\n",
    });
  });

  // Drift: Access keeps a person's session for 30 days, so a login removed on the dashboard would keep every private site until that session ends.
  test("a person whose login is removed keeps a private site for the rest of the instance's minute and is then refused, token and all", async () => {
    const two = withBindings({ FIRST_SETTINGS: { ...FIRST, logins: `${OWNER},second@example.com` } });
    const worker = instance(w);
    await ask(worker, `${ADMIN}/api/whoami`, {}, two);
    const site = await publish(worker, await tokenOf(w, "publisher"), { name: "report" }, [page("<h1>report</h1>")]);
    const second = await accessHeaders(w, { email: "second@example.com" });

    const before = await ask(worker, `${under(site, "p")}/`, { headers: second });
    await done(await api(worker, await tokenOf(w, "admin"), "PATCH", ROUTES.changeConfig.path(), { logins: [OWNER] }));
    const withinTheMinute = await ask(worker, `${under(site, "p")}/`, { headers: second });
    wait(w, 1 / 60);
    const afterTheMinute = await ask(worker, `${under(site, "p")}/`, { headers: second });

    expect([before.status, withinTheMinute.status, afterTheMinute.status, (await ask(worker, `${under(site, "p")}/`, { headers: await accessHeaders(w) })).status]).toEqual([200, 200, 404, 200]);
  });

  // Drift: an entry that read a file to pass it on would hold all of it in memory and could send it without its length.
  test("a 5 MiB binary file is answered with its length before any of it is read from the bucket, and then goes out byte for byte", async () => {
    const read = { bytes: 0 };
    const worker = instance(w);
    await ask(worker, `${ADMIN}/api/whoami`, {}, withBindings({ SITES: meteredBucket(read) }));
    const bytes = new Uint8Array(LARGE_BYTES).map((_zero, at) => (at * 31 + (at >> 9)) & 255);
    const site = await publish(worker, await tokenOf(w, "publisher"), { name: "film", access: "unlisted" }, [page("<video src=clip.bin>"), { path: "clip.bin", body: bytes, type: "video/mp4" }]);

    const answer = await ask(worker, `${site.addresses.site}/clip.bin`);
    const answered = { status: answer.status, length: answer.headers.get("Content-Length"), type: answer.headers.get("Content-Type"), read: read.bytes };
    const received = new Uint8Array(await answer.arrayBuffer());

    expect(answered).toEqual({ status: 200, length: String(LARGE_BYTES), type: "video/mp4", read: 0 });
    expect(read.bytes).toBe(LARGE_BYTES);
    expect(await sha256(received)).toBe(await sha256(bytes));
  });

  // Drift: a settings read, a key read, or a second site query on every view would spend the database's daily rows on nothing.
  test("a page view on a warm instance costs one site query, one request count, and one file read", async () => {
    const tally = { calls: 0 };
    const worker = instance(w);
    await ask(worker, `${ADMIN}/api/whoami`, {}, countedBindings(tally));
    await publish(worker, await tokenOf(w, "publisher"), { name: "docs", access: "public" }, [page("<p>docs</p>")]);
    await ask(worker, "https://docs-page.example.com/");

    tally.calls = 0;
    const view = await ask(worker, "https://docs-page.example.com/");

    expect({ status: view.status, text: await view.text(), calls: tally.calls }).toEqual({ status: 200, text: "<p>docs</p>", calls: 3 });
  });

  // Drift: a page a browser asks about again would cost a bucket call each time, or a visitor who holds an older version would keep its styles and scripts beside the new page for a day.
  test("a page asked for again costs the site query and the request count alone; after a publish and after a rollback it comes whole, with the word to drop the cached files", async () => {
    const tally = { calls: 0 };
    const worker = instance(w);
    await ask(worker, `${ADMIN}/api/whoami`, {}, countedBindings(tally));
    const token = await tokenOf(w, "admin");
    const site = await publish(worker, token, { name: "docs", access: "unlisted" }, [page("<p>one</p>")]);
    const home = `${under(site, "u")}/`;
    const holding = (tag: string | null): Promise<Response> => ask(worker, home, { headers: { "If-None-Match": tag ?? "" } });
    const first = await ask(worker, home);
    const one = first.headers.get("ETag");

    tally.calls = 0;
    const same = await holding(one);
    const calls = tally.calls;

    wait(w, 1);
    await publish(worker, token, { site: site.label }, [page("<p>two</p>")]);
    const newer = await holding(one);
    const two = newer.headers.get("ETag");
    await done(await api(worker, token, "POST", ROUTES.rollbackSite.path({ site: site.label }), { version: 1 }));
    const back = await holding(two);

    expect({ status: first.status, cache: first.headers.get("Cache-Control"), clear: first.headers.get("Clear-Site-Data") }).toEqual({ status: 200, cache: "public, max-age=300, must-revalidate", clear: null });
    expect({ status: same.status, text: await same.text(), calls }).toEqual({ status: 304, text: "", calls: 2 });
    expect({ status: newer.status, clear: newer.headers.get("Clear-Site-Data"), text: await newer.text(), changed: two !== one }).toEqual({ status: 200, clear: '"cache"', text: "<p>two</p>", changed: true });
    expect({ status: back.status, clear: back.headers.get("Clear-Site-Data"), text: await back.text(), tag: back.headers.get("ETag") }).toEqual({ status: 200, clear: '"cache"', text: "<p>one</p>", tag: one });
  });

  // Drift: a view is counted in the request's own count, after the answer; a file, a refusal, or the move of a private site's address counted as one would show opens nobody made.
  test("a site's views count its pages answered 200 or 304, private or not, and nothing else it answers", async () => {
    const worker = instance(w);
    const token = await tokenOf(w, "publisher");
    const style = { path: "site.css", body: new TextEncoder().encode("body{}"), type: "text/css" };
    const open = await publish(worker, token, { name: "docs", access: "public" }, [page("<p>docs</p>"), style]);
    const closed = await publish(worker, token, { name: "notes" }, [page("<p>notes</p>")]);
    const first = await ask(worker, "https://docs-page.example.com/");

    const answers = [
      first.status,
      (await ask(worker, "https://docs-page.example.com/", { headers: { "If-None-Match": first.headers.get("ETag") ?? "" } })).status,
      (await ask(worker, "https://docs-page.example.com/site.css")).status,
      (await ask(worker, "https://docs-page.example.com/", { method: "HEAD" })).status,
      (await ask(worker, "https://docs-page.example.com/missing")).status,
      (await ask(worker, `${under(closed, "u")}/`)).status,
      (await ask(worker, `${under(closed, "p")}/`, { headers: await accessHeaders(w) })).status,
    ];
    const { database, now } = await installOf(w);
    const day = new Date(now()).toISOString().slice(0, 10);
    const views = await database.readViews([open.id, closed.id] as never, day);

    expect([answers, [...views.values()], await database.readRequests(day, open.id as never)]).toEqual([
      [200, 304, 200, 200, 404, 302, 200],
      [{ today: 2, week: 2 }, { today: 1, week: 1 }],
      { site: 5, all: 6 },
    ]);
  });

  // Drift: the limits would sit behind serving, or count nothing for an address that names no site, and a probe of made-up names would run free.
  test.each([
    { name: "a public site", address: "https://docs-page.example.com/", served: 200 },
    { name: "a name no site holds", address: "https://nothing-page.example.com/", served: 404 },
  ])("$name answers a visitor past the per-visitor limit 429 with Retry-After, and another visitor as before", async ({ address, served }) => {
    const tight = withBindings({ FIRST_SETTINGS: { ...FIRST, visitor_requests_per_minute: "2" } });
    const worker = instance(w);
    await ask(worker, `${ADMIN}/api/whoami`, {}, tight);
    await publish(worker, await tokenOf(w, "publisher"), { name: "docs", access: "public" }, [page("<p>docs</p>")]);

    const from = (visitor: string): Promise<Response> => ask(worker, address, { headers: { "CF-Connecting-IP": visitor } });
    const answers = [await from("203.0.113.7"), await from("203.0.113.7"), await from("203.0.113.7"), await from("198.51.100.9")];

    expect(answers.map((answer) => answer.status)).toEqual([served, served, 429, served]);
    expect(answers.map((answer) => answer.headers.get("Retry-After"))).toEqual([null, null, "60", null]);
  });

  // Drift: the id alone names a site, under any name; counted apart from the site, every other name before the id would be a fresh allowance.
  test("a label with a site's id under another name is the same site and spends that site's minute", async () => {
    const strict = withBindings({ FIRST_SETTINGS: { ...FIRST, site_requests_per_minute: "1" } });
    const worker = instance(w);
    await ask(worker, `${ADMIN}/api/whoami`, {}, strict);
    const site = await publish(worker, await tokenOf(w, "publisher"), { name: "docs", access: "public" }, [page("<p>docs</p>")]);

    const renamed = await ask(worker, `https://other--${site.id}-u-poplin.example.com/`, { headers: { "CF-Connecting-IP": "203.0.113.7" } });
    const real = await ask(worker, "https://docs-page.example.com/", { headers: { "CF-Connecting-IP": "198.51.100.9" } });

    expect([renamed.status, real.status]).toEqual([200, 429]);
  });

  // Drift: counted for the site, a request that only gets a redirect would let anyone who guessed an id use up a private site's minute, and the 429 would tell that the id is real.
  test("a private site's address under the open letter spends nothing of that site's minute", async () => {
    const strict = withBindings({ FIRST_SETTINGS: { ...FIRST, site_requests_per_minute: "1" } });
    const worker = instance(w);
    await ask(worker, `${ADMIN}/api/whoami`, {}, strict);
    const site = await publish(worker, await tokenOf(w, "publisher"), { name: "report" }, [page("<h1>report</h1>")]);
    const owner = await accessHeaders(w);

    const probes = [await ask(worker, `${under(site, "u")}/`, { headers: { "CF-Connecting-IP": "203.0.113.7" } }), await ask(worker, `${under(site, "u")}/`, { headers: { "CF-Connecting-IP": "203.0.113.8" } })];
    const real = await ask(worker, `${under(site, "p")}/`, { headers: { ...owner, "CF-Connecting-IP": "198.51.100.9" } });
    const again = await ask(worker, `${under(site, "p")}/`, { headers: { ...owner, "CF-Connecting-IP": "192.0.2.44" } });

    expect([...probes.map((probe) => probe.status), real.status, again.status]).toEqual([302, 302, 200, 429]);
  });

  // Drift: the routes should make a stray hostname impossible; if one arrives, it must not be read as the dashboard or as a site.
  test.each(["https://example.org/", "https://example.com/", "https://plain.example.com/", "https://poplin.example.com.example.org/api/whoami"])("%s is neither the admin hostname nor a site's and gets serving's 404", async (address) => {
    const answer = await ask(instance(w), address);

    expect({ status: answer.status, text: await answer.text(), cache: answer.headers.get("Cache-Control") }).toEqual({ status: 404, text: "Not found\n", cache: "no-store" });
  });
});

describe("a request over plain http", () => {
  /** An address on each kind of hostname the Worker answers, and on one it does not know. */
  const plain: readonly (readonly [kind: string, address: string])[] = [
    ["a site", "http://report--k3f9x2ab71qz-p-poplin.example.com/a/b.html?c=d"],
    ["the admin hostname", "http://poplin.example.com/sites?page=2"],
    ["the Worker's own address", "http://poplin.example.workers.dev/setup"],
    ["a hostname of nobody", "http://elsewhere.example.net/"],
  ];

  // Drift: without the provider's redirect rule, which needs a permission of its own, a site answered over http as it answers over https.
  test.each(plain)("to %s is sent to the same address over https, whatever its method, before the database or the bucket is asked and with no cookie", async (_kind, address) => {
    const tally = { calls: 0 };
    const answers = [];
    for (const method of ["GET", "POST"]) {
      for (const bindings of [countedBindings(tally), { ...countedBindings(tally), ZONE: undefined, ACCOUNT_ID: undefined } as Bindings]) {
        const answer = await ask(instance(w), address, { method, headers: { Cookie: "__Secure-poplin-session=x" } }, bindings);
        answers.push([answer.status, answer.headers.get("Location"), answer.headers.get("Set-Cookie"), await answer.text()]);
      }
    }

    expect(answers).toEqual(Array.from({ length: 4 }, () => [308, address.replace("http://", "https://"), null, ""]));
    expect(tally.calls).toBe(0);
  });

  // Drift: the preview and a local run answer on this machine over http, where no network is crossed and no https exists.
  test("to this machine itself is answered as any other request", async () => {
    const answer = await ask(instance(w), "http://127.0.0.1/");

    expect([answer.status === 308, answer.headers.get("Location")]).toEqual([false, null]);
  });
});

describe("the admin hostname", () => {
  // Drift: a path of the admin hostname would be answered without the check its piece owns.
  test("the API answers a token and refuses none, and the login refuses a request Access did not sign", async () => {
    const worker = instance(w);
    await ask(worker, `${ADMIN}/api/whoami`);
    const token = await tokenOf(w, "admin");
    const known = await api(worker, token, "GET", ROUTES.whoami.path());
    const unknown = await api(worker, null, "GET", ROUTES.whoami.path());
    const exported = await api(worker, token, "GET", ROUTES.exportSettings.path());
    const unsigned = await ask(worker, `${ADMIN}/login`);
    const posted = await ask(worker, `${ADMIN}/login`, { method: "POST" });

    expect({ status: known.status, body: await known.json() }).toMatchObject({ status: 200, body: { token: { scope: "admin", note: "a test" } } });
    expect([unknown.status, exported.status, unsigned.status, posted.status]).toEqual([401, 200, 403, 405]);
    expect([unsigned.headers.get("Set-Cookie"), posted.headers.get("Allow")]).toEqual([null, "GET"]);
  });

  // Drift: the dashboard would be mounted without a session reader, or with one that trusts a key the install no longer has; or its session would open, or its sign-out would close, a private site.
  test("the dashboard shows the sites to a session and sends anyone else to the login; signing everyone out ends the dashboard's sessions at once and leaves a private site to Access", async () => {
    const worker = instance(w);
    const token = await tokenOf(w, "admin");
    const site = await publish(worker, token, { name: "report" }, [page("<h1>report</h1>")]);
    const session = { Cookie: cookieOf(await logIn(worker, w)) };
    const owner = await accessHeaders(w);

    const stranger = await ask(worker, `${ADMIN}/`);
    const sites = await ask(worker, `${ADMIN}/`, { headers: session });
    const unmarked = await ask(worker, `${ADMIN}/sites/${site.label}/delete`, { method: "POST", headers: { ...session, ...FORM }, body: "" });
    const after = await done<{ site: Published }>(await api(worker, token, "GET", ROUTES.getSite.path({ site: site.label })));
    const unknown = await ask(worker, `${ADMIN}/no-such-page`, { headers: session });

    await done(await api(worker, token, "DELETE", ROUTES.signEveryoneOut.path()));
    const signedOut = await ask(worker, `${ADMIN}/`, { headers: session });
    wait(w, 1 / 60);
    const privately = await ask(worker, `${under(site, "p")}/`, { headers: owner });

    expect({ status: stranger.status, to: stranger.headers.get("Location") }).toEqual({ status: 302, to: `${ADMIN}/login?return=${encodeURIComponent("/")}` });
    expect({ status: sites.status, page: (await sites.text()).includes(site.label), policy: sites.headers.get("Content-Security-Policy") }).toMatchObject({ status: 200, page: true });
    expect(sites.headers.get("Content-Security-Policy")).toContain("default-src 'none'");
    expect([unmarked.status, after.site.state, unknown.status]).toEqual([403, "live", 404]);
    expect([signedOut.status, privately.status]).toEqual([302, 200]);
  });
});

describe("a database that takes no more writes for the day", () => {
  // Drift: an instance wrote on every start and the login wrote before its redirect, so a set-up install answered nobody once its writes were spent. Letting a first login through the same way would leave the setup page open behind a person who is in.
  test("a new instance of a set-up install starts, serves a page and a file, logs a person in without the audit entry, which the log notes, and shows the dashboard; the first login of an install is refused and its setup stays open", async () => {
    using warned = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    using failed = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const spent = withBindings({ DB: spentDatabase("write") });
    const site = await publish(instance(w), await tokenOf(w, "admin"), { name: "report", access: "public" }, [page("<h1>report</h1>"), { path: "notes.txt", body: new TextEncoder().encode("notes"), type: "text/plain" }]);
    const worker = instance(w);
    const signed = { headers: await accessHeaders(w) };
    const { database } = await installOf(w);

    const first = await ask(worker, `${ADMIN}/login`, signed, spent);
    const open = !(await database.hasLoggedIn());
    await logIn(instance(w), w);
    const later = await ask(worker, `${ADMIN}/login`, signed, spent);
    const session = { headers: { Cookie: cookieOf(later) } };
    const answers = [await ask(worker, `${site.addresses.public}/`, {}, spent), await ask(worker, `${site.addresses.public}/notes.txt`, {}, spent)];
    for (const path of ["/", `/sites/${site.label}`, "/activity", "/usage", "/tokens", "/settings"]) answers.push(await ask(worker, `${ADMIN}${path}`, session, spent));
    const logins = (await database.listAudit({ limit: 100 })).filter((entry) => entry.action === "login");

    expect([first.status, first.headers.get("Set-Cookie"), open]).toEqual([503, null, true]);
    expect([later.status, later.headers.get("Location"), logins.length]).toEqual([302, "/", 1]);
    expect(answers.map((answer) => answer.status)).toEqual([200, 200, 200, 200, 200, 200, 200, 200]);
    expect(warned.mock.calls.map(([line]) => line)).toEqual(["poplin: a login was not written to the audit log"]);
    expect(failed.mock.calls.map(([line]) => line)).toEqual(["poplin: a request failed"]);
  });
});

describe("a database whose allowance for the day is used up", () => {
  // Drift: D1 says so only in the words of an error, and every address answered a bare 503 or 500 that named nothing. A visitor, a caller of the API, and the owner each need it in their own form, with the wait to midnight UTC, or they ask again all day.
  test("a site's address answers the paused page, the API the code with what ran out, the dashboard its notice, and a program's setup run its refusal: each a 503 with the seconds to midnight UTC", async () => {
    using failed = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const token = await tokenOf(w, "admin");
    const site = await publish(instance(w), token, { name: "report", access: "public" }, [page("<h1>report</h1>")]);
    const session = { Cookie: cookieOf(await logIn(instance(w), w)) };
    const bearer = { Authorization: `Bearer ${token}` };
    const noReading = withBindings({ DB: spentDatabase("read") });
    const noWriting = withBindings({ DB: spentDatabase("write") });
    const paused = instance(w);
    const reading = instance(w);

    const answers = [
      await ask(paused, `${site.addresses.public}/`, {}, noReading),
      await ask(paused, `${site.addresses.public}/`, { method: "HEAD" }, noReading),
      await ask(paused, `${ADMIN}${ROUTES.whoami.path()}`, { headers: bearer }, noReading),
      await ask(paused, `${ADMIN}/`, { headers: session }, noReading),
      await ask(paused, `${ADMIN}/setup/api/check`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ token: "a-token-0123456789-abcdefgh" }) }, noReading),
      await ask(reading, `${ADMIN}${ROUTES.issueToken.path()}`, { method: "POST", headers: { ...bearer, "Content-Type": "application/json" }, body: JSON.stringify({ scope: "publisher", note: "a test" }) }, noWriting),
    ];
    const told = await Promise.all(answers.map(async (answer) => [answer.status, answer.headers.get("Retry-After"), answer.headers.get("Cache-Control"), await answer.text()]));

    // The world's clock stands at 22:13:20 UTC: 6,400 seconds before midnight.
    expect(told).toEqual([
      [503, "6400", "public, max-age=60", "This site is paused until midnight UTC.\n"],
      [503, "6400", "public, max-age=60", ""],
      [503, "6400", "no-store", JSON.stringify({ error: { code: "allowance_spent", message: "the day's free allowance of the database is used up: ask again after midnight UTC", about: "reading" } })],
      [503, "6400", "no-store", "The dashboard is paused: the free allowance of the database for reading is used up for today. It is back after midnight UTC.\n"],
      [503, "6400", "no-store", JSON.stringify({ ok: false, refusal: "allowance_spent" })],
      [503, "6400", "no-store", JSON.stringify({ error: { code: "allowance_spent", message: "the day's free allowance of the database is used up: ask again after midnight UTC", about: "writing" } })],
    ]);
    expect(failed).toHaveBeenCalledTimes(6);
  });
});

describe("a computer's login", () => {
  /** Begin a login with no token, from a computer at this address. */
  async function begin(worker: ReturnType<typeof instance>, address: string): Promise<Response> {
    const headers = { "Content-Type": "application/json", "CF-Connecting-IP": address };

    return ask(worker, `${ADMIN}${ROUTES.beginLogin.path()}`, { method: "POST", headers, body: JSON.stringify({ scope: "publisher", computer: "laptop" }) });
  }

  function collect(worker: ReturnType<typeof instance>, secret: string): Promise<Response> {
    return api(worker, null, "POST", ROUTES.redeemLogin.path(), { secret });
  }

  // Drift: the pieces each hold their own rule, and the entry joins them: a route not mounted, a return path dropped at the login, or a dashboard built without its counters would leave no way to a first token.
  test("a computer with no token begins a login, the owner allows it on the dashboard after the login brings them back to its page, and the computer collects one token", async () => {
    const worker = instance(w);
    const begun = await done<Begun>(await begin(worker, "192.0.2.1"));
    const waiting = await done<{ state: string }>(await collect(worker, begun.secret));

    const stranger = await ask(worker, begun.verify_url);
    const login = await logIn(worker, w, stranger.headers.get("Location") ?? "");
    const session = { Cookie: cookieOf(login) };
    const page = await (await ask(worker, `${ADMIN}${login.headers.get("Location")}`, { headers: session })).text();
    const [, csrf = ""] = /name="csrf" value="([^"]+)"/.exec(page) ?? [];
    const form = new URLSearchParams({ code: begun.code, confirm: "yes", csrf }).toString();

    const unsigned = await ask(worker, `${ADMIN}/tokens/allow`, { method: "POST", headers: FORM, body: form });
    w.clock.now += 5000;
    const untouched = await done<{ state: string }>(await collect(worker, begun.secret));
    const allowed = await ask(worker, `${ADMIN}/tokens/allow`, { method: "POST", headers: { ...session, ...FORM }, body: form });
    w.clock.now += 5000;
    const collected = await done<{ state: string; token: string }>(await collect(worker, begun.secret));
    const again = await done<{ state: string }>(await collect(worker, begun.secret));
    const who = await done<{ token: { scope: string; note: string } }>(await api(worker, collected.token, "GET", ROUTES.whoami.path()));

    expect([begun.verify_url, waiting.state]).toEqual([`${ADMIN}/tokens/allow?code=${begun.code}`, "pending"]);
    expect([stranger.status, stranger.headers.get("Location")]).toEqual([302, `${ADMIN}/login?return=${encodeURIComponent(`/tokens/allow?code=${begun.code}`)}`]);
    expect([login.status, login.headers.get("Location"), page.includes(`>${begun.code}</p>`)]).toEqual([302, `/tokens/allow?code=${begun.code}`, true]);
    expect([unsigned.status, untouched.state]).toEqual([303, "pending"]);
    expect([allowed.status, allowed.headers.get("Location")]).toEqual([303, "/tokens?done=allowed"]);
    expect([collected.state, again.state, who.token]).toMatchObject(["allowed", "expired", { scope: "publisher", note: "laptop" }]);
  });

  // Drift: the two login routes are the only ones a request with no token may reach; an entry that let a third through would hand the install to anyone who can reach its address.
  test("every other route of the API refuses a request with no token", async () => {
    const worker = instance(w);
    const open: readonly string[] = OPEN_ROUTES;
    const closed = Object.entries(ROUTES).filter(([name]) => !open.includes(name));
    const statuses: [string, number][] = [];

    for (const [name, route] of closed) {
      const path = (route.path as (args: object) => string)(NAMED);
      const answer = await api(worker, null, route.method, path, route.sends === "json" ? {} : undefined);
      statuses.push([name, answer.status]);
    }

    expect(closed.length).toBeGreaterThan(25);
    expect(statuses.filter(([, status]) => status !== 401)).toEqual([]);
  });

  // Drift: questions are counted by the address Cloudflare saw, and logins begun by all addresses together. One key for everyone would let one computer silence every terminal, and no count of the install would let a few addresses spend a day's writes.
  test("the sixth login begun in a minute is refused whichever address begins it, and the twenty-sixth question of one address is refused while another address is answered", async () => {
    const worker = instance(w);
    const question = (address: string): Promise<Response> => {
      const headers = { "Content-Type": "application/json", "CF-Connecting-IP": address };

      return ask(worker, `${ADMIN}${ROUTES.redeemLogin.path()}`, { method: "POST", headers, body: JSON.stringify({ secret: `poplin_login_${"0".repeat(16)}_${"0".repeat(64)}` }) });
    };
    const begun: number[] = [];
    const asked: number[] = [];

    // The binding's minute is the wall clock's, not the test's: a run that would cross one waits for the next.
    const left = MINUTE_MS - (Date.now() % MINUTE_MS);
    if (left < MINUTE_END_MS) await new Promise((resolve) => setTimeout(resolve, left));

    for (let sent = 0; sent < 5; sent += 1) begun.push((await begin(worker, "192.0.2.1")).status);
    begun.push((await begin(worker, "192.0.2.2")).status);
    for (let sent = 0; sent < 26; sent += 1) asked.push((await question("192.0.2.1")).status);
    asked.push((await question("192.0.2.2")).status);

    expect([begun, asked]).toEqual([
      [200, 200, 200, 200, 200, 429],
      [...Array.from({ length: 25 }, () => 200), 429, 200],
    ]);
  });
});

describe("the built bundle", () => {
  const modules = [...bundle.matchAll(/^\/\/ (\S+\.[cm]?[jt]s)$/gm)].map(([, path = ""]) => path);

  // Drift: the file the OpenTofu module uploads is built from the entry's imports, so one import of a test helper or a whole library would ship to every install.
  test("is one module of the entry and what it imports, under the size cap, with no test or fixture file in it", () => {
    expect(modules).toContain("packages/cloudflare/src/worker/worker.ts");
    expect(modules.filter((path) => /(^|\/)tests\/|\.test\.|\/support\/|vitest|fixtures/.test(path))).toEqual([]);
    expect([...bundle.matchAll(/^import .*$/gm)].map(([line]) => line)).toEqual([]);
    expect(new TextEncoder().encode(bundle).byteLength).toBeLessThan(MOST_BUNDLE_BYTES);
  });

  // Drift: a release writes its number into the package's manifest alone, so a bundle that held a number of its own would name an old release on every install.
  test("answers with the version the released package's manifest states", async () => {
    // The built Worker reads the runtime's own clock, so its token is issued at that time.
    const token = await tokenOf({ ...w, clock: { now: Date.now() } }, "admin");
    const answered = await done<{ version: string }>(await api(built, token, "GET", ROUTES.whoami.path()));

    expect(answered.version).toBe((JSON.parse(manifest) as { version: string }).version);
  });
});
