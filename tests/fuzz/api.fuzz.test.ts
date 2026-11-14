// A client chooses the method, the path, the query, every header, and the body: the API must answer each of them with one of its published statuses, never throw, and change nothing for a caller with no live token.
// The two routes a computer logs in through answer such a caller, and still change nothing it can use.

import { expect } from "bun:test";
import fc from "fast-check";

import { OPEN_ROUTES, ROUTES } from "../../packages/core/src/api/routes";
import { type ApiInstall, ORIGIN, openApi } from "../../packages/app/tests/api/support/install";
import { fuzzTarget } from "./config";
import { hostile } from "./hostile";

const ANSWERS = [200, 400, 401, 403, 404, 405, 409, 413, 415, 429];
const UNPROVEN = [401, 404, 405];
const OPEN_PATHS: readonly string[] = OPEN_ROUTES.map((name) => ROUTES[name].path());
const UNPROVEN_ON_OPEN = [200, 400, 405, 413, 415, 429];
const METHODS = ["GET", "GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS", "PROPFIND"];
const CONTENT_TYPES = ["application/json", "application/json; charset=utf-8", "application/octet-stream", "text/plain", "multipart/form-data; boundary=x", "APPLICATION/JSON", ""];
const NO_SITE = "zzzzzzzzzzzz";
const NO_UPLOAD = "zzzzzzzzzzzzzzzz";
const PAGE = { path: "index.html", size: 4, content_type: "text/html" };
const RUNS_PER_INSTALL = 200;

/** The install the requests go to, with a site, a pending upload, and the paths of every route about them. It is made anew every so many runs, since a run may revoke a token or delete the site. */
interface Target {
  readonly install: ApiInstall;
  readonly paths: readonly string[];
  runs: number;
}

const property = fuzzTarget(import.meta.file);

let target = await openTarget();

async function openTarget(): Promise<Target> {
  const install = await openApi();
  const { owner: token } = install.tokens;
  const first = await install.call("beginPublish", undefined, { token, body: { name: "report", files: [PAGE] } });
  const upload = (first.body.upload as { id: string }).id;
  await install.call("uploadFile", { upload, path: PAGE.path }, { token, body: "page" });
  const finished = await install.call("finishPublish", { upload }, { token });
  const site = (finished.body.site as { id: string }).id;
  const pending = await install.call("beginPublish", undefined, { token, body: { site, files: [PAGE] } });
  const named = { site, upload: (pending.body.upload as { id: string }).id, token: "00000000000000aa", path: PAGE.path, version: 1 };
  const paths = Object.values(ROUTES).flatMap((route) => [
    (route.path as (args: object) => string)(named),
    (route.path as (args: object) => string)({ ...named, site: NO_SITE, upload: NO_UPLOAD, trash: true, limit: 1, forever: true }),
  ]);

  return { install, paths, runs: 0 };
}

/** The install to send the next request to. */
async function nextTarget(): Promise<Target> {
  if (target.runs >= RUNS_PER_INSTALL) target = await openTarget();

  target.runs += 1;

  return target;
}

const pathChoices = fc.nat({ max: 2 * Object.keys(ROUTES).length - 1 });
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

      const proven = credential.who !== undefined && (await install.call("whoami", undefined, { token: install.tokens[credential.who] })).status === 200;
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
