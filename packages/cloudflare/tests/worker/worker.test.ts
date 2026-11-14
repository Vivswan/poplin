// The Worker's entry, driven as Cloudflare drives it, on the simulated bucket, database, and rate limiter.
// Without these the pieces could each pass their own tests and still not be joined into a product that publishes a site and serves it.

import { reset } from "cloudflare:test";
import { OPEN_ROUTES, ROUTES } from "@poplin/core/src/api/routes";
import { settingsFromText } from "@poplin/core/src/records/settings";
import { beforeEach, describe, expect, test } from "vitest";
import bundle from "../../dist/worker.js?raw";
import type { Bindings } from "../../src/worker/bindings";
import { ADMIN, ask, api, BINDINGS, cookieOf, countedBindings, done, installOf, instance, logIn, OWNER, type Published, page, publish, tokenOf, type World, wait, world } from "./support/install";

/** The largest bundle that passes: three times today's, so a library pulled in whole fails here. */
const MOST_BUNDLE_BYTES = 1_000_000;

/** A file large enough that it cannot pass through in one piece: 5 MiB. */
const LARGE_BYTES = 5 * 1024 * 1024;

/** The example first settings of wrangler.jsonc. */
const FIRST = BINDINGS.FIRST_SETTINGS as Readonly<Record<string, string>>;

/** The milliseconds of one minute, which is how long the rate limiting binding counts for. */
const MINUTE_MS = 60_000;

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
  // Drift: two instances that start together would each store settings and a key of their own, and a session made by one would be no session at the other.
  test("two instances starting together on an empty database end with the schema, one settings record from FIRST_SETTINGS, and one signing key", async () => {
    const [one, other] = [instance(w), instance(w)];
    const started = await Promise.all([ask(one, `${ADMIN}/api/whoami`), ask(other, `${ADMIN}/api/whoami`)]);
    const { database } = await installOf(w);
    const first = settingsFromText(FIRST);
    if (!first.ok) throw new Error(`the example first settings are refused at ${first.key}`);

    const stored = (await database.listAudit({ limit: 100 })).filter((entry) => entry.action === "settings_set");

    const site = await publish(other, await tokenOf(w, "publisher"), { name: "notes" }, [page("<p>notes</p>")]);
    const session = cookieOf(await logIn(one, w));
    const opened = await ask(other, `${site.addresses.site}/`, { headers: { Cookie: session } });

    expect(started.map((answer) => answer.status)).toEqual([401, 401]);
    expect(await database.readSettings()).toEqual(first.values);
    expect(stored.map((entry) => entry.by)).toEqual([OWNER]);
    expect({ status: opened.status, text: await opened.text() }).toEqual({ status: 200, text: "<p>notes</p>" });
  });

  // Drift: a later apply of the module changes FIRST_SETTINGS; an instance that read the binding again would overwrite what the dashboard set.
  test("an instance that starts on stored settings never reads FIRST_SETTINGS: it starts without the binding and leaves the settings as they are", async () => {
    await ask(instance(w), `${ADMIN}/api/whoami`);
    const later = withBindings({ FIRST_SETTINGS: undefined });
    const answer = await ask(instance(w), `${ADMIN}/api/whoami`, {}, later);

    expect(answer.status).toBe(401);
    expect((await (await installOf(w)).database.readSettings())?.trash_days).toBe(7);
  });

  const stopped: readonly { readonly name: string; readonly broken: () => Bindings; readonly status: number; readonly says: string; readonly hides: string }[] = [
    { name: "a ZONE binding with a key missing", broken: () => withBindings({ ZONE: { domain: "example.com" } }), status: 500, says: "its ZONE binding is refused (bad-shape)", hides: "example.com" },
    { name: "no ZONE binding", broken: () => withBindings({ ZONE: undefined }), status: 500, says: "its ZONE binding is refused (absent)", hides: "example.com" },
    {
      name: "an ACCESS binding whose audience is no tag",
      broken: () => withBindings({ ACCESS: { team_domain: "team.cloudflareaccess.com", audience: "not-a-tag" } }),
      status: 500,
      says: "its ACCESS binding is refused (bad-audience)",
      hides: "not-a-tag",
    },
    {
      name: "a first setting in no form its key takes",
      broken: () => withBindings({ FIRST_SETTINGS: { ...FIRST, trash_days: "soon" } }),
      status: 500,
      says: "its FIRST_SETTINGS binding is refused (bad-form at trash_days)",
      hides: "soon",
    },
    {
      name: "a first setting under a key that is no setting",
      broken: () => withBindings({ FIRST_SETTINGS: { ...FIRST, poplin_0123456789abcdef: "on" } }),
      status: 500,
      says: "its FIRST_SETTINGS binding is refused (unknown-key)",
      hides: "poplin_0123456789abcdef",
    },
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
  // Drift: any one join could break alone: the API's install, serving's session reader, the login's cookie domain, or the address the API prints against the one serving reads.
  test("a site published through the API is private until the login, public under its public name, and gone from an address a new link replaced", async () => {
    const worker = instance(w);
    const token = await tokenOf(w, "publisher");
    const site = await publish(worker, token, { name: "report" }, [page("<h1>report</h1>"), { path: "data/table.csv", body: new TextEncoder().encode("a,b\n1,2\n"), type: "text/csv" }]);
    const home = `${site.addresses.site}/`;

    const closed = await ask(worker, home);
    const login = await logIn(worker, w, closed.headers.get("Location") ?? "");
    const session = { Cookie: cookieOf(login) };
    const opened = await ask(worker, home, { headers: session });
    const file = await ask(worker, `${site.addresses.site}/data/table.csv`, { headers: session });

    const shown = await done<{ site: Published }>(await api(worker, token, "PATCH", ROUTES.updateSite.path({ site: site.label }), { access: "public", public_name: "yearly" }));
    const named = await ask(worker, "https://yearly-page.example.com/");
    const moved = await done<{ site: Published }>(await api(worker, token, "POST", ROUTES.newLink.path({ site: site.label })));
    const old = await ask(worker, home, { headers: session });
    const fresh = await ask(worker, `${moved.site.addresses.site}/`);

    expect({ status: closed.status, to: closed.headers.get("Location") }).toEqual({ status: 302, to: `${ADMIN}/login?return=${encodeURIComponent(home)}` });
    expect({ status: login.status, to: login.headers.get("Location"), cache: login.headers.get("Cache-Control") }).toEqual({ status: 302, to: home, cache: "no-store" });
    expect(login.headers.get("Set-Cookie")).toMatch(/^__Secure-poplin-session=[^;]+; Secure; HttpOnly; SameSite=Lax; Path=\/; Max-Age=\d+; Domain=example\.com$/);
    expect({ status: opened.status, type: opened.headers.get("Content-Type"), text: await opened.text() }).toMatchObject({ status: 200, text: "<h1>report</h1>" });
    expect({ status: file.status, type: file.headers.get("Content-Type"), text: await file.text() }).toEqual({ status: 200, type: "text/csv", text: "a,b\n1,2\n" });
    expect(shown.site.addresses.public).toBe("https://yearly-page.example.com");
    expect({ status: named.status, text: await named.text() }).toEqual({ status: 200, text: "<h1>report</h1>" });
    expect((await (await installOf(w)).database.listAudit({ limit: 100 })).filter((entry) => entry.action === "login").map((entry) => entry.by)).toEqual([OWNER]);
    expect(moved.site.addresses.site).not.toBe(site.addresses.site);
    expect([old.status, fresh.status]).toEqual([404, 200]);
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

  // Drift: a label with a site's id under another name is no address of the site; counted for the site, anyone who learned an id could use up its minute.
  test("a label with a site's id under another name spends nothing of that site's minute", async () => {
    const strict = withBindings({ FIRST_SETTINGS: { ...FIRST, site_requests_per_minute: "1" } });
    const worker = instance(w);
    await ask(worker, `${ADMIN}/api/whoami`, {}, strict);
    const site = await publish(worker, await tokenOf(w, "publisher"), { name: "docs", access: "public" }, [page("<p>docs</p>")]);

    const misnamed = await ask(worker, `https://other--${site.id}-page.example.com/`, { headers: { "CF-Connecting-IP": "203.0.113.7" } });
    const real = await ask(worker, "https://docs-page.example.com/", { headers: { "CF-Connecting-IP": "198.51.100.9" } });
    const again = await ask(worker, "https://docs-page.example.com/", { headers: { "CF-Connecting-IP": "192.0.2.44" } });

    expect([misnamed.status, real.status, again.status]).toEqual([302, 200, 429]);
  });

  // Drift: the routes should make a stray hostname impossible; if one arrives, it must not be read as the dashboard or as a site.
  test.each(["https://example.org/", "https://example.com/", "https://plain.example.com/", "https://admin.example.com.example.org/api/whoami"])("%s is neither the admin hostname nor a site's and gets serving's 404", async (address) => {
    const answer = await ask(instance(w), address);

    expect({ status: answer.status, text: await answer.text(), cache: answer.headers.get("Cache-Control") }).toEqual({ status: 404, text: "Not found\n", cache: "no-store" });
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

  // Drift: the dashboard would be mounted without a session reader, or with one that trusts a key the install no longer has.
  test("the dashboard shows the sites to a session and sends anyone else to the login; signing everyone out ends a session there at once, and at another instance's sites within its minute", async () => {
    const worker = instance(w);
    const token = await tokenOf(w, "admin");
    const site = await publish(worker, token, { name: "report" }, [page("<h1>report</h1>")]);
    const session = { Cookie: cookieOf(await logIn(worker, w)) };

    const stranger = await ask(worker, `${ADMIN}/`);
    const sites = await ask(worker, `${ADMIN}/`, { headers: session });
    const unmarked = await ask(worker, `${ADMIN}/sites/${site.label}/delete`, { method: "POST", headers: { ...session, ...FORM }, body: "" });
    const after = await done<{ site: Published }>(await api(worker, token, "GET", ROUTES.getSite.path({ site: site.label })));
    const unknown = await ask(worker, `${ADMIN}/no-such-page`, { headers: session });

    const elsewhere = instance(w);
    const privately = await ask(elsewhere, `${site.addresses.site}/`, { headers: session });
    await done(await api(worker, token, "DELETE", ROUTES.signEveryoneOut.path()));
    const signedOut = await ask(worker, `${ADMIN}/`, { headers: session });
    const withinTheMinute = await ask(elsewhere, `${site.addresses.site}/`, { headers: session });
    wait(w, 1 / 60);
    const afterTheMinute = await ask(elsewhere, `${site.addresses.site}/`, { headers: session });

    expect({ status: stranger.status, to: stranger.headers.get("Location") }).toEqual({ status: 302, to: `${ADMIN}/login?return=${encodeURIComponent("/")}` });
    expect({ status: sites.status, page: (await sites.text()).includes(site.label), policy: sites.headers.get("Content-Security-Policy") }).toMatchObject({ status: 200, page: true });
    expect(sites.headers.get("Content-Security-Policy")).toContain("default-src 'none'");
    expect([unmarked.status, after.site.state, unknown.status]).toEqual([403, "live", 404]);
    expect([privately.status, signedOut.status, withinTheMinute.status, afterTheMinute.status]).toEqual([200, 302, 200, 302]);
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

  // Drift: the counts are keyed by the address Cloudflare saw; an entry that passed no key, or one key for everyone, would let one computer lock every other out, or count nobody.
  test("the sixth login one address begins in a minute is refused, and another address begins one", async () => {
    const worker = instance(w);
    let statuses: number[] = [];
    let started = 0;

    // The binding's minute is the wall clock's, not the test's: a run that crosses one is made again.
    do {
      started = Math.floor(Date.now() / MINUTE_MS);
      statuses = [];
      for (let sent = 0; sent < 6; sent += 1) statuses.push((await begin(worker, "192.0.2.1")).status);
      statuses.push((await begin(worker, "192.0.2.2")).status);
    } while (Math.floor(Date.now() / MINUTE_MS) !== started);

    expect(statuses).toEqual([200, 200, 200, 200, 200, 429, 200]);
  });
});

describe("the built bundle", () => {
  const modules = [...bundle.matchAll(/^\/\/ (\S+\.[cm]?[jt]s)$/gm)].map(([, path = ""]) => path);

  // Drift: the file the OpenTofu module uploads is built from the entry's imports, so one import of a test helper or a whole library would ship to every install.
  test("is one module of the entry and what it imports, under the size cap, with no test or fixture file in it", () => {
    expect(modules).toContain("src/worker/worker.ts");
    expect(modules.filter((path) => /(^|\/)tests\/|\.test\.|\/support\/|vitest|fixtures/.test(path))).toEqual([]);
    expect([...bundle.matchAll(/^import .*$/gm)].map(([line]) => line)).toEqual([]);
    expect(new TextEncoder().encode(bundle).byteLength).toBeLessThan(MOST_BUNDLE_BYTES);
  });
});
