import { describe, expect, test } from "bun:test";

import { decideLogin } from "@poplin/core/src/actions/computer-logins";
import { publishSite } from "@poplin/core/src/actions/publish";
import type { Install } from "@poplin/core/src/actions/records";
import type { Login } from "@poplin/core/src/auth/logins";
import { AllowanceSpent } from "@poplin/core/src/database/driver";
import { dayOf } from "@poplin/core/src/records/views";
import type { InferRequestType } from "hono/client";
import type { ExtractSchema } from "hono/types";

import type { Api } from "../../src/api/api";
import { ADDRESSES } from "../sites/support/layout";
import { type Answered, type ApiClient, type ApiInstall, answered, bytes, INSTALL_VERSION, LIMITS, NOW, ORIGIN, openApi, REBUILD_ADDRESS, VISITOR_HEADER } from "./support/install";

/** Every path the API declares, each with the methods it takes. */
type Declared = ExtractSchema<Api>;

/** The method a client's call is named after: `GET` for `$get`. */
type MethodOf<Call> = Call extends `$${infer Method}` ? Uppercase<Method> : never;

/** A route the API declares, by its method and its path: `GET /api/sites/:site`. */
type RouteKey = { [Path in keyof Declared & string]: `${MethodOf<keyof Declared[Path]>} ${Path}` }[keyof Declared & string];

/** A route that takes a token: every route but the two a computer logs in through. */
type TokenRoute = Exclude<RouteKey, (typeof OPEN_ROUTES)[number]>;

/** A call of one typed route, on its way. */
type Sent = Parameters<typeof answered>[0];

/** What sends one request through a client, as whoever the client sends as. */
type Send = (api: ApiClient) => Sent;

/** What a publish is begun with, less its files. */
type Publish = Omit<InferRequestType<ApiClient["uploads"]["$post"]>["json"], "files">;

/** What a listing of sites takes in its query, each value as text. */
type SitesQuery = InferRequestType<ApiClient["sites"]["$get"]>["query"];

/** How many milliseconds a day holds. */
const DAY = 86_400_000;

/** The files of the fixture site, each with its text. */
const PAGES = { "index.html": "<h1>report</h1>", "css/site.css": "body{}" };

/** An id in the form of a site id that no site has. */
const NO_SITE = "zzzzzzzzzzzz";

/** An id in the form of an upload id that no upload has. */
const NO_UPLOAD = "zzzzzzzzzzzzzzzz";

/** A site as a backup holds it, of one version with one file of four bytes. */
const BACKED_UP = {
  ...{ id: "k3f9x2ab71qz", name: "backed-up", title: null, page_title: null, access: "unlisted", search_engines: false, embeddable: true, expires: "never" },
  ...{ live_version: 1, versions: [{ number: 1, published_at: 1, published_by: "ada@example.com", bytes: 4, files: 1 }] },
  ...{ owner: "ada@example.com", created_at: 1, updated_at: 1, state: "live" },
};

/** How a 401 says to authenticate when the token it was sent is not a live one. */
const TOKEN_REFUSED = 'Bearer error="invalid_token"';

/** What a browser sends ahead of a script's request from another origin. */
const PREFLIGHT = { Origin: "https://www.example.com", "Access-Control-Request-Method": "GET" };

/** The content type of a file's bytes. */
const BYTES = { "Content-Type": "application/octet-stream" };

/** The content type of a form. */
const FORM = { "Content-Type": "application/x-www-form-urlencoded" };

/** One file more than the test install lets a publish declare. */
const MANY_FILES = Array.from({ length: LIMITS.files + 1 }, (_file, at) => ({ path: `${at}.html`, size: 1, content_type: "text/html" }));

/** A file one byte longer than the test install lets a request carry. */
const LONG_FILE = { path: "index.html", size: LIMITS.fileBytes + 1, content_type: "text/html" };

/** The two routes that take no token: a computer calls them to get one. */
const OPEN_ROUTES = ["POST /api/logins", "POST /api/logins/token"] as const satisfies readonly RouteKey[];

/** The one route that answers the bytes of a file. */
const FILE_ROUTE: RouteKey = "GET /api/export/sites/:site/file";

/** The most calls to the database and the store each route may make for one request, the token's lookup included. A route missing here does not compile. */
const BUDGET: Readonly<Record<RouteKey, number>> = {
  "GET /api/whoami": 3,
  "DELETE /api/token": 2,
  "GET /api/tokens": 2,
  "POST /api/tokens": 2,
  "DELETE /api/tokens/:token": 2,
  "POST /api/logins": 1,
  "POST /api/logins/token": 2,
  "GET /api/sites": 4,
  "GET /api/sites/:site": 5,
  "PATCH /api/sites/:site": 6,
  "POST /api/sites/:site/rollback": 5,
  "POST /api/sites/:site/new-link": 9,
  "DELETE /api/sites/:site": 35,
  "POST /api/sites/:site/restore": 5,
  "POST /api/sites/:site/duplicate": 47,
  "POST /api/uploads": 7,
  "GET /api/uploads/:upload": 14,
  "PUT /api/uploads/:upload/file": 6,
  "POST /api/uploads/:upload/finish": 44,
  "DELETE /api/uploads/:upload": 24,
  "GET /api/export/settings": 2,
  "GET /api/export/sites": 2,
  "GET /api/export/sites/:site": 4,
  "GET /api/export/sites/:site/files": 6,
  "GET /api/export/sites/:site/file": 5,
  "POST /api/import/settings": 2,
  "POST /api/import/sites": 7,
  "GET /api/config": 2,
  "PATCH /api/config": 3,
  "DELETE /api/sessions": 2,
  "GET /api/audit": 2,
  "GET /api/domain": 2,
  "POST /api/update": 5,
  "GET /api/update/address": 2,
  "PUT /api/update/address": 2,
  "DELETE /api/update/address": 2,
};

/** How long a test that copies a thousand files may take, in milliseconds: it passes alone in under a second, and a busy machine takes it past the runner's five. */
const COPY_MS = 30_000;

/** Every route the API declares, in the order of the budgets. */
const ROUTE_KEYS = Object.keys(BUDGET) as RouteKey[];

/** Every route that takes a token, in the same order. */
const TOKEN_ROUTES = ROUTE_KEYS.filter((route) => !(OPEN_ROUTES as readonly string[]).includes(route));

/** A request to every route that takes a token, each well formed, about a site and an upload that the fixture names. A route missing here does not compile. */
function samples(site: string, upload: string): Readonly<Record<TokenRoute, Send>> {
  return {
    "GET /api/whoami": (api) => api.whoami.$get({ query: {} }),
    "DELETE /api/token": (api) => api.token.$delete({ query: {} }),
    "GET /api/tokens": (api) => api.tokens.$get({ query: {} }),
    "POST /api/tokens": (api) => api.tokens.$post({ json: { scope: "publisher", note: "ci" }, query: {} }),
    "DELETE /api/tokens/:token": (api) => api.tokens[":token"].$delete({ param: { token: "00000000000000aa" }, query: {} }),
    "GET /api/sites": (api) => api.sites.$get({ query: {} }),
    "GET /api/sites/:site": (api) => api.sites[":site"].$get({ param: { site }, query: {} }),
    "PATCH /api/sites/:site": (api) => api.sites[":site"].$patch({ param: { site }, json: { title: "Q3 sales" }, query: {} }),
    "POST /api/sites/:site/rollback": (api) => api.sites[":site"].rollback.$post({ param: { site }, json: {}, query: {} }),
    "POST /api/sites/:site/new-link": (api) => api.sites[":site"]["new-link"].$post({ param: { site }, query: {} }),
    "DELETE /api/sites/:site": (api) => api.sites[":site"].$delete({ param: { site }, query: { forever: "true" } }),
    "POST /api/sites/:site/restore": (api) => api.sites[":site"].restore.$post({ param: { site }, query: {} }),
    "POST /api/sites/:site/duplicate": (api) => api.sites[":site"].duplicate.$post({ param: { site }, json: {}, query: {} }),
    "POST /api/uploads": (api) => api.uploads.$post({ json: { site, files: manifest(PAGES) }, query: {} }),
    "GET /api/uploads/:upload": (api) => api.uploads[":upload"].$get({ param: { upload }, query: {} }),
    "PUT /api/uploads/:upload/file": (api) => api.uploads[":upload"].file.$put({ param: { upload }, query: { path: "index.html" } }, bytes(PAGES["index.html"])),
    "POST /api/uploads/:upload/finish": (api) => api.uploads[":upload"].finish.$post({ param: { upload }, query: {} }),
    "DELETE /api/uploads/:upload": (api) => api.uploads[":upload"].$delete({ param: { upload }, query: {} }),
    "GET /api/export/settings": (api) => api.export.settings.$get({ query: {} }),
    "GET /api/export/sites": (api) => api.export.sites.$get({ query: {} }),
    "GET /api/export/sites/:site": (api) => api.export.sites[":site"].$get({ param: { site }, query: {} }),
    "GET /api/export/sites/:site/files": (api) => api.export.sites[":site"].files.$get({ param: { site }, query: { version: "1" } }),
    "GET /api/export/sites/:site/file": (api) => api.export.sites[":site"].file.$get({ param: { site }, query: { version: "1", path: "index.html" } }),
    "POST /api/import/settings": (api) => api.import.settings.$post({ json: { format: 1, settings: {} }, query: {} }),
    "POST /api/import/sites": (api) => api.import.sites.$post({ json: { format: 1, site: BACKED_UP as never, files: [{ path: "v1/index.html", size: 4, content_type: "text/html" }] }, query: {} }),
    "GET /api/config": (api) => api.config.$get({ query: {} }),
    "PATCH /api/config": (api) => api.config.$patch({ json: { trash_days: 9 }, query: {} }),
    "DELETE /api/sessions": (api) => api.sessions.$delete({ query: {} }),
    "GET /api/audit": (api) => api.audit.$get({ query: {} }),
    "GET /api/domain": (api) => api.domain.$get({ query: {} }),
    "POST /api/update": (api) => api.update.$post({ query: { anyway: "true" } }),
    "GET /api/update/address": (api) => api.update.address.$get({ query: {} }),
    "PUT /api/update/address": (api) => api.update.address.$put({ json: { address: REBUILD_ADDRESS }, query: {} }),
    "DELETE /api/update/address": (api) => api.update.address.$delete({ query: {} }),
  };
}

function manifest(pages: Readonly<Record<string, string>>): { path: string; size: number; content_type: string }[] {
  return Object.entries(pages).map(([path, text]) => ({ path, size: new TextEncoder().encode(text).length, content_type: "text/html; charset=utf-8" }));
}

function part(answer: Answered, key: string): Record<string, unknown> {
  return answer.body[key] as Record<string, unknown>;
}

/** The route the install's last request was sent to: the declared one its method and its path fit. */
function lastRoute(install: ApiInstall): RouteKey {
  const request = install.requests.at(-1);
  const sent = `${request?.method} ${new URL(request?.url ?? ORIGIN).pathname}`;
  const route = ROUTE_KEYS.find((declared) => new RegExp(`^${declared.replace(/:\w+/g, "[^/]+")}$`).test(sent));
  if (route === undefined) throw new Error(`no declared route fits ${sent}`);

  return route;
}

/** The cursor a listing answered as `next`, as the keys the query of the following request holds it under. */
function after(next: unknown): Record<string, string> {
  return Object.fromEntries(Object.entries(next as object).map(([key, value]) => [`after_${key}`, String(value)]));
}

/** List the sites the admin sees. */
function listed(install: ApiInstall, query: SitesQuery = {}): Promise<Answered> {
  return answered(install.routes.sites.$get({ query }));
}

/** A request the admin sends to a path written out by hand, as no client typed from the routes would. */
function raw(install: ApiInstall, path: string, init: RequestInit & { headers?: Record<string, string> } = {}): Request {
  return new Request(`${ORIGIN}${path}`, { ...init, headers: { ...init.headers, Authorization: `Bearer ${install.tokens.admin}` } });
}

/** Begin a publish and send every file of it; answers the upload's id. */
async function staged(install: ApiInstall, asked: Publish, pages: Readonly<Record<string, string>> = PAGES, token: string = install.tokens.owner): Promise<string> {
  const api = install.as(token);
  const begun = await answered(api.uploads.$post({ json: { ...asked, files: manifest(pages) }, query: {} }));
  if (begun.status !== 200) throw new Error(`the fixture publish was refused: ${JSON.stringify(begun.body)}`);

  const upload = part(begun, "upload").id as string;
  for (const [path, text] of Object.entries(pages)) await api.uploads[":upload"].file.$put({ param: { upload }, query: { path } }, bytes(text));

  return upload;
}

/** Publish over the staged routes; answers the site's id. */
async function published(install: ApiInstall, asked: Publish, pages?: Readonly<Record<string, string>>): Promise<string> {
  const upload = await staged(install, asked, pages);
  const finished = await answered(install.as(install.tokens.owner).uploads[":upload"].finish.$post({ param: { upload }, query: {} }));
  if (finished.status !== 200) throw new Error(`the fixture publish was not finished: ${JSON.stringify(finished.body)}`);

  return part(finished, "site").id as string;
}

/** What the install holds that a refused request must leave alone: the sites, the store's keys, and the count of audit entries. */
async function stateOf(install: ApiInstall): Promise<unknown> {
  const sites = await listed(install);
  const trash = await listed(install, { trash: "true" });

  return [sites.body, trash.body, await install.keys(), await install.audit(), (await install.database.listTokens()).length];
}

/** The test install as the rule book takes it, for a step that only a dashboard session can take. */
function installOf(install: ApiInstall): Install {
  return { database: install.database, store: install.store, now: () => install.clock.now, addressOf: ADDRESSES.addressOf, publicAddressOf: ADDRESSES.publicAddressOf, reservedNames: ADDRESSES.reservedNames };
}

describe("createApi", () => {
  // Drift: a client reads a public site's address with the word the install answers here; an answer without it, or with another install's, would name the wrong site or none.
  test.each(["page", "site"])("whoami carries the word the install's public addresses end in: %j", async (publicWord) => {
    const install = await openApi({}, LIMITS, publicWord);

    expect((await answered(install.routes.whoami.$get({ query: {} }))).body.public_word).toBe(publicWord);
  });

  // Drift: `whoami` is where the CLI and an agent learn that a newer version is out. An answer without the release, or with one on an install that knows none, would leave `poplin doctor` silent or wrong.
  test("whoami carries the newer release once the install has learned of one, and no such key before", async () => {
    const install = await openApi();
    const before = (await answered(install.routes.whoami.$get({ query: {} }))).body;
    await install.database.keepUpdateCheck({ checked_at: NOW, news: { version: "7.9.0", released: "2026-12-01", notes: "https://example.com/changelog/#v7-9-0", database: false } });

    expect(["update" in before, (await answered(install.routes.whoami.$get({ query: {} }))).body.update]).toEqual([
      false,
      { current: INSTALL_VERSION, newest: "7.9.0", released: "2026-12-01", notes: "https://example.com/changelog/#v7-9-0", database: false },
    ]);
  });

  // Drift: a client is typed from the routes the API declares; a route that no request here reached, that went over its budget of calls, or that dropped a fixed header would ship with no test failing.
  test("every route the API declares is answered, inside its budget of calls, and carries the fixed headers", async () => {
    const install = await openApi();
    const walked = new Set<string>();
    const over: string[] = [];

    // The request is sent after the counts are set to zero, so a call it makes at once is counted.
    const done = async (send: Send, api: ApiClient = install.routes): Promise<Answered> => {
      Object.assign(install.calls, { database: 0, store: 0 });
      const answer = await answered(send(api));
      const calls = install.calls.database + install.calls.store;
      const { headers } = answer.response;
      const route = lastRoute(install);
      walked.add(route);
      if (calls > BUDGET[route]) over.push(`${route}: ${calls} calls`);

      expect([route, answer.status, answer.body.error]).toEqual([route, 200, undefined]);
      const type = route === FILE_ROUTE ? "application/octet-stream" : "application/json; charset=utf-8";
      expect([headers.get("Cache-Control"), headers.get("X-Content-Type-Options"), headers.get("Content-Type")]).toEqual(["no-store", "nosniff", type]);

      return answer;
    };
    const sendFile = (upload: string, path: string, text: string): Promise<Answered> => done((api) => api.uploads[":upload"].file.$put({ param: { upload }, query: { path } }, bytes(text)));
    const finish = (upload: string): Promise<Answered> => done((api) => api.uploads[":upload"].finish.$post({ param: { upload }, query: {} }));

    expect(part(await done((api) => api.whoami.$get({ query: {} })), "token")).toMatchObject({ scope: "admin", note: "a test", expires: NOW + 30 * DAY });
    expect((await done((api) => api.whoami.$get({ query: {} }))).body.version).toBe(INSTALL_VERSION);
    const issued = await done((api) => api.tokens.$post({ json: { scope: "publisher", note: "ci" }, query: {} }));
    expect((await done((api) => api.tokens.$get({ query: {} }))).body.tokens).toHaveLength(4);
    expect(part(await done((api) => api.whoami.$get({ query: {} }), install.as(issued.body.token as string)), "token")).toMatchObject({ scope: "publisher", note: "ci", expires: "never" });
    await done((api) => api.tokens[":token"].$delete({ param: { token: part(issued, "record").id as string }, query: {} }));
    const login = await done((api) => api.logins.$post({ json: { scope: "publisher", computer: "laptop" }, query: {} }), install.as(null));
    expect(login.body).toMatchObject({ expires_in: 600, interval: 5, verify_url: `${ORIGIN}/tokens/allow?code=${login.body.code}` });
    expect((await done((api) => api.logins.token.$post({ json: { secret: login.body.secret as string }, query: {} }), install.as(null))).body).toEqual({ state: "pending" });

    const begun = await done((api) => api.uploads.$post({ json: { name: "report", files: manifest(PAGES) }, query: {} }));
    const upload = part(begun, "upload").id as string;
    expect((await done((api) => api.uploads[":upload"].$get({ param: { upload }, query: {} }))).body.missing).toEqual(["index.html", "css/site.css"]);
    for (const [path, text] of Object.entries(PAGES)) await sendFile(upload, path, text);
    const first = part(await finish(upload), "site");
    const label = first.label as string;
    const site = { site: label };

    expect(first).toMatchObject({ name: "report", created: true, access: "private", live_version: 1, bytes: 21, files: 2, updated: NOW, url: `https://${label}-p-poplin.example.com` });
    expect((await done((api) => api.sites.$get({ query: { limit: "1" } }))).body.sites).toHaveLength(1);
    const settings = (await done((api) => api.export.settings.$get({ query: {} }))).body.settings as Record<string, string>;
    const backup = part(await done((api) => api.export.sites[":site"].$get({ param: site, query: {} })), "site");
    expect([(await done((api) => api.export.sites.$get({ query: { limit: "1" } }))).body.sites, settings.trash_days]).toEqual([[backup], "7"]);
    expect((await done((api) => api.export.sites[":site"].files.$get({ param: site, query: { version: "1" } }))).body.files).toEqual([{ path: "css/site.css", size: 6 }, { path: "index.html", size: 15 }]);
    expect(await (await done((api) => api.export.sites[":site"].file.$get({ param: site, query: { version: "1", path: "index.html" } }))).response.text()).toBe(PAGES["index.html"]);
    expect(part(await done((api) => api.sites[":site"].$get({ param: site, query: {} })), "site").id).toBe(first.id);
    expect(part(await done((api) => api.sites[":site"].$patch({ param: site, json: { title: "Q3 sales", access: "unlisted" }, query: {} })), "site")).toMatchObject({ title: "Q3 sales", access: "unlisted" });
    expect(part(await done((api) => api.sites[":site"].$patch({ param: site, json: { name: "q3-report" }, query: {} })), "site")).toMatchObject({ id: first.id, name: "q3-report", label: `q3-report--${first.id}` });
    expect(part(await done((api) => api.sites[":site"].rollback.$post({ param: site, json: { version: 1 }, query: {} })), "site").live_version).toBe(1);
    const moved = part(await done((api) => api.sites[":site"]["new-link"].$post({ param: site, query: {} })), "site").id as string;
    expect(moved).not.toBe(first.id);
    expect(part(await done((api) => api.sites[":site"].duplicate.$post({ param: { site: moved }, json: { name: "report-copy" }, query: {} })), "site")).toMatchObject({ name: "report-copy", access: "private", created: true });
    expect(part(await done((api) => api.sites[":site"].$delete({ param: { site: moved }, query: {} })), "site").state).toBe("trash");
    expect(part(await done((api) => api.sites[":site"].restore.$post({ param: { site: moved }, query: {} })), "site").state).toBe("live");

    const second = part(await done((api) => api.uploads.$post({ json: { site: moved, files: manifest(PAGES) }, query: {} })), "upload").id as string;
    expect((await done((api) => api.uploads[":upload"].$delete({ param: { upload: second }, query: {} }))).body.left).toEqual([]);
    expect(part(await done((api) => api.config.$get({ query: {} })), "values").trash_days).toBe(7);
    expect(part(await done((api) => api.config.$patch({ json: { trash_days: 9 }, query: {} })), "values").trash_days).toBe(9);
    // Drift: a token names no email, so the API is the way a list of new emails alone would reach the store and shut the dashboard on everyone.
    const shut = await answered(install.routes.config.$patch({ json: { logins: ["new@example.com" as Login] }, query: {} }));
    expect([shut.status, shut.body.error]).toEqual([409, { code: "no_working_login", message: "the change would leave no login that works", about: "logins" }]);
    const key = await install.database.ensureSigningKey(new Uint8Array(32).fill(7), NOW);
    expect([(await done((api) => api.sessions.$delete({ query: {} }))).body, await install.database.readSigningKey()]).not.toEqual([{}, key.key]);
    expect(((await done((api) => api.audit.$get({ query: { limit: "3" } }))).body.entries as { action: string }[]).map((entry) => entry.action)).toEqual(["signed_everyone_out", "settings_changed", "restore"]);
    // Drift: the note of the last check of the domain is what `poplin doctor` prints; an answer of another form is one the command cannot read, so it would report a failure of the install where a login is broken.
    const ada = "ada@example.com" as Login;
    const piece = { piece: "Login", detail: "the dashboard's login", part: "login", state: "needs_repair" } as const;
    await install.database.keepDomainCheck({ ran_at: NOW, by: ada, run: "check", pieces: [piece] }, {});
    expect((await done((api) => api.domain.$get({ query: {} }))).body).toEqual({
      check: { ran_at: NOW, by: ada, run: "check", pieces: [piece] },
      age: 0,
      stale: false,
      waits: false,
      note: { code: "login_broken", about: "Login" },
    });
    // Drift: `poplin config logins` replaces the users through this route. A change that left no mark would have the domain say nobody waits while the added user cannot log in.
    const users = [ada, "bo@example.com" as Login];
    expect(part(await done((api) => api.config.$patch({ json: { logins: users }, query: {} })), "values").logins).toEqual(users);
    expect([(await done((api) => api.domain.$get({ query: {} }))).body.waits, (await install.database.readDomainCheck())?.users_changed_at]).toEqual([true, NOW]);
    expect(part(await done((api) => api.sites[":site"].$delete({ param: { site: moved }, query: { forever: "true" } })), "before").id).toBe(moved);
    expect(part(await done((api) => api.import.settings.$post({ json: { format: 1, settings }, query: {} })), "values").trash_days).toBe(7);
    const files = manifest(PAGES).map((file) => ({ ...file, path: `v1/${file.path}` }));
    const restored = part(await done((api) => api.import.sites.$post({ json: { format: 1, site: backup as never, files }, query: {} })), "upload").id as string;
    for (const [path, text] of Object.entries(PAGES)) await sendFile(restored, `v1/${path}`, text);
    expect(part(await finish(restored), "site")).toMatchObject({ id: first.id, label, created: true, live_version: 1 });
    expect((await done((api) => api.update.address.$put({ json: { address: REBUILD_ADDRESS }, query: {} }))).body).toEqual({ set: true, since: NOW });
    expect((await done((api) => api.update.$post({ query: { anyway: "true" } }))).body).toEqual({ started: true, from: INSTALL_VERSION, to: null });
    expect([(await done((api) => api.update.address.$get({ query: {} }))).body, install.provider.sent]).toEqual([{ set: true, since: NOW }, [["POST", "manual", "no body", REBUILD_ADDRESS]]]);
    expect((await done((api) => api.update.address.$delete({ query: {} }))).body).toEqual({ set: false, since: null });
    await done((api) => api.token.$delete({ query: {} }), install.as(install.tokens.stranger));

    expect((await install.as(install.tokens.stranger).whoami.$get({ query: {} })).status).toBe(401);
    expect([[...walked].sort(), over]).toEqual([[...ROUTE_KEYS].sort(), []]);
  });

  // Drift: the update link is typed once and is a credential from then on. A route that echoed it, in an answer, a refusal, a header, the log, or a backup, would hand it to every admin token and every reader of a backup.
  test("no route hands a typed update link back, kept or refused", async () => {
    const install = await openApi();
    const site = await published(install, { name: "report" });
    const upload = await staged(install, { site });
    const refused = await answered(install.routes.update.address.$put({ json: { address: "https://example.com/hooks/typed-and-refused" }, query: {} }));
    const asKey = await answered(install.routes.update.address.$put({ json: { address: REBUILD_ADDRESS, [`${REBUILD_ADDRESS}/typed-as-a-key`]: true } as never, query: {} }));
    const said: string[] = [JSON.stringify(refused.body), JSON.stringify(asKey.body)];
    await install.routes.update.address.$put({ json: { address: REBUILD_ADDRESS }, query: {} });
    const routes = Object.entries(samples(site, upload)) as [TokenRoute, Send][];
    for (const [route, send] of routes.filter(([route]) => route !== "DELETE /api/token" && route !== "DELETE /api/update/address" && route !== "DELETE /api/sessions")) {
      const { response } = await answered(send(install.routes));
      said.push(route, await response.text(), JSON.stringify([...response.headers]));
    }

    expect(said.filter((text) => text.includes("3f9c2a7e5b") || text.includes("builds.provider.example") || text.includes("typed-and-refused"))).toEqual([]);
    expect([asKey.status, refused.status, refused.body, (await install.database.readUpdateAddress())?.address, install.provider.sent.length]).toEqual([
      400,
      400,
      { error: { code: "bad_argument", message: "an argument is missing, unknown, or of the wrong form", about: "address" } },
      REBUILD_ADDRESS,
      1,
    ]);
  });

  // Drift: the CLI and the dashboard word a failed start by its code and status. Each row is a press of the button and what the API must answer, with what reached the provider.
  test.each([
    { name: "no address is saved", saved: false, answer: [409, "no_update_address", undefined], sent: 0 },
    { name: "no newer version is known", saved: true, answer: [409, "no_update", undefined], sent: 0 },
    { name: "the provider refuses", saved: true, anyway: true, provider: 403, answer: [502, "update_refused", "403"], sent: 1 },
    { name: "the provider redirects", saved: true, anyway: true, provider: 307, answer: [502, "update_refused", "307"], sent: 1 },
    { name: "a second press inside the minute", saved: true, anyway: true, pressed: true, answer: [429, "too_many_requests", "update"], sent: 1 },
  ])("a start is refused by its code: $name", async ({ saved, anyway, provider, pressed, answer, sent }) => {
    const install = await openApi();
    const query = anyway === undefined ? {} : { anyway: String(anyway) };
    if (saved) await install.routes.update.address.$put({ json: { address: REBUILD_ADDRESS }, query: {} });
    if (pressed === true) await install.routes.update.$post({ query });

    install.provider.status = provider ?? 200;
    const started = await answered(install.routes.update.$post({ query }));
    const error = part(started, "error");

    expect<unknown>([[started.status, error.code, error.about], install.provider.sent.length]).toEqual([answer, sent]);
  });

  // Drift: the cursor of a listing crosses the wire as two query keys; a key renamed on one side alone would hand every page the first sites again.
  test("a listing's `next` asks for the following page, in the sites and in the audit log", async () => {
    const install = await openApi();
    for (const [at, name] of ["one", "two", "three"].entries()) {
      install.clock.now = NOW + at;
      await published(install, { name });
    }

    const first = await listed(install, { limit: "2" });
    const rest = await listed(install, { limit: "2", ...after(first.body.next) });
    const entries = (await answered(install.routes.audit.$get({ query: { limit: "2" } }))).body.entries as { seq: number }[];
    const older = await answered(install.routes.audit.$get({ query: { limit: "2", after: String(entries.at(-1)?.seq) } }));
    const names = (answer: Answered): unknown[] => (answer.body.sites as { name: string }[]).map((site) => site.name);

    expect([names(first), names(rest), rest.body.next]).toEqual([["three", "two"], ["one"], undefined]);
    // Drift: the client checks a listing's query against the same shape the action takes; a key the address did not carry would be dropped without a word.
    expect([names(await listed(install, { named: "t" })), names(await listed(install, { named: "t", access: "public" }))]).toEqual([["three", "two"], []]);
    const actions = async (query: { kind: "access" | "sites"; site?: string }): Promise<string[]> => ((await answered(install.routes.audit.$get({ query }))).body.entries as { action: string }[]).map((entry) => entry.action);

    expect([new Set(await actions({ kind: "access" })), await actions({ kind: "sites", site: "three" })]).toEqual([new Set(["token_added"]), ["create"]]);

    const byName = await listed(install, { sort: "name", limit: "2", expires: "never" });
    const lastByName = await listed(install, { sort: "name", limit: "2", ...after(byName.body.next) });

    expect([names(byName), names(lastByName), names(await listed(install, { sort: "name", dir: "desc", limit: "1" }))]).toEqual([["one", "three"], ["two"], ["two"]]);

    // Drift: a listing by title carries the place of a title under a key of its own; a client that did not send it back would be refused the second page.
    const byTitle = await listed(install, { sort: "title", limit: "2" });
    const lastByTitle = await listed(install, { sort: "title", limit: "2", ...after(byTitle.body.next) });

    expect([names(byTitle), (byTitle.body.next as { title: string }).title, names(lastByTitle)]).toEqual([["one", "three"], "three", ["two"]]);
    expect((older.body.entries as { seq: number }[]).map((entry) => entry.seq)).toEqual([(entries[0]?.seq ?? 0) - 2, (entries[0]?.seq ?? 0) - 3]);

    const oldest = await answered(install.routes.audit.$get({ query: { limit: "2", dir: "asc" } }));
    const seqs = (answer: Answered): number[] => (answer.body.entries as { seq: number }[]).map((entry) => entry.seq);
    const next = await answered(install.routes.audit.$get({ query: { limit: "2", dir: "asc", after: String(seqs(oldest).at(-1)) } }));
    const wrong = await answered(install.routes.audit.$get({ query: { dir: "up" as never } }));

    expect([seqs(oldest), seqs(next), wrong.status, part(wrong, "error")]).toEqual([[1, 2], [3, 4], 400, expect.objectContaining({ code: "bad_argument", about: "dir" })]);
  });

  // Drift: every route changes or shows something an install owns; one that ran before the token was checked would be open to anyone who can reach the address.
  test.each([
    ["no token, though a cookie names an admin's", () => null, "Bearer"],
    ["a word that is no token", () => "let-me-in", TOKEN_REFUSED],
    ["a token of no record", () => `poplin_${"0".repeat(16)}_${"0".repeat(64)}`, TOKEN_REFUSED],
    ["a token with another's secret", (install: ApiInstall) => `${install.tokens.admin.slice(0, 24)}${install.tokens.owner.slice(24)}`, TOKEN_REFUSED],
    ["an admin token past its 30 days", (install: ApiInstall) => install.tokens.admin, TOKEN_REFUSED],
    ["a revoked token", (install: ApiInstall) => install.tokens.stranger, TOKEN_REFUSED],
  ])("a request with %s is answered 401 on every route, with nothing but the code and how to authenticate, and changes nothing", async (why, tokenOf, challenge) => {
    const install = await openApi();
    const site = await published(install, { name: "report" });
    const upload = await staged(install, { site });
    await install.as(install.tokens.stranger).token.$delete({ query: {} });
    const before = await stateOf(install);
    if (why.startsWith("an admin token past")) install.clock.now = NOW + 31 * DAY;

    const api = install.as(tokenOf(install), { Cookie: `session=${install.tokens.admin}` });
    const answers: unknown[] = [];
    for (const send of Object.values(samples(site, upload))) {
      const answer = await answered(send(api));
      answers.push([lastRoute(install), answer.status, answer.body, answer.response.headers.get("WWW-Authenticate")]);
    }

    const refused = { error: { code: "not_logged_in", message: "no token was sent, or it is not a live token of this install" } };
    install.clock.now = NOW;

    expect(answers).toEqual(TOKEN_ROUTES.map((route) => [route, 401, refused, challenge]));
    expect(await stateOf(install)).toEqual(before);
  });

  // Drift: HTTP lets a client write the scheme in any case and put more than one space after it; a stricter reading turns a live token away, and a looser one takes another scheme's credentials.
  test.each([
    ["the scheme in small letters", (token: string) => `bearer ${token}`, 200, null],
    ["two spaces after the scheme", (token: string) => `Bearer  ${token}`, 200, null],
    ["the scheme alone", () => "Bearer", 401, "Bearer"],
    ["under another scheme", (token: string) => `Basic ${token}`, 401, "Bearer"],
    ["with no scheme", (token: string) => token, 401, "Bearer"],
    ["twice", (token: string) => `Bearer ${token} ${token}`, 401, "Bearer"],
  ])("a live token sent as %s is read as HTTP reads it", async (_form, headerOf, status, challenge) => {
    const install = await openApi();

    const answered = await install.ask(new Request(`${ORIGIN}/api/whoami`, { headers: { Authorization: headerOf(install.tokens.admin) } }));

    expect([answered.status, answered.response.headers.get("WWW-Authenticate")]).toEqual([status, challenge]);
  });

  // Drift: a publisher token sits in an agent's shell; a route that skipped the action's check would let one agent read, change, or delete another's sites and uploads.
  test("a publisher is answered 404 for another's private site and upload on every route, 403 on the admin's routes, and changes nothing", async () => {
    const install = await openApi();
    const site = await published(install, { name: "report" });
    const upload = await staged(install, { site });
    const before = await stateOf(install);
    const stranger = install.as(install.tokens.stranger);

    const answers: unknown[] = [];
    for (const [route, send] of Object.entries(samples(site, upload)) as [TokenRoute, Send][]) {
      if (route === "DELETE /api/token" || route === "GET /api/whoami") continue;

      const answer = await answered(send(stranger));
      answers.push([route, answer.status, part(answer, "error")?.code ?? answer.body.sites]);
    }

    expect(answers).toEqual([
      ["GET /api/tokens", 403, "not_allowed"],
      ["POST /api/tokens", 403, "not_allowed"],
      ["DELETE /api/tokens/:token", 403, "not_allowed"],
      ["GET /api/sites", 200, []],
      ["GET /api/sites/:site", 404, "not_found"],
      ["PATCH /api/sites/:site", 404, "not_found"],
      ["POST /api/sites/:site/rollback", 404, "not_found"],
      ["POST /api/sites/:site/new-link", 404, "not_found"],
      ["DELETE /api/sites/:site", 404, "not_found"],
      ["POST /api/sites/:site/restore", 404, "not_found"],
      ["POST /api/sites/:site/duplicate", 404, "not_found"],
      ["POST /api/uploads", 404, "not_found"],
      ["GET /api/uploads/:upload", 404, "not_found"],
      ["PUT /api/uploads/:upload/file", 404, "not_found"],
      ["POST /api/uploads/:upload/finish", 404, "not_found"],
      ["DELETE /api/uploads/:upload", 404, "not_found"],
      ["GET /api/export/settings", 403, "not_allowed"],
      ["GET /api/export/sites", 403, "not_allowed"],
      ["GET /api/export/sites/:site", 403, "not_allowed"],
      ["GET /api/export/sites/:site/files", 403, "not_allowed"],
      ["GET /api/export/sites/:site/file", 403, "not_allowed"],
      ["POST /api/import/settings", 403, "not_allowed"],
      ["POST /api/import/sites", 403, "not_allowed"],
      ["GET /api/config", 403, "not_allowed"],
      ["PATCH /api/config", 403, "not_allowed"],
      ["DELETE /api/sessions", 403, "not_allowed"],
      ["GET /api/audit", 403, "not_allowed"],
      ["GET /api/domain", 403, "not_allowed"],
      ["POST /api/update", 403, "not_allowed"],
      ["GET /api/update/address", 403, "not_allowed"],
      ["PUT /api/update/address", 403, "not_allowed"],
      ["DELETE /api/update/address", 403, "not_allowed"],
    ]);
    expect(await stateOf(install)).toEqual(before);
    expect((await install.as(install.tokens.owner).uploads[":upload"].finish.$post({ param: { upload }, query: {} })).status).toBe(200);
  });

  // Drift: an admin token that could issue admin tokens would outlive its 30 days for good; a publisher that could revoke another token would lock an owner out.
  test("an admin token issues publisher tokens alone, and a publisher revokes no token but its own", async () => {
    const install = await openApi();
    const [asOwner, asStranger] = [install.as(install.tokens.owner), install.as(install.tokens.stranger)];
    const owner = part(await answered(asOwner.whoami.$get({ query: {} })), "token").id as string;

    const admin = await answered(install.routes.tokens.$post({ json: { scope: "admin", note: "more" }, query: {} }));
    const unknown = await answered(install.routes.tokens.$post({ json: { scope: "publisher", note: "ci", expires: "never" } as never, query: {} }));
    const others = await asStranger.tokens[":token"].$delete({ param: { token: owner }, query: {} });
    const own = await asOwner.tokens[":token"].$delete({ param: { token: owner }, query: {} });

    expect([admin.status, part(admin, "error").code, unknown.status, part(unknown, "error")]).toEqual([403, "not_allowed", 400, expect.objectContaining({ code: "bad_argument", about: "expires" })]);
    expect<number[]>([others.status, own.status, (await asOwner.whoami.$get({ query: {} })).status]).toEqual([403, 200, 401]);
  });

  // Drift: a host ends a request past 50 calls to the database, and the route reads the token first, in a request that may also start the host. A copy told nothing of that passes 50 on a host that just started.
  test.each([
    [1, 1],
    [48, 1],
    [300, 3],
    [1_001, 10],
  ])("a copy of %i files through the route is whole after %i requests, none of which makes more than 40 calls to the database, the 44 a copy is held to less the 4 of a host's start, or more than 250 to the store", async (count, requests) => {
    const install = await openApi({}, { fileBytes: 64, files: 10_000, manifestBytes: 2_000_000 });
    const files = Array.from({ length: count }, (_page, at) => ({ path: at === 0 ? "index.html" : `pages/${at}.html`, size: 1, contentType: "text/html", open: () => new Blob(["x"]).stream() }));
    const source = await publishSite(installOf(install), { scope: "admin", holder: "ada@example.com" as Login }, { name: "report", files });
    if (!source.ok) throw new Error(`the source was refused: ${source.code}`);

    const spent: (typeof install.calls)[] = [];
    let upload: string | undefined;

    for (let site: unknown = null; site === null; ) {
      Object.assign(install.calls, { database: 0, store: 0 });
      const step = await answered(install.routes.sites[":site"].duplicate.$post({ param: { site: source.site.id }, json: upload === undefined ? {} : { upload }, query: {} }));
      if (step.status !== 200) throw new Error(`a request was refused: ${JSON.stringify(step.body)}`);

      spent.push({ ...install.calls });
      upload = part(step, "copy").upload as string;
      site = step.body.site;
    }

    expect([spent.length, spent.filter((calls) => calls.database > 40 || calls.store > 250)]).toEqual([requests, []]);
  }, COPY_MS);
});

describe("the staged publish over HTTP", () => {
  // Drift: the files of a publish are in the bucket before the publish is live; a row written early would serve a half-uploaded site, or swap a live one mid-upload.
  test("a new site is in no listing, and a live site keeps its version and its files, until the upload is finished", async () => {
    const install = await openApi();
    const asOwner = install.as(install.tokens.owner);
    const site = await published(install, { name: "report" });
    const [audit, held] = [await install.audit(), (await listed(install)).body];

    const created = await staged(install, { name: "draft", access: "public" });
    const updated = await staged(install, { site, access: "unlisted", title: "Q3 sales" }, { "index.html": "<h1>report, again</h1>" });
    const folder = (await install.keys()).find((key) => key.endsWith("/v2/index.html"))?.split("/")[0];

    expect([(await listed(install)).body, await install.audit()]).toEqual([held, audit]);
    expect(await install.database.findServed({ public_name: "draft" as never }, NOW)).toBeUndefined();
    expect(part(await answered(install.routes.sites[":site"].$get({ param: { site }, query: {} })), "site")).toMatchObject({ live_version: 1, access: "private", title: null, versions: [{ number: 1 }] });

    const made = await answered(asOwner.uploads[":upload"].finish.$post({ param: { upload: created }, query: {} }));
    const added = await answered(asOwner.uploads[":upload"].finish.$post({ param: { upload: updated }, query: {} }));

    expect(part(made, "site")).toMatchObject({ name: "draft", created: true, access: "public", url: "https://draft-page.example.com" });
    expect(part(added, "site")).toMatchObject({ id: site, created: false, live_version: 2, access: "unlisted", title: "Q3 sales" });
    expect(part(added, "before")).toMatchObject({ live_version: 1, access: "private" });
    expect(await new Response((await install.store.read(`${folder}/v2/index.html` as never) as { body: ReadableStream }).body).text()).toBe("<h1>report, again</h1>");
  });

  // Drift: a client retries what it did not hear back from; a second upload of a file or a second finish that failed, or made a second site, would turn every lost answer into a broken publish.
  test("a file sent twice and a finish asked twice both answer as the first time, with one site made", async () => {
    const install = await openApi();
    const asOwner = install.as(install.tokens.owner);
    const upload = await staged(install, { name: "report" });
    const file = { param: { upload }, query: { path: "index.html" } };
    const again = await answered(asOwner.uploads[":upload"].file.$put(file, bytes(PAGES["index.html"])));
    const first = await answered(asOwner.uploads[":upload"].finish.$post({ param: { upload }, query: {} }));
    const second = await answered(asOwner.uploads[":upload"].finish.$post({ param: { upload }, query: {} }));
    const late = await answered(asOwner.uploads[":upload"].file.$put(file, bytes("<h1>other</h1>....")));

    expect([again.status, again.body]).toEqual([200, { path: "index.html", size: 15 }]);
    expect([first.status, second.status, second.body]).toEqual([200, 200, first.body]);
    expect([late.status, part(late, "error").code]).toEqual([409, "upload_finished"]);
    const { created, ...site } = part(first, "site");
    const shown = await answered(install.routes.uploads[":upload"].$get({ param: { upload }, query: {} }));

    expect([created, (await listed(install)).body.sites]).toEqual([true, [{ ...site, views: { today: 0, week: 0 } }]]);
    expect([part(shown, "upload").state, shown.body.missing, shown.body.more]).toEqual(["finished", [], false]);
  });

  // Drift: a host bills every listing of its store past a month's free amount. A route that listed uncounted, or went on listing at the bound, would let a client's loop run up a bill; one that failed a delete there would keep a site its owner removed.
  test("every listing a route makes is counted against the day; at the bound a route that lists is refused with when to come back, and a delete leaves its files to the sweep", async () => {
    const install = await openApi({ max_storage_writes_per_day: 8 });
    const counts: unknown[] = [];
    const count = async (): Promise<void> => void counts.push((await install.database.readStorageWrites(dayOf(NOW)))?.writes);
    const api = install.routes;
    const files = (site: string): Promise<Answered> => answered(api.export.sites[":site"].files.$get({ param: { site }, query: { version: "1" } }));

    const upload = await staged(install, { name: "report" });
    await count();
    for (let asked = 0; asked < 2; asked += 1) await api.uploads[":upload"].$get({ param: { upload }, query: {} });
    await count();
    const site = part(await answered(install.as(install.tokens.owner).uploads[":upload"].finish.$post({ param: { upload }, query: {} })), "site").id as string;
    await count();
    const listed = await files(site);
    await count();
    const copy = await answered(api.sites[":site"].duplicate.$post({ param: { site }, json: {}, query: {} }));
    await count();
    const last = await files(site);
    await count();
    const refused = await files(site);
    const removed = await answered(api.sites[":site"].$delete({ param: { site }, query: { forever: "true" } }));
    await count();
    install.clock.now += DAY;
    const tomorrow = await answered(api.uploads.$post({ json: { name: "report", files: manifest(PAGES) }, query: {} }));

    const spent = { error: { code: "allowance_spent", message: "a day's allowance of the install is used up: ask again after midnight UTC", about: "max_storage_writes_per_day" } };
    expect(counts).toEqual([2, 4, 5, 6, 7, 8, 8]);
    expect([listed.status, last.status, tomorrow.status]).toEqual([200, 200, 200]);
    // The fixtures' moment is 22:13:20 UTC: 6,400 seconds before midnight.
    expect([copy.status, copy.body, copy.response.headers.get("Retry-After")]).toEqual([503, spent, "6400"]);
    expect([refused.status, refused.body, refused.response.headers.get("Retry-After")]).toEqual([503, spent, "6400"]);
    expect([removed.status, (removed.body.left as string[]).length, (await api.sites[":site"].$get({ param: { site }, query: {} })).status, (await install.keys()).length]).toEqual([200, 1, 404, 2]);
  });

  // Drift: each row is a way a publish ends without going live; files left in the bucket under no site would fill it unseen, and a half-sent file would be served.
  test.each([
    ["abandoned", async (install: ApiInstall, upload: string) => answered(install.as(install.tokens.owner).uploads[":upload"].$delete({ param: { upload }, query: {} })), 200, undefined],
    ["finished after a newer publish went live", async (install: ApiInstall, upload: string, site: string) => {
      await published(install, { site });

      return answered(install.as(install.tokens.owner).uploads[":upload"].finish.$post({ param: { upload }, query: {} }));
    }, 409, "stale_version"],
    ["finished after its site went to the trash", async (install: ApiInstall, upload: string, site: string) => {
      await install.routes.sites[":site"].$delete({ param: { site }, query: {} });

      return answered(install.as(install.tokens.owner).uploads[":upload"].finish.$post({ param: { upload }, query: {} }));
    }, 409, "in_trash"],
  ] as const)("an upload that is %s leaves no file, takes no more files, and can never be finished", async (_how, end, status, code) => {
    const install = await openApi();
    const asOwner = install.as(install.tokens.owner);
    const site = await published(install, { name: "report" });
    const upload = await staged(install, { site, title: "never shown" });
    const ended = await end(install, upload, site);
    const keys = await install.keys();

    const sent = await asOwner.uploads[":upload"].file.$put({ param: { upload }, query: { path: "index.html" } }, bytes(PAGES["index.html"]));
    const finished = await asOwner.uploads[":upload"].finish.$post({ param: { upload }, query: {} });

    expect([ended.status, part(ended, "error")?.code]).toEqual([status, code]);
    expect<unknown>([sent.status, finished.status, await install.keys()]).toEqual([404, 404, keys]);
    expect(keys.filter((key) => key.includes("/v2/"))).toEqual([]);
    expect(part(await listed(install, { trash: String(status === 409 && code === "in_trash") }), "sites")).toMatchObject([{ id: site, title: null }]);
  });

  // Drift: finishing checks the store, not the client's word; a missing or wrongly sized file that passed would be a live site with a broken page.
  test("a finish with a file missing, or a file whose bytes are not its declared size, is refused, and the upload goes on once the file is sent whole", async () => {
    const install = await openApi();
    const asOwner = install.as(install.tokens.owner);
    const begun = await answered(asOwner.uploads.$post({ json: { name: "report", files: manifest(PAGES) }, query: {} }));
    const upload = part(begun, "upload").id as string;
    const sendFile = (path: string, text: string): Promise<Answered> => answered(asOwner.uploads[":upload"].file.$put({ param: { upload }, query: { path } }, bytes(text)));
    await sendFile("css/site.css", PAGES["css/site.css"]);

    const early = await answered(asOwner.uploads[":upload"].finish.$post({ param: { upload }, query: {} }));
    const long = await sendFile("index.html", `${PAGES["index.html"]} and more`);
    const short = await sendFile("index.html", "<h1>");
    const unnamed = await sendFile("other.html", "x");
    const keys = await install.keys();
    await sendFile("index.html", PAGES["index.html"]);

    expect([early.status, early.body.error]).toEqual([409, { code: "missing_files", message: "a declared file has not been uploaded", about: "index.html" }]);
    expect([long.status, short.status, part(long, "error")]).toEqual([400, 400, { code: "size_mismatch", message: "a file's bytes are not as many as its declared size", about: "index.html" }]);
    expect([unnamed.status, part(unnamed, "error").about, keys.map((key) => key.split("/").slice(1).join("/"))]).toEqual([404, "path", ["v1/css/site.css"]]);
    expect<number>((await asOwner.uploads[":upload"].finish.$post({ param: { upload }, query: {} })).status).toBe(200);
  });

  // Drift: a pending upload holds bucket space and a version number; one that took files for ever would let a forgotten client keep the space for good.
  test("an upload takes no file and is not finished once a day has passed since it began", async () => {
    const install = await openApi();
    const asOwner = install.as(install.tokens.owner);
    const upload = await staged(install, { name: "report" });
    install.clock.now = NOW + DAY;

    const sent = await asOwner.uploads[":upload"].file.$put({ param: { upload }, query: { path: "index.html" } }, bytes(PAGES["index.html"]));
    const finished = await asOwner.uploads[":upload"].finish.$post({ param: { upload }, query: {} });

    expect<unknown>([sent.status, finished.status, (await listed(install)).body.sites]).toEqual([404, 404, []]);
  });
});

describe("what the API refuses before any action runs", () => {
  // Drift: each row is a request the transport must stop itself; one that reached an action would be parsed, stored, or answered in a way no action was written for.
  test.each([
    ["a method the route does not take", (install: ApiInstall) => install.ask(new Request(`${ORIGIN}/api/sites`, { method: "POST" })), 405, { code: "method_not_allowed" }, "GET, HEAD"],
    ["a method no route of a path with three takes", (install: ApiInstall) => install.ask(new Request(`${ORIGIN}/api/sites/${NO_SITE}`, { method: "PUT" })), 405, { code: "method_not_allowed" }, "GET, HEAD, PATCH, DELETE"],
    ["a read of a path that only takes a post", (install: ApiInstall) => install.ask(new Request(`${ORIGIN}/api/logins`)), 405, { code: "method_not_allowed" }, "POST"],
    ["a preflight from another origin", (install: ApiInstall) => install.ask(new Request(`${ORIGIN}/api/sites`, { method: "OPTIONS", headers: PREFLIGHT })), 405, {}, "GET, HEAD"],
    ["a path that is no route", (install: ApiInstall) => install.ask(new Request(`${ORIGIN}/api/site`)), 404, { code: "not_found", about: "route" }, null],
    ["a path outside the API", (install: ApiInstall) => install.ask(new Request(`${ORIGIN}/`)), 404, { code: "not_found", about: "route" }, null],
    ["a JSON route sent a form", (install: ApiInstall) => answered(install.routes.config.$patch({ json: undefined as never, query: {} }, bytes("{}", FORM))), 415, {}, null],
    ["a file sent as JSON", (install: ApiInstall) => answered(install.routes.uploads[":upload"].file.$put({ param: { upload: NO_UPLOAD }, query: { path: "index.html" } }, bytes("x", { "Content-Type": "application/json" }))), 415, {}, null],
    ["a body that is no JSON", (install: ApiInstall) => install.ask(raw(install, "/api/config", { method: "PATCH", body: "{", headers: { "Content-Type": "application/json" } })), 400, { about: "body" }, null],
    ["a JSON body past its cap", (install: ApiInstall) => answered(install.routes.config.$patch({ json: { logins: ["x".repeat(65_536) as Login] }, query: {} })), 413, { code: "too_large", about: "body" }, null],
    ["a manifest past its own cap", (install: ApiInstall) => answered(install.routes.uploads.$post({ json: { name: "x".repeat(LIMITS.manifestBytes), files: [] }, query: {} })), 413, { about: "body" }, null],
    ["a field no schema names", (install: ApiInstall) => answered(install.routes.sites[":site"].$patch({ param: { site: NO_SITE }, json: { colour: "red" } as never, query: {} })), 400, { about: "colour" }, null],
    ["a field of the wrong type", (install: ApiInstall) => answered(install.routes.sites[":site"].rollback.$post({ param: { site: NO_SITE }, json: { version: "1" } as never, query: {} })), 400, { about: "version" }, null],
    ["a query key no route names", (install: ApiInstall) => install.ask(raw(install, "/api/sites?owner=ada")), 400, { about: "query" }, null],
    ["a query key given twice", (install: ApiInstall) => install.ask(raw(install, "/api/sites?limit=1&limit=2")), 400, { about: "limit" }, null],
    ["a query number that is none", (install: ApiInstall) => install.ask(raw(install, "/api/audit?limit=1e2")), 400, { about: "limit" }, null],
    ["a query switch that is neither word", (install: ApiInstall) => install.ask(raw(install, "/api/sites?trash=yes")), 400, { about: "trash" }, null],
    ["half a cursor", (install: ApiInstall) => install.ask(raw(install, `/api/sites?after_id=${NO_SITE}`)), 400, { about: "after_updated_at" }, null],
    ["a cursor part that is not of its form", (install: ApiInstall) => install.ask(raw(install, "/api/sites?after_updated_at=1&after_id=BAD")), 400, { about: "after_id" }, null],
    ["a query value under no key", (install: ApiInstall) => install.ask(raw(install, "/api/whoami?=x")), 400, { about: "query" }, null],
    ["a query key that names what every object has", (install: ApiInstall) => install.ask(raw(install, "/api/whoami?__proto__=x")), 400, { about: "query" }, null],
    ["a query key on a route that takes none", (install: ApiInstall) => install.ask(raw(install, "/api/whoami?limit=1")), 400, { about: "query" }, null],
    ["a site in the path that is no reference", (install: ApiInstall) => install.ask(raw(install, "/api/sites/Report..html")), 400, { about: "site" }, null],
    ["a file with no path", (install: ApiInstall) => install.ask(raw(install, `/api/uploads/${NO_UPLOAD}/file`, { method: "PUT", body: "x", headers: BYTES })), 400, { about: "path" }, null],
    ["more files than one publish may declare", (install: ApiInstall) => answered(install.routes.uploads.$post({ json: { name: "report", files: MANY_FILES }, query: {} })), 413, { about: "max_files" }, null],
    ["a file longer than one request may carry", (install: ApiInstall) => answered(install.routes.uploads.$post({ json: { name: "report", files: [LONG_FILE] }, query: {} })), 413, { about: "max_file_size" }, null],
  ] as const)("%s is refused, with no header that opens the API to another origin", async (_what, send, status, error, allow) => {
    const install = await openApi();
    const before = await stateOf(install);
    const answer = await send(install);
    const names = [...answer.response.headers.keys()];

    expect([answer.status, answer.response.headers.get("Allow")]).toEqual([status, allow]);
    expect(answer.body.error).toMatchObject(error);
    expect([names.filter((name) => name.startsWith("access-control-")), answer.response.headers.get("Cache-Control"), answer.response.headers.get("X-Content-Type-Options")]).toEqual([[], "no-store", "nosniff"]);
    expect(await stateOf(install)).toEqual(before);
  });

  // Drift: `Allow` names `HEAD` beside every `GET`; a `HEAD` answered any other way than its `GET` would make the header promise a method the path does not take.
  test("a HEAD is answered as the GET of its path without the body, and refused where the path takes no GET", async () => {
    const install = await openApi();
    const head = (path: string): Promise<Answered> => install.ask(raw(install, path, { method: "HEAD" }));

    const [read, posted] = [await head("/api/whoami"), await head("/api/logins")];

    expect([read.status, read.response.headers.get("Content-Type"), await read.response.text()]).toEqual([200, "application/json; charset=utf-8", ""]);
    expect([posted.status, posted.response.headers.get("Allow"), await posted.response.text()]).toEqual([405, "POST", ""]);
  });

  // Drift: a body read whole before it is measured lets one request hold the Worker's memory; the cap must cut the stream where it is passed.
  test.each([
    ["with no length declared", {}, 3],
    ["with its true length declared", { "Content-Length": "4096" }, 0],
  ])("a file body past the cap %s is refused 413 before it is read to its end, and nothing of it is stored", async (_how, headers, read) => {
    const install = await openApi();
    const asOwner = install.as(install.tokens.owner);
    const begun = await answered(asOwner.uploads.$post({ json: { name: "report", files: manifest(PAGES) }, query: {} }));
    const upload = part(begun, "upload").id as string;
    let pulled = 0;
    const body = new ReadableStream<Uint8Array>({
      pull(controller): void {
        pulled += 1;
        if (pulled <= 128) controller.enqueue(new Uint8Array(32).fill(120));
        if (pulled > 128) controller.close();
      },
    });

    const answer = await answered(asOwner.uploads[":upload"].file.$put({ param: { upload }, query: { path: "index.html" } }, bytes(body, headers)));

    expect([answer.status, answer.body.error]).toEqual([413, { code: "too_large", message: "a size limit is passed", about: "max_file_size" }]);
    expect([pulled <= read + 2, await install.keys()]).toEqual([true, []]);
  });

  // Drift: an error is logged and pasted into issues; one that quoted the token or a file's bytes would leak a credential or a private page with it.
  test("no refusal quotes the token it was sent with or the body of a file", async () => {
    const install = await openApi();
    const { owner: token } = install.tokens;
    const asOwner = install.as(token);
    const secret = "the body of a private page";
    const begun = await answered(asOwner.uploads.$post({ json: { name: "report", files: [{ path: "index.html", size: 3, content_type: "text/html" }] }, query: {} }));
    const upload = part(begun, "upload").id as string;

    const answers = [
      await answered(asOwner.uploads[":upload"].file.$put({ param: { upload }, query: { path: "index.html" } }, bytes(secret))),
      await answered(asOwner.tokens[":token"].$delete({ param: { token: install.tokens.admin }, query: {} })),
      await answered(install.as(`${token}0`).sites[":site"].$get({ param: { site: NO_SITE }, query: {} })),
      await answered(asOwner.sites[":site"].$patch({ param: { site: NO_SITE }, json: { title: secret, [token]: true } as never, query: {} })),
      await install.ask(new Request(`${ORIGIN}/api/sites?${token}=1`, { headers: { Authorization: `Bearer ${token}` } })),
    ];
    const texts = await Promise.all(answers.map((answer) => answer.response.text()));

    expect(answers.map((answer) => answer.status)).toEqual([400, 400, 401, 400, 400]);
    expect(texts.filter((text) => text.includes(secret) || text.includes(token.slice(0, 40)) || text.includes(install.tokens.admin.slice(0, 40)))).toEqual([]);
  });

  // Drift: a computer that logs in has no token yet. The two routes it calls must answer without one, and must be the only two that do: the 401 test above walks every other.
  test("the two routes of a login answer a request with no token, with a dead one, and with a cookie, and hand out nothing but a wait", async () => {
    const install = await openApi();
    const before = await stateOf(install);
    const sent = [install.as(null), install.as("let-me-in", { [VISITOR_HEADER]: "two" }), install.as(null, { [VISITOR_HEADER]: "three", Cookie: `session=${install.tokens.admin}` })];

    const begun = await Promise.all(sent.map((api) => answered(api.logins.$post({ json: { scope: "admin", computer: "laptop" }, query: {} }))));
    const asked = await Promise.all(begun.map((login, at) => answered((sent[at] as ApiClient).logins.token.$post({ json: { secret: login.body.secret as string }, query: {} }))));

    expect(begun.map((login) => [login.status, Object.keys(login.body).sort()])).toEqual(sent.map(() => [200, ["code", "expires_in", "interval", "secret", "verify_url"]]));
    expect(asked.map((answer) => [answer.status, answer.body])).toEqual(sent.map(() => [200, { state: "pending" }]));
    expect(await stateOf(install)).toEqual(before);
  });

  // Drift: nobody is asked before these two routes run, so the count by address is the brake on one address's flood of logins and on its guesses at a secret.
  test("one address begins two logins and asks twenty-five times a minute; the next request is answered 429 with when to come back, and another address's login, its question, and the next minute are not", async () => {
    const install = await openApi();
    const begin = (visitor: string): Promise<Answered> => answered(install.as(null, { [VISITOR_HEADER]: visitor }).logins.$post({ json: { scope: "publisher", computer: "laptop" }, query: {} }));
    const ask = (visitor: string): Promise<Answered> => answered(install.as(null, { [VISITOR_HEADER]: visitor }).logins.token.$post({ json: { secret: `poplin_login_${"0".repeat(16)}_${"0".repeat(64)}` }, query: {} }));
    install.clock.now = NOW + 1000;

    const begun = [];
    for (let sent = 0; sent < 3; sent += 1) begun.push(await begin("one"));
    const guesses = [];
    for (let sent = 0; sent < 26; sent += 1) guesses.push(await ask("one"));
    const refused = begun.at(-1);
    const others = [await begin("two"), await ask("two")];
    install.clock.now = NOW + 60_000;

    expect([begun.map((answer) => answer.status), guesses.map((answer) => answer.status)]).toEqual([[200, 200, 429], [...Array.from({ length: 25 }, () => 200), 429]]);
    expect([refused?.body, refused?.response.headers.get("Retry-After")]).toEqual([{ error: { code: "too_many_requests", message: "the install is asked too often: wait, then ask again" } }, "39"]);
    expect([...others, await begin("one"), await ask("one")].map((answer) => answer.status)).toEqual([200, 200, 200, 200]);
  });

  // Drift: every login begun writes four rows whoever begins it, and addresses are cheap. Without a count of all of them together, a few addresses spend the database's free day of writing in hours.
  test("eight logins are begun in a minute by all addresses together; the ninth is answered 429 with when to come back, its address's question is not, and the next minute begins eight more", async () => {
    const install = await openApi();
    const begin = (visitor: string): Promise<Answered> => answered(install.as(null, { [VISITOR_HEADER]: visitor }).logins.$post({ json: { scope: "publisher", computer: "laptop" }, query: {} }));
    install.clock.now = NOW + 1000;

    const first = [];
    for (const visitor of ["one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "nine"]) first.push(await begin(visitor));
    const asked = await install.as(null, { [VISITOR_HEADER]: "nine" }).logins.token.$post({ json: { secret: first[0]?.body.secret as string }, query: {} });
    install.clock.now = NOW + 60_000;
    const next = [];
    for (const visitor of ["nine", "nine", "one", "one", "two", "two", "three", "three", "four"]) next.push(await begin(visitor));

    expect([first.map((answer) => answer.status), asked.status, next.map((answer) => answer.status)]).toEqual([[200, 200, 200, 200, 200, 200, 200, 200, 429, 429], 200, [200, 200, 200, 200, 200, 200, 200, 200, 429]]);
    expect([first.at(-1)?.response.headers.get("Retry-After"), part(first.at(-1) as Answered, "error").code]).toEqual(["39", "too_many_requests"]);
  });

  // Drift: an entry that passed every request as one visitor would let one address take every other computer's place. A share as large as the minute of all would let one address refuse every other computer's login.
  test.each([
    ["one address", ["one"], 60],
    ["three addresses", ["one", "three", "four"], 180],
  ])("%s beginning logins as fast as they may for thirty minutes spend their own shares alone: another address begins its login every minute, and no login that waits loses its place", async (_who, flooding, begins) => {
    const install = await openApi();
    const begin = (visitor: string): Promise<Answered> => answered(install.as(null, { [VISITOR_HEADER]: visitor }).logins.$post({ json: { scope: "publisher", computer: "laptop" }, query: {} }));
    const flood: number[] = [];
    const others: unknown[] = [];

    for (let minute = 0; minute < 30; minute += 1) {
      install.clock.now = NOW + minute * 60_000;
      for (const visitor of flooding) for (let sent = 0; sent < 3; sent += 1) flood.push((await begin(visitor)).status);
      const other = await begin("two");

      const asked = await answered(install.as(null, { [VISITOR_HEADER]: "two" }).logins.token.$post({ json: { secret: other.body.secret as string }, query: {} }));
      others.push([other.status, asked.body]);
    }

    expect([flood.filter((status) => status === 200).length, flood.filter((status) => status === 429).length]).toEqual([begins, flooding.length * 30]);
    expect(others).toEqual(Array.from({ length: 30 }, () => [200, { state: "pending" }]));
  });

  // Drift: a login counted for its visitor at a minute's last moment, and for all in the next minute, would let two addresses spend four addresses' starts there, and refuse the rest.
  test("logins begun as a minute ends are counted in that minute for all too, so the next minute still begins eight", async () => {
    const install = await openApi();
    const begin = (visitor: string): Promise<Answered> => answered(install.as(null, { [VISITOR_HEADER]: visitor }).logins.$post({ json: { scope: "publisher", computer: "laptop" }, query: {} }));
    const takeMinute = install.counters.takeMinute.bind(install.counters);
    const nextMinute = (Math.floor(NOW / 60_000) + 1) * 60_000;
    // The minute ends between a login's two counts.
    install.counters.takeMinute = async (window, now) => {
      const taken = await takeMinute(window, now);
      if (window.scope === "visitor") install.clock.now = nextMinute;

      return taken;
    };

    const ending = [];
    for (const visitor of ["one", "one", "two", "two"]) {
      install.clock.now = nextMinute - 1;
      ending.push((await begin(visitor)).status);
    }
    install.counters.takeMinute = takeMinute;
    const next = [];
    for (const visitor of ["one", "one", "two", "two", "three", "three", "four", "four"]) next.push((await begin(visitor)).status);

    expect([ending, next]).toEqual([[200, 200, 200, 200], Array.from({ length: 8 }, () => 200)]);
  });

  // Drift: the count is the brake on a flood of logins; a counter that is down and let every request through would be no brake exactly when someone found a way to bring it down.
  test("a counter that cannot answer refuses a login that is begun, as over the count, and the install is not asked anything", async () => {
    const install = await openApi();
    install.counters.takeMinute = () => Promise.reject(new Error("the counter is down"));
    Object.assign(install.calls, { database: 0, store: 0 });

    const begun = await answered(install.as(null).logins.$post({ json: { scope: "publisher", computer: "laptop" }, query: {} }));

    expect([begun.status, part(begun, "error").code, begun.response.headers.get("Retry-After")]).toEqual([429, "too_many_requests", "60"]);
    expect([install.calls, install.reported]).toEqual([{ database: 0, store: 0 }, []]);
  });

  // Drift: the count is also the brake on guesses at a secret; a counter that is down must not turn an allowed login into a token for whoever asks while nothing counts.
  test("a counter that cannot answer refuses the question for a token, and the allowed login is still there to collect once it counts again", async () => {
    const install = await openApi();
    const { takeMinute } = install.counters;
    const begun = await answered(install.as(null).logins.$post({ json: { scope: "publisher", computer: "laptop" }, query: {} }));
    const allowed = await decideLogin(installOf(install), { scope: "admin", holder: "ada@example.com" as Login }, { code: String(begun.body.code), allow: true, scope: "publisher" });
    const ask = (): Promise<Answered> => answered(install.as(null).logins.token.$post({ json: { secret: begun.body.secret as string }, query: {} }));
    install.counters.takeMinute = () => Promise.reject(new Error("the counter is down"));

    const refused = await ask();
    const tokens = (await install.database.listTokens()).length;
    install.counters.takeMinute = takeMinute;

    expect([allowed.ok, refused.status, part(refused, "error").code, refused.response.headers.get("Retry-After"), tokens]).toEqual([true, 429, "too_many_requests", "60", 3]);
    expect([(await ask()).body.state, (await install.database.listTokens()).length]).toEqual(["allowed", 4]);
  });

  // Drift: what these routes are sent comes from anyone at all; each row must end in a refusal that stores nothing and echoes no secret.
  test.each([
    ["a body that is no JSON", (api: ApiClient) => api.logins.$post({ json: "scope=admin" as never, query: {} }), 400, "bad_argument", "body"],
    ["a form in place of JSON", (api: ApiClient) => api.logins.$post({ json: undefined as never, query: {} }, bytes(JSON.stringify("scope=admin"), FORM)), 415, "unsupported_media_type", undefined],
    ["a body over the cap", (api: ApiClient) => api.logins.token.$post({ json: { secret: "x".repeat(70_000) }, query: {} }), 413, "too_large", "body"],
    ["a secret where a key goes too", (api: ApiClient) => api.logins.token.$post({ json: { secret: "x", [`poplin_login_${"0".repeat(16)}_${"a".repeat(64)}`]: true } as never, query: {} }), 400, "bad_argument", undefined],
    ["a secret of another form", (api: ApiClient) => api.logins.token.$post({ json: { secret: 7 } as never, query: {} }), 400, "bad_argument", "secret"],
  ] as const)("a login route sent %s refuses it", async (_what, send, status, code, about) => {
    const install = await openApi();
    const before = await stateOf(install);

    const answer = await answered(send(install.as(null)));

    expect([answer.status, part(answer, "error").code, part(answer, "error").about]).toEqual([status, code, about]);
    expect([await stateOf(install), JSON.stringify(answer.body).includes("poplin_login_")]).toEqual([before, false]);
  });

  // Drift: a store or a database that fails mid-request must not take the Worker down with it, nor tell the caller what failed inside.
  test("a failure of the database is answered 500 with the code alone, and reported once", async () => {
    const install = await openApi();
    install.database.listShownSites = () => Promise.reject(new Error("the database is down"));

    const answer = await listed(install);

    expect([answer.status, answer.body]).toEqual([500, { error: { code: "internal", message: "the install failed to do that" } }]);
    expect(install.reported.map(String)).toEqual(["Error: the database is down"]);
  });

  // Drift: a caller that reads only "the install failed" tries again at once, all day; the code and the wait are what tell it the database is spent until midnight UTC.
  test("a database whose day's allowance is used up is answered 503 with the code, what ran out, and the seconds to midnight UTC", async () => {
    const install = await openApi();
    install.database.listShownSites = () => Promise.reject(new AllowanceSpent("writing"));

    const answer = await listed(install);

    // The fixtures' moment is 22:13:20 UTC: 6,400 seconds before midnight.
    expect([answer.status, answer.response.headers.get("Retry-After"), answer.body]).toEqual([
      503,
      "6400",
      { error: { code: "allowance_spent", message: "a day's allowance of the install is used up: ask again after midnight UTC", about: "writing" } },
    ]);
    expect(install.reported.length).toBe(1);
  });

  // Drift: a route that takes no token counts its visitor first, and a count that cannot be had is read as a full minute; a spent database told as "wait a minute" sends a terminal back sixty seconds later, all day.
  test("a computer that begins a login while the visitor cannot be read for a spent database is answered the spent allowance, not a full minute", async () => {
    const install = await openApi();
    install.counters.takeMinute = () => Promise.reject(new AllowanceSpent("reading"));

    const answer = await answered(install.as(null).logins.$post({ json: { scope: "publisher", computer: "laptop" }, query: {} }));

    expect([answer.status, part(answer, "error").code, part(answer, "error").about, answer.response.headers.get("Retry-After")]).toEqual([503, "allowance_spent", "reading", "6400"]);
  });
});
