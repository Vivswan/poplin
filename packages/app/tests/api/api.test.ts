import { describe, expect, test } from "bun:test";

import { ROUTES } from "@poplin/core/src/api/routes";

import { type Answered, type ApiInstall, LIMITS, NOW, ORIGIN, openApi, requestOf } from "./support/install";

type RouteName = keyof typeof ROUTES;

/** What a route's path is built from, and the body it goes with. */
interface Sample {
  readonly args: unknown;
  readonly body?: unknown;
}

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
  ...{ id: "k3f9x2ab71qz", name: "backed-up", title: null, access: "unlisted", search_engines: false, embeddable: true, expires: "never" },
  ...{ live_version: 1, versions: [{ number: 1, published_at: 1, published_by: "ada@example.com", bytes: 4, files: 1 }] },
  ...{ owner: "ada@example.com", created_at: 1, updated_at: 1, state: "live" },
};

/** What a browser sends ahead of a script's request from another origin. */
const PREFLIGHT = { Origin: "https://www.example.com", "Access-Control-Request-Method": "GET" };

/** The content type of a file's bytes. */
const BYTES = { "Content-Type": "application/octet-stream" };

/** One file more than the test install lets a publish declare. */
const MANY_FILES = Array.from({ length: LIMITS.files + 1 }, (_file, at) => ({ path: `${at}.html`, size: 1, content_type: "text/html" }));

/** A file one byte longer than the test install lets a request carry. */
const LONG_FILE = { path: "index.html", size: LIMITS.fileBytes + 1, content_type: "text/html" };

/** The most calls to the database and the store each route may make for one request, the token's lookup included. A route missing here does not compile. */
const BUDGET: Readonly<Record<RouteName, number>> = {
  whoami: 1,
  logout: 2,
  listTokens: 2,
  issueToken: 2,
  revokeToken: 2,
  listSites: 3,
  getSite: 4,
  updateSite: 6,
  rollbackSite: 5,
  newLink: 9,
  deleteSite: 35,
  restoreSite: 5,
  beginPublish: 7,
  showUpload: 14,
  uploadFile: 6,
  finishPublish: 44,
  abandonPublish: 24,
  exportSettings: 2,
  exportSites: 2,
  exportSite: 4,
  exportFiles: 5,
  exportFile: 5,
  importSettings: 2,
  beginImport: 7,
  readConfig: 2,
  changeConfig: 2,
  signEveryoneOut: 2,
  listAudit: 2,
};

/** A request to every route, each well formed, about a site and an upload that the fixture names. A route missing here does not compile. */
function samples(site: string, upload: string): Readonly<Record<RouteName, Sample>> {
  return {
    whoami: { args: undefined },
    logout: { args: undefined },
    listTokens: { args: undefined },
    issueToken: { args: undefined, body: { scope: "publisher", note: "ci" } },
    revokeToken: { args: { token: "00000000000000aa" } },
    listSites: { args: {} },
    getSite: { args: { site } },
    updateSite: { args: { site }, body: { title: "Q3 sales" } },
    rollbackSite: { args: { site }, body: {} },
    newLink: { args: { site } },
    deleteSite: { args: { site, forever: true } },
    restoreSite: { args: { site } },
    beginPublish: { args: undefined, body: { site, files: manifest(PAGES) } },
    showUpload: { args: { upload } },
    uploadFile: { args: { upload, path: "index.html" }, body: PAGES["index.html"] },
    finishPublish: { args: { upload } },
    abandonPublish: { args: { upload } },
    exportSettings: { args: undefined },
    exportSites: { args: {} },
    exportSite: { args: { site } },
    exportFiles: { args: { site, version: 1 } },
    exportFile: { args: { site, version: 1, path: "index.html" } },
    importSettings: { args: undefined, body: { format: 1, settings: {} } },
    beginImport: { args: undefined, body: { format: 1, site: BACKED_UP, files: [{ path: "v1/index.html", size: 4, content_type: "text/html" }] } },
    readConfig: { args: undefined },
    changeConfig: { args: undefined, body: { trash_days: 9 } },
    signEveryoneOut: { args: undefined },
    listAudit: { args: {} },
  };
}

function manifest(pages: Readonly<Record<string, string>>): { path: string; size: number; content_type: string }[] {
  return Object.entries(pages).map(([path, text]) => ({ path, size: new TextEncoder().encode(text).length, content_type: "text/html; charset=utf-8" }));
}

function part(answered: Answered, key: string): Record<string, unknown> {
  return answered.body[key] as Record<string, unknown>;
}

/** Send one sample as a token, with the route's name kept loose: the samples are checked against the table where they are built. */
function send(install: ApiInstall, name: RouteName, sample: Sample, token: string | null): Promise<Answered> {
  return install.ask(requestOf(name, sample.args as never, { token, body: sample.body }));
}

/** A request to one route as the admin, with a body and, when given, a content type that replaces the route's own. */
function asAdmin<Name extends RouteName>(install: ApiInstall, name: Name, args: Parameters<(typeof ROUTES)[Name]["path"]>[0], body: unknown, type?: string): Request {
  return requestOf(name, args, { token: install.tokens.admin, body, headers: type === undefined ? {} : { "Content-Type": type } });
}

/** A request the admin sends to a path written out by hand, as no client built from the table would. */
function raw(install: ApiInstall, path: string, init: RequestInit & { headers?: Record<string, string> } = {}): Request {
  return new Request(`${ORIGIN}${path}`, { ...init, headers: { ...init.headers, Authorization: `Bearer ${install.tokens.admin}` } });
}

/** Begin a publish and send every file of it; answers the upload's id. */
async function staged(install: ApiInstall, asked: object, pages: Readonly<Record<string, string>> = PAGES, token: string = install.tokens.owner): Promise<string> {
  const begun = await install.call("beginPublish", undefined, { token, body: { ...asked, files: manifest(pages) } });
  if (begun.status !== 200) throw new Error(`the fixture publish was refused: ${JSON.stringify(begun.body)}`);

  const upload = part(begun, "upload").id as string;
  for (const [path, text] of Object.entries(pages)) await install.call("uploadFile", { upload, path }, { token, body: text });

  return upload;
}

/** Publish over the staged routes; answers the site's id. */
async function published(install: ApiInstall, asked: object, pages?: Readonly<Record<string, string>>): Promise<string> {
  const upload = await staged(install, asked, pages);
  const finished = await install.call("finishPublish", { upload }, { token: install.tokens.owner });
  if (finished.status !== 200) throw new Error(`the fixture publish was not finished: ${JSON.stringify(finished.body)}`);

  return part(finished, "site").id as string;
}

/** What the install holds that a refused request must leave alone: the sites, the store's keys, and the count of audit entries. */
async function stateOf(install: ApiInstall): Promise<unknown> {
  const sites = await install.call("listSites", {});
  const trash = await install.call("listSites", { trash: true });

  return [sites.body, trash.body, await install.keys(), await install.audit(), (await install.database.listTokens()).length];
}

describe("createApi", () => {
  // Drift: the CLI's client is built from core's table alone; a route the API answers under another method, path, or query would break it with no test of either side failing.
  test("every route of core's table is answered as the table says, inside its budget of calls, and carries the fixed headers", async () => {
    const install = await openApi();
    const walked = new Set<string>();
    const over: string[] = [];

    const done = async <Name extends RouteName>(name: Name, args: Parameters<(typeof ROUTES)[Name]["path"]>[0], sent: object = {}): Promise<Answered> => {
      Object.assign(install.calls, { database: 0, store: 0 });
      const answered = await install.call(name, args, sent);
      const calls = install.calls.database + install.calls.store;
      const { headers } = answered.response;
      walked.add(name);
      if (calls > BUDGET[name]) over.push(`${name}: ${calls} calls`);

      expect([name, answered.status, answered.body.error]).toEqual([name, 200, undefined]);
      const type = ROUTES[name].answers === "bytes" ? "application/octet-stream" : "application/json; charset=utf-8";
      expect([headers.get("Cache-Control"), headers.get("X-Content-Type-Options"), headers.get("Content-Type")]).toEqual(["no-store", "nosniff", type]);

      return answered;
    };

    expect(part(await done("whoami", undefined), "token")).toMatchObject({ scope: "admin", note: "a test", expires: NOW + 30 * DAY });
    const issued = await done("issueToken", undefined, { body: { scope: "publisher", note: "ci" } });
    expect((await done("listTokens", undefined)).body.tokens).toHaveLength(4);
    expect(part(await done("whoami", undefined, { token: issued.body.token }), "token")).toMatchObject({ scope: "publisher", note: "ci", expires: "never" });
    await done("revokeToken", { token: part(issued, "record").id as string });

    const begun = await done("beginPublish", undefined, { body: { name: "report", files: manifest(PAGES) } });
    const upload = part(begun, "upload").id as string;
    expect((await done("showUpload", { upload })).body.missing).toEqual(["index.html", "css/site.css"]);
    for (const [path, text] of Object.entries(PAGES)) await done("uploadFile", { upload, path }, { body: text });
    const first = part(await done("finishPublish", { upload }), "site");
    const label = first.label as string;

    expect(first).toMatchObject({ name: "report", created: true, access: "private", live_version: 1, bytes: 21, files: 2, updated: NOW, url: `https://${label}-page.example.com` });
    expect((await done("listSites", { limit: 1 })).body.sites).toHaveLength(1);
    const settings = (await done("exportSettings", undefined)).body.settings as Record<string, string>;
    const backup = part(await done("exportSite", { site: label }), "site");
    expect([(await done("exportSites", { limit: 1 })).body.sites, settings.trash_days]).toEqual([[backup], "7"]);
    expect((await done("exportFiles", { site: label, version: 1 })).body.files).toEqual([{ path: "css/site.css", size: 6 }, { path: "index.html", size: 15 }]);
    expect(await (await done("exportFile", { site: label, version: 1, path: "index.html" })).response.text()).toBe(PAGES["index.html"]);
    expect(part(await done("getSite", { site: label }), "site").id).toBe(first.id);
    expect(part(await done("updateSite", { site: label }, { body: { title: "Q3 sales", access: "unlisted" } }), "site")).toMatchObject({ title: "Q3 sales", access: "unlisted" });
    expect(part(await done("rollbackSite", { site: label }, { body: { version: 1 } }), "site").live_version).toBe(1);
    const moved = part(await done("newLink", { site: label }), "site").id as string;
    expect(moved).not.toBe(first.id);
    expect(part(await done("deleteSite", { site: moved }), "site").state).toBe("trash");
    expect(part(await done("restoreSite", { site: moved }), "site").state).toBe("live");

    const second = part(await done("beginPublish", undefined, { body: { site: moved, files: manifest(PAGES) } }), "upload").id as string;
    expect((await done("abandonPublish", { upload: second })).body.left).toEqual([]);
    expect(part(await done("readConfig", undefined), "values").trash_days).toBe(7);
    expect(part(await done("changeConfig", undefined, { body: { trash_days: 9 } }), "values").trash_days).toBe(9);
    const key = await install.database.ensureSigningKey(new Uint8Array(32).fill(7), NOW);
    expect([(await done("signEveryoneOut", undefined)).body, await install.database.readSigningKey()]).not.toEqual([{}, key.key]);
    expect(((await done("listAudit", { limit: 3 })).body.entries as { action: string }[]).map((entry) => entry.action)).toEqual(["signed-everyone-out", "settings_changed", "restore"]);
    expect(part(await done("deleteSite", { site: moved, forever: true }), "before").id).toBe(moved);
    expect(part(await done("importSettings", undefined, { body: { format: 1, settings } }), "values").trash_days).toBe(7);
    const files = manifest(PAGES).map((file) => ({ ...file, path: `v1/${file.path}` }));
    const restored = part(await done("beginImport", undefined, { body: { format: 1, site: backup as never, files } }), "upload").id as string;
    for (const [path, text] of Object.entries(PAGES)) await done("uploadFile", { upload: restored, path: `v1/${path}` }, { body: text });
    expect(part(await done("finishPublish", { upload: restored }), "site")).toMatchObject({ id: first.id, label, created: true, live_version: 1 });
    await done("logout", undefined, { token: install.tokens.stranger });

    expect((await install.call("whoami", undefined, { token: install.tokens.stranger })).status).toBe(401);
    expect([[...walked].sort(), over]).toEqual([Object.keys(ROUTES).sort(), []]);
  });

  // Drift: the cursor of a listing crosses the wire as two query keys; a key renamed on one side alone would hand every page the first sites again.
  test("a listing's `next` asks for the following page, in the sites and in the audit log", async () => {
    const install = await openApi();
    for (const [at, name] of ["one", "two", "three"].entries()) {
      install.clock.now = NOW + at;
      await published(install, { name });
    }

    const first = await install.call("listSites", { limit: 2 });
    const rest = await install.call("listSites", { limit: 2, after: first.body.next as never });
    const entries = (await install.call("listAudit", { limit: 2 })).body.entries as { seq: number }[];
    const older = await install.call("listAudit", { limit: 2, before: entries.at(-1)?.seq });
    const names = (answered: Answered): unknown[] => (answered.body.sites as { name: string }[]).map((site) => site.name);

    expect([names(first), names(rest), rest.body.next]).toEqual([["three", "two"], ["one"], undefined]);
    expect((older.body.entries as { seq: number }[]).map((entry) => entry.seq)).toEqual([(entries[0]?.seq ?? 0) - 2, (entries[0]?.seq ?? 0) - 3]);
  });

  // Drift: every route changes or shows something an install owns; one that ran before the token was checked would be open to anyone who can reach the address.
  test.each([
    ["no token, though a cookie names an admin's", () => null],
    ["a word that is no token", () => "let-me-in"],
    ["a token of no record", () => `poplin_${"0".repeat(16)}_${"0".repeat(64)}`],
    ["a token with another's secret", (install: ApiInstall) => `${install.tokens.admin.slice(0, 24)}${install.tokens.owner.slice(24)}`],
    ["an admin token past its 30 days", (install: ApiInstall) => install.tokens.admin],
    ["a revoked token", (install: ApiInstall) => install.tokens.stranger],
  ])("a request with %s is answered 401 on every route, with nothing but the code, and changes nothing", async (why, tokenOf) => {
    const install = await openApi();
    const site = await published(install, { name: "report" });
    const upload = await staged(install, { site });
    await install.call("logout", undefined, { token: install.tokens.stranger });
    const before = await stateOf(install);
    if (why.startsWith("an admin token past")) install.clock.now = NOW + 31 * DAY;

    const token = tokenOf(install);
    const answers: unknown[] = [];
    for (const [name, sample] of Object.entries(samples(site, upload)) as [RouteName, Sample][]) {
      const request = requestOf(name, sample.args as never, { token, body: sample.body, headers: { Cookie: `session=${install.tokens.admin}` } });
      const answered = await install.ask(request);
      answers.push([name, answered.status, answered.body]);
    }

    const refused = { error: { code: "not_logged_in", message: "no token was sent, or it is not a live token of this install" } };
    install.clock.now = NOW;

    expect(answers).toEqual(Object.keys(ROUTES).map((name) => [name, 401, refused]));
    expect(await stateOf(install)).toEqual(before);
  });

  // Drift: a publisher token sits in an agent's shell; a route that skipped the action's check would let one agent read, change, or delete another's sites and uploads.
  test("a publisher is answered 404 for another's private site and upload on every route, 403 on the admin's routes, and changes nothing", async () => {
    const install = await openApi();
    const site = await published(install, { name: "report" });
    const upload = await staged(install, { site });
    const before = await stateOf(install);
    const { stranger } = install.tokens;

    const answers: unknown[] = [];
    for (const [name, sample] of Object.entries(samples(site, upload)) as [RouteName, Sample][]) {
      if (name === "logout" || name === "whoami") continue;

      const answered = await send(install, name, sample, stranger);
      answers.push([name, answered.status, part(answered, "error")?.code ?? answered.body.sites]);
    }

    expect(answers).toEqual([
      ["listTokens", 403, "not_allowed"],
      ["issueToken", 403, "not_allowed"],
      ["revokeToken", 403, "not_allowed"],
      ["listSites", 200, []],
      ["getSite", 404, "not_found"],
      ["updateSite", 404, "not_found"],
      ["rollbackSite", 404, "not_found"],
      ["newLink", 404, "not_found"],
      ["deleteSite", 404, "not_found"],
      ["restoreSite", 404, "not_found"],
      ["beginPublish", 404, "not_found"],
      ["showUpload", 404, "not_found"],
      ["uploadFile", 404, "not_found"],
      ["finishPublish", 404, "not_found"],
      ["abandonPublish", 404, "not_found"],
      ["exportSettings", 403, "not_allowed"],
      ["exportSites", 403, "not_allowed"],
      ["exportSite", 403, "not_allowed"],
      ["exportFiles", 403, "not_allowed"],
      ["exportFile", 403, "not_allowed"],
      ["importSettings", 403, "not_allowed"],
      ["beginImport", 403, "not_allowed"],
      ["readConfig", 403, "not_allowed"],
      ["changeConfig", 403, "not_allowed"],
      ["signEveryoneOut", 403, "not_allowed"],
      ["listAudit", 403, "not_allowed"],
    ]);
    expect(await stateOf(install)).toEqual(before);
    expect((await install.call("finishPublish", { upload }, { token: install.tokens.owner })).status).toBe(200);
  });

  // Drift: an admin token that could issue admin tokens would outlive its 30 days for good; a publisher that could revoke another token would lock an owner out.
  test("an admin token issues publisher tokens alone, and a publisher revokes no token but its own", async () => {
    const install = await openApi();
    const owner = part(await install.call("whoami", undefined, { token: install.tokens.owner }), "token").id as string;

    const admin = await install.call("issueToken", undefined, { body: { scope: "admin", note: "more" } });
    const unknown = await install.call("issueToken", undefined, { body: { scope: "publisher", note: "ci", expires: "never" } });
    const others = await install.call("revokeToken", { token: owner }, { token: install.tokens.stranger });
    const own = await install.call("revokeToken", { token: owner }, { token: install.tokens.owner });

    expect([admin.status, part(admin, "error").code, unknown.status, part(unknown, "error")]).toEqual([403, "not_allowed", 400, expect.objectContaining({ code: "bad_argument", about: "expires" })]);
    expect([others.status, own.status, (await install.call("whoami", undefined, { token: install.tokens.owner })).status]).toEqual([403, 200, 401]);
  });
});

describe("the staged publish over HTTP", () => {
  // Drift: the files of a publish are in the bucket before the publish is live; a row written early would serve a half-uploaded site, or swap a live one mid-upload.
  test("a new site is in no listing, and a live site keeps its version and its files, until the upload is finished", async () => {
    const install = await openApi();
    const site = await published(install, { name: "report" });
    const [audit, listed] = [await install.audit(), (await install.call("listSites", {})).body];

    const created = await staged(install, { name: "draft", access: "public" });
    const updated = await staged(install, { site, access: "unlisted", title: "Q3 sales" }, { "index.html": "<h1>report, again</h1>" });
    const folder = (await install.keys()).find((key) => key.endsWith("/v2/index.html"))?.split("/")[0];

    expect([(await install.call("listSites", {})).body, await install.audit()]).toEqual([listed, audit]);
    expect(await install.database.findServed({ public_name: "draft" as never }, NOW)).toBeUndefined();
    expect(part(await install.call("getSite", { site }), "site")).toMatchObject({ live_version: 1, access: "private", title: null, versions: [{ number: 1 }] });

    const made = await install.call("finishPublish", { upload: created }, { token: install.tokens.owner });
    const added = await install.call("finishPublish", { upload: updated }, { token: install.tokens.owner });

    expect(part(made, "site")).toMatchObject({ name: "draft", created: true, access: "public", url: "https://draft-page.example.com" });
    expect(part(added, "site")).toMatchObject({ id: site, created: false, live_version: 2, access: "unlisted", title: "Q3 sales" });
    expect(part(added, "before")).toMatchObject({ live_version: 1, access: "private" });
    expect(await new Response((await install.store.read(`${folder}/v2/index.html` as never) as { body: ReadableStream }).body).text()).toBe("<h1>report, again</h1>");
  });

  // Drift: a client retries what it did not hear back from; a second upload of a file or a second finish that failed, or made a second site, would turn every lost answer into a broken publish.
  test("a file sent twice and a finish asked twice both answer as the first time, with one site made", async () => {
    const install = await openApi();
    const upload = await staged(install, { name: "report" });
    const again = await install.call("uploadFile", { upload, path: "index.html" }, { token: install.tokens.owner, body: PAGES["index.html"] });
    const first = await install.call("finishPublish", { upload }, { token: install.tokens.owner });
    const second = await install.call("finishPublish", { upload }, { token: install.tokens.owner });
    const late = await install.call("uploadFile", { upload, path: "index.html" }, { token: install.tokens.owner, body: "<h1>other</h1>...." });

    expect([again.status, again.body]).toEqual([200, { path: "index.html", size: 15 }]);
    expect([first.status, second.status, second.body]).toEqual([200, 200, first.body]);
    expect([late.status, part(late, "error").code]).toEqual([409, "upload_finished"]);
    const { created, ...site } = part(first, "site");
    const shown = await install.call("showUpload", { upload });

    expect([created, (await install.call("listSites", {})).body.sites]).toEqual([true, [site]]);
    expect([part(shown, "upload").state, shown.body.missing, shown.body.more]).toEqual(["finished", [], false]);
  });

  // Drift: each row is a way a publish ends without going live; files left in the bucket under no site would fill it unseen, and a half-sent file would be served.
  test.each([
    ["abandoned", async (install: ApiInstall, upload: string) => install.call("abandonPublish", { upload }, { token: install.tokens.owner }), 200, undefined],
    ["finished after a newer publish went live", async (install: ApiInstall, upload: string, site: string) => {
      await published(install, { site });

      return install.call("finishPublish", { upload }, { token: install.tokens.owner });
    }, 409, "stale_version"],
    ["finished after its site went to the trash", async (install: ApiInstall, upload: string, site: string) => {
      await install.call("deleteSite", { site });

      return install.call("finishPublish", { upload }, { token: install.tokens.owner });
    }, 409, "in_trash"],
  ] as const)("an upload that is %s leaves no file, takes no more files, and can never be finished", async (_how, end, status, code) => {
    const install = await openApi();
    const site = await published(install, { name: "report" });
    const upload = await staged(install, { site, title: "never shown" });
    const ended = await end(install, upload, site);
    const keys = await install.keys();

    const sent = await install.call("uploadFile", { upload, path: "index.html" }, { token: install.tokens.owner, body: PAGES["index.html"] });
    const finished = await install.call("finishPublish", { upload }, { token: install.tokens.owner });

    expect([ended.status, part(ended, "error")?.code]).toEqual([status, code]);
    expect([sent.status, finished.status, await install.keys()]).toEqual([404, 404, keys]);
    expect(keys.filter((key) => key.includes("/v2/"))).toEqual([]);
    expect(part(await install.call("listSites", { trash: status === 409 && code === "in_trash" }), "sites")).toMatchObject([{ id: site, title: null }]);
  });

  // Drift: finishing checks the store, not the client's word; a missing or wrongly sized file that passed would be a live site with a broken page.
  test("a finish with a file missing, or a file whose bytes are not its declared size, is refused, and the upload goes on once the file is sent whole", async () => {
    const install = await openApi();
    const { owner: token } = install.tokens;
    const begun = await install.call("beginPublish", undefined, { token, body: { name: "report", files: manifest(PAGES) } });
    const upload = part(begun, "upload").id as string;
    await install.call("uploadFile", { upload, path: "css/site.css" }, { token, body: PAGES["css/site.css"] });

    const early = await install.call("finishPublish", { upload }, { token });
    const long = await install.call("uploadFile", { upload, path: "index.html" }, { token, body: `${PAGES["index.html"]} and more` });
    const short = await install.call("uploadFile", { upload, path: "index.html" }, { token, body: "<h1>" });
    const unnamed = await install.call("uploadFile", { upload, path: "other.html" }, { token, body: "x" });
    const keys = await install.keys();
    await install.call("uploadFile", { upload, path: "index.html" }, { token, body: PAGES["index.html"] });

    expect([early.status, early.body.error]).toEqual([409, { code: "missing_files", message: "a declared file has not been uploaded", about: "index.html" }]);
    expect([long.status, short.status, part(long, "error")]).toEqual([400, 400, { code: "size_mismatch", message: "a file's bytes are not as many as its declared size", about: "index.html" }]);
    expect([unnamed.status, part(unnamed, "error").about, keys.map((key) => key.split("/").slice(1).join("/"))]).toEqual([404, "path", ["v1/css/site.css"]]);
    expect((await install.call("finishPublish", { upload }, { token })).status).toBe(200);
  });

  // Drift: a pending upload holds bucket space and a version number; one that took files for ever would let a forgotten client keep the space for good.
  test("an upload takes no file and is not finished once a day has passed since it began", async () => {
    const install = await openApi();
    const upload = await staged(install, { name: "report" });
    install.clock.now = NOW + DAY;

    const sent = await install.call("uploadFile", { upload, path: "index.html" }, { token: install.tokens.owner, body: PAGES["index.html"] });
    const finished = await install.call("finishPublish", { upload }, { token: install.tokens.owner });

    expect([sent.status, finished.status, (await install.call("listSites", {})).body.sites]).toEqual([404, 404, []]);
  });
});

describe("what the API refuses before any action runs", () => {
  // Drift: each row is a request the transport must stop itself; one that reached an action would be parsed, stored, or answered in a way no action was written for.
  test.each([
    ["a method the route does not take", () => new Request(`${ORIGIN}/api/sites`, { method: "POST" }), 405, { code: "method_not_allowed" }, "GET"],
    ["a preflight from another origin", () => new Request(`${ORIGIN}/api/sites`, { method: "OPTIONS", headers: PREFLIGHT }), 405, {}, "GET"],
    ["a path that is no route", () => new Request(`${ORIGIN}/api/site`), 404, { code: "not_found", about: "route" }, null],
    ["a path outside the API", () => new Request(`${ORIGIN}/`), 404, { code: "not_found", about: "route" }, null],
    ["a JSON route sent a form", (install: ApiInstall) => asAdmin(install, "changeConfig", undefined, {}, "application/x-www-form-urlencoded"), 415, {}, null],
    ["a file sent as JSON", (install: ApiInstall) => asAdmin(install, "uploadFile", { upload: NO_UPLOAD, path: "index.html" }, "x", "application/json"), 415, {}, null],
    ["a body that is no JSON", (install: ApiInstall) => raw(install, "/api/config", { method: "PATCH", body: "{", headers: { "Content-Type": "application/json" } }), 400, { about: "body" }, null],
    ["a JSON body past its cap", (install: ApiInstall) => asAdmin(install, "changeConfig", undefined, { dashboard_title: "x".repeat(65_536) }), 413, { code: "too_large", about: "body" }, null],
    ["a manifest past its own cap", (install: ApiInstall) => asAdmin(install, "beginPublish", undefined, { name: "x".repeat(LIMITS.manifestBytes), files: [] }), 413, { about: "body" }, null],
    ["a field no schema names", (install: ApiInstall) => asAdmin(install, "updateSite", { site: NO_SITE }, { colour: "red" }), 400, { about: "colour" }, null],
    ["a field of the wrong type", (install: ApiInstall) => asAdmin(install, "rollbackSite", { site: NO_SITE }, { version: "1" }), 400, { about: "version" }, null],
    ["a query key no route names", (install: ApiInstall) => raw(install, "/api/sites?owner=ada"), 400, { about: "query" }, null],
    ["a query key given twice", (install: ApiInstall) => raw(install, "/api/sites?limit=1&limit=2"), 400, { about: "limit" }, null],
    ["a query number that is none", (install: ApiInstall) => raw(install, "/api/audit?limit=1e2"), 400, { about: "limit" }, null],
    ["half a cursor", (install: ApiInstall) => raw(install, `/api/sites?after_id=${NO_SITE}`), 400, { about: "after" }, null],
    ["a site in the path that is no reference", (install: ApiInstall) => raw(install, "/api/sites/Report..html"), 400, { about: "site" }, null],
    ["a file with no path", (install: ApiInstall) => raw(install, `/api/uploads/${NO_UPLOAD}/file`, { method: "PUT", body: "x", headers: BYTES }), 400, { about: "path" }, null],
    ["more files than one publish may declare", (install: ApiInstall) => asAdmin(install, "beginPublish", undefined, { name: "report", files: MANY_FILES }), 413, { about: "max_files" }, null],
    ["a file longer than one request may carry", (install: ApiInstall) => asAdmin(install, "beginPublish", undefined, { name: "report", files: [LONG_FILE] }), 413, { about: "max_file_size" }, null],
  ] as const)("%s is refused, with no header that opens the API to another origin", async (_what, build, status, error, allow) => {
    const install = await openApi();
    const before = await stateOf(install);
    const answered = await install.ask(build(install));
    const names = [...answered.response.headers.keys()];

    expect([answered.status, answered.response.headers.get("Allow")]).toEqual([status, allow]);
    expect(answered.body.error).toMatchObject(error);
    expect([names.filter((name) => name.startsWith("access-control-")), answered.response.headers.get("Cache-Control"), answered.response.headers.get("X-Content-Type-Options")]).toEqual([[], "no-store", "nosniff"]);
    expect(await stateOf(install)).toEqual(before);
  });

  // Drift: a body read whole before it is measured lets one request hold the Worker's memory; the cap must cut the stream where it is passed.
  test.each([
    ["with no length declared", {}, 3],
    ["with its true length declared", { "Content-Length": "4096" }, 0],
  ])("a file body past the cap %s is refused 413 before it is read to its end, and nothing of it is stored", async (_how, headers, read) => {
    const install = await openApi();
    const { owner: token } = install.tokens;
    const begun = await install.call("beginPublish", undefined, { token, body: { name: "report", files: manifest(PAGES) } });
    const upload = part(begun, "upload").id as string;
    let pulled = 0;
    const body = new ReadableStream<Uint8Array>({
      pull(controller): void {
        pulled += 1;
        if (pulled <= 128) controller.enqueue(new Uint8Array(32).fill(120));
        if (pulled > 128) controller.close();
      },
    });

    const answered = await install.call("uploadFile", { upload, path: "index.html" }, { token, body, headers });

    expect([answered.status, answered.body.error]).toEqual([413, { code: "too_large", message: "a size limit is passed", about: "max_file_size" }]);
    expect([pulled <= read + 2, await install.keys()]).toEqual([true, []]);
  });

  // Drift: an error is logged and pasted into issues; one that quoted the token or a file's bytes would leak a credential or a private page with it.
  test("no refusal quotes the token it was sent with or the body of a file", async () => {
    const install = await openApi();
    const { owner: token } = install.tokens;
    const secret = "the body of a private page";
    const begun = await install.call("beginPublish", undefined, { token, body: { name: "report", files: [{ path: "index.html", size: 3, content_type: "text/html" }] } });
    const upload = part(begun, "upload").id as string;

    const answers = [
      await install.call("uploadFile", { upload, path: "index.html" }, { token, body: secret }),
      await install.call("revokeToken", { token: install.tokens.admin }, { token }),
      await install.call("getSite", { site: NO_SITE }, { token: `${token}0` }),
      await install.call("updateSite", { site: NO_SITE }, { token, body: { title: secret, [token]: true } }),
      await install.ask(new Request(`${ORIGIN}/api/sites?${token}=1`, { headers: { Authorization: `Bearer ${token}` } })),
    ];
    const texts = await Promise.all(answers.map((answered) => answered.response.text()));

    expect(answers.map((answered) => answered.status)).toEqual([400, 400, 401, 400, 400]);
    expect(texts.filter((text) => text.includes(secret) || text.includes(token.slice(0, 40)) || text.includes(install.tokens.admin.slice(0, 40)))).toEqual([]);
  });

  // Drift: a store or a database that fails mid-request must not take the Worker down with it, nor tell the caller what failed inside.
  test("a failure of the database is answered 500 with the code alone, and reported once", async () => {
    const install = await openApi();
    install.database.readSettings = () => Promise.reject(new Error("the database is down"));

    const answered = await install.call("listSites", {});

    expect([answered.status, answered.body]).toEqual([500, { error: { code: "internal", message: "the install failed to do that" } }]);
    expect(install.reported.map(String)).toEqual(["Error: the database is down"]);
  });
});
