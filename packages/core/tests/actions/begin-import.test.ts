import { describe, expect, test } from "bun:test";

import { abandonPublish } from "../../src/actions/abandon-publish";
import { beginImport, type ImportRequest } from "../../src/actions/begin-import";
import { exportFile, exportFiles, exportSite } from "../../src/actions/export";
import { finishPublish } from "../../src/actions/finish-publish";
import { publishSite } from "../../src/actions/publish";
import { signedBy } from "../../src/actions/reach";
import { getSite } from "../../src/actions/show";
import { uploadFile } from "../../src/actions/upload-file";
import type { SettingValues } from "../../src/records/settings";
import { sha256Of } from "../../src/storage/storage";
import { ADMIN, file, made, makeWorld, NOW, OWNER, PAGE_SHA256, pages, type World } from "./support/actions-fixture";

/** One site of a backup: what an import sends, and the bytes of each file it declares. */
interface Entry {
  readonly request: ImportRequest;
  readonly bodies: ReadonlyMap<string, Uint8Array>;
}

/** A size setting of so many bytes. */
function bytes(count: number): SettingValues["max_site_size"] {
  return { count, unit: "B" };
}

/** Read one site of an install as a client does, with every version it keeps: 15 bytes in 2 files a version. */
async function backupOf(world: World, site: string): Promise<Entry> {
  const exported = await exportSite(world.install, ADMIN, { site, all_versions: true });
  if (!exported.ok) throw new Error(`the fixture export was refused: ${exported.code}`);

  const files = [];
  const bodies = new Map<string, Uint8Array>();
  for (const { number } of exported.site.versions) {
    const listed = await exportFiles(world.install, ADMIN, { site, version: number });
    if (!listed.ok) throw new Error(`the fixture listing was refused: ${listed.code}`);

    for (const { path, size } of listed.files) {
      const read = await exportFile(world.install, ADMIN, { site, version: number, path });
      if (!read.ok) throw new Error(`the fixture file was refused: ${read.code}`);

      const bytes = new Uint8Array(await new Response(read.body).arrayBuffer());
      files.push({ path: `v${number}/${path}`, size, content_type: read.content_type, sha256: await sha256Of(bytes) });
      bodies.set(`v${number}/${path}`, bytes);
    }
  }

  return { request: { format: exported.format, site: exported.site, files }, bodies };
}

/** A backup of a site named `manual` that keeps three versions, made in an install of its own. */
async function manual(settings: object = {}): Promise<Entry> {
  const world = await makeWorld();
  const id = await made(world, OWNER, "manual", settings);
  for (const text of ["manual v2", "manual v3"]) await publishSite(world.install, OWNER, { site: id, files: pages(text) });

  return backupOf(world, id);
}

/** A declared file, one byte shorter when it is the first version's entry page. */
function shortened(file: Entry["request"]["files"][number]): Entry["request"]["files"][number] {
  return file.path === "v1/index.html" ? { ...file, size: file.size - 1 } : file;
}

/** What an import sends, with fields of its site replaced. */
function sited(entry: Entry, fields: object): object {
  return { ...entry.request, site: { ...entry.request.site, ...fields } };
}

/** What an import sends, with one more file declared. */
function filed(entry: Entry, file: object): object {
  return { ...entry.request, files: [...entry.request.files, file] };
}

/** Begin an import and send every file but those `without` names; answers the upload's id. */
async function staged(world: World, entry: Entry, without: readonly string[] = []): Promise<string> {
  const begun = await beginImport(world.install, ADMIN, entry.request);
  if (!begun.ok) throw new Error(`the fixture import was refused: ${begun.code}`);

  for (const [path, body] of entry.bodies) {
    if (without.includes(path)) continue;

    await uploadFile(world.install, ADMIN, { upload: begun.upload.id, path, body: new Blob([body as Uint8Array<ArrayBuffer>]).stream() });
  }

  return begun.upload.id;
}

describe("beginImport", () => {
  // Drift: the limits are the install's promise to its bucket; an import that skipped them would be the one way past a size every publish is held to.
  test.each([
    ["a site exactly as large as a site may be", { max_site_size: bytes(45) }, { ok: true }],
    ["a site one byte larger than a site may be", { max_site_size: bytes(44) }, { ok: false, code: "too_large", about: "max_site_size" }],
    ["a site that fills the install exactly", { max_total_size: bytes(60) }, { ok: true }],
    ["a site one byte past what the install may hold", { max_total_size: bytes(59) }, { ok: false, code: "too_large", about: "max_total_size" }],
    ["a site that is the last the install may hold", { max_sites: 2 }, { ok: true }],
    ["a site beyond the most the install may hold", { max_sites: 1 }, { ok: false, code: "too_many_sites", about: "max_sites" }],
  ] as const)("%s", async (_what, settings, answer) => {
    const world = await makeWorld(settings);
    await made(world, OWNER, "report");
    const keys = await world.keys();

    expect(await beginImport(world.install, ADMIN, (await manual()).request)).toMatchObject(answer);
    expect([await world.keys(), await world.audit()]).toEqual([keys, ["create"]]);
  });

  // Drift: an import that is begun holds its bytes and its place among the sites until it ends; one that was not counted would let two imports begun together pass a limit neither passes alone.
  test("a pending import counts toward the limits, and frees its room when it is given up", async () => {
    const world = await makeWorld({ max_sites: 1 });
    const [first, second] = [await manual(), await manual()];
    const begun = await beginImport(world.install, ADMIN, first.request);
    if (!begun.ok) throw new Error(`the first import was refused: ${begun.code}`);

    const full = await beginImport(world.install, ADMIN, second.request);
    await abandonPublish(world.install, ADMIN, begun.upload.id);

    expect([begun.upload, full, (await beginImport(world.install, ADMIN, second.request)).ok]).toEqual([
      { id: begun.upload.id, state: "pending", version: 1, files: 6, bytes: 45, expires: NOW + 86_400_000 },
      { ok: false, code: "too_many_sites", about: "max_sites" },
      true,
    ]);
  });

  // Drift: a backup is a file people edit and tools rewrite; a record or a manifest that does not hold together, once begun, would be finished into a site no read can turn back into a site.
  test.each([
    ["a publisher", (entry: Entry) => entry.request, { ok: false, code: "not_allowed" }, OWNER],
    ["a newer format", (entry: Entry) => ({ ...entry.request, format: 2 }), { ok: false, code: "backup_too_new", about: "format" }, ADMIN],
    ["no site", (entry: Entry) => ({ ...entry.request, site: undefined }), { ok: false, code: "bad_argument", about: "site" }, ADMIN],
    ["a site with an id that is none", (entry: Entry) => sited(entry, { id: "NOT-AN-ID" }), { ok: false, code: "bad_argument", about: "site" }, ADMIN],
    ["a flag that is a word", (entry: Entry) => sited(entry, { search_engines: "off" }), { ok: false, code: "bad_argument", about: "site" }, ADMIN],
    ["a site that does not say whether it is in the trash", (entry: Entry) => sited(entry, { state: undefined }), { ok: false, code: "bad_argument", about: "site" }, ADMIN],
    ["a public name on a site that is not public", (entry: Entry) => sited(entry, { public_name: "handbook" }), { ok: false, code: "bad_argument", about: "site" }, ADMIN],
    ["a field no site has", (entry: Entry) => sited(entry, { colour: "red" }), { ok: false, code: "bad_argument", about: "site" }, ADMIN],
    ["a typed title longer than one may be typed", (entry: Entry) => sited(entry, { title: "t".repeat(201) }), { ok: false, code: "bad_argument", about: "site" }, ADMIN],
    ["a live version the site does not keep", (entry: Entry) => sited(entry, { live_version: 9 }), { ok: false, code: "bad_argument", about: "site" }, ADMIN],
    ["a public name this install keeps for itself", (entry: Entry) => sited(entry, { access: "public", public_name: "docs-p" }), { ok: false, code: "reserved_name", about: "public_name" }, ADMIN],
    ["a file under a version the site does not keep", (entry: Entry) => filed(entry, { path: "v4/index.html", size: 1, content_type: "text/html", sha256: PAGE_SHA256 }), { ok: false, code: "bad_path", about: "v4/index.html" }, ADMIN],
    ["a file under no version", (entry: Entry) => filed(entry, { path: "index.html", size: 1, content_type: "text/html", sha256: PAGE_SHA256 }), { ok: false, code: "bad_path", about: "index.html" }, ADMIN],
    ["a file whose path climbs out of its version", (entry: Entry) => filed(entry, { path: "v3/../v2/extra.html", size: 1, content_type: "text/html", sha256: PAGE_SHA256 }), { ok: false, code: "bad_path", about: "v3/../v2/extra.html" }, ADMIN],
    ["a file declared twice", (entry: Entry) => ({ ...entry.request, files: [...entry.request.files, ...entry.request.files.slice(0, 1)] }), { ok: false, code: "bad_path", about: "v1/css/site.css" }, ADMIN],
    ["a version without its entry page", (entry: Entry) => ({ ...entry.request, files: entry.request.files.filter((file) => file.path !== "v2/index.html") }), { ok: false, code: "no_index" }, ADMIN],
    ["a version with a file more than its record counts", (entry: Entry) => filed(entry, { path: "v3/extra.html", size: 0, content_type: "text/html", sha256: PAGE_SHA256 }), { ok: false, code: "bad_argument", about: "files" }, ADMIN],
    ["a file a byte shorter than its version's record sums to", (entry: Entry) => ({ ...entry.request, files: entry.request.files.map(shortened) }), { ok: false, code: "bad_argument", about: "files" }, ADMIN],
  ] as const)("an import by or with %s is refused, and nothing is recorded", async (_what, change, refusal, actor) => {
    const world = await makeWorld();

    expect(await beginImport(world.install, actor, change(await manual()) as never)).toEqual(refusal);
    expect([await world.keys(), await world.audit(), (await world.install.database.listUploads({ before: NOW + 1, limit: 10 })).uploads]).toEqual([[], [], []]);
  });

  // Drift: an import's list of files is read whole as it begins, every version's among them, so the install's own count bounds them together; the refusal is the one a command line answers by sending the live version alone.
  test.each([
    ["as many files as max_files_per_publish", 6, { ok: true }],
    ["one file more than max_files_per_publish", 5, { ok: false, code: "too_large", about: "max_files_per_publish" }],
  ] as const)("a site of three versions of two files each, with %s", async (_what, most, answer) => {
    const world = await makeWorld({ max_files_per_publish: most });

    expect(await beginImport(world.install, ADMIN, (await manual()).request)).toMatchObject(answer);
  });

  // Drift: a request's limits were written for one publish; held against every version of a site at once, they would refuse a backup of a site each of whose publishes they let through.
  test.each([
    ["as many files a version as one publish may declare", { fileBytes: 9, files: 2 }, { ok: true }],
    ["a version with a file more than one publish may declare", { fileBytes: 9, files: 1 }, { ok: false, code: "too_large", about: "max_files" }],
    ["a file a byte longer than one request may carry", { fileBytes: 8, files: 2 }, { ok: false, code: "too_large", about: "max_file_size" }],
  ] as const)("a site of three versions with %s", async (_what, limits, answer) => {
    const world = await makeWorld();

    expect(await beginImport(world.install, ADMIN, (await manual()).request, limits)).toMatchObject(answer);
  });

  // Drift: the folder is this install's own; one taken from a backup could be a folder another site here keeps its files in, and the import's files would be written over that site's.
  test("a folder sent with a site is not read: the import's files go under a folder made for it", async () => {
    const world = await makeWorld();
    const report = await getSite(world.install, ADMIN, await made(world, OWNER, "report"));
    const [held] = (await world.keys()).map((key) => key.split("/")[0]);
    const entry = await manual();
    const sent = { ...entry.request, site: { ...entry.request.site, folder: held } };

    const upload = await staged(world, { ...entry, request: sent as never });
    const finished = await finishPublish(world.install, ADMIN, upload);
    const folders = [...new Set((await world.keys()).map((key) => key.split("/")[0]))];

    expect([finished.ok, folders.length, folders.includes(held), await getSite(world.install, ADMIN, report.ok ? report.site.id : "")]).toEqual([true, 2, true, report]);
    expect((await world.keys()).filter((key) => key.startsWith(`${held}/`))).toEqual([`${held}/v1/css/site.css`, `${held}/v1/index.html`]);
  });
});

describe("an import that is finished", () => {
  // Drift: what finishing stores is the record the backup held, not one made new; a field it replaced with this install's default would change a site that was only moved.
  test("the site is stored with the id, the name, the access, the details, the owner, the versions, and the moments its backup held", async () => {
    const source = await makeWorld();
    const id = await made(source, OWNER, "manual", { access: "public", public_name: "handbook", title: "The manual", embeddable: false, search_engines: true, expires: "30d" });
    source.clock.now = NOW + 5;
    await publishSite(source.install, OWNER, { site: id, files: pages("manual v2") });
    const entry = await backupOf(source, id);
    const world = await makeWorld();
    world.clock.now = NOW + 1000;

    const finished = await finishPublish(world.install, ADMIN, await staged(world, entry));
    const again = await beginImport(world.install, ADMIN, entry.request);
    const [before, after] = [await getSite(source.install, ADMIN, id), await getSite(world.install, ADMIN, id)];

    expect(finished).toMatchObject({ ok: true, before: null, site: { id, created: true, public_name: "handbook", live_version: 2, updated: NOW + 5 }, left: [] });
    expect([after, await world.audit(), again]).toEqual([before, ["imported"], { ok: false, code: "id_taken", about: "id" }]);
    expect((await backupOf(world, id)).request).toEqual(entry.request);
  });

  // Drift: a backup carries no record of what a version holds, so an import works it out from the files it declares, version by version. One record for the whole site would serve an older version's `404.html` that the live one never had.
  test("each version of an imported site is recorded with what its own files say it holds", async () => {
    const source = await makeWorld();
    const first = await publishSite(source.install, OWNER, { name: "manual", files: [file("index.html", "home"), file("404.html", "lost"), file("LICENSE", "terms")] });
    if (!first.ok) throw new Error(`the fixture publish was refused: ${first.code}`);

    await publishSite(source.install, OWNER, { site: first.site.id, files: [file("index.html", "home again")] });
    const world = await makeWorld();
    await finishPublish(world.install, ADMIN, await staged(world, await backupOf(source, first.site.id)));
    const holds = async (): Promise<unknown> => (await world.install.database.findServed({ id: first.site.id }, world.clock.now))?.contents;
    const contents = [await holds()];
    await world.install.database.setLiveVersion(first.site.id, 1, signedBy(ADMIN, world.clock.now));
    contents.push(await holds());

    expect(contents).toEqual([{ missing_page: false, bare_files: "" }, { missing_page: true, bare_files: "\nLICENSE\n" }]);
  });

  // Drift: the check at the start is a courtesy; the id or the public name can be taken while the files are sent, and only the last step can refuse then without leaving a site half made.
  test.each([
    ["its id", {}, "id_taken", "id"],
    ["its public name", { access: "public", public_name: "handbook" }, "name_taken", "public_name"],
  ] as const)("an import whose site lost %s to another site while its files were sent is refused at the finish, and its files go", async (_what, settings, code, about) => {
    const entry = await manual(settings);
    const world = await makeWorld();
    const upload = await staged(world, entry);
    const rival = code === "id_taken" ? await staged(world, entry) : "";
    const taken = code === "id_taken" ? await finishPublish(world.install, ADMIN, rival) : await publishSite(world.install, OWNER, { name: "other", access: "public", public_name: "handbook", files: pages("other") });
    const kept = await world.keys();

    const finished = await finishPublish(world.install, ADMIN, upload);

    expect([taken.ok, kept.length, finished]).toEqual([true, code === "id_taken" ? 12 : 8, { ok: false, code, about }]);
    expect([(await world.keys()).length, await world.audit(), await finishPublish(world.install, ADMIN, upload)]).toEqual([kept.length - 6, [code === "id_taken" ? "imported" : "create"], { ok: false, code: "not_found", about: "upload" }]);
  });

  // Drift: finishing trusts the store, not the client; a file missing from one version of three would be a site that breaks only when someone rolls it back.
  test("a file missing from a version that is not the live one stops the finish, and the import goes on once it is sent", async () => {
    const entry = await manual();
    const world = await makeWorld();
    const upload = await staged(world, entry, ["v1/css/site.css"]);

    const early = await finishPublish(world.install, ADMIN, upload);
    const hidden = await getSite(world.install, ADMIN, entry.request.site.id);
    await uploadFile(world.install, ADMIN, { upload, path: "v1/css/site.css", body: new Blob(["body{}"]).stream() });

    expect([early, hidden, await world.audit()]).toEqual([{ ok: false, code: "missing_files", about: "v1/css/site.css" }, { ok: false, code: "not_found" }, []]);
    expect(await finishPublish(world.install, ADMIN, upload)).toMatchObject({ ok: true, site: { id: entry.request.site.id, live_version: 3 } });
  });
});
