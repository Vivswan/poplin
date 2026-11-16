// The part of the database contract about uploads: an upload and its files, the files declared in a day, and the day's writes to the store.

import { describe, expect, test } from "bun:test";

import type { Database, NewUpload } from "../../../src/database/database";
import type { PublicName } from "../../../src/names/names";
import { mintSiteFolder, type Site } from "../../../src/records/site";
import type { SiteId } from "../../../src/sites/ids";
import { mintUploadId, type UploadId } from "../../../src/records/upload";
import {
  ADA,
  BO,
  BY_ADA,
  BY_BO_LATER,
  DOCS,
  type DatabaseFactory,
  MANIFEST,
  NOW,
  REPORT,
  ROOMY,
  SETTINGS,
  TODAY,
  TOMORROW,
  auditActions,
  auditTrail,
  begunFiles,
  begunImport,
  begunSite,
  begunVersion,
  draft,
  everything,
  made,
  numberedFiles,
  opened,
} from "./database-fixtures";

export function uploadFiles(label: string, makeDatabase: DatabaseFactory): void {
  describe(`${label}: the files of an upload`, () => {
    // Drift: a file request finds its one file among thousands by path; a lookup that matched a near path, or another upload's file, would store bytes at the wrong length.
    test("one file is found among 5,000 by its exact path, the first and the last alike, and each of two uploads that share a path answers its own file", async () => {
      const database = await opened(makeDatabase);
      const large = await begunFiles(database, numberedFiles(5000));
      const small = await begunFiles(database, numberedFiles(3).map((file) => ({ ...file, size: file.size + 100, content_type: "text/plain" })));
      const found = async (id: UploadId, path: string): Promise<unknown> => (await database.getUploadFile(id, path))?.file ?? "none";
      const paths = ["page-0.html", "page-2.html", "page-4999.html", "page-5000.html", "page-499", "Page-2.html", "page-2.html/", ""];

      expect(await Promise.all(paths.map((path) => found(large, path)))).toEqual([
        { path: "page-0.html", size: 0, content_type: "text/html" },
        { path: "page-2.html", size: 2, content_type: "text/html" },
        { path: "page-4999.html", size: 4999, content_type: "text/html" },
        "none",
        "none",
        "none",
        "none",
        "none",
      ]);
      expect([await found(small, "page-2.html"), await found(small, "page-3.html")]).toEqual([{ path: "page-2.html", size: 102, content_type: "text/plain" }, "none"]);
      expect([(await database.getUpload(large))?.manifest.length, (await database.getUploadFile(large, ""))?.upload.files]).toEqual([5000, 5000]);
    });

    // Drift: a path is any text a key may be; one read as a number, as a JSON path, or as a property of an object would be found under another file, or moved to the front of the list a finish compares in order.
    test("paths made of digits, of JSON path signs, of quotes, of the names an object is born with, and two of one hash are each found as written, and the manifest keeps their order", async () => {
      const database = await opened(makeDatabase);
      // The second path and the last have one hash of 32 bits, 96444b56, by the FNV-1a rule.
      const signs = ["index.html", "page-2794.html", "2024", "10", "9", "$", "$.a", "$[0]", "a.b[0]", "[1]", "0/0", 'say "hi"', "it's", "100%_done"];
      const paths = [...signs, "constructor", "__proto__", "toString", "length", "\u00fc/\u{1F600}.html", " ", `${"long/".repeat(200)}page.html`, "page-64060.html"];
      const manifest = paths.map((path, index) => ({ path, size: index, content_type: `text/x-${index}; charset="utf-8"` }));
      const upload = await begunFiles(database, manifest);
      const each = await Promise.all(paths.map(async (path) => (await database.getUploadFile(upload, path))?.file));
      const absent = await Promise.all(["0", "$.b", "[0]", "a", "valueOf", '"index.html"', "'index.html'", "index.html ", "f96444b56"].map(async (path) => (await database.getUploadFile(upload, path))?.file));

      expect([(await database.getUpload(upload))?.manifest, each]).toEqual([manifest, manifest]);
      expect(absent.filter((file) => file !== undefined)).toEqual([]);
    });

    // Drift: a path names one file; an upload recorded with a path twice would answer one size for it and hold another in its manifest.
    test("an upload whose manifest names a path twice is refused whole", async () => {
      const database = await opened(makeDatabase);
      const site = { ...draft(REPORT), embeddable: true };
      const twice = [...MANIFEST, { path: "index.html", size: 1, content_type: "text/plain" }];
      const upload: NewUpload = { id: mintUploadId(), folder: site.folder, number: 1, owner: ADA, plan: { kind: "create", site }, manifest: twice, created_at: NOW };

      await expect(database.addUpload(upload, ROOMY)).rejects.toThrow();
      expect([await database.getUpload(upload.id), await database.getUploadFile(upload.id, "index.html")]).toEqual([undefined, undefined]);
    });
  });
}

export function uploads(label: string, makeDatabase: DatabaseFactory): void {
  describe(`${label}: uploads`, () => {
    // Drift: every later step reads the upload back; a manifest that lost a path's quotes or a file's size would store a file under the wrong key or at the wrong length.
    test("an upload reads back as recorded, one file of it is found by its exact path, and an upload given up keeps no manifest", async () => {
      const database = await opened(makeDatabase);
      const site = await made(database, draft(REPORT));
      const created = await begunSite(database, draft(REPORT));
      const updated = await begunVersion(database, site);
      const read = await database.getUpload(created.id);
      const quoted = await database.getUploadFile(created.id, MANIFEST[1]?.path ?? "");
      const unnamed = await database.getUploadFile(created.id, "index.htm");
      await database.abandonUpload(updated);

      expect(read).toEqual({
        upload: {
          id: created.id,
          folder: created.site.folder,
          number: 1,
          owner: ADA,
          state: "pending",
          plan: { kind: "create", site: created.site },
          bytes: 1000,
          files: 2,
          dropped: [],
          created_at: NOW,
        },
        manifest: MANIFEST,
      } as never);
      expect<unknown>([quoted, unnamed?.file, await database.getUploadFile(mintUploadId(), "index.html")]).toEqual([{ upload: read?.upload, file: MANIFEST[1] }, undefined, undefined]);
      expect(await auditActions(database)).toEqual(["create"]);
      expect([(await database.getUpload(updated))?.manifest, (await database.getUploadFile(updated, "index.html"))?.file]).toEqual([[], undefined]);
    });

    // Drift: finishing is the one step that makes files live; a site made twice, or made from an upload that was given up, would serve files nobody meant to publish.
    test("an upload becomes a site once: of two finishes at the same moment one makes it, and an abandoned upload makes none", async () => {
      const database = await opened(makeDatabase);
      const live = await begunSite(database, draft(REPORT));
      const given = await begunSite(database, draft(REPORT));
      await database.abandonUpload(given.id);

      const [first, second] = await Promise.all([database.publishUploadAsSite(live.id, live.site, BY_ADA), database.publishUploadAsSite(live.id, live.site, BY_ADA)]);
      const lost = await database.publishUploadAsSite(given.id, given.site, BY_ADA);
      const elsewhere = await database.publishUploadAsSite(given.id, draft(REPORT), BY_ADA);

      expect([first.kind, second.kind].sort()).toEqual(["done", "not_pending"]);
      expect([lost.kind, elsewhere.kind, (await database.getUpload(live.id))?.upload.state]).toEqual(["not_pending", "not_pending", "finished"]);
      expect([await auditActions(database), await database.readTotals()]).toEqual([["create"], { sites: 1, trashed_sites: 0, bytes: 1000, files: 4 }]);
    });

    // Drift: a public name taken while the files were uploading must leave the upload pending, so the files it holds are still owned by a record that can be given up.
    test("an upload whose public name another site took in the meantime makes no site and stays pending", async () => {
      const database = await opened(makeDatabase);
      const upload = await begunSite(database, draft(REPORT, "public", DOCS));
      await made(database, draft(REPORT, "public", DOCS));

      expect(await database.publishUploadAsSite(upload.id, upload.site, BY_ADA)).toEqual({ kind: "name_taken" });
      expect([(await database.getUpload(upload.id))?.upload.state, await auditActions(database)]).toEqual(["pending", ["create"]]);
    });

    // Drift: an import's files are in the store before its site is; a site stored twice, or stored from an import that was given up while its files were removed, would be served with files missing.
    test("an import becomes its site once, as the backup held it: of two finishes at the same moment one stores it, and an import that was given up stores none", async () => {
      const database = await opened(makeDatabase);
      const first = await made(database, draft(REPORT, "public", DOCS), BY_BO_LATER);
      const second = await made(database, draft(REPORT));
      for (const site of [first, second]) await database.deleteSite(site.id, BY_ADA);
      const live = await begunImport(database, first);
      const given = await begunImport(database, second);
      await database.abandonUpload(given.id);

      const signed = { by: ADA, at: NOW + 99 };
      const finishes = await Promise.all([database.importUploadAsSite(live.id, live.site, signed), database.importUploadAsSite(live.id, live.site, signed)]);
      const lost = await database.importUploadAsSite(given.id, given.site, signed);
      const elsewhere = await database.importUploadAsSite(given.id, { ...given.site, folder: mintSiteFolder() }, signed);

      expect(finishes.map((finish) => finish.kind).sort()).toEqual(["done", "not_pending"]);
      expect(finishes.find((finish) => finish.kind === "done")).toEqual({ kind: "done", site: live.site });
      expect([lost.kind, elsewhere.kind, (await database.getUpload(live.id))?.upload.state, (await database.getUpload(given.id))?.upload.state]).toEqual(["not_pending", "not_pending", "finished", "abandoned"]);
      expect([await database.getSite(first.id), await database.getSite(second.id), await database.readTotals()]).toEqual([live.site, undefined, { sites: 1, trashed_sites: 0, bytes: 1000, files: 4 }]);
      expect((await auditTrail(database)).slice(4).map((entry) => [entry.action, entry.by, entry.at, entry.site?.id, entry.detail])).toEqual([["imported", ADA, NOW + 99, first.id, { versions: 1 }]]);
    });

    // Drift: what a refused import leaves pending still owns its files; one marked finished without its site, or one that changed the site in its way, would lose track of one of the two.
    test.each([
      ["its id is a site's", "id_taken", (site: Site, held: Site): Site => ({ ...site, id: held.id })],
      ["its id is a site's public name", "id_taken", (site: Site): Site => ({ ...site, id: "cccccccccccc" as SiteId })],
      ["its public name is a site's", "name_taken", (site: Site): Site => ({ ...site, access: "public", public_name: "cccccccccccc" as PublicName })],
      ["its public name is a site's id", "name_taken", (site: Site, held: Site): Site => ({ ...site, access: "public", public_name: held.id as string as PublicName })],
    ] as const)("an import is refused with %s as %s: nothing is stored, and the upload stays pending", async (_case, kind, change) => {
      const database = await opened(makeDatabase);
      const held = await made(database, draft(REPORT, "public", "cccccccccccc" as PublicName));
      const gone = await made(database, draft(REPORT));
      await database.deleteSite(gone.id, BY_ADA);
      const upload = await begunImport(database, change(gone, held));
      const before = await everything(database);

      expect(await database.importUploadAsSite(upload.id, upload.site, BY_ADA)).toEqual({ kind });
      expect([await everything(database), (await database.getUpload(upload.id))?.upload.state]).toEqual([before, "pending"]);
    });

    // Drift: the folder of an import is made for it; a site already in it means its files are another site's, which the row must refuse whatever the caller checked before.
    test("an import whose folder is a site's is refused with folder_taken, and one that is no site throws: both leave the upload pending", async () => {
      const database = await opened(makeDatabase);
      const held = await made(database, draft(REPORT));
      const gone = await made(database, draft(REPORT));
      await database.deleteSite(gone.id, BY_ADA);
      const upload: NewUpload = { id: mintUploadId(), folder: held.folder, number: 1, owner: ADA, plan: { kind: "import", site: {} }, manifest: MANIFEST, created_at: NOW };
      await database.addUpload(upload, ROOMY);
      const before = await everything(database);

      expect(await database.importUploadAsSite(upload.id, { ...gone, folder: held.folder }, BY_ADA)).toEqual({ kind: "folder_taken" });
      await expect(database.importUploadAsSite(upload.id, { ...gone, folder: held.folder, live_version: 9 }, BY_ADA)).rejects.toThrow();
      expect([await everything(database), (await database.getUpload(upload.id))?.upload.state]).toEqual([before, "pending"]);
    });

    // Drift: the settings asked with an update go live with its version; a refused version that had already changed the access would publish old content under a new access.
    test.each([
      ["a higher version already kept", { access: { access: "public", public_name: DOCS }, details: { title: "Q3 sales" } }, "stale", "stale_number"],
      ["a public name another site holds", { access: { access: "public", public_name: "taken" as PublicName }, details: { title: "Q3 sales" } }, "none", "name_taken"],
      ["a site in the trash", { details: { title: "Q3 sales" } }, "trash", "in_trash"],
      ["a site that is gone", { details: { title: "Q3 sales" } }, "delete", "not_found"],
    ] as const)("an update refused for %s changes neither the site's settings nor its versions, and writes no audit entry", async (_why, asked, before, refusal) => {
      const database = await opened(makeDatabase);
      await made(database, draft(REPORT, "public", "taken" as PublicName));
      const site = await made(database, draft(REPORT));
      const upload = await begunVersion(database, site);
      if (before === "stale") await database.publishUploadAsVersion(await begunVersion(database, site), { keep: 3, details: {} }, BY_ADA);
      if (before === "trash") await database.trashSite(site.id, BY_ADA);
      if (before === "delete") await database.deleteSite(site.id, BY_ADA);
      const stored = await everything(database);

      expect(await database.publishUploadAsVersion(upload, { keep: 3, ...asked }, BY_BO_LATER)).toEqual({ kind: refusal });
      expect([await everything(database), (await database.getUpload(upload))?.upload.state]).toEqual([stored, "pending"]);
    });

    // Drift: the versions a publish drops are named in the upload's record, which is all that tells the sweep whose files to remove after a crash.
    test("an update goes live with its settings in one step, each with its audit entry, and its record names the versions it dropped", async () => {
      const database = await opened(makeDatabase);
      const site = await made(database, draft(REPORT));
      const second = await begunVersion(database, site);
      const third = await begunVersion(database, site);
      await database.publishUploadAsVersion(second, { keep: 2, details: {} }, BY_ADA);

      const settings = { access: { access: "public", public_name: DOCS }, details: { title: "Q3 sales", embeddable: false } } as const;
      const published = await database.publishUploadAsVersion(third, { keep: 1, ...settings }, BY_BO_LATER);
      const again = await database.publishUploadAsVersion(third, { keep: 1, access: { access: "unlisted" }, details: { title: "changed" } }, BY_BO_LATER);
      const live = { access: "public", public_name: DOCS, title: "Q3 sales", embeddable: false, live_version: 3, updated_at: NOW + 5 };

      expect(published).toMatchObject({ kind: "done", dropped: [1, 2], site: { ...live, versions: [{ number: 3, bytes: 1000, files: 2, published_by: BO }] } });
      expect([again, await database.getUpload(third)]).toMatchObject([{ kind: "not_pending" }, { manifest: [], upload: { state: "finished", dropped: [1, 2] } }]);
      expect(await auditActions(database)).toEqual(["create", "publish", "access", "details", "publish"]);
      expect([await database.getSiteByFolder(site.folder), await database.readTotals()]).toMatchObject([{ id: site.id, title: "Q3 sales" }, { sites: 1, bytes: 1000, files: 2 }]);
    });

    // Drift: the typed title and the page's own are two columns; a version that wrote its page's title over the typed one would lose a title the owner set.
    test("a version brings its page's title and leaves the typed one, a typed title taken away leaves the page's, and a backup carries both", async () => {
      const database = await opened(makeDatabase);
      const begun = await begunSite(database, { ...draft(REPORT), page_title: "Field notes" });
      const created = await database.publishUploadAsSite(begun.id, begun.site, BY_ADA);
      if (created.kind !== "done") throw new Error(`the fixture site was refused: ${created.kind}`);

      const { site } = created;
      const typed = await database.changeDetails(site.id, { title: "Q3 sales" }, BY_ADA);
      const second = await database.publishUploadAsVersion(await begunVersion(database, site), { keep: 3, details: {}, page_title: "Second page" }, BY_ADA);
      const [exported] = (await database.exportSites({ limit: 1 })).sites;
      const cleared = await database.changeDetails(site.id, { title: null }, BY_ADA);
      const third = await database.publishUploadAsVersion(await begunVersion(database, site), { keep: 3, details: {} }, BY_ADA);
      if (exported === undefined) throw new Error("the fixture site is not exported");

      await database.deleteSite(site.id, BY_ADA);
      const back = await begunImport(database, exported);
      const imported = await database.importUploadAsSite(back.id, back.site, BY_ADA);

      expect([site, typed, second, cleared, third, imported]).toMatchObject([
        { title: null, page_title: "Field notes" },
        { site: { title: "Q3 sales", page_title: "Field notes" } },
        { site: { title: "Q3 sales", page_title: "Second page", live_version: 2 } },
        { site: { title: null, page_title: "Second page" } },
        { site: { title: null, page_title: null, live_version: 3 } },
        { kind: "done", site: { title: "Q3 sales", page_title: "Second page", live_version: 2 } },
      ]);
      expect(await auditActions(database)).toEqual(["create", "details", "publish", "details", "publish", "delete", "imported"]);
    });

    // Drift: the sweep removes a record only after its files; a pending record that could be removed would orphan the files still being uploaded under it.
    test("a record is removed only once it is finished or abandoned, and old uploads list a page at a time, the oldest first", async () => {
      const database = await opened(makeDatabase);
      const ids: UploadId[] = [];
      for (const age of [3, 1, 2]) ids.push((await begunSite(database, draft(REPORT), NOW - age)).id);

      const [oldest, newest, middle] = ids as [UploadId, UploadId, UploadId];
      const first = await database.listUploads({ before: NOW, limit: 2 });
      const rest = await database.listUploads({ before: NOW, limit: 2, after: first.next });
      const kept = await database.removeUpload(oldest);
      const given = [await database.abandonUpload(oldest), await database.abandonUpload(oldest), await database.removeUpload(oldest), await database.removeUpload(oldest)];

      expect([first.uploads.map((upload) => upload.id), rest.uploads.map((upload) => upload.id), rest.next]).toEqual([[oldest, middle], [newest], undefined]);
      expect([(await database.listUploads({ before: NOW - 2, limit: 2 })).uploads.length, kept, given]).toEqual([0, false, [true, false, true, false]]);
      await expect(database.listUploads({ before: NOW, limit: 101 })).rejects.toThrow(RangeError);
    });

    // Drift: these are uploads no later step could store a file for or finish; each row is one the database must refuse to record.
    test.each([
      ["a second upload under the same folder and number", (upload: NewUpload): NewUpload => ({ ...upload, id: mintUploadId() })],
      ["a second upload with the same id", (upload: NewUpload): NewUpload => ({ ...upload, folder: mintSiteFolder() })],
      ["an upload of no file", (upload: NewUpload): NewUpload => ({ ...upload, id: mintUploadId(), folder: mintSiteFolder(), manifest: [] })],
      ["a file of a negative size", (upload: NewUpload): NewUpload => ({ ...upload, id: mintUploadId(), folder: mintSiteFolder(), manifest: [{ ...MANIFEST[0], size: -1 }] as never })],
      ["an id that is none", (upload: NewUpload): NewUpload => ({ ...upload, id: "nope" as UploadId, folder: mintSiteFolder() })],
    ])("%s is refused, and nothing of it is kept", async (_state, change) => {
      const database = await opened(makeDatabase);
      const { folder } = draft(REPORT);
      const upload: NewUpload = { id: mintUploadId(), folder, number: 2, owner: ADA, plan: { kind: "update", details: {} }, manifest: MANIFEST, created_at: NOW };
      await database.addUpload(upload, ROOMY);

      await expect(database.addUpload(change(upload), ROOMY)).rejects.toThrow();
      expect((await database.listUploads({ before: NOW + 1, limit: 10 })).uploads.length).toBe(1);
    });

    // Drift: the limits bound what the bucket and the database hold; an upload measured in one step and recorded in the next would let requests sent together pass every limit at once.
    test.each([
      ["its owner's pending uploads", { own: 2 }, "version", 1, "own_full"],
      ["the bytes pending under its folder", { folderBytes: 2000 }, "version", 1, "folder_full"],
      ["the bytes of its folder with the site's newest version", { folderBytes: 2000, staying: 1 }, "version", 0, "folder_full"],
      ["the bytes of every site and every pending upload", { totalBytes: 4000 }, "version", 1, "total_full"],
      ["the sites there are and are being made", { sites: 3 }, "site", 1, "sites_full"],
      ["the files declared on its day", { dayFiles: 6 }, "version", 1, "day_full"],
      ["the writes to the store counted on its day", { dayWrites: 6 }, "version", 1, "writes_full"],
    ] as const)("of three uploads recorded at the same moment only as many are kept as fit the room for %s", async (_bound, bound, kind, fit, refusal) => {
      const database = await opened(makeDatabase);
      const site = await made(database, draft(REPORT));
      const room = { ...ROOMY, ...bound };
      const version = (number: number): NewUpload => ({ id: mintUploadId(), folder: site.folder, number, owner: ADA, plan: { kind: "update", details: {} }, manifest: MANIFEST, created_at: NOW });
      const candidate = (number: number): NewUpload => (kind === "version" ? version(number) : { ...version(1), folder: mintSiteFolder() });
      await database.addUpload({ ...version(1), folder: mintSiteFolder() }, ROOMY);
      await database.addUpload({ ...version(2), owner: BO }, ROOMY);

      const together = await Promise.all([3, 4, 5].map((number) => database.addUpload(candidate(number), room)));
      const kinds = together.map((added) => added.kind).sort();

      expect(kinds).toEqual([...Array.from({ length: fit }, () => "done" as const), ...Array.from({ length: 3 - fit }, () => refusal)].sort());
      expect((await database.listUploads({ before: NOW + 1, limit: 10 })).uploads.length).toBe(2 + fit);
    });

    // Drift: the record of a finished upload is all that says which dropped versions still have files; one that could not be shortened would have every removal start over.
    test("the dropped versions of a finished upload are set to the ones still to go, and those of a pending upload are left alone", async () => {
      const database = await opened(makeDatabase);
      const site = await made(database, draft(REPORT));
      const finished = await begunVersion(database, site);
      const pending = await begunVersion(database, site);
      await database.publishUploadAsVersion(finished, { keep: 1, details: {} }, BY_ADA);
      await database.setUploadDropped(finished, []);
      await database.setUploadDropped(pending, [1]);

      expect([(await database.getUpload(finished))?.upload.dropped, (await database.getUpload(pending))?.upload.dropped]).toEqual([[], []]);
    });

    // Drift: a site made by an admin finishing a publisher's upload must stay the publisher's, or the publisher loses the site it uploaded.
    test("a site made from an upload belongs to whoever began the upload, and its audit entry to whoever finished it", async () => {
      const database = await opened(makeDatabase);
      const upload = await begunSite(database, draft(REPORT));
      const made = await database.publishUploadAsSite(upload.id, upload.site, BY_BO_LATER);

      expect(made).toMatchObject({ kind: "done", site: { owner: ADA, created_at: NOW + 5, versions: [{ published_by: ADA }] } });
      expect((await auditTrail(database)).map((entry) => [entry.action, entry.by])).toEqual([["create", BO]]);
    });
  });
}

export function declaredFiles(label: string, makeDatabase: DatabaseFactory): void {
  describe(`${label}: the files declared in a day`, () => {
    // Drift: every stored file is a bucket operation the host bills past a monthly amount. A count that an upload given up gave back would let a loop of begin and abandon store without end, and one that outlived its day would refuse tomorrow's publish.
    test("the files of every upload begun on a day count against that day, an upload given up gives none back, the next day begins at none, and one begun late for the day before still counts against it", async () => {
      const database = await opened(makeDatabase);
      const site = await made(database, draft(REPORT));
      const begin = async (number: number, day: string, dayFiles = 4): Promise<{ readonly id: UploadId; readonly added: Awaited<ReturnType<Database["addUpload"]>> }> => {
        const id = mintUploadId();
        const added = await database.addUpload({ id, folder: site.folder, number, owner: ADA, plan: { kind: "update", details: {} }, manifest: MANIFEST, created_at: NOW }, { ...ROOMY, dayFiles, day });

        return { id, added };
      };

      const first = await begin(2, TODAY);
      await database.abandonUpload(first.id);
      const kinds = [first.added.kind];
      for (const [number, day] of [[3, TODAY], [4, TODAY], [5, TOMORROW], [6, TODAY], [7, TOMORROW], [8, TOMORROW]] as const) kinds.push((await begin(number, day)).added.kind);
      const refused = [await begin(9, TODAY), await begin(9, TODAY, 5), await begin(9, TODAY, 1)].map(({ added }) => added);

      expect(kinds).toEqual(["done", "done", "day_full", "done", "day_full", "done", "day_full"]);
      // A refusal says how many files the day has left, so its caller tells a day used up from an upload too large for the rest.
      expect(refused).toEqual([{ kind: "day_full", left: 0 }, { kind: "day_full", left: 1 }, { kind: "day_full", left: 0 }]);
    });
  });
}

/** A day whose count's arrival drops the fixture's first day: three days after it. */
const THREE_DAYS_ON = "2026-11-16";

export function storageWrites(label: string, makeDatabase: DatabaseFactory): void {
  describe(`${label}: the writes to the store counted in a day`, () => {
    // Drift: the count is what keeps a month of writes and listings inside what a host takes for free. One that forgot an upload's writes, or a listing's, would let a loop pass the bound unseen.
    test("an upload's writes are counted when it begins, listings add to the same day, an upload that does not fit is refused, and the bound read back is the stored setting", async () => {
      const database = await opened(makeDatabase);
      const site = await made(database, draft(REPORT));
      const begin = (number: number, room: Partial<typeof ROOMY>): ReturnType<Database["addUpload"]> =>
        database.addUpload({ id: mintUploadId(), folder: site.folder, number, owner: ADA, plan: { kind: "update", details: {} }, manifest: MANIFEST, created_at: NOW }, { ...ROOMY, day: TODAY, ...room });
      const most = SETTINGS.max_storage_writes_per_day;
      await database.initSettings(SETTINGS, BY_ADA);

      const added = [await begin(2, { writes: 4, dayWrites: 9 })];
      await database.addStorageWrites(TODAY, 3);
      added.push(await begin(3, { writes: 3, dayWrites: 9 }), await begin(4, { writes: 2, dayWrites: 9 }), await begin(5, { writes: 3, dayWrites: 9, day: TOMORROW }), await begin(6, { writes: 1, dayWrites: 9 }));

      // The refusals say how many writes the day has left: two for an upload of three, and none once the day is used up.
      expect(added).toEqual([{ kind: "done" }, { kind: "writes_full", left: 2 }, { kind: "done" }, { kind: "done" }, { kind: "writes_full", left: 0 }]);
      expect([await database.readStorageWrites(TODAY), await database.readStorageWrites(TOMORROW)]).toEqual([{ writes: 9, most }, { writes: 3, most }]);
    });

    // Drift: the day's files and the day's writes share a row. A listing counted on a day no upload began would have no row to add to, and a count that outlived its day would refuse the next day's work.
    test("writes are counted on a day no upload began, change no count of declared files, and a listing that takes its place drops the days before the day before", async () => {
      const database = await opened(makeDatabase);
      const site = await made(database, draft(REPORT));
      await database.initSettings(SETTINGS, BY_ADA);
      await database.addStorageWrites(TODAY, 5);
      await database.addStorageWrites(TODAY, 1);
      const fits = await database.addUpload({ id: mintUploadId(), folder: site.folder, number: 2, owner: ADA, plan: { kind: "update", details: {} }, manifest: MANIFEST, created_at: NOW }, { ...ROOMY, day: TODAY, dayFiles: 2 });
      await database.takeStorageWrite(THREE_DAYS_ON, 0);

      expect(fits).toEqual({ kind: "done" });
      expect((await Promise.all([TODAY, TOMORROW, THREE_DAYS_ON].map((day) => database.readStorageWrites(day)))).map((read) => read?.writes)).toEqual([0, 0, 1]);
    });

    // Drift: a listing is checked and counted in one step. Checked first and counted after, the listings of requests that arrive together would each see the same room and pass the bound together.
    test("of five listings that ask for a place at the same moment only as many are counted as the day has room for, and a caller's spare ones on top", async () => {
      const database = await opened(makeDatabase);
      await database.initSettings({ ...SETTINGS, max_storage_writes_per_day: 4 }, BY_ADA);
      await database.addStorageWrites(TODAY, 2);

      const together = await Promise.all(Array.from({ length: 5 }, () => database.takeStorageWrite(TODAY, 0)));
      const spare = [await database.takeStorageWrite(TODAY, 1), await database.takeStorageWrite(TODAY, 1), await database.takeStorageWrite(TOMORROW, 0)];

      expect([together.filter((taken) => taken).length, spare, (await database.readStorageWrites(TODAY))?.writes]).toEqual([2, [true, false, true], 5]);
    });
  });
}
