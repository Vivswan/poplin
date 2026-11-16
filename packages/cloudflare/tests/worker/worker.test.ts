// The Worker's entry, driven as Cloudflare drives it, on the simulated bucket, database, and rate limiter.
// Without these the pieces could each pass their own tests and still not be joined into a product that publishes a site and serves it.

import { reset } from "cloudflare:test";
import type { Api } from "@poplin/app/src/api/api";
import { publishSite } from "@poplin/core/src/actions/publish";
import { settingsFromText } from "@poplin/core/src/records/settings";
import { parse } from "es-module-lexer/js";
import type { ExtractSchema } from "hono/types";
import { hexToUint8Array, uint8ArrayToHex } from "uint8array-extras";
import { beforeEach, describe, expect, test, vi } from "vitest";
import manifest from "../../../cli/package.json?raw";
import built from "../../dist/worker.js";
import bundle from "../../dist/worker.js?raw";
import bundleMap from "../../dist/worker.js.map?raw";
import { DEFAULT_ICON } from "../../../app/src/sites/default-icon";
import { readShell } from "../../../app/tests/console/support/shell";
import type { Bindings } from "../../src/worker/bindings";
import { signer } from "../login/support/access";
import {
  ADMIN, type Answer, type ApiCalls, accessHeaders, ask, api, awayFromMinuteEnd, BINDINGS, cookieOf, countedBindings, done, freePlanBindings, installOf, instance, logIn, OWNER,
  PATHS, type Published, page, publish, send, spentDatabase, tokenOf, type World, under, wait, world,
} from "./support/install";

/** This repository's own guard against a library pulled in whole: Cloudflare takes a Worker of up to 64 MiB as it is, on every plan. The bundle is about 1,812,000 bytes, the dashboard's built client in it as strings. */
const MOST_BUNDLE_BYTES = 3_000_000;

/** This repository's own guard on the gzipped bundle: Cloudflare sets no limit on that size. The bundle is about 630,000 bytes then. */
const MOST_BUNDLE_GZIP_BYTES = 800_000;

/** A path that starts at the root of a disk, or an address: it would name the machine a map was built on. */
const ABSOLUTE = /^(?:[/\\]|[A-Za-z]:|[a-z]+:\/\/)/;

/** The folder of a person's account on macOS, Linux, or Windows, as a map's JSON would hold it. */
const HOME_FOLDER = /[/\\]Users[/\\]|\/home\//;

/** How long the test that copies a thousand files four times over may take, in milliseconds. */
const COPY_MS = 120_000;

/** The policy the dashboard goes out under: it runs its own script alone and reads this origin alone. */
const POLICY = "default-src 'none'; script-src 'self'; style-src 'self' 'unsafe-inline'; font-src 'self'; connect-src 'self'; img-src 'self' data:; form-action 'self'; frame-ancestors 'none'; base-uri 'none'";

/** How long a browser may keep a file of the dashboard's client: for good, as its name holds a hash of its content. */
const KEPT_FOR_GOOD = "public, max-age=31536000, immutable";

/** What the dashboard's data answers a request with no session. */
const NO_SESSION = { ok: false, code: "no_session", about: null, sentence: "Log in again." };

/** What the dashboard says while the database's free reading is used up for the day. */
const NO_READING = "The dashboard is paused: the free allowance of the database for reading is used up for today. It is back after midnight UTC.";

/** A file large enough that it cannot pass through in one piece: 5 MiB. */
const LARGE_BYTES = 5 * 1024 * 1024;

/** The first settings the tests' Worker starts from. */
const FIRST = BINDINGS.FIRST_SETTINGS as Readonly<Record<string, string>>;

/** What every host answers on a database another build of poplin made. */
const MADE_BY_ANOTHER_BUILD = "This install's database was made by another build of poplin, so its records are not the ones this build reads. Deploy the build that made it, or delete the database and poplin makes it anew.";

/** The most entries one file of the audit log holds. */
const FILE_ENTRIES = 2000;

/** A site in the form of one, for a request to every route that names a site. */
const SITE = { param: { site: "zzzzzzzzzzzz" } };

/** An upload in the form of one, for a request to every route that names an upload. */
const UPLOAD = { param: { upload: "zzzzzzzzzzzzzzzz" } };

/** A file of a version in the form of one, for a request to every route that names a file. */
const FILE = { version: "1", path: "index.html" };

/** The JSON of a request that is refused before its body is read. */
const UNREAD = {} as never;

/** One request to every route, under the path and the method the app declares it by. A route the app declares and this leaves out does not compile, nor one it does not declare. */
const EVERY_ROUTE: { readonly [Path in keyof Routes]: { readonly [Method in keyof Routes[Path]]: (calls: ApiCalls) => Promise<Answer> } } = {
  "/api/whoami": { $get: (calls) => calls.whoami.$get({ query: {} }) },
  "/api/token": { $delete: (calls) => calls.token.$delete({ query: {} }) },
  "/api/tokens": { $get: (calls) => calls.tokens.$get({ query: {} }), $post: (calls) => calls.tokens.$post({ query: {}, json: UNREAD }) },
  "/api/tokens/:token": { $delete: (calls) => calls.tokens[":token"].$delete({ param: { token: "00000000000000aa" }, query: {} }) },
  "/api/logins": { $post: (calls) => calls.logins.$post({ query: {}, json: UNREAD }) },
  "/api/logins/token": { $post: (calls) => calls.logins.token.$post({ query: {}, json: UNREAD }) },
  "/api/sites": { $get: (calls) => calls.sites.$get({ query: {} }) },
  "/api/sites/:site": {
    $get: (calls) => calls.sites[":site"].$get({ ...SITE, query: {} }),
    $patch: (calls) => calls.sites[":site"].$patch({ ...SITE, query: {}, json: UNREAD }),
    $delete: (calls) => calls.sites[":site"].$delete({ ...SITE, query: {} }),
  },
  "/api/sites/:site/rollback": { $post: (calls) => calls.sites[":site"].rollback.$post({ ...SITE, query: {}, json: UNREAD }) },
  "/api/sites/:site/new-link": { $post: (calls) => calls.sites[":site"]["new-link"].$post({ ...SITE, query: {} }) },
  "/api/sites/:site/restore": { $post: (calls) => calls.sites[":site"].restore.$post({ ...SITE, query: {} }) },
  "/api/sites/:site/duplicate": { $post: (calls) => calls.sites[":site"].duplicate.$post({ ...SITE, query: {}, json: UNREAD }) },
  "/api/uploads": { $post: (calls) => calls.uploads.$post({ query: {}, json: UNREAD }) },
  "/api/uploads/:upload": { $get: (calls) => calls.uploads[":upload"].$get({ ...UPLOAD, query: {} }), $delete: (calls) => calls.uploads[":upload"].$delete({ ...UPLOAD, query: {} }) },
  "/api/uploads/:upload/file": { $put: (calls) => calls.uploads[":upload"].file.$put({ ...UPLOAD, query: { path: FILE.path } }) },
  "/api/uploads/:upload/finish": { $post: (calls) => calls.uploads[":upload"].finish.$post({ ...UPLOAD, query: {} }) },
  "/api/export/settings": { $get: (calls) => calls.export.settings.$get({ query: {} }) },
  "/api/export/sites": { $get: (calls) => calls.export.sites.$get({ query: {} }) },
  "/api/export/sites/:site": { $get: (calls) => calls.export.sites[":site"].$get({ ...SITE, query: {} }) },
  "/api/export/sites/:site/files": { $get: (calls) => calls.export.sites[":site"].files.$get({ ...SITE, query: { version: FILE.version } }) },
  "/api/export/sites/:site/file": { $get: (calls) => calls.export.sites[":site"].file.$get({ ...SITE, query: FILE }) },
  "/api/import/settings": { $post: (calls) => calls.import.settings.$post({ query: {}, json: UNREAD }) },
  "/api/import/sites": { $post: (calls) => calls.import.sites.$post({ query: {}, json: UNREAD }) },
  "/api/config": { $get: (calls) => calls.config.$get({ query: {} }), $patch: (calls) => calls.config.$patch({ query: {}, json: UNREAD }) },
  "/api/sessions": { $delete: (calls) => calls.sessions.$delete({ query: {} }) },
  "/api/audit": { $get: (calls) => calls.audit.$get({ query: SITE.param }) },
  "/api/domain": { $get: (calls) => calls.domain.$get({ query: {} }) },
  "/api/update": { $post: (calls) => calls.update.$post({ query: {} }) },
  "/api/update/address": {
    $get: (calls) => calls.update.address.$get({ query: {} }),
    $put: (calls) => calls.update.address.$put({ query: {}, json: UNREAD }),
    $delete: (calls) => calls.update.address.$delete({ query: {} }),
  },
};

/** Every route the app declares, by its path and then its method. */
type Routes = ExtractSchema<Api>;

/** What the API answers a computer that begins a login. */
interface Begun {
  readonly code: string;
  readonly secret: string;
  readonly verify_url: string;
}

/** What an answer says: its status, where it sends, its media type, how long it is kept, and its whole text. */
interface Said {
  readonly status: number;
  readonly to: string | null;
  readonly type: string | null;
  readonly cache: string | null;
  readonly text: string;
}

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

/** A database binding that adds the rows every batch read to `rows`, as the provider counts them against a day's allowance. */
function meteredDatabase(database: D1Database, rows: { read: number }): D1Database {
  return new Proxy(database, {
    get(inner, name) {
      const member: unknown = Reflect.get(inner, name, inner);
      if (typeof member !== "function" || name !== "batch") return member;

      return async (...given: unknown[]): Promise<unknown> => {
        const results = (await Reflect.apply(member, inner, given)) as readonly D1Result[];
        for (const { meta } of results) rows.read += meta.rows_read;

        return results;
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

/** The bytes a text is once it is gzipped. */
async function gzippedBytes(text: string): Promise<number> {
  const gzipped = new Blob([text]).stream().pipeThrough(new CompressionStream("gzip"));

  return (await new Response(gzipped).arrayBuffer()).byteLength;
}

/** An answer as far as two Workers can be held against each other. */
async function said(answer: Response): Promise<Said> {
  return { status: answer.status, to: answer.headers.get("Location"), type: answer.headers.get("Content-Type"), cache: answer.headers.get("Cache-Control"), text: await answer.text() };
}

async function sha256(bytes: Uint8Array<ArrayBuffer>): Promise<string> {
  return uint8ArrayToHex(new Uint8Array(await crypto.subtle.digest("SHA-256", bytes)));
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
  test("FIRST_SETTINGS that names the logins alone starts the install with every other setting at its default", async () => {
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
    await BINDINGS.DB.exec("INSERT INTO schema_steps (step, description, applied_at, fingerprint) VALUES (999, 'a step of a newer poplin', 0, 'newer')");
    const refused = await ask(worker, `${ADMIN}/api/whoami`);
    await BINDINGS.DB.exec("DELETE FROM schema_steps WHERE step = 999");
    const served = await ask(worker, `${ADMIN}/api/whoami`);

    expect({ status: refused.status, text: await refused.text() }).toEqual({ status: 503, text: "This install's database is newer than its code: update poplin.\n" });
    expect(served.status).toBe(401);
  });

  // Drift: a database an earlier build made counts as up to date by its step number, so every request met the catch-all line with no reason: a public site's address, the dashboard, and the API alike.
  test.each([
    ["stored settings that lack a setting this build reads", "UPDATE settings SET value = json_remove(value, '$.max_storage_writes_per_day')"],
    ["a schema step another build applied", "UPDATE schema_steps SET fingerprint = 'of another build'"],
  ])("%s stop the start with the reason, on every host", async (_name, drift) => {
    await ask(instance(w), `${ADMIN}/api/whoami`);
    await BINDINGS.DB.exec(drift);
    const worker = instance(w);
    const answers = await Promise.all(["https://docs-page.example.com/", "https://docs-p-poplin.example.com/", `${ADMIN}/`, `${ADMIN}/api/whoami`].map((url) => ask(worker, url)));

    expect(await Promise.all(answers.map(async (answer) => ({ status: answer.status, text: await answer.text() })))).toEqual(
      answers.map(() => ({ status: 503, text: `${MADE_BY_ANOTHER_BUILD}\n` })),
    );
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

    const shown = await done<{ site: Published }>(await api(worker, token).sites[":site"].$patch({ param: { site: site.label }, query: {}, json: { access: "public", public_name: "yearly" } }));
    const named = await ask(worker, "https://yearly-page.example.com/");
    const stale = await ask(worker, `${under(site, "p")}/data/table.csv?x=1`, { headers: owner });
    const moved = await done<{ site: Published }>(await api(worker, token).sites[":site"]["new-link"].$post({ param: { site: site.label }, query: {} }));
    const old = [await ask(worker, `${under(site, "p")}/`, { headers: owner }), await ask(worker, `${under(site, "u")}/`)];
    const fresh = await ask(worker, `${under(moved.site, "u")}/`);

    expect({ status: open.status, to: open.headers.get("Location") }).toEqual({ status: 302, to: `${under(site, "p")}/data/table.csv?x=1` });
    expect({ status: around.status, to: around.headers.get("Location"), text: await around.text() }).toEqual({ status: 404, to: null, text: "Not found\n" });
    expect({ status: opened.status, cache: opened.headers.get("Cache-Control"), text: await opened.text() }).toEqual({ status: 200, cache: "private, no-cache", text: "<h1>report</h1>" });
    expect({ status: file.status, type: file.headers.get("Content-Type"), text: await file.text() }).toEqual({ status: 200, type: "text/csv", text: "a,b\n1,2\n" });
    expect({ status: login.status, to: login.headers.get("Location"), cache: login.headers.get("Cache-Control") }).toEqual({ status: 302, to: "/", cache: "no-store" });
    expect(login.headers.get("Set-Cookie")).toMatch(/^__Host-poplin-session=[^;]+; Max-Age=\d+; Path=\/; HttpOnly; Secure; SameSite=Lax$/);
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
    await done(await api(worker, await tokenOf(w, "admin")).config.$patch({ query: {}, json: { logins: [OWNER] } }));
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

  const lostPage = { path: "404.html", body: new TextEncoder().encode("<h1>lost</h1>"), type: "text/html" };
  const ownIcon = { path: "favicon.ico", body: new TextEncoder().encode("own icon"), type: "image/x-icon" };

  // Drift: a site without an icon would show a blank tab, the icon would cost a second bucket read where the site has a 404 page, a person's own icon would be replaced, or the icon would count as a page opened.
  test.each([
    { holds: "no icon of its own", files: [page("<p>docs</p>")], type: "image/svg+xml", text: DEFAULT_ICON, cache: "public, max-age=3600" },
    { holds: "no icon of its own and a 404 page", files: [page("<p>docs</p>"), lostPage], type: "image/svg+xml", text: DEFAULT_ICON, cache: "public, max-age=3600" },
    { holds: "an icon of its own", files: [page("<p>docs</p>"), lostPage, ownIcon], type: "image/x-icon", text: "own icon", cache: "public, max-age=86400" },
  ])("/favicon.ico of a site that holds $holds costs one site query, one request count, and one bucket read, and is no page view", async ({ files, type, text, cache }) => {
    const tally = { calls: 0 };
    const worker = instance(w);
    await ask(worker, `${ADMIN}/api/whoami`, {}, countedBindings(tally));
    const site = await publish(worker, await tokenOf(w, "publisher"), { name: "docs", access: "public" }, files);
    await ask(worker, "https://docs-page.example.com/");

    tally.calls = 0;
    const icon = await ask(worker, "https://docs-page.example.com/favicon.ico");
    const { calls } = tally;
    const { database, now } = await installOf(w);
    const views = await database.readViews([site.id] as never, new Date(now()).toISOString().slice(0, 10));

    const headers = { type: icon.headers.get("Content-Type"), sniff: icon.headers.get("X-Content-Type-Options"), cache: icon.headers.get("Cache-Control") };

    expect({ status: icon.status, ...headers, text: new TextDecoder().decode(await icon.arrayBuffer()), calls, views: [...views.values()] }).toEqual({
      status: 200,
      type,
      sniff: "nosniff",
      cache,
      text,
      calls: 3,
      views: [{ today: 1, week: 1 }],
    });
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
    await done(await api(worker, token).sites[":site"].rollback.$post({ param: { site: site.label }, query: {}, json: { version: 1 } }));
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
    await awayFromMinuteEnd();
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
    await awayFromMinuteEnd();
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
    await awayFromMinuteEnd();
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
        const answer = await ask(instance(w), address, { method, headers: { Cookie: "__Host-poplin-session=x" } }, bindings);
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
    const known = await api(worker, token).whoami.$get({ query: {} });
    const unknown = await api(worker, null).whoami.$get({ query: {} });
    const exported = await api(worker, token).export.settings.$get({ query: {} });
    const unsigned = await ask(worker, `${ADMIN}/login`);
    const posted = await ask(worker, `${ADMIN}/login`, { method: "POST" });

    expect({ status: known.status, body: await known.json() }).toMatchObject({ status: 200, body: { token: { scope: "admin", note: "a test" } } });
    expect([unknown.status, exported.status, unsigned.status, posted.status]).toEqual([401, 200, 403, 405]);
    expect([unsigned.headers.get("Set-Cookie"), posted.headers.get("Allow")]).toEqual([null, "GET"]);
  });

  // Drift: the dashboard would be mounted without a session reader, or with one that trusts a key the install no longer has; or its session would open, or its sign-out would close, a private site.
  // A change taken as a form would let a page of another origin send one with the owner's session.
  test("the dashboard answers its page and its data to a session and sends anyone else to the login; a change is JSON alone; signing everyone out ends the dashboard's sessions at once and leaves a private site to Access", async () => {
    const worker = instance(w);
    const token = await tokenOf(w, "admin");
    const site = await publish(worker, token, { name: "report" }, [page("<h1>report</h1>")]);
    const session = { Cookie: cookieOf(await logIn(worker, w)) };
    const owner = await accessHeaders(w);
    const remove = `${ADMIN}/data/sites/${site.label}/delete`;
    const form = { ...session, "Content-Type": "application/x-www-form-urlencoded" };

    const strangers = [await ask(worker, `${ADMIN}/`), await ask(worker, `${ADMIN}/data/sites`), await send(worker, remove, {})];
    const shell = await ask(worker, `${ADMIN}/sites/${site.label}`, { headers: session });
    const sites = await ask(worker, `${ADMIN}/data/sites`, { headers: session });
    const forms = [await send(worker, remove, {}, { ...form, Origin: "https://elsewhere.example.net", "Sec-Fetch-Site": "cross-site" }), await send(worker, remove, {}, form)];
    const after = await done<{ site: Published }>(await api(worker, token).sites[":site"].$get({ param: { site: site.label }, query: {} }));
    const unknown = await ask(worker, `${ADMIN}/data/no-such-data`, { headers: session });

    const out = await send(worker, `${ADMIN}/data/settings/sign-everyone-out`, {}, session);
    const signedOut = [await ask(worker, `${ADMIN}/`, { headers: session }), await ask(worker, `${ADMIN}/data/sites`, { headers: session })];
    wait(w, 1 / 60);
    const privately = await ask(worker, `${under(site, "p")}/`, { headers: owner });

    expect(strangers.map((answer) => [answer.status, answer.headers.get("Location")])).toEqual([[302, `${ADMIN}/login?return=${encodeURIComponent("/")}`], [401, null], [401, null]]);
    expect(await strangers[1]?.json()).toEqual(NO_SESSION);
    expect([shell.status, shell.headers.get("Content-Security-Policy"), shell.headers.get("Cache-Control"), ((await readShell(await shell.text())).boot as { email: string }).email]).toEqual([200, POLICY, "no-store", OWNER]);
    expect([sites.status, (await sites.json<{ sites: Published[] }>()).sites.map((listed) => listed.label)]).toEqual([200, [site.label]]);
    expect([forms.map((answer) => answer.status), after.site.state, unknown.status]).toEqual([[403, 415], "live", 404]);
    expect([out.status, signedOut.map((answer) => answer.status), privately.status]).toEqual([200, [302, 401], 200]);
  });

  // Drift: D1 answers one invocation 50 queries, a batch being one. Reads that left their batch would cost every request of the dashboard a query more each, unseen until a long request ran out of them.
  test("a request of the dashboard on a warm instance asks the database as few questions as its row says, the session's read among them", async () => {
    const tally = { calls: 0 };
    const worker = instance(w);
    await ask(worker, `${ADMIN}/api/whoami`, {}, countedBindings(tally));
    const token = await tokenOf(w, "admin");
    const site = await publish(worker, token, { name: "report" }, [page("<h1>report</h1>")]);
    const session = { Cookie: cookieOf(await logIn(worker, w)) };
    const counted = async (answer: () => Promise<Response>): Promise<readonly [status: number, queries: number]> => {
      tally.calls = 0;

      return [(await answer()).status, tally.calls];
    };
    const asked = (path: string): Promise<readonly [status: number, queries: number]> => counted(() => ask(worker, `${ADMIN}${path}`, { headers: session }));

    expect({
      "an address that asks nothing but who is there": await asked("/data/public-address?name=docs"),
      "the people, who are in the settings the session read": await asked("/data/people"),
      "a page of the dashboard: the session, then all its frame shows": await asked("/"),
      "the frame alone": await asked("/data/frame"),
      "the sites, each with its views and who published it": await asked("/data/sites"),
      "the sites through the API: the token, then the settings with the sites and their views": await counted(() => ask(worker, `${ADMIN}/api/sites`, { headers: { Authorization: `Bearer ${token}` } })),
      "one site: the site, its views, and who published it": await asked(`/data/sites/${site.label}`),
      "a change to one site: the session, the settings with the site, the change": await counted(() => send(worker, `${ADMIN}/data/sites/${site.label}/naming`, { title: "Report" }, session)),
      "one site through the API: the token, the settings with the site, its views": await counted(() => ask(worker, `${ADMIN}/api/sites/${site.id}`, { headers: { Authorization: `Bearer ${token}` } })),
    }).toEqual({
      "an address that asks nothing but who is there": [200, 1],
      "the people, who are in the settings the session read": [200, 1],
      "a page of the dashboard: the session, then all its frame shows": [200, 2],
      "the frame alone": [200, 2],
      "the sites, each with its views and who published it": [200, 2],
      "the sites through the API: the token, then the settings with the sites and their views": [200, 2],
      "one site: the site, its views, and who published it": [200, 4],
      "a change to one site: the session, the settings with the site, the change": [200, 3],
      "one site through the API: the token, the settings with the site, its views": [200, 3],
    });
  });

  // Drift: a read is answered from the settings its own request read on the way in. Kept any longer than the request, a setting changed a moment ago would be shown as it was.
  test("a setting changed through the dashboard is what the very next read shows, on the same instance and on another", async () => {
    const [worker, other] = [instance(w), instance(w)];
    const session = { Cookie: cookieOf(await logIn(worker, w)) };
    const people = async (from: ReturnType<typeof instance>): Promise<unknown> => (await (await ask(from, `${ADMIN}/data/people`, { headers: session })).json<{ logins: string[] }>()).logins;
    const before = [await people(worker), await people(other)];
    const added = await send(worker, `${ADMIN}/data/people/add`, { login: "bo@example.com" }, session);

    expect([before, added.status, await people(worker), await people(other)]).toEqual([[[OWNER], [OWNER]], 200, [OWNER, "bo@example.com"], [OWNER, "bo@example.com"]]);
  });

  // Drift: the dashboard's client rides inside the Worker's one file. Built without it, or handed out behind the session, the page would load and draw nothing; without the header a browser would fetch two megabytes again at every visit.
  test("the dashboard's page names a script and a stylesheet under /assets/, and each is answered to anyone by its media type, for a browser to keep for good; a name the build did not write is not found", async () => {
    const worker = instance(w);
    const shell = await readShell(await (await ask(worker, `${ADMIN}/`, { headers: { Cookie: cookieOf(await logIn(worker, w)) } })).text());
    const files = await Promise.all([...shell.scripts, ...shell.styles, "/assets/app-00000000.js"].map((path) => ask(worker, `${ADMIN}${path}`)));
    const sizes = await Promise.all(files.map(async (file) => (await file.arrayBuffer()).byteLength > 1000));

    expect([shell.scripts, shell.styles].map((names) => names.map((name) => name.startsWith("/assets/")))).toEqual([[true], [true]]);
    expect(files.map((file, at) => [file.status, file.headers.get("Content-Type"), file.headers.get("Cache-Control"), sizes[at]])).toEqual([
      [200, "text/javascript;charset=utf-8", KEPT_FOR_GOOD, true],
      [200, "text/css;charset=utf-8", KEPT_FOR_GOOD, true],
      [404, "text/plain; charset=UTF-8", null, false],
    ]);
  });
});

describe("the audit log as a file", () => {
  // Drift: the log is only ever added to, so its file is the one answer of the dashboard that grows with it. Built whole, read a listing's page at a time, or with no bound, it would pass what the Free plan gives one request.
  test("a log longer than a file holds is sent a reading at a time, 2,000 entries in 4 queries and a row read an entry, and says that the log holds more; where the next file goes on costs 3 queries and the same rows", async () => {
    const session = { Cookie: cookieOf(await logIn(instance(w), w)) };
    await BINDINGS.DB.prepare(
      "WITH RECURSIVE counted(entry) AS (SELECT 1 UNION ALL SELECT entry + 1 FROM counted WHERE entry < ?) INSERT INTO audit (at, actor, action, detail) SELECT ?, ?, 'login', '{}' FROM counted",
    )
      .bind(FILE_ENTRIES + 200, Date.now(), OWNER)
      .run();
    const tally = { calls: 0 };
    const rows = { read: 0 };
    const bindings = freePlanBindings(tally);
    const metered = { ...bindings, DB: meteredDatabase(bindings.DB, rows) };
    // A new instance, since an instance keeps the bindings of its first request. That request is asked before the file, so this count leaves out what an instance's start costs: the test below counts a file that is an instance's first request.
    const worker = instance(w);
    await ask(worker, `${ADMIN}/data/frame`, { headers: session }, metered);
    const start = { ...tally, ...rows };

    const answer = await ask(worker, `${ADMIN}/data/activity/download?part=1`, { headers: session }, metered);
    const pieces: string[] = [];
    const decoder = new TextDecoder();
    for await (const piece of answer.body ?? []) pieces.push(decoder.decode(piece));
    const file = { calls: tally.calls - start.calls, read: rows.read - start.read };
    const next = await ask(worker, `${ADMIN}/data/activity/download/next`, { headers: session }, metered);

    expect([answer.status, answer.headers.get("Content-Disposition")]).toEqual([200, expect.stringMatching(/^attachment; filename="poplin-activity-\d{4}-\d{2}-\d{2}-1\.csv"$/)]);
    expect(pieces.map((piece) => piece.split("\r\n").length - 1)).toEqual([1, 1000, 1000, 1]);
    expect(pieces.at(-1)).toBe('"2,000 entries. The log holds more: download the next part."\r\n');
    expect([file, await next.json(), { calls: tally.calls - start.calls - file.calls, read: rows.read - start.read - file.read }]).toEqual([
      { calls: 4, read: FILE_ENTRIES + 3 },
      { ok: true, from: expect.stringMatching(/^[1-9]\d*$/), after: expect.stringMatching(/^[1-9]\d*$/) },
      { calls: 3, read: FILE_ENTRIES + 4 },
    ]);
  });

  // Drift: a reading that named its sites and its tokens by lookups of a hundred ids each would take 47 queries for such a file, and 51 as an instance's first request: one more than the Free plan gives, so the download would break off.
  // The rows are pinned where no start is counted: an entry and its token's row, each read once.
  test.each([
    ["an instance that answered before", true, { calls: 4, read: 2 * FILE_ENTRIES + 4 }],
    ["a new instance, its start counted with the file", false, { calls: 8 }],
  ])("a file of 2,000 entries, each about its own site that is gone and by its own token, is read by %s in the queries of any other file, far under the Free plan's 50", async (_which, warm, cost) => {
    const session = { Cookie: cookieOf(await logIn(instance(w), w)) };
    const counted = "WITH RECURSIVE counted(entry) AS (SELECT 1 UNION ALL SELECT entry + 1 FROM counted WHERE entry < ?)";
    await BINDINGS.DB.batch([
      BINDINGS.DB.prepare(`${counted} INSERT INTO tokens (id, hash, scope, note, created_at) SELECT printf('%016x', entry), 'none', 'publisher', 'agent ' || entry, ? FROM counted`).bind(FILE_ENTRIES + 200, Date.now()),
      BINDINGS.DB.prepare(
        `${counted} INSERT INTO audit (at, actor, action, site_id, site_name, detail) SELECT ?, printf('%016x', entry), 'delete', printf('%012d', entry), 'gone-' || entry, '{}' FROM counted`,
      ).bind(FILE_ENTRIES + 200, Date.now()),
    ]);
    const tally = { calls: 0 };
    const rows = { read: 0 };
    const bindings = freePlanBindings(tally);
    const metered = { ...bindings, DB: meteredDatabase(bindings.DB, rows) };
    const worker = instance(w);
    if (warm) await ask(worker, `${ADMIN}/data/frame`, { headers: session }, metered);
    const start = { ...tally, ...rows };

    const answer = await ask(worker, `${ADMIN}/data/activity/download`, { headers: session }, metered);
    const lines = (await answer.text()).split("\r\n");

    expect([lines.length - 1, lines[1]?.split(",").slice(1), lines.at(-2)]).toEqual([
      FILE_ENTRIES + 2,
      [`agent ${FILE_ENTRIES + 200}`, "Deleted for good", `gone-${FILE_ENTRIES + 200}`, "", "delete"],
      '"2,000 entries. The log holds more: download the next part."',
    ]);
    expect({ calls: tally.calls - start.calls, read: rows.read - start.read }).toMatchObject(cost);
  });
});

describe("a copy of a site", () => {
  // Drift: the Free plan ends a request past 50 queries of the database, 4 of them made by a request that starts an instance, and bounds the bucket apart. A copy that counts its own calls alone passes 50 on a new instance.
  test.each([
    [130, 2, { database: [9, 13], bucket: [225, 225] }],
    [1_001, 10, { database: [9, 13], bucket: [228, 228] }],
  ])(
    "of %i files takes %i requests through the API, and the request that makes the most calls stays under 44 to the database and 250 to the bucket, on an instance that runs and on one each request starts",
    async (count, requests, most) => {
      // The first request of an install stores its settings, which a publish reads.
      await ask(instance(w), `${ADMIN}/api/whoami`);
      const token = await tokenOf(w, "admin");
      const files = Array.from({ length: count }, (_page, at) => ({ path: at === 0 ? "index.html" : `pages/${at}.html`, size: 1, contentType: "text/html", open: () => new Blob(["x"]).stream() }));
      const source = await publishSite(await installOf(w), { scope: "admin", holder: OWNER }, { name: "report", files });
      if (!source.ok) throw new Error(`the source was refused: ${source.code}`);

      /** The most calls one request of a copy made to the database and to the bucket, and how many requests the copy took; `fresh` starts a new instance for every request. */
      const costs = async (fresh: boolean): Promise<{ readonly database: number; readonly bucket: number; readonly requests: number }> => {
        const [database, bucket] = [{ calls: 0 }, { calls: 0 }];
        const counted = (): Bindings => ({ ...BINDINGS, DB: countedBindings(database).DB, SITES: countedBindings(bucket).SITES });
        const most = { database: 0, bucket: 0, requests: 0 };
        let [worker, bindings] = [instance(w), counted()];
        // An instance keeps the bindings of its first request, so the one that runs is started on the counted ones.
        if (!fresh) await ask(worker, `${ADMIN}/api/whoami`, {}, bindings);

        for (let round: { site: unknown; copy?: { upload: string } } = { site: null }; round.site === null; most.requests += 1) {
          if (fresh) [worker, bindings] = [instance(w), counted()];

          const before = [database.calls, bucket.calls] as const;
          round = await done(await send(worker, `${ADMIN}/api/sites/${source.site.id}/duplicate`, round.copy === undefined ? {} : { upload: round.copy.upload }, { Authorization: `Bearer ${token}` }, bindings));
          Object.assign(most, { database: Math.max(most.database, database.calls - before[0]), bucket: Math.max(most.bucket, bucket.calls - before[1]) });
        }

        return most;
      };
      const [warm, cold] = [await costs(false), await costs(true)];

      expect([warm.requests, cold.requests]).toEqual([requests, requests]);
      expect({ database: [warm.database, cold.database], bucket: [warm.bucket, cold.bucket] }).toEqual(most);
    },
    COPY_MS,
  );
});

describe("a database that takes no more writes for the day", () => {
  // Drift: an instance wrote on every start and the login wrote before its redirect, so a set-up install answered nobody once its writes were spent. Letting a first login through the same way would leave the setup page open behind a person who is in.
  test("a new instance of a set-up install starts, serves a page and a file, logs a person in without the audit entry, which the log notes, and answers the dashboard; the first login of an install is refused and its setup stays open", async () => {
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
    for (const path of ["/", "/data/frame", "/data/sites", `/data/sites/${site.label}`, "/data/activity", "/data/usage", "/data/tokens", "/data/people", "/data/settings"]) answers.push(await ask(worker, `${ADMIN}${path}`, session, spent));
    const logins = (await database.listAudit({ limit: 100 })).filter((entry) => entry.action === "login");

    expect([first.status, first.headers.get("Set-Cookie"), open]).toEqual([503, null, true]);
    expect([later.status, later.headers.get("Location"), logins.length]).toEqual([302, "/", 1]);
    expect(answers.map((answer) => answer.status)).toEqual(answers.map(() => 200));
    expect(warned.mock.calls).toEqual([]);
    expect(failed.mock.calls.map(([line]) => String(line).split("\n")[0])).toEqual(["poplin: a request failed (AllowanceSpent, caused by Error)", "poplin: a login was not written to the audit log (AllowanceSpent, caused by Error)"]);
  });
});

describe("a database whose allowance for the day is used up", () => {
  // Drift: D1 says so only in the words of an error, and every address answered a bare 503 or 500 that named nothing. A visitor, a caller of the API, and the owner each need it in their own form, with the wait to midnight UTC, or they ask again all day.
  test("a site's address answers the paused page, the API the code with what ran out, the dashboard's page its sentence and the dashboard's data its refusal, and a program's setup run its refusal: each a 503 with the seconds to midnight UTC", async () => {
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
      await ask(paused, `${ADMIN}${PATHS.whoami.$path()}`, { headers: bearer }, noReading),
      await ask(paused, `${ADMIN}/`, { headers: session }, noReading),
      await ask(paused, `${ADMIN}/data/sites`, { headers: session }, noReading),
      await ask(paused, `${ADMIN}/setup/api/check`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ token: "a-token-0123456789-abcdefgh" }) }, noReading),
      await ask(reading, `${ADMIN}${PATHS.tokens.$path()}`, { method: "POST", headers: { ...bearer, "Content-Type": "application/json" }, body: JSON.stringify({ scope: "publisher", note: "a test" }) }, noWriting),
      await send(reading, `${ADMIN}/data/settings/sign-everyone-out`, {}, session, noWriting),
    ];
    const told = await Promise.all(answers.map(async (answer) => [answer.status, answer.headers.get("Retry-After"), answer.headers.get("Cache-Control"), await answer.text()]));

    // The world's clock stands at 22:13:20 UTC: 6,400 seconds before midnight.
    expect(told).toEqual([
      [503, "6400", "public, max-age=60", "This site is paused until midnight UTC.\n"],
      [503, "6400", "public, max-age=60", ""],
      [503, "6400", "no-store", JSON.stringify({ error: { code: "allowance_spent", message: "a day's allowance of the install is used up: ask again after midnight UTC", about: "reading" } })],
      [503, "6400", "no-store", `${NO_READING}\n`],
      [503, "6400", "no-store", JSON.stringify({ ok: false, code: "allowance_spent", about: "reading", sentence: NO_READING })],
      [503, "6400", "no-store", JSON.stringify({ ok: false, refusal: "allowance_spent" })],
      [503, "6400", "no-store", JSON.stringify({ error: { code: "allowance_spent", message: "a day's allowance of the install is used up: ask again after midnight UTC", about: "writing" } })],
      [503, "6400", "no-store", JSON.stringify({ ok: false, code: "allowance_spent", about: "writing", sentence: "The database takes no more changes today: its free allowance for writing is used up. Changes work again after midnight UTC." })],
    ]);
    // The entry writes down each failure it answers itself. The dashboard answers the change it could not write, so the entry never sees that one.
    expect(failed).toHaveBeenCalledTimes(7);
  });
});

describe("a computer's login", () => {
  /** Begin a login with no token, from a computer at this address. */
  async function begin(worker: ReturnType<typeof instance>, address: string): Promise<Response> {
    const headers = { "Content-Type": "application/json", "CF-Connecting-IP": address };

    return ask(worker, `${ADMIN}${PATHS.logins.$path()}`, { method: "POST", headers, body: JSON.stringify({ scope: "publisher", computer: "laptop" }) });
  }

  function collect(worker: ReturnType<typeof instance>, secret: string): Promise<Answer> {
    return api(worker, null).logins.token.$post({ query: {}, json: { secret } });
  }

  // Drift: the pieces each hold their own rule, and the entry joins them: a route not mounted, a return path dropped at the login, or a dashboard built without its counters would leave no way to a first token.
  test("a computer with no token begins a login, the owner allows it through the dashboard after the login brings them back to the address the terminal printed, and the computer collects one token", async () => {
    const worker = instance(w);
    const begun = await done<Begun>(await begin(worker, "192.0.2.1"));
    const waiting = await done<{ state: string }>(await collect(worker, begun.secret));

    const stranger = await ask(worker, begun.verify_url);
    const login = await logIn(worker, w, stranger.headers.get("Location") ?? "");
    const session = { Cookie: cookieOf(login) };
    const opened = await ask(worker, `${ADMIN}${login.headers.get("Location")}`, { headers: session });
    const found = await ask(worker, `${ADMIN}/data/logins/find?code=${begun.code}`, { headers: session });
    const decision = { code: begun.code, allow: true, confirm: true, scope: "publisher" };

    const unsigned = await send(worker, `${ADMIN}/data/logins/decide`, decision);
    w.clock.now += 5000;
    const untouched = await done<{ state: string }>(await collect(worker, begun.secret));
    const allowed = await send(worker, `${ADMIN}/data/logins/decide`, decision, session);
    w.clock.now += 5000;
    const collected = await done<{ state: string; token: string }>(await collect(worker, begun.secret));
    const again = await done<{ state: string }>(await collect(worker, begun.secret));
    const who = await done<{ token: { scope: string; note: string } }>(await api(worker, collected.token).whoami.$get({ query: {} }));

    expect([begun.verify_url, waiting.state]).toEqual([`${ADMIN}/tokens/allow?code=${begun.code}`, "pending"]);
    expect([stranger.status, stranger.headers.get("Location")]).toEqual([302, `${ADMIN}/login?return=${encodeURIComponent(`/tokens/allow?code=${begun.code}`)}`]);
    expect([login.status, login.headers.get("Location"), opened.status, ((await readShell(await opened.text())).boot as { email: string }).email]).toEqual([302, `/tokens/allow?code=${begun.code}`, 200, OWNER]);
    expect([found.status, await found.json()]).toMatchObject([200, { ok: true, login: { code: begun.code, computer: "laptop", scope: "publisher" } }]);
    expect([unsigned.status, untouched.state]).toEqual([401, "pending"]);
    expect([allowed.status, await allowed.json()]).toEqual([200, { ok: true, allowed: true, scope: "publisher" }]);
    expect([collected.state, again.state, who.token]).toMatchObject(["allowed", "expired", { scope: "publisher", note: "laptop" }]);
  });

  // Drift: the two login routes are the only ones a request with no token may reach; an entry that let a third through would hand the install to anyone who can reach its address.
  test("every other route of the API refuses a request with no token", async () => {
    const worker = instance(w);
    const { "/api/logins": begin, "/api/logins/token": redeem, ...closed } = EVERY_ROUTE;
    const statuses: [string, number][] = [];

    for (const [path, methods] of Object.entries(closed)) {
      for (const [method, send] of Object.entries(methods)) statuses.push([`${method} ${path}`, (await send(api(worker, null))).status]);
    }

    expect(statuses.length).toBeGreaterThan(25);
    expect(statuses.filter(([, status]) => status !== 401)).toEqual([]);
  });

  // Drift: the Worker is where the address check and the count of starts are joined to a real request. Wired without either, a pasted address of any host would be sent to, or a script could queue builds without end.
  test("an admin saves only a Deploy Hook, one start sends it one POST that follows no redirect, and a second start in the minute sends nothing", async () => {
    const hook = "https://api.cloudflare.com/client/v4/workers/builds/deploy_hooks/a1b2c3d4-e5f6-7890-abcd-ef1234567890";
    const sent: unknown[][] = [];
    const worker = instance(w, undefined, undefined, async (address, init) => {
      sent.push([address, init.method, init.redirect, "body" in init]);

      return Response.json({ success: true });
    });
    const token = await tokenOf(w, "admin");
    const start = (): Promise<Answer> => api(worker, token).update.$post({ query: { anyway: "true" } });

    await awayFromMinuteEnd();

    const elsewhere = await api(worker, token).update.address.$put({ query: {}, json: { address: "https://example.com/client/v4/workers/builds/deploy_hooks/a1b2c3d4" } });
    const unsaved = await start();
    const saved = await done<{ set: boolean }>(await api(worker, token).update.address.$put({ query: {}, json: { address: hook } }));
    const first = await done<{ started: boolean; to: string | null }>(await start());
    const second = await start();
    const state = await api(worker, token).update.address.$get({ query: {} });

    expect([elsewhere.status, unsaved.status, saved.set, first, second.status]).toEqual([400, 409, true, { started: true, from: JSON.parse(manifest).version, to: null }, 429]);
    expect(sent).toEqual([[hook, "POST", "manual", false]]);
    expect(await state.text()).not.toContain("a1b2c3d4");
  });

  // Drift: one key for everyone would let one computer silence every terminal, a share as large as the whole would let one address refuse every login, and no count of the install would let a few addresses spend a day's writes.
  test("one address's third login of a minute is refused while others begin theirs, the ninth of all is refused, and one address's twenty-sixth question is refused while another's is answered", async () => {
    const worker = instance(w);
    const question = (address: string): Promise<Response> => {
      const headers = { "Content-Type": "application/json", "CF-Connecting-IP": address };

      return ask(worker, `${ADMIN}${PATHS.logins.token.$path()}`, { method: "POST", headers, body: JSON.stringify({ secret: `poplin_login_${"0".repeat(16)}_${"0".repeat(64)}` }) });
    };
    const begun: number[] = [];
    const asked: number[] = [];

    await awayFromMinuteEnd();

    for (let sent = 0; sent < 3; sent += 1) begun.push((await begin(worker, "192.0.2.1")).status);
    for (const address of ["192.0.2.2", "192.0.2.2", "192.0.2.3", "192.0.2.3", "192.0.2.4", "192.0.2.4", "192.0.2.5"]) begun.push((await begin(worker, address)).status);
    for (let sent = 0; sent < 26; sent += 1) asked.push((await question("192.0.2.1")).status);
    asked.push((await question("192.0.2.2")).status);

    expect([begun, asked]).toEqual([
      [200, 200, 429, 200, 200, 200, 200, 200, 200, 429],
      [...Array.from({ length: 25 }, () => 200), 429, 200],
    ]);
  });
});

describe("the built bundle", () => {
  // The bundle is minified and names no file, so the files it was built from are read from the map written beside it.
  const modules = (JSON.parse(bundleMap) as { sources: string[] }).sources;

  // Drift: the file the OpenTofu module uploads is built from the entry's imports, so one import of a test helper or a whole library would ship to every install.
  test("is one module of the entry and what it imports, under the size caps as it is and gzipped, with no test or fixture file in it", async () => {
    expect(modules).toContain("../src/worker/worker.ts");
    expect(modules.filter((path) => /(^|\/)tests\/|\.test\.|\/support\/|vitest|fixtures/.test(path))).toEqual([]);
    expect(parse(bundle)[0].map((left) => left.n)).toEqual([]);
    expect(new TextEncoder().encode(bundle).byteLength).toBeLessThan(MOST_BUNDLE_BYTES);
    expect(await gzippedBytes(bundle)).toBeLessThan(MOST_BUNDLE_GZIP_BYTES);
  });

  // Drift: every upload sends the map to Cloudflare, sources and all, so a path of the machine that built it would go with it; a map written into the bundle would triple the file an install runs.
  // The map is about 7,100,000 bytes, 1,350,000 gzipped. Cloudflare takes a map of up to 60 MiB, 15 MiB gzipped, so no cap of this repository is set on it.
  test("ends in the name of the map beside it, and the map names every source by a relative path and holds no home folder", () => {
    const map = JSON.parse(bundleMap) as { sources: string[]; sourceRoot?: string };

    expect(bundle.trimEnd().split("\n").at(-1)).toBe("//# sourceMappingURL=worker.js.map");
    expect([map.sourceRoot ?? "", ...map.sources].filter((path) => ABSOLUTE.test(path))).toEqual([]);
    expect(bundleMap.match(HOME_FOLDER)).toBeNull();
  });

  // Drift: every other test here runs the Worker's source, and the file an install runs is that source minified: a name the minifier changed that the code reads back would break that file alone.
  // A release writes its number into the package's manifest alone, so a bundle that held a number of its own would name an old release on every install.
  test("logs a person in, hands out the dashboard's page and its files, refuses a call with no token, and publishes and serves a site, each as the Worker's source does; a token is answered the version the released package's manifest states", async () => {
    // The built Worker reads the runtime's own clock and `fetch`, so the tokens are live now and the team's keys come from the stand-in. It starts once, so this one test asks it everything.
    const now = { ...w, clock: { now: Date.now() } };
    using keys = vi.spyOn(globalThis, "fetch").mockImplementation((address, init) => w.certs.fetch(String(address), init as Parameters<typeof w.certs.fetch>[1]));
    const session = { Cookie: cookieOf(await logIn(built, now)) };
    const shell = await ask(built, `${ADMIN}/`, { headers: session });
    const read = await readShell(await shell.text());
    const token = await tokenOf(now, "publisher");
    const site = await publish(built, token, { name: "report", access: "public", public_name: "yearly" }, [page("<h1>report</h1>")]);
    const answered = await done<{ version: string }>(await api(built, token).whoami.$get({ query: {} }));

    const addresses = [`${ADMIN}/`, ...[...read.scripts, ...read.styles].map((path) => `${ADMIN}${path}`), `${ADMIN}/api/whoami`, "https://yearly-page.example.com/", "https://nothing-page.example.com/"];
    const answers = (worker: typeof built): Promise<Said[]> => Promise.all(addresses.map(async (address) => said(await ask(worker, address))));
    const fromBuilt = await answers(built);

    expect([shell.status, (read.boot as { email: string }).email, site.addresses.public, keys.mock.calls.length]).toEqual([200, OWNER, "https://yearly-page.example.com", 1]);
    expect(answered.version).toBe((JSON.parse(manifest) as { version: string }).version);
    expect(fromBuilt.map((answer) => answer.status)).toEqual([302, 200, 200, 401, 200, 404]);
    expect(fromBuilt).toEqual(await answers(instance(now)));
  });
});

describe("bytes as hex, inside the runtime the Worker runs in", () => {
  // Drift: stored hashes, the signing key, and visitor keys were written in these exact characters; a hex library that failed in this runtime, or wrote capitals, would match none of them.
  test.each([
    [[], ""],
    [[0], "00"],
    [[0x00, 0x0f, 0xff], "000fff"],
    [[0xde, 0xad, 0xbe, 0xef], "deadbeef"],
  ])("the bytes %j are %j, both ways", (bytes, hex) => {
    expect({ written: uint8ArrayToHex(Uint8Array.from(bytes)), read: Array.from(hexToUint8Array(hex)) }).toEqual({ written: hex, read: bytes });
  });
});
