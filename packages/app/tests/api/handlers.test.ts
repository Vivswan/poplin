import { describe, expect, test } from "bun:test";

import { sweepExpired } from "@poplin/core/src/actions/sweep";
import { type ROUTES, STORED_TYPE_HEADER } from "@poplin/core/src/api/routes";
import { importSessionKey } from "@poplin/core/src/auth/cookie";
import { type Login, parseLogins } from "@poplin/core/src/auth/logins";
import type { Hostname } from "@poplin/core/src/names/hostname";
import { applySuffix, DEFAULT_SUFFIX } from "@poplin/core/src/names/suffix";

import { mintSessionCookie, readSession } from "../../src/login/session";
import { hostnameAddresses } from "../../src/sites/hostname-addresses";
import { serveSite } from "../../src/sites/serve";
import { type Answered, type ApiInstall, NOW, openApi, requestOf } from "./support/install";

type RouteName = keyof typeof ROUTES;

/** One site of a backup with its files. */
type Entry = Backup["sites"][number];

/** One file of a backup as a client keeps it: the name an import declares it under, and its bytes. */
interface BackupFile {
  readonly path: string;
  readonly size: number;
  readonly content_type: string;
  readonly bytes: Uint8Array;
}

/** What a client holds after an export: the settings, every site with its files, and every byte any export route answered, as text. */
interface Backup {
  readonly format: number;
  readonly settings: Record<string, string>;
  readonly sites: { readonly site: Record<string, unknown>; readonly files: readonly BackupFile[] }[];
  readonly material: string;
}

/** The bytes of the signing key the source install is given, so a leak of it is found by value. */
const SIGNING_KEY = new Uint8Array(32).fill(0xa7);

/** The note of a token the source install issues: it sits in the tokens table and in the audit log, and nowhere a backup may reach. */
const CANARY = "canary-note-5d1";

/** A public site of the importing install, to hold a name an import asks for. */
const OTHER = { name: "other", access: "public" };

/** The login the serving of the second install knows. */
const ADMIN_EMAIL = "ada@example.com";

function part(answered: Answered, key: string): Record<string, unknown> {
  return answered.body[key] as Record<string, unknown>;
}

function pages(text: string): Record<string, string> {
  return { "index.html": `<h1>${text}</h1>`, "css/site.css": `/* ${text} */` };
}

/** Publish over the staged routes, as the owner unless another token is given; answers the site's id. */
async function published(install: ApiInstall, asked: object, files: Readonly<Record<string, string>>, token: string = install.tokens.owner): Promise<string> {
  const manifest = Object.entries(files).map(([path, text]) => ({ path, size: text.length, content_type: path.endsWith(".css") ? "text/css" : "text/html; charset=utf-8" }));
  const begun = await install.call("beginPublish", undefined, { token, body: { ...asked, files: manifest } });
  const upload = part(begun, "upload")?.id as string;
  for (const [path, text] of Object.entries(files)) await install.call("uploadFile", { upload, path }, { token, body: text });

  const finished = await install.call("finishPublish", { upload }, { token });
  if (finished.status !== 200) throw new Error(`the fixture publish was refused: ${JSON.stringify([begun.body, finished.body])}`);

  return part(finished, "site").id as string;
}

/** An install with a private, an unlisted, and a public site, one in the trash, and one that keeps three versions and is live at its second; with a signing key and a token whose note is the canary. */
async function source(): Promise<ApiInstall & { readonly ids: Readonly<Record<"report" | "notes" | "docs" | "gone" | "manual", string>> }> {
  const install = await openApi();
  const report = await published(install, { name: "report" }, pages("report"));
  const notes = await published(install, { name: "notes", access: "unlisted", title: "Notes", embeddable: false, search_engines: true, expires: "30d" }, pages("notes"));
  const docs = await published(install, { name: "docs", access: "public" }, pages("docs"));
  const gone = await published(install, { name: "gone" }, pages("gone"));
  const manual = await published(install, { name: "manual" }, pages("manual 1"));
  for (const [at, text] of ["manual 2", "manual 3"].entries()) {
    install.clock.now = NOW + at + 1;
    await published(install, { site: manual }, pages(text));
  }

  await install.call("rollbackSite", { site: manual }, { body: { version: 2 } });
  await install.call("deleteSite", { site: gone });
  await install.call("issueToken", undefined, { body: { scope: "publisher", note: CANARY } });
  await install.database.ensureSigningKey(SIGNING_KEY, NOW);

  return { ...install, ids: { report, notes, docs, gone, manual } };
}

/** Ask a JSON route as the admin; the test fails here when it is refused. */
async function got<Name extends RouteName>(install: ApiInstall, name: Name, args: Parameters<(typeof ROUTES)[Name]["path"]>[0], material: string[]): Promise<Answered> {
  const answered = await install.call(name, args);
  if (answered.status !== 200) throw new Error(`${name} was refused: ${JSON.stringify(answered.body)}`);

  material.push(await answered.response.text());

  return answered;
}

/** Fetch every file of one version, a page of one file at a time, so the cursor is walked. */
async function filesOf(install: ApiInstall, site: string, version: number, material: string[]): Promise<BackupFile[]> {
  const files: BackupFile[] = [];
  let cursor: string | undefined;

  do {
    const page = await got(install, "exportFiles", { site, version, limit: 1, cursor }, material);
    for (const { path, size } of page.body.files as { path: string; size: number }[]) {
      const response = await install.api.fetch(requestOf("exportFile", { site, version, path }, { token: install.tokens.admin }));
      const bytes = new Uint8Array(await response.arrayBuffer());
      material.push(new TextDecoder().decode(bytes), JSON.stringify([...response.headers]));
      files.push({ path: `v${version}/${path}`, size, content_type: decodeURIComponent(response.headers.get(STORED_TYPE_HEADER) ?? ""), bytes });
    }

    cursor = page.body.next as string | undefined;
  } while (cursor !== undefined);

  return files;
}

/** Export an install as a client does: the settings, the sites two a page, and each site's files. */
async function exportAll(install: ApiInstall, allVersions: boolean): Promise<Backup> {
  const material: string[] = [];
  const settings = await got(install, "exportSettings", undefined, material);
  const sites: Backup["sites"] = [];
  let after: string | undefined;

  do {
    const page = await got(install, "exportSites", { limit: 2, after: after as never, all_versions: allVersions }, material);
    for (const site of page.body.sites as { id: string; versions: { number: number }[] }[]) {
      const files = [];
      for (const { number } of site.versions) files.push(...(await filesOf(install, site.id, number, material)));

      sites.push({ site, files });
    }

    after = page.body.next as string | undefined;
  } while (after !== undefined);

  return { format: settings.body.format as number, settings: settings.body.settings as Record<string, string>, sites, material: material.join("\n") };
}

/** Begin the import of one site of a backup; `change` alters what is sent. */
function begin(install: ApiInstall, entry: Entry, change: object = {}): Promise<Answered> {
  const files = entry.files.map(({ path, size, content_type }) => ({ path, size, content_type }));

  return install.call("beginImport", undefined, { body: { format: 1, site: entry.site, files, ...change } });
}

/** Import one site of a backup: begin, send every file, finish. Answers the finish. */
async function imported(install: ApiInstall, entry: Entry): Promise<Answered> {
  const begun = await begin(install, entry);
  if (begun.status !== 200) return begun;

  const upload = part(begun, "upload").id as string;
  for (const file of entry.files) await install.call("uploadFile", { upload, path: file.path }, { body: file.bytes });

  return install.call("finishPublish", { upload });
}

/** Every site as the rule book shows it, the trash included, by id. */
async function sitesOf(install: ApiInstall): Promise<Record<string, unknown>> {
  const listed = [...((await install.call("listSites", {})).body.sites as { id: string }[]), ...((await install.call("listSites", { trash: true })).body.sites as { id: string }[])];

  return Object.fromEntries(listed.map((site) => [site.id, site]));
}

/** Every stored object in the order of its place under its site's folder: that place, its bytes as text, and its content type. The folder itself is left out, since an import makes a new one. */
async function storeOf(install: ApiInstall): Promise<string[]> {
  const stored: string[] = [];

  for (const key of await install.keys()) {
    const read = await install.store.read(key as never);
    if (read.kind === "found") stored.push(JSON.stringify([key.split("/").slice(1).join("/"), await new Response(read.body).text(), read.info.contentType]));
  }

  return stored.sort();
}

/** The folders an install's files sit under. */
async function foldersOf(install: ApiInstall): Promise<string[]> {
  return [...new Set((await install.keys()).map((key) => key.split("/")[0] ?? ""))];
}

/** What an install holds that a refused import must leave alone. */
async function stateOf(install: ApiInstall): Promise<unknown> {
  const { uploads } = await install.database.listUploads({ before: Number.MAX_SAFE_INTEGER, limit: 100 });

  return [await sitesOf(install), await storeOf(install), await install.audit(), uploads.map((upload) => [upload.id, upload.state])];
}

/** Serve one request from an install's database and store, as the Worker does, with a session of the admin when `signedIn`. */
async function served(install: ApiInstall, host: string, signedIn: boolean): Promise<[status: number, body: string]> {
  const layout = { domain: "example.com" as Hostname, adminHostname: "admin.example.com" as Hostname, suffix: DEFAULT_SUFFIX };
  const logins = parseLogins([ADMIN_EMAIL]);
  const settings = await install.database.readSettings();
  if (!logins.ok || settings === undefined) throw new Error("the test's serving was refused");

  const key = await importSessionKey(new Uint8Array(32).fill(7));
  const cookie = await mintSessionCookie({ email: ADMIN_EMAIL as Login, key, now: NOW, domain: layout.domain });
  const headers: Record<string, string> = signedIn ? { Cookie: cookie.slice(0, cookie.indexOf(";")) } : {};
  const response = await serveSite(new Request(`https://${applySuffix(layout.suffix, host as never)}.example.com/`, { headers }), {
    database: install.database,
    store: install.store,
    settings,
    addresses: hostnameAddresses(layout),
    readSession: (sent) => readSession(sent, { key, logins: logins.value, now: NOW }),
    now: () => NOW,
  });

  return [response.status, await response.text()];
}

describe("an export imported into another install", () => {
  // Drift: the two halves are written apart, an export that reads and an import that stores; a field one of them dropped would lose it on every restore with no test of either failing.
  test("an empty install that imports every site with all versions holds the same sites, files, and settings, and answers at every address", async () => {
    const first = await source();
    const second = await openApi({ trash_days: 30, dashboard_title: "second" });
    const backup = await exportAll(first, true);

    const finishes = [];
    for (const entry of backup.sites) finishes.push((await imported(second, entry)).status);
    const settings = await second.call("importSettings", undefined, { body: { format: backup.format, settings: backup.settings } });
    const entries = await second.database.listAudit({ limit: 100 });
    const { ids } = first;
    const sites = await sitesOf(second);
    const label = (site: string): string => (sites[site] as { label: string }).label;
    const { manual } = ids;

    // No time differs: a site keeps the moments it was made, changed, published, and trashed at.
    expect([finishes, sites, await storeOf(second)]).toEqual([[200, 200, 200, 200, 200], await sitesOf(first), await storeOf(first)]);
    expect([settings.status, part(settings, "values")]).toEqual([200, part(await first.call("readConfig", undefined), "values")]);
    expect((await exportAll(second, true)).sites).toEqual(backup.sites);

    // The folder is the one thing an import makes anew, and no export names it.
    const folders = [await foldersOf(first), await foldersOf(second)];
    expect([folders.map((held) => held.length), folders[1]?.filter((folder) => folders[0]?.includes(folder)), backup.sites.filter(({ site }) => "folder" in site)]).toEqual([[5, 5], [], []]);
    expect<unknown>(entries.filter((entry) => entry.action === "imported").map((entry) => [entry.site?.id, entry.detail]).sort()).toEqual(
      [[ids.report, { versions: 1 }], [ids.notes, { versions: 1 }], [ids.docs, { versions: 1 }], [ids.gone, { versions: 1 }], [manual, { versions: 3 }]].sort(),
    );
    expect([
      await served(second, label(ids.report), true),
      await served(second, label(ids.report), false),
      await served(second, label(ids.notes), false),
      await served(second, "docs", false),
      await served(second, label(ids.docs), false),
      await served(second, label(manual), true),
      (await served(second, label(ids.gone), true))[0],
    ]).toEqual([[200, "<h1>report</h1>"], [302, ""], [200, "<h1>notes</h1>"], [200, "<h1>docs</h1>"], [200, "<h1>docs</h1>"], [200, "<h1>manual 2</h1>"], 404]);

    await second.call("rollbackSite", { site: manual }, { body: { version: 3 } });
    const lost = await second.call("getSite", { site: manual }, { token: second.tokens.owner });
    const next = await published(second, { site: manual }, pages("manual 4"), second.tokens.admin);

    // A publisher's token is not in a backup, so the site it made is an admin's alone in the second install.
    expect([lost.status, await served(second, label(manual), true), (part(await second.call("getSite", { site: next }), "site").versions as { number: number }[]).map((version) => version.number)]).toEqual([
      404,
      [200, "<h1>manual 4</h1>"],
      [2, 3, 4],
    ]);
  });

  // Drift: a setting is changed one request at a time and exported all at once; an import held to the cap of one change would refuse the settings of an install whose changes each passed it.
  test("settings whose title is as long as one change may make it are exported and imported whole", async () => {
    const [first, second] = [await openApi(), await openApi()];
    const title = "x".repeat(65_490);
    const changed = await first.call("changeConfig", undefined, { body: { dashboard_title: title } });
    const exported = await first.call("exportSettings", undefined);

    const imported = await second.call("importSettings", undefined, { body: { format: exported.body.format, settings: exported.body.settings } });

    expect([changed.status, exported.status, imported.status, part(imported, "values").dashboard_title === title]).toEqual([200, 200, 200, true]);
  });

  // Drift: `--all-versions` is a flag of the client; an export that sent every version without it, or an import that needed them all, would make every backup as large as the bucket.
  test("an export without all versions carries each site's live version alone, and its import keeps that version's number", async () => {
    const first = await source();
    const second = await openApi();
    const backup = await exportAll(first, false);
    for (const entry of backup.sites) await imported(second, entry);

    const manual = part(await second.call("getSite", { site: first.ids.manual }), "site");
    const keys = (await second.keys()).map((key) => key.split("/").slice(1).join("/")).sort();

    const carried = backup.sites.map(({ site, files }) => `${site.name}: versions ${(site.versions as { number: number }[]).map((version) => version.number)}, ${files.length} files`);

    expect(carried.sort()).toEqual(["docs: versions 1, 2 files", "gone: versions 1, 2 files", "manual: versions 2, 2 files", "notes: versions 1, 2 files", "report: versions 1, 2 files"]);
    expect([manual.live_version, (manual.versions as { number: number }[]).map((version) => version.number), manual.bytes, manual.files]).toEqual([2, [2], 31, 2]);
    expect(keys).toEqual([...Array.from({ length: 4 }, () => ["v1/css/site.css", "v1/index.html"]).flat(), "v2/css/site.css", "v2/index.html"].sort());
    expect(await served(second, manual.label as string, true)).toEqual([200, "<h1>manual 2</h1>"]);
  });

  // Drift: a backup is copied to laptops and buckets; a credential or the log inside it would turn every copy into a way in, and no reader of the zip would notice.
  test("nothing any export route answers holds a token, a token's hash, the signing key, or an audit entry", async () => {
    const first = await source();
    const { material } = await exportAll(first, true);
    const records = await first.database.listTokens();
    const owner = records.find((record) => first.tokens.owner.includes(record.id))?.id ?? "";
    const key = [Buffer.from(SIGNING_KEY).toString("hex"), Buffer.from(SIGNING_KEY).toString("base64"), Buffer.from(SIGNING_KEY).toString("latin1")];
    const secrets = [...Object.values(first.tokens), ...Object.values(first.tokens).map((token) => token.split("_")[2] ?? ""), ...records.map((record) => record.hash), ...key, CANARY, "token_added"];

    // The control: the search does find what a backup is meant to hold, a site's owner among it.
    expect([records.length, material.includes(owner), material.includes("<h1>manual 3</h1>")]).toEqual([4, true, true]);
    expect(secrets.filter((secret) => secret === "" || material.includes(secret))).toEqual([]);
  });
});

describe("an import into an install that holds sites", () => {
  // Drift: each row is a site the install would have to change or shadow to take the import; one that passed would hand an address to other content with no word to its owner.
  test.each([
    ["the same site again", "report", {}, (install: ApiInstall, entry: Entry): Promise<unknown> => imported(install, entry), 409, { code: "id_taken", about: "id" }],
    ["a site whose id is the public name of a site here", "report", {}, (install: ApiInstall, entry: Entry): Promise<unknown> => published(install, { ...OTHER, public_name: entry.site.id }, pages("other")), 409, { code: "id_taken", about: "id" }],
    ["a public name another site here holds", "docs", {}, (install: ApiInstall): Promise<unknown> => published(install, { ...OTHER, public_name: "docs" }, pages("other")), 409, { code: "name_taken", about: "public_name" }],
    ["a backup of a newer format", "notes", { format: 2 }, async (): Promise<unknown> => undefined, 400, { code: "backup_too_new", about: "format" }],
    ["a format that is no number", "notes", { format: "1" }, async (): Promise<unknown> => undefined, 400, { code: "bad_argument", about: "format" }],
  ] as const)("%s is refused as it begins, and nothing here changes", async (_what, name, change, prepare, status, error) => {
    const first = await source();
    const backup = await exportAll(first, true);
    const entry = backup.sites.find(({ site }) => site.name === name);
    if (entry === undefined) throw new Error("the fixture backup lacks the site");

    const second = await openApi();
    await prepare(second, entry);
    const before = await stateOf(second);

    const begun = await begin(second, entry, change);

    expect([begun.status, begun.body.error]).toEqual([status, expect.objectContaining(error)]);
    expect(await stateOf(second)).toEqual(before);
  });

  // Drift: finishing is the one step that makes an imported site visible; a row written before every file is there would serve a site with holes at an address that worked.
  test("a site is in no listing and answers nowhere until its import is finished with every file, and a finish with one missing names it", async () => {
    const first = await source();
    const entry = (await exportAll(first, true)).sites.find(({ site }) => site.name === "docs");
    if (entry === undefined) throw new Error("the fixture backup lacks the site");

    const second = await openApi();
    const audit = await second.audit();
    const upload = part(await begin(second, entry), "upload").id as string;
    const [kept, last] = [entry.files.slice(0, -1), entry.files.at(-1)];
    for (const file of kept) await second.call("uploadFile", { upload, path: file.path }, { body: file.bytes });

    const early = await second.call("finishPublish", { upload });
    const shown = await second.call("showUpload", { upload });
    const hidden = [await sitesOf(second), await served(second, "docs", false), await second.audit()];
    const wrong = await second.call("uploadFile", { upload, path: last?.path ?? "" }, { body: "x" });
    await second.call("uploadFile", { upload, path: last?.path ?? "" }, { body: last?.bytes });
    const finished = await second.call("finishPublish", { upload });

    expect<unknown>([early.status, early.body.error, shown.body.missing]).toEqual([409, expect.objectContaining({ code: "missing_files", about: last?.path }), [last?.path]]);
    expect([hidden, wrong.status]).toEqual([[{}, [404, "Not found\n"], audit], 400]);
    expect<unknown>([finished.status, part(finished, "site").id, await served(second, "docs", false)]).toEqual([200, entry.site.id, [200, "<h1>docs</h1>"]]);
  });

  // Drift: an import that stops half way leaves files in the bucket under no site; kept, they would fill the bucket unseen, and a record left pending would hold the site's id against its next import.
  test.each([
    ["given up", async (install: ApiInstall, upload: string) => void (await install.call("abandonPublish", { upload })), 0, ["abandoned"]],
    ["left for a day and swept", async (install: ApiInstall) => {
      install.clock.now = NOW + 26 * 3_600_000;
      const swept = await sweepExpired({ ...install, now: () => install.clock.now, addressOf: String, reservedNames: new Set() }, { scope: "admin", holder: ADMIN_EMAIL as Login }, { limit: 100, from: { uploads: true } });
      if (!swept.ok || swept.uploads !== 1) throw new Error(`the sweep removed no upload: ${JSON.stringify(swept)}`);
    }, 26 * 3_600_000, []],
  ] as const)("an import that is %s leaves no file and no site, takes no more files, and the same site is then imported whole", async (_how, end, later, records) => {
    const first = await source();
    const entry = (await exportAll(first, true)).sites.find(({ site }) => site.name === "manual");
    if (entry === undefined) throw new Error("the fixture backup lacks the site");

    const second = await openApi();
    const before = [await sitesOf(second), await storeOf(second), await second.audit()];
    const upload = part(await begin(second, entry), "upload").id as string;
    for (const file of entry.files.slice(0, 3)) await second.call("uploadFile", { upload, path: file.path }, { body: file.bytes });
    const stored = (await second.keys()).length;
    await end(second, upload);

    const late = await second.call("uploadFile", { upload, path: entry.files[0]?.path ?? "" }, { body: entry.files[0]?.bytes });
    const finished = await second.call("finishPublish", { upload });

    const { uploads } = await second.database.listUploads({ before: Number.MAX_SAFE_INTEGER, limit: 100 });

    expect<unknown>([stored, late.status, finished.status, uploads.map((kept) => kept.state)]).toEqual([3, 404, 404, records]);
    expect([await sitesOf(second), await storeOf(second), await second.audit()]).toEqual(before);

    second.clock.now = NOW + later;

    expect<unknown>([(await imported(second, entry)).status, Object.keys(await sitesOf(second))]).toEqual([200, [entry.site.id]]);
  });

  // Drift: a publisher token sits in an agent's shell; an export or import route that skipped the action's check would hand one agent every site's files, or let it plant a site under any id.
  test("a publisher is refused on every export and import route, and cannot touch an admin's import", async () => {
    const first = await source();
    const backup = await exportAll(first, true);
    const [entry] = backup.sites;
    if (entry === undefined) throw new Error("the fixture backup is empty");

    const second = await openApi();
    const upload = part(await begin(second, entry), "upload").id as string;
    const before = [await stateOf(first), await stateOf(second)];
    const token = first.tokens.owner;
    const site = first.ids.report;
    const body = { format: 1, site: entry.site, files: entry.files.map(({ path, size, content_type }) => ({ path, size, content_type })) };

    const answers = [
      await first.call("exportSettings", undefined, { token }),
      await first.call("exportSites", {}, { token }),
      await first.call("exportSite", { site }, { token }),
      await first.call("exportFiles", { site, version: 1 }, { token }),
      await first.call("exportFile", { site, version: 1, path: "index.html" }, { token }),
      await first.call("importSettings", undefined, { token, body: { format: 1, settings: backup.settings } }),
      await first.call("beginImport", undefined, { token, body }),
      await second.call("showUpload", { upload }, { token: second.tokens.owner }),
      await second.call("uploadFile", { upload, path: entry.files[0]?.path ?? "" }, { token: second.tokens.owner, body: entry.files[0]?.bytes }),
      await second.call("finishPublish", { upload }, { token: second.tokens.owner }),
      await second.call("abandonPublish", { upload }, { token: second.tokens.owner }),
    ];

    expect(answers.map((answered) => [answered.status, part(answered, "error").code])).toEqual([...Array.from({ length: 7 }, () => [403, "not_allowed"]), ...Array.from({ length: 4 }, () => [404, "not_found"])]);
    expect([await stateOf(first), await stateOf(second)]).toEqual(before);
  });
});

describe("the one route that answers a file", () => {
  // Drift: this is the only route that reads the bucket for a caller; a key built from the caller's text would read any site's files, a pending upload's, or another version's.
  test.each([
    ["a file of the live version", { version: 2, path: "index.html" }, 200, "<h1>manual 2</h1>"],
    ["a file of another kept version", { version: 3, path: "css/site.css" }, 200, "/* manual 3 */"],
    ["a version the site does not keep", { version: 4, path: "index.html" }, 404, "no_such_version"],
    ["a path that climbs out of the version", { version: 2, path: "../v3/index.html" }, 404, "not_found"],
    ["a path with a backslash", { version: 2, path: "css\\site.css" }, 404, "not_found"],
    ["a path the version does not hold", { version: 2, path: "index.htm" }, 404, "not_found"],
    ["no path", { version: 2, path: "" }, 404, "not_found"],
  ] as const)("%s is answered as bytes or refused, and never as a page a browser would render", async (_what, asked, status, answer) => {
    const first = await source();
    const response = await first.api.fetch(requestOf("exportFile", { site: first.ids.manual, ...asked }, { token: first.tokens.admin }));
    const text = await response.text();
    const { headers } = response;

    expect([response.status, status === 200 ? text : JSON.parse(text).error.code]).toEqual([status, answer]);
    expect([headers.get("Cache-Control"), headers.get("X-Content-Type-Options")]).toEqual(["no-store", "nosniff"]);
    if (status !== 200) return;

    expect([headers.get("Content-Type"), headers.get("Content-Disposition"), headers.get("Content-Length"), headers.get(STORED_TYPE_HEADER)]).toEqual([
      "application/octet-stream",
      "attachment",
      String(text.length),
      encodeURIComponent(asked.path.endsWith(".css") ? "text/css" : "text/html; charset=utf-8"),
    ]);
  });

  // Drift: a pending upload's files sit in the bucket under a version number no site keeps yet; an export that listed or read them would leak a publish before it is live.
  test("the files of a pending upload are in no listing and behind no path", async () => {
    const first = await source();
    const { owner: token } = first.tokens;
    const begun = await first.call("beginPublish", undefined, { token, body: { site: first.ids.report, files: [{ path: "index.html", size: 6, content_type: "text/html" }] } });
    await first.call("uploadFile", { upload: part(begun, "upload").id as string, path: "index.html" }, { token, body: "secret" });

    const listed = await first.call("exportFiles", { site: first.ids.report, version: 2 });
    const read = await first.call("exportFile", { site: first.ids.report, version: 2, path: "index.html" });

    expect([(await first.keys()).some((key) => key.endsWith("/v2/index.html")), listed.status, read.status, part(read, "error").code]).toEqual([true, 404, 404, "no_such_version"]);
  });
});
