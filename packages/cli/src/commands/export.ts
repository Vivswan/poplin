// Export: ask the install for its settings, its sites, and every file of each, and write them into one zip as they arrive. No file is held whole, and the zip takes its name only when all of it is written.

import type { ROUTES } from "../../../core/src/api/routes";
import { showBytes } from "../../../core/src/records/settings";
import { siteLabel } from "../../../core/src/sites/labels";
import { BACKUP_FORMAT, type IndexedFile, LAYOUT, type Manifest } from "../backup/layout";
import { type BackupWriter, createBackup } from "../backup/write";
import type { Called, Client } from "../client/client";
import { VERSION } from "../poplin";
import { type Problem, problem, problemOf } from "./problems";
import type { Outcome, RequestOf, Session } from "./records";
import { columns, countText, dayText } from "./text";
import { siteWord } from "./wire";

/** The `export` command as the parser read it. */
type ExportRequest = RequestOf<"export">;

/** A site as the install stores it, which is what a backup holds of it. */
type StoredSite = NonNullable<(typeof ROUTES)["exportSite"]["types"]>["done"]["site"];

/** What an export works with: the install, the zip, and what shows a file's arrival. */
interface Job {
  readonly client: Client;
  readonly writer: BackupWriter;
  readonly arrived: (label: string) => void;
}

/** What was written of one site. */
interface Exported {
  readonly id: string;
  readonly label: string;
  readonly versions: number;
  readonly files: number;
  readonly bytes: number;
}

/** The export cannot go on: carried up to `runExport`, which gives the zip up. */
class Stopped extends Error {
  readonly problem: Problem;

  constructor(said: Problem) {
    super(said.message);
    this.problem = said;
  }
}

function need<Done>(called: Called<Done>): Done {
  if (!called.ok) throw new Stopped(problemOf(called.failure));

  return called.value;
}

function needFormat(format: number): void {
  if (format !== BACKUP_FORMAT) throw new Stopped(problem("other_format", `format ${format}`));
}

/** Write the files of one version, a page of the listing at a time, and then the index that names each with its length and its content type. */
async function writeVersion(job: Job, site: StoredSite, label: string, version: number): Promise<readonly IndexedFile[]> {
  const index: IndexedFile[] = [];
  let cursor: string | undefined;

  do {
    const page = need(await job.client.call("exportFiles", cursor === undefined ? { site: site.id, version } : { site: site.id, version, cursor }));

    for (const listed of page.files) {
      const file = need(await job.client.download({ site: site.id, version, path: listed.path }));
      await job.writer.addFile(LAYOUT.file(label, version, listed.path), file.body, file.size);

      index.push({ path: listed.path, size: file.size, content_type: file.contentType });
      job.arrived(label);
    }

    cursor = page.next;
  } while (cursor !== undefined);

  job.writer.addJson(LAYOUT.index(label, version), index);

  return index;
}

/** Write one site: its record, then each version it keeps. A version whose files are not what the record counts would make a backup no install takes, so the export stops there. */
async function writeSite(job: Job, site: StoredSite): Promise<Exported> {
  const label = siteLabel(site.name, site.id);
  const totals = { files: 0, bytes: 0 };
  job.writer.addJson(LAYOUT.site(label), site);

  for (const version of site.versions) {
    const index = await writeVersion(job, site, label, version.number);
    const bytes = index.reduce((sum, file) => sum + file.size, 0);
    if (index.length !== version.files || bytes !== version.bytes) throw new Stopped(problem("site_changed", `${label}, version ${version.number}`));

    totals.files += index.length;
    totals.bytes += bytes;
  }

  return { id: site.id, label, versions: site.versions.length, ...totals };
}

/** Write the settings and every site of the install, a page of sites at a time. */
async function writeInstall(job: Job, allVersions: boolean): Promise<readonly Exported[]> {
  const settings = need(await job.client.call("exportSettings", undefined));
  needFormat(settings.format);
  job.writer.addJson(LAYOUT.settings, settings.settings);

  const written: Exported[] = [];
  let after: StoredSite["id"] | undefined;

  do {
    const page = need(await job.client.call("exportSites", { ...(allVersions ? { all_versions: true } : {}), ...(after === undefined ? {} : { after }) }));
    needFormat(page.format);

    for (const site of page.sites) written.push(await writeSite(job, site));

    after = page.next;
  } while (after !== undefined);

  return written;
}

async function writeOne(job: Job, request: ExportRequest & { readonly site: NonNullable<ExportRequest["site"]> }): Promise<readonly Exported[]> {
  const one = need(await job.client.call("exportSite", { site: siteWord(request.site), ...(request.allVersions ? { all_versions: true } : {}) }));
  needFormat(one.format);

  return [await writeSite(job, one.site)];
}

function exported(target: string, manifest: Manifest, sites: readonly Exported[], zipBytes: number): Outcome {
  const rows = sites.map((site) => ["exported", site.label, countText(site.versions, "version"), countText(site.files, "file"), showBytes(site.bytes)]);
  const { made_by, made_at, sites: count, ...facts } = manifest;

  return {
    ok: true,
    value: { file: target, ...facts, sites, zip_bytes: zipBytes },
    lines: [...columns(rows), `wrote ${target}: ${countText(count, "site")}, ${countText(manifest.files, "file")}, ${showBytes(zipBytes)}`],
  };
}

/**
 * Export the install, or one site of it, into one zip.
 *
 * The zip is written beside its target and renamed at the end, so a failure at any step leaves nothing under the target's name. A target that is already there is refused before the install is asked anything, unless `--overwrite` was given.
 *
 * @returns one line per site and a last line with the totals; the same as data under `--json`
 */
export async function runExport(request: ExportRequest, { client, io }: Session): Promise<Outcome> {
  const target = request.out ?? `poplin-backup-${dayText(Date.now())}.zip`;
  const created = await createBackup(target, request.overwrite);
  if (!created.ok) return { ok: false, problem: created.reason === "exists" ? problem("file_exists", target) : problem("unwritable", created.why) };

  const { writer } = created;
  let files = 0;
  const arrived = (label: string): void => {
    files += 1;
    if (io.terminal.progress) io.status(`exporting ${label}: ${countText(files, "file")} so far`);
  };

  try {
    const job = { client, writer, arrived };
    const { site } = request;
    const sites = site === undefined ? await writeInstall(job, request.allVersions) : await writeOne(job, { ...request, site });
    const manifest: Manifest = {
      format: BACKUP_FORMAT,
      made_by: `poplin ${VERSION}`,
      made_at: Date.now(),
      all_versions: request.allVersions,
      settings: site === undefined,
      sites: sites.length,
      files: sites.reduce((sum, written) => sum + written.files, 0),
      bytes: sites.reduce((sum, written) => sum + written.bytes, 0),
    };
    writer.addJson(LAYOUT.manifest, manifest);

    return exported(target, manifest, sites, await writer.finish());
  } catch (error) {
    await writer.abandon();
    if (error instanceof Stopped) return { ok: false, problem: error.problem };

    return { ok: false, problem: problem("unwritable", error instanceof Error ? error.message : String(error)) };
  } finally {
    if (io.terminal.progress) io.status("");
  }
}
