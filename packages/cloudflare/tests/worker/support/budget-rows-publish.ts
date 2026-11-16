// What publishing may cost: a publish's three steps, a copy's rounds, and a backup put back.

import type { ImportRequest } from "@poplin/core/src/actions/begin-import";
import { sha256Of } from "@poplin/core/src/storage/storage";
import { done, type Published, page, sendFile } from "./install";
import { adminToken, apiOf, type BudgetRow, published, type Stage, unmeasured } from "./budget-stage";
import { BYTE_SHA256, filePath, manyFiles, manySites, siteFolder, siteId, siteWithFiles, uploadOf } from "./budget-seeds";

/** The group of every row here. */
const group = "Publishing";

/** The versions a site keeps under the first settings of the tests' install. */
const KEPT = 3;

/** The most files one publish declares under the first settings of the tests' install. */
const MOST_FILES = 5000;

/** The files of a version the bucket lists in two pages: one more than a page holds. */
const TWO_PAGES = 1001;

/** The files a copy of up to a thousand takes in one call: a site of so many is copied and made in that one call. */
const COPIED_AT_ONCE = 112;

/** An upload key made long before any row's clock, in the text the Worker keeps it as: the install signs tickets with it. */
const UPLOAD_KEY = JSON.stringify({ id: "0123456789abcdef0123456789abcdef", secret: "5".repeat(64), bucket: "poplin-sites", minted_at: 0 });

/** One file's bytes, as every made-up file holds them. */
const BODY = new TextEncoder().encode("x");

/** What a backup holds of one site: the site as the export answered it, and every file of every version by the path an import names it with. */
interface Backup {
  readonly site: ImportRequest["site"];
  readonly files: readonly { readonly path: string; readonly size: number; readonly content_type: string; readonly sha256: string }[];
}

/** The made-up site 1 with every version it keeps holding ten files in the bucket, as a site published three times does. */
async function keptSite(stage: Stage): Promise<void> {
  await manySites(stage, 1, { versions: KEPT });
  for (let version = 1; version <= KEPT; version += 1) await manyFiles(`${siteFolder(1)}/v${version}/`, 10);
}

/** Publish a site three times, take its backup with every version, and remove it for good: what an import of it into the same install starts from. */
async function backupOf(stage: Stage, token: string): Promise<Backup> {
  const calls = apiOf(unmeasured(stage), token);
  const first: Published = await published(stage, { name: "report" });
  for (let later = 2; later <= KEPT; later += 1) await published(stage, { site: first.id }, [page(`<h1>version ${later}</h1>`)]);

  const param = { site: first.id };
  const kept = await done<{ site: ImportRequest["site"] }>(await calls.export.sites[":site"].$get({ param, query: { all_versions: "true" } }));
  const files: Backup["files"][number][] = [];
  for (const { number } of kept.site.versions) {
    const listed = await done<{ files: readonly { path: string; size: number }[] }>(await calls.export.sites[":site"].files.$get({ param, query: { version: String(number) } }));
    // A row that sends these files sends so many zeros for each, so that is the hash each declares.
    for (const { path, size } of listed.files) files.push({ path: `v${number}/${path}`, size, content_type: "text/html", sha256: await sha256Of(new Uint8Array(size)) });
  }

  await done(await calls.sites[":site"].$delete({ param, query: { forever: "true" } }));

  return { site: kept.site, files };
}

export const PUBLISH_ROWS: readonly BudgetRow[] = [
  {
    group,
    name: "publish a one-page site: start",
    guide: "Publish a site of one page",
    route: "POST /api/uploads",
    // The common publish: a new site of one page.
    arrange: async (stage) => {
      const token = await adminToken(stage);
      const files = [{ path: filePath(0), size: BODY.byteLength, content_type: "text/html", sha256: BYTE_SHA256 }];

      return (measured) => apiOf(measured, token).uploads.$post({ query: {}, json: { name: "report", files } });
    },
    status: 200,
    budget: { queries: 3, reads: 0, writes: 0 },
  },
  {
    group,
    name: "publish 5,000 files: start",
    route: "POST /api/uploads",
    // Worst: as many files as one publish may declare, as the next version of a site that keeps every version it may, with each setting changed along.
    arrange: async (stage) => {
      await manySites(stage, 1, { versions: KEPT });
      const token = await adminToken(stage);
      const files = Array.from({ length: MOST_FILES }, (_file, at) => ({ path: filePath(at), size: BODY.byteLength, content_type: "text/html", sha256: BYTE_SHA256 }));
      const json = { site: siteId(1), access: "public", public_name: "report-page", title: "A title", search_engines: true, embeddable: false, expires: "7d", files } as const;

      return (measured) => apiOf(measured, token).uploads.$post({ query: {}, json: { ...json, files } });
    },
    status: 200,
    budget: { queries: 5, reads: 0, writes: 0 },
  },
  {
    group,
    name: "publish 5,000 files: one file",
    route: "PUT /api/uploads/:upload/file",
    // Worst: the file is one of the largest manifest a publish may declare, which the database looks the path up in.
    arrange: async (stage) => {
      const token = await adminToken(stage);
      const upload = await uploadOf(stage, token, { declared: MOST_FILES, stored: 0 });

      return (measured) => sendFile(apiOf(measured, token), upload, { path: filePath(MOST_FILES - 1), body: BODY });
    },
    status: 200,
    budget: { queries: 2, reads: 1, writes: 1 },
  },
  {
    group,
    name: "publish 5,000 files: the tickets of a hundred files",
    route: "POST /api/uploads/:upload/tickets",
    // Worst: the most paths one call names, each looked up in the largest manifest a publish may declare. Nothing is written, and the bucket is not asked.
    arrange: async (stage) => {
      const token = await adminToken(stage);
      const upload = await uploadOf(stage, token, { declared: MOST_FILES, stored: 0 });
      const paths = Array.from({ length: 100 }, (_path, at) => filePath(MOST_FILES - 1 - at));

      return (measured) => apiOf(measured, token).uploads[":upload"].tickets.$post({ param: { upload }, query: {}, json: { paths } });
    },
    status: 200,
    budget: { queries: 2, read: 2, written: 0, reads: 0, writes: 0 },
  },
  {
    group,
    name: "publish 5,000 files: the tickets of a hundred files, signed for the bucket",
    route: "POST /api/uploads/:upload/tickets",
    // Worst: the same hundred paths on an install that holds an upload key, each signed in the request. Signing asks neither the database nor the bucket.
    arrange: async (stage) => {
      const token = await adminToken(stage);
      const upload = await uploadOf(stage, token, { declared: MOST_FILES, stored: 0 });
      const paths = Array.from({ length: 100 }, (_path, at) => filePath(MOST_FILES - 1 - at));
      stage.uploadKey = UPLOAD_KEY;

      return (measured) => apiOf(measured, token).uploads[":upload"].tickets.$post({ param: { upload }, query: {}, json: { paths } });
    },
    status: 200,
    budget: { queries: 2, read: 2, written: 0, reads: 0, writes: 0 },
  },
  {
    group,
    name: "publish 5,000 files: the tickets of a hundred files, after the bucket refused them",
    route: "POST /api/uploads/:upload/tickets",
    // Worst: the first sender of an hour that turns back to the install on one that holds an upload key. It is noted as a problem, in one more query that writes its one row.
    arrange: async (stage) => {
      const token = await adminToken(stage);
      const upload = await uploadOf(stage, token, { declared: MOST_FILES, stored: 0 });
      const paths = Array.from({ length: 100 }, (_path, at) => filePath(MOST_FILES - 1 - at));
      stage.uploadKey = UPLOAD_KEY;

      return (measured) => apiOf(measured, token).uploads[":upload"].tickets.$post({ param: { upload }, query: {}, json: { paths, through: "install" } });
    },
    status: 200,
    budget: { queries: 3, read: 3, written: 1, reads: 0, writes: 0 },
  },
  {
    group,
    name: "look at an upload, 1,001 files stored",
    route: "GET /api/uploads/:upload",
    // The listing that finds the missing files walks a page for every 1,000 stored. Seeded with two pages: the queries are the same for any count, and the largest publish, 5,000 files, is five listings.
    arrange: async (stage) => {
      const token = await adminToken(stage);
      const upload = await uploadOf(stage, token, { declared: TWO_PAGES, stored: TWO_PAGES });

      return (measured) => apiOf(measured, token).uploads[":upload"].$get({ param: { upload }, query: {} });
    },
    status: 200,
    budget: { queries: 4, reads: 0, writes: 2 },
  },
  {
    group,
    name: "publish a one-page site: its file",
    guide: "Publish a site of one page",
    route: "PUT /api/uploads/:upload/file",
    // The common publish: the one file is looked up in its manifest, looked for in the bucket, and stored.
    arrange: async (stage) => {
      const token = await adminToken(stage);
      const upload = await uploadOf(stage, token, { declared: 1, stored: 0 });

      return (measured) => sendFile(apiOf(measured, token), upload, { path: filePath(0), body: BODY });
    },
    status: 200,
    budget: { queries: 2, reads: 1, writes: 1 },
  },
  {
    group,
    name: "publish a one-page site: finish",
    guide: "Publish a site of one page",
    route: "POST /api/uploads/:upload/finish",
    // The common publish: the one file is there, and the site is made.
    arrange: async (stage) => {
      const token = await adminToken(stage);
      const upload = await uploadOf(stage, token, { declared: 1, stored: 1 });

      return (measured) => apiOf(measured, token).uploads[":upload"].finish.$post({ param: { upload }, query: {} });
    },
    status: 200,
    budget: { queries: 5, reads: 0, writes: 1 },
  },
  {
    group,
    name: "publish 1,001 files: finish, the oldest version dropped",
    route: "POST /api/uploads/:upload/finish",
    // Worst: the site keeps every version it may, so going live drops the oldest and removes its files. Seeded with two list pages: the queries are the same for any count, and the largest publish is five listings.
    arrange: async (stage) => {
      await keptSite(stage);
      const token = await adminToken(stage);
      const upload = await uploadOf(stage, token, { declared: TWO_PAGES, stored: TWO_PAGES, site: siteId(1) });

      return (measured) => apiOf(measured, token).uploads[":upload"].finish.$post({ param: { upload }, query: {} });
    },
    status: 200,
    budget: { queries: 8, reads: 0, writes: 3, deletes: 1 },
  },
  {
    group,
    name: "give up an upload, 1,001 files stored",
    route: "DELETE /api/uploads/:upload",
    // The removal lists and deletes a page for every 1,000 files stored. Seeded with two pages: the queries are the same for any count.
    arrange: async (stage) => {
      const token = await adminToken(stage);
      const upload = await uploadOf(stage, token, { declared: TWO_PAGES, stored: TWO_PAGES });

      return (measured) => apiOf(measured, token).uploads[":upload"].$delete({ param: { upload }, query: {} });
    },
    status: 200,
    budget: { queries: 5, reads: 0, writes: 2, deletes: 2 },
  },
  {
    group,
    name: "duplicate a site of 112 files, whole in one call",
    guide: "Copy a site of 112 files",
    route: "POST /api/sites/:site/duplicate",
    // Worst of a small copy: as many files as one call copies, so the same call stages the copy, copies every file, lists it again, and makes the site.
    arrange: async (stage) => {
      await siteWithFiles(stage, COPIED_AT_ONCE);
      const token = await adminToken(stage);

      return (measured) => apiOf(measured, token).sites[":site"].duplicate.$post({ param: { site: siteId(1) }, query: {}, json: { name: "copy" } });
    },
    status: 200,
    budget: { queries: 8, reads: 112, writes: 114 },
  },
  {
    group,
    name: "duplicate a site of 1,001 files: first round",
    route: "POST /api/sites/:site/duplicate",
    // Worst of a first round: a version listed in two pages, where a call copies the most files it ever does.
    arrange: async (stage) => {
      await siteWithFiles(stage, TWO_PAGES);
      const token = await adminToken(stage);

      return (measured) => apiOf(measured, token).sites[":site"].duplicate.$post({ param: { site: siteId(1) }, query: {}, json: { name: "copy" } });
    },
    status: 200,
    budget: { queries: 5, reads: 113, writes: 115 },
  },
  {
    group,
    name: "duplicate a site of 1,001 files: a later round, on an install with no Workflow",
    route: "POST /api/sites/:site/duplicate",
    // Worst of a later round where the asking request runs it: the copy is listed for what it lacks, and as many more files are copied.
    arrange: async (stage) => {
      await siteWithFiles(stage, TWO_PAGES);
      const token = await adminToken(stage);
      const param = { site: siteId(1) };
      const begun = await done<{ copy: { upload: string } }>(await apiOf(unmeasured(stage), token).sites[":site"].duplicate.$post({ param, query: {}, json: { name: "copy" } }));

      return (measured) => apiOf(measured, token).sites[":site"].duplicate.$post({ param, query: {}, json: { upload: begun.copy.upload } });
    },
    status: 200,
    budget: { queries: 4, reads: 113, writes: 114 },
  },
  {
    group,
    name: "restore a backup's site: start",
    route: "POST /api/import/sites",
    // Worst: the site comes with every version it kept, so the import declares each version's files.
    arrange: async (stage) => {
      const token = await adminToken(stage);
      const backup = await backupOf(stage, token);

      return (measured) => apiOf(measured, token).import.sites.$post({ query: {}, json: { format: 1, site: backup.site, files: [...backup.files] } });
    },
    status: 200,
    budget: { queries: 5, reads: 0, writes: 0 },
  },
  {
    group,
    name: "restore a backup's site: finish",
    // Worst: the upload is an import of every kept version, so the finish makes the site and all its versions in one step.
    arrange: async (stage) => {
      const token = await adminToken(stage);
      const backup = await backupOf(stage, token);
      const calls = apiOf(unmeasured(stage), token);
      const begun = await done<{ upload: { id: string } }>(await calls.import.sites.$post({ query: {}, json: { format: 1, site: backup.site, files: [...backup.files] } }));
      for (const file of backup.files) await done(await sendFile(calls, begun.upload.id, { path: file.path, body: new Uint8Array(file.size) }));

      return (measured) => apiOf(measured, token).uploads[":upload"].finish.$post({ param: { upload: begun.upload.id }, query: {} });
    },
    status: 200,
    budget: { queries: 5, reads: 0, writes: 1 },
  },
];
