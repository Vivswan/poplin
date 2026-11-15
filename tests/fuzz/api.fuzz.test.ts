// A client chooses the method, the path, the query, every header, and the body: the API must answer each of them with one of its published statuses, never throw, and change nothing for a caller with no live token.
// The two routes a computer logs in through answer such a caller, and still change nothing it can use.

import { expect } from "bun:test";
import fc from "fast-check";
import { hc } from "hono/client";
import type { ExtractSchema } from "hono/types";

import type { Api } from "../../packages/app/src/api/api";
import { type ApiInstall, ORIGIN, openApi } from "../../packages/app/tests/api/support/install";
import { fuzzTarget } from "./config";
import { hostile } from "./hostile";

const ANSWERS = [200, 400, 401, 403, 404, 405, 409, 413, 415, 429];
const UNPROVEN = [401, 404, 405];
const ROUTES = hc<Api>(ORIGIN).api;
const OPEN_PATHS: readonly string[] = [ROUTES.logins.$path(), ROUTES.logins.token.$path()];
const UNPROVEN_ON_OPEN = [200, 400, 405, 413, 415, 429];
const METHODS = ["GET", "GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS", "PROPFIND"];
const CONTENT_TYPES = ["application/json", "application/json; charset=utf-8", "application/octet-stream", "text/plain", "multipart/form-data; boundary=x", "APPLICATION/JSON", ""];
const NO_SITE = "zzzzzzzzzzzz";
const NO_UPLOAD = "zzzzzzzzzzzzzzzz";
const PAGE = { path: "index.html", size: 4, content_type: "text/html" };
const NO_TOKEN = "00000000000000aa";
const BYTES = { "Content-Type": "application/octet-stream" };
const RUNS_PER_INSTALL = 200;

/** The install the requests go to, with a site, a pending upload, and the paths of every route about them. It is made anew every so many runs, since a run may revoke a token or delete the site. */
interface Target {
  readonly install: ApiInstall;
  readonly paths: readonly string[];
  runs: number;
}

/** What the paths of one pass over the routes name: a site, an upload, and the query of the routes that take one. */
interface Named {
  readonly site: string;
  readonly upload: string;
  readonly trash?: "true";
  readonly limit?: "1";
  readonly forever?: "true";
}

const property = fuzzTarget(import.meta.file);

let target = await openTarget();

/** The typed client of an install, asking with one token. Its requests go to the API itself, with no network between. */
function callsOf(install: ApiInstall, token: string): typeof ROUTES {
  const fetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => install.api.fetch(new Request(input, init));

  return hc<Api>(ORIGIN, { fetch, headers: { Authorization: `Bearer ${token}` } }).api;
}

/** The id of the upload a done request answered. */
async function uploadOf(response: Pick<Response, "json">): Promise<string> {
  const { upload } = (await response.json()) as { upload: { id: string } };

  return upload.id;
}

/** The paths of every route, under the path the app declares it by. A route the app declares and this leaves out does not compile, nor one it does not declare. */
function pathsOf({ site, upload, trash, limit, forever }: Named): Readonly<Record<keyof ExtractSchema<Api>, readonly string[]>> {
  const one = { param: { site }, query: {} };
  const held = { param: { upload }, query: {} };
  const file = { version: "1", path: PAGE.path };

  return {
    "/api/whoami": [ROUTES.whoami.$path()],
    "/api/token": [ROUTES.token.$path()],
    "/api/tokens": [ROUTES.tokens.$path()],
    "/api/tokens/:token": [ROUTES.tokens[":token"].$path({ param: { token: NO_TOKEN }, query: {} })],
    "/api/logins": [ROUTES.logins.$path()],
    "/api/logins/token": [ROUTES.logins.token.$path()],
    "/api/sites": [ROUTES.sites.$path({ query: { trash, limit } })],
    "/api/sites/:site": [ROUTES.sites[":site"].$path(one), ROUTES.sites[":site"].$path({ ...one, query: { forever } })],
    "/api/sites/:site/rollback": [ROUTES.sites[":site"].rollback.$path(one)],
    "/api/sites/:site/new-link": [ROUTES.sites[":site"]["new-link"].$path(one)],
    "/api/sites/:site/restore": [ROUTES.sites[":site"].restore.$path(one)],
    "/api/sites/:site/duplicate": [ROUTES.sites[":site"].duplicate.$path(one)],
    "/api/uploads": [ROUTES.uploads.$path()],
    "/api/uploads/:upload": [ROUTES.uploads[":upload"].$path(held)],
    "/api/uploads/:upload/file": [ROUTES.uploads[":upload"].file.$path({ ...held, query: { path: PAGE.path } })],
    "/api/uploads/:upload/finish": [ROUTES.uploads[":upload"].finish.$path(held)],
    "/api/export/settings": [ROUTES.export.settings.$path()],
    "/api/export/sites": [ROUTES.export.sites.$path({ query: { limit } })],
    "/api/export/sites/:site": [ROUTES.export.sites[":site"].$path(one)],
    "/api/export/sites/:site/files": [ROUTES.export.sites[":site"].files.$path({ ...one, query: { version: file.version, limit } })],
    "/api/export/sites/:site/file": [ROUTES.export.sites[":site"].file.$path({ ...one, query: file })],
    "/api/import/settings": [ROUTES.import.settings.$path()],
    "/api/import/sites": [ROUTES.import.sites.$path()],
    "/api/config": [ROUTES.config.$path()],
    "/api/sessions": [ROUTES.sessions.$path()],
    "/api/audit": [ROUTES.audit.$path({ query: { limit, site } })],
    "/api/domain": [ROUTES.domain.$path()],
    "/api/update": [ROUTES.update.$path()],
    "/api/update/address": [ROUTES.update.address.$path()],
  };
}

async function openTarget(): Promise<Target> {
  const install = await openApi();
  const calls = callsOf(install, install.tokens.owner);
  const upload = await uploadOf(await calls.uploads.$post({ query: {}, json: { name: "report", files: [PAGE] } }));
  await calls.uploads[":upload"].file.$put({ param: { upload }, query: { path: PAGE.path } }, { headers: BYTES, init: { body: "page" } });
  const finished = await calls.uploads[":upload"].finish.$post({ param: { upload }, query: {} });
  const site = ((await finished.json()) as { site: { id: string } }).site.id;
  const pending = await uploadOf(await calls.uploads.$post({ query: {}, json: { site, files: [PAGE] } }));
  const held = Object.values(pathsOf({ site, upload: pending })).flat();
  const absent = Object.values(pathsOf({ site: NO_SITE, upload: NO_UPLOAD, trash: "true", limit: "1", forever: "true" })).flat();

  return { install, paths: [...held, ...absent], runs: 0 };
}

/** The install to send the next request to. */
async function nextTarget(): Promise<Target> {
  if (target.runs >= RUNS_PER_INSTALL) target = await openTarget();

  target.runs += 1;

  return target;
}

const pathChoices = fc.nat({ max: target.paths.length - 1 });
const mangled = hostile(fc.constantFrom("/api/sites", "/api/sites/report--k3f9x2ab71qz/rollback", "/api/uploads/0000000000000000/file?path=index.html", "/api/audit?limit=5&before=3", "/api/tokens/00000000000000aa"));
const tokenChoices = fc.constantFrom("admin" as const, "owner" as const, "stranger" as const);
const credentials = fc.oneof(
  { arbitrary: tokenChoices.map((who) => ({ who, header: undefined as string | undefined })), weight: 3 },
  { arbitrary: hostile(fc.stringMatching(/^Bearer poplin_[0-9a-f]{16}_[0-9a-f]{64}$/)).map((header) => ({ who: undefined, header })), weight: 2 },
  { arbitrary: fc.constant({ who: undefined, header: undefined as string | undefined }), weight: 1 },
);
const jsonBodies = fc.oneof(
  fc.json(),
  fc.record(
    {
      name: hostile(fc.constant("report")),
      site: hostile(fc.constant(NO_SITE)),
      access: fc.constantFrom("private", "unlisted", "public", "secret"),
      public_name: hostile(fc.constant("docs")),
      title: fc.oneof(fc.string(), fc.constant(null)),
      expires: hostile(fc.constantFrom("7d", "never", "2026-12-01")),
      version: fc.oneof(fc.integer(), fc.double()),
      scope: fc.constantFrom("publisher", "admin", "root"),
      note: fc.string(),
      trash_days: fc.integer({ min: -1, max: 40 }),
      files: fc.array(fc.record({ path: hostile(fc.constantFrom("index.html", "css/site.css")), size: fc.oneof(fc.nat({ max: 80 }), fc.integer()), content_type: hostile(fc.constant("text/html")) }), { maxLength: 10 }),
    },
    { requiredKeys: [] },
  ).map((value) => JSON.stringify(value)),
);
const declaredFiles = fc.array(fc.record({ path: hostile(fc.constantFrom("v1/index.html", "v2/index.html", "index.html")), size: fc.oneof(fc.nat({ max: 80 }), fc.integer()), content_type: hostile(fc.constant("text/html")) }), { maxLength: 4 });
const backupVersions = fc.record({
  number: fc.integer({ min: -1, max: 3 }),
  published_at: fc.nat(),
  published_by: hostile(fc.constant("ada@example.com")),
  bytes: fc.integer({ min: -1, max: 80 }),
  files: fc.integer({ min: -1, max: 3 }),
});
const backupSites = fc.record(
  {
    id: hostile(fc.constantFrom(NO_SITE, "k3f9x2ab71qz")),
    name: hostile(fc.constant("report")),
    folder: hostile(fc.constant("0000000000000000")),
    title: fc.oneof(fc.string(), fc.constant(null)),
    access: fc.constantFrom("private", "unlisted", "public", "secret"),
    public_name: hostile(fc.constantFrom("docs", "gallery")),
    search_engines: fc.boolean(),
    embeddable: fc.boolean(),
    expires: fc.oneof(fc.constant("never"), fc.integer()),
    live_version: fc.integer({ min: -1, max: 3 }),
    versions: fc.array(backupVersions, { maxLength: 3 }),
    owner: hostile(fc.constant("ada@example.com")),
    created_at: fc.nat(),
    updated_at: fc.nat(),
    state: fc.constantFrom("live", "trash"),
    trashed_at: fc.oneof(fc.nat(), fc.constant(null)),
  },
  { requiredKeys: ["id", "name", "access", "live_version", "versions", "owner"] },
);
const backupBodies = fc
  .record(
    {
      format: fc.oneof(fc.constantFrom(1, 2, 0), fc.string()),
      site: fc.oneof(backupSites, fc.json()),
      files: declaredFiles,
      settings: fc.dictionary(hostile(fc.constantFrom("trash_days", "logins", "max_sites")), hostile(fc.constantFrom("7", "none", "ada@example.com")), { maxKeys: 4 }),
      logins: fc.boolean(),
    },
    { requiredKeys: ["format"] },
  )
  .map((value) => JSON.stringify(value));
const wholeBackup = JSON.stringify({
  format: 1,
  site: {
    ...{ id: "k3f9x2ab71qz", name: "report", title: null, page_title: null, access: "unlisted", search_engines: false, embeddable: true, expires: "never" },
    ...{ live_version: 1, versions: [{ number: 1, published_at: 1, published_by: "ada@example.com", bytes: 4, files: 1 }] },
    ...{ owner: "ada@example.com", created_at: 1, updated_at: 1, state: "live" },
  },
  files: [{ path: "v1/index.html", size: 4, content_type: "text/html" }],
});
const bodies = fc.oneof(jsonBodies, backupBodies, fc.constant(wholeBackup), fc.string({ unit: "binary", maxLength: 200 }), fc.constant("page"), fc.constant("x".repeat(5000)));
const extraHeaders = fc.record(
  {
    "Content-Type": fc.constantFrom(...CONTENT_TYPES),
    "Content-Length": fc.constantFrom("0", "4", "99999999999", "-1", "4, 4", "abc"),
    Cookie: fc.constant("session=owner"),
    Origin: fc.constantFrom("https://www.example.com", "null"),
  },
  { requiredKeys: [] },
);

/** The uploads the install holds, each with its state. */
async function pendingOf(install: ApiInstall): Promise<unknown> {
  const { uploads } = await install.database.listUploads({ before: Number.MAX_SAFE_INTEGER, limit: 100 });

  return uploads.map((upload) => [upload.id, upload.state]);
}

/** Build the request a run sends, or `undefined` when the runtime itself refuses to build it. */
function build(address: string, method: string, headers: Readonly<Record<string, string>>, body: string): Request | undefined {
  const sends = method !== "GET" && method !== "HEAD";

  try {
    return new Request(address, sends ? { method, headers, body } : { method, headers });
  } catch {
    return undefined;
  }
}

property(
  "any request gets one of the published answers, never a failure, and changes nothing without a live token",
  fc.asyncProperty(
    fc.oneof({ arbitrary: pathChoices, weight: 3 }, { arbitrary: mangled, weight: 2 }),
    fc.constantFrom(...METHODS),
    credentials,
    extraHeaders,
    bodies,
    async (path, method, credential, extra, body) => {
      const { install, paths } = await nextTarget();
      const address = `${ORIGIN}${typeof path === "number" ? paths[path] : path}`;
      const bearer = credential.who === undefined ? credential.header : `Bearer ${install.tokens[credential.who]}`;
      const request = build(address, method, bearer === undefined ? extra : { ...extra, Authorization: bearer }, body);
      fc.pre(request !== undefined && URL.canParse(address));

      const proven = credential.who !== undefined && (await callsOf(install, install.tokens[credential.who]).whoami.$get({ query: {} })).status === 200;
      const before = proven ? undefined : [await install.audit(), await install.keys(), await pendingOf(install)];
      const response = await install.api.fetch(request as Request);
      const text = await response.text();
      const after = proven ? undefined : [await install.audit(), await install.keys(), await pendingOf(install)];
      const isFile = response.headers.get("Content-Type") === "application/octet-stream";
      const parsed: unknown = text === "" || isFile ? {} : JSON.parse(text);

      const facts = {
        published: ANSWERS.includes(response.status),
        unprovenRefused: proven || (OPEN_PATHS.includes(new URL(address).pathname) ? UNPROVEN_ON_OPEN : UNPROVEN).includes(response.status),
        unprovenChanged: !Bun.deepEquals(before, after),
        crossOriginOpened: [...response.headers.keys()].some((name) => name.startsWith("access-control-")),
        stored: response.headers.get("Cache-Control") !== "no-store" || response.headers.get("X-Content-Type-Options") !== "nosniff",
        tokenQuoted: Object.values(install.tokens).some((token) => text.includes(token)),
        reported: install.reported.length,
        isObject: typeof parsed === "object" && parsed !== null,
        fileUnasked: isFile && !(response.status === 200 && credential.who === "admin" && new URL(address).pathname.endsWith("/file")),
      };

      expect(facts).toEqual({ published: true, unprovenRefused: true, unprovenChanged: false, crossOriginOpened: false, stored: false, tokenQuoted: false, reported: 0, isObject: true, fileUnasked: false });
    },
  ),
);

property(
  "a store that fails is answered 500 or a published answer, never a throw, and never a quoted token",
  fc.asyncProperty(pathChoices, fc.constantFrom(...METHODS), tokenChoices, bodies, async (path, method, who, body) => {
    const { install, paths } = await nextTarget();
    const down = (): Promise<never> => Promise.reject(new Error("the store is down"));
    const { write, list, deleteMany } = install.store;
    Object.assign(install.store, { write: down, list: down, deleteMany: down });

    try {
      const request = build(`${ORIGIN}${paths[path]}`, method, { Authorization: `Bearer ${install.tokens[who]}`, "Content-Type": method === "PUT" ? "application/octet-stream" : "application/json" }, body);
      fc.pre(request !== undefined);
      const response = await install.api.fetch(request as Request);
      const text = await response.text();

      expect([[...ANSWERS, 500].includes(response.status), text.includes(install.tokens[who]), text.includes("the store is down")]).toEqual([true, false, false]);
    } finally {
      Object.assign(install.store, { write, list, deleteMany });
      install.reported.length = 0;
    }
  }),
);
