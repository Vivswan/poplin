// What publishing costs as a site's files grow: a publish's three steps, a copy, and a backup put back.

import type { ImportRequest } from "@poplin/core/src/actions/begin-import";
import type { Fill } from "../../../load/profiles";
import { BYTE_SHA256, filePath, manyFiles, siteId, uploadOf } from "../../shared/worker/support/budget-seeds";
import { adminToken, apiOf, type Stage, unmeasured } from "../../shared/worker/support/budget-stage";
import { BINDINGS, done, sendFile } from "../../shared/worker/support/install";
import { fillInstall } from "./fill";
import type { Scenario } from "./measure";

/** The files the publishes begun in one day may declare, under the first settings of the tests' install. */
const FILES_A_DAY = 25_000;

/** The files up to which a fill makes several uploads to finish, so a row and a burst of finishes can be asked. */
const SMALL = 200;

/** The uploads a fill of a small site makes ready to finish: under the 20 one holder may leave unfinished. */
const READY = 15;

/** One file's bytes, as every made-up file holds them. */
const BODY = new TextEncoder().encode("x");

/** The id of a site an import makes, from the turn that makes it: twelve characters no made-up site has. */
function importedId(turn: number): string {
  return `9${String(turn).padStart(11, "0")}`;
}

/** What a publish of so many made-up files declares, each named under a folder where one is given. */
function declared(files: number, folder = ""): { readonly path: string; readonly size: number; readonly content_type: string; readonly sha256: string }[] {
  return Array.from({ length: files }, (_file, at) => ({ path: `${folder}${filePath(at)}`, size: BODY.length, content_type: "text/html", sha256: BYTE_SHA256 }));
}

/** How many publishes of a fill's files a row and a burst may begin: what one day has room for, less one for what the fill itself began, and under the 20 one holder may leave unfinished. */
function publishesADay(fill: Fill): number {
  return Math.min(READY, Math.floor(FILES_A_DAY / fill.files) - 1);
}

/** The private site 3 as a backup holds it, with its live version alone, declared to hold the fill's files of one byte each. */
async function backedUp(stage: Stage, token: string, fill: Fill): Promise<ImportRequest["site"]> {
  const kept = await done<{ site: ImportRequest["site"] }>(await apiOf(unmeasured(stage), token).export.sites[":site"].$get({ param: { site: siteId(3) }, query: {} }));

  return { ...kept.site, versions: kept.site.versions.map((version) => ({ ...version, files: fill.files, bytes: fill.files * BODY.length })) };
}

/** Begin an import of a site of the fill's files under an id of its own, and put its files in the bucket: what a finish then makes a site of. */
async function importReady(stage: Stage, token: string, site: ImportRequest["site"], fill: Fill, turn: number): Promise<string> {
  const json = { format: 1, site: { ...site, id: importedId(turn) } as ImportRequest["site"], files: declared(fill.files, "v1/") };
  const begun = await done<{ upload: { id: string } }>(await apiOf(unmeasured(stage), token).import.sites.$post({ query: {}, json }));
  const placed = await BINDINGS.DB.prepare("SELECT folder FROM uploads WHERE id = ?1").bind(begun.upload.id).first<{ folder: string }>();
  if (placed === null) throw new Error("the import's upload is not there");

  await manyFiles(`${placed.folder}/v1/`, fill.files);

  return begun.upload.id;
}

/** Publishing, a copy, and an import. */
export const PUBLISH_SCENARIOS: readonly Scenario[] = [
  {
    name: "publish: start, a new site",
    axis: "files",
    flat: false,
    status: 200,
    turns: publishesADay,
    arrange: async (stage, fill) => {
      await fillInstall(stage, fill);
      const token = await adminToken(stage);
      const files = declared(fill.files);

      return (measured, turn) => apiOf(measured, token).uploads.$post({ query: {}, json: { name: `load-${turn}`, files } });
    },
  },
  {
    name: "publish: one file, from the last one on",
    axis: "files",
    flat: true,
    status: 200,
    turns: (fill) => fill.files,
    arrange: async (stage, fill) => {
      await fillInstall(stage, fill);
      const token = await adminToken(stage);
      const upload = await uploadOf(stage, token, { declared: fill.files, stored: 0 });

      return (measured, turn) => sendFile(apiOf(measured, token), upload, { path: filePath(fill.files - 1 - turn), body: BODY });
    },
  },
  {
    name: "publish: finish, a new site",
    axis: "files",
    flat: false,
    status: 200,
    turns: (fill) => (fill.files <= SMALL ? READY : 1),
    arrange: async (stage, fill) => {
      await fillInstall(stage, fill);
      const token = await adminToken(stage);
      const uploads: string[] = [];
      for (let made = 0; made < (fill.files <= SMALL ? READY : 1); made += 1) uploads.push(await uploadOf(stage, token, { declared: fill.files, stored: fill.files }));

      return (measured, turn) => apiOf(measured, token).uploads[":upload"].finish.$post({ param: { upload: uploads[turn] ?? "" }, query: {} });
    },
  },
  {
    name: "duplicate a site: the first request",
    axis: "files",
    flat: false,
    status: 200,
    turns: (fill) => Math.floor(publishesADay(fill) / 2),
    arrange: async (stage, fill) => {
      await fillInstall(stage, fill);
      const token = await adminToken(stage);

      return (measured, turn) => apiOf(measured, token).sites[":site"].duplicate.$post({ param: { site: siteId(1) }, query: {}, json: { name: `copy-${turn}` } });
    },
  },
  {
    name: "import: start",
    axis: "files",
    flat: false,
    status: 200,
    turns: publishesADay,
    arrange: async (stage, fill) => {
      await fillInstall(stage, fill);
      const token = await adminToken(stage);
      const site = await backedUp(stage, token, fill);
      const files = declared(fill.files, "v1/");

      return (measured, turn) => apiOf(measured, token).import.sites.$post({ query: {}, json: { format: 1, site: { ...site, id: importedId(turn) } as ImportRequest["site"], files } });
    },
  },
  {
    name: "import: finish",
    axis: "files",
    flat: false,
    status: 200,
    turns: (fill) => (fill.files <= SMALL ? READY : 1),
    arrange: async (stage, fill) => {
      await fillInstall(stage, fill);
      const token = await adminToken(stage);
      const site = await backedUp(stage, token, fill);
      const uploads: string[] = [];
      for (let made = 0; made < (fill.files <= SMALL ? READY : 1); made += 1) uploads.push(await importReady(stage, token, site, fill, made));

      return (measured, turn) => apiOf(measured, token).uploads[":upload"].finish.$post({ param: { upload: uploads[turn] ?? "" }, query: {} });
    },
  },
];
