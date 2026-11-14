// Import: check the whole backup, then put its sites back one at a time. A site the install refuses changes nothing there, and the next one is tried.

import type { ROUTES } from "../../../core/src/api/routes";
import { showBytes } from "../../../core/src/records/settings";
import { type Backup, type BackupSite, openBackup } from "../backup/read";
import type { Called, Client, Failure } from "../client/client";
import { problem, problemOf } from "./problems";
import type { Io, Outcome, RequestOf, Session } from "./records";
import { countText } from "./text";
import { giveUpUpload, sendUpload, type UploadFile } from "./upload";
import { siteWord } from "./wire";

/** What stands between two facts of a line. */
const GAP = "  ";

/** The refusal of a site this install already has, as a run that is started again meets it: the site is passed over, and nothing failed. */
const ALREADY_THERE = "id_taken";

/** The refusal of a site whose versions are together more than one import may carry. */
const TOO_LARGE = "too_large";

/** The statuses of a refusal that every other site would meet too: no login, or not an admin's. */
const REFUSED_FOR_ALL: readonly number[] = [401, 403];

/** What became of an upload that was not finished, in words. */
const AFTERMATH = {
  abandoned: "the upload was given up and the site was not made",
  unknown: "the upload could not be given up: it runs out by itself within a day, and poplin list shows whether the site was made",
  live: "the site was made all the same, and its answer was lost; poplin list shows it",
} as const;

/** The `import` command as the parser read it. */
type ImportRequest = RequestOf<"import">;

/** What the import of one site is begun with. */
type Begin = NonNullable<(typeof ROUTES)["beginImport"]["types"]>["body"];

/** The answer to a begun import. */
type Begun = NonNullable<(typeof ROUTES)["beginImport"]["types"]>["done"];

/** The labels of the sites to import; `undefined` for every site of the backup. */
type Chosen = ReadonlySet<string> | undefined;

/** What runs a step against the install the command is logged in to, or says why there is none. */
type Online = (send: (session: Session) => Promise<Outcome>) => Promise<Outcome>;

/** One site as it is sent: what the import is begun with, and the files to send, each under the name the import declares it by. */
interface Sending {
  readonly body: Begin;
  readonly files: readonly UploadFile[];
  readonly liveOnly: boolean;
}

/** What the backup holds of one site, as every line about it says. */
interface Sized {
  readonly id: string;
  readonly label: string;
  readonly versions: number;
  readonly files: number;
  readonly bytes: number;
}

/** What became of one site of the backup: it was made, or it was not and the code says why. `stops` is set by a failure every later site would meet too. */
type Result =
  | (Sized & { readonly result: "imported"; readonly live_only?: true })
  | (Sized & { readonly result: "skipped" | "failed"; readonly code: string; readonly message: string; readonly stops?: true });

function sizeOf(site: BackupSite): Sized {
  return { id: site.record.id, label: site.label, versions: site.versions.length, files: site.files, bytes: site.bytes };
}

/** How a site of the backup answers to what `--site` names: as the site with that label or id, or as the one with that public name. Twelve letters and digits may be either. */
function matchOf(site: BackupSite, named: NonNullable<ImportRequest["site"]>): "site" | "public-name" | undefined {
  if (named.kind === "site") return site.label === siteWord(named) ? "site" : undefined;

  if (named.kind === "id" && site.record.id === named.id) return "site";

  return site.record.public_name === siteWord(named) ? "public-name" : undefined;
}

/** The sites to import: every site without `--site`, else the one it names, by id before public name as the install reads the same word, which may be none. */
async function chosenLabels(backup: Backup, named: ImportRequest["site"]): Promise<Chosen> {
  if (named === undefined) return undefined;

  const found = { site: new Set<string>(), "public-name": new Set<string>() };
  for await (const site of backup.sites()) {
    const match = matchOf(site, named);
    if (match !== undefined) found[match].add(site.label);
  }

  return found.site.size > 0 ? found.site : found["public-name"];
}

/**
 * Build what one site is sent as. A file's name is `v<number>/<path>`, built here from a version's number and a path the reader checked.
 *
 * @param liveOnly - whether the site goes with its live version alone, its record naming no other
 */
function sendingOf(format: number, site: BackupSite, liveOnly: boolean): Sending {
  const versions = site.versions.filter((version) => !liveOnly || version.number === site.record.live_version);
  const kept = new Set(versions.map((version) => version.number));
  const record = { ...site.record, versions: site.record.versions.filter((version) => kept.has(version.number)) };
  const files = versions.flatMap((version) =>
    version.files.map((file) => ({ path: `v${version.number}/${file.path}`, size: file.size, contentType: file.contentType, open: () => file.open() })),
  );
  const declared = files.map((file) => ({ path: file.path, size: file.size, content_type: file.contentType }));

  return { body: { format, site: record as unknown as Begin["site"], files: declared }, files, liveOnly };
}

function isRefusedAs(failure: Failure, code: string): boolean {
  return failure.kind === "refused" && failure.code === code;
}

/** Begin the import of one site with every version the backup holds; one the install finds too large is begun once more with its live version alone. */
async function begin(client: Client, format: number, site: BackupSite): Promise<{ readonly begun: Called<Begun>; readonly sending: Sending }> {
  const whole = sendingOf(format, site, false);
  const begun = await client.call("beginImport", undefined, whole.body);
  if (begun.ok || !isRefusedAs(begun.failure, TOO_LARGE) || site.versions.length < 2) return { begun, sending: whole };

  const live = sendingOf(format, site, true);

  return { begun: await client.call("beginImport", undefined, live.body), sending: live };
}

function unfinished(site: BackupSite, failure: Failure, aftermath?: string): Result {
  const said = problemOf(failure);
  const sentence = said.about === undefined ? said.message : `${said.message} (${said.about})`;
  const message = aftermath === undefined ? sentence : `${sentence}; ${aftermath}`;
  const result = isRefusedAs(failure, ALREADY_THERE) ? "skipped" : "failed";
  const forAll = failure.kind !== "refused" || REFUSED_FOR_ALL.includes(failure.status);

  return { ...sizeOf(site), result, code: said.code, message, ...(forAll ? { stops: true as const } : {}) };
}

function finished(site: BackupSite, sending: Sending): Result {
  if (!sending.liveOnly) return { ...sizeOf(site), result: "imported" };

  const bytes = sending.files.reduce((sum, file) => sum + file.size, 0);

  return { ...sizeOf(site), result: "imported", versions: 1, files: sending.files.length, bytes, live_only: true };
}

/** Import one site: begin, send every file, finish. An import that cannot be finished is given up, and the site is then not made. */
async function importSite(client: Client, io: Io, format: number, site: BackupSite): Promise<Result> {
  const { begun, sending } = await begin(client, format, site);
  if (!begun.ok) return unfinished(site, begun.failure);

  const upload = begun.value.upload.id;
  let arrived = 0;

  try {
    const sent = await sendUpload(client, upload, sending.files, () => {
      arrived += 1;
      if (io.terminal.progress) io.status(`importing ${site.label}: ${arrived}/${sending.files.length} files`);
    });
    if (sent.ok) return finished(site, sending);

    const became = await giveUpUpload(client, upload);
    if (became.kind === "published") return finished(site, sending);

    return unfinished(site, sent.failure, AFTERMATH[became.kind]);
  } catch (error) {
    await client.call("abandonPublish", { upload });

    throw error;
  } finally {
    if (io.terminal.progress) io.status("");
  }
}

function stopsRun(done: Result): boolean {
  return done.result !== "imported" && done.stops === true;
}

/** A result as `--json` prints it: without the mark that only steers the run. */
function shown(done: Result): Result {
  if (done.result === "imported") return done;

  const { stops, ...said } = done;

  return said;
}

function lineOf(done: Result): string {
  if (done.result !== "imported") return [done.result, done.label, `${done.code}: ${done.message}`].join(GAP);

  const versions = done.live_only === true ? "live version only" : countText(done.versions, "version");

  return ["imported", done.label, versions, countText(done.files, "file"), showBytes(done.bytes)].join(GAP);
}

function reported(request: ImportRequest, results: readonly Result[]): Outcome {
  const count = (result: Result["result"]): number => results.filter((done) => done.result === result).length;
  const counts = { imported: count("imported"), skipped: count("skipped"), failed: count("failed") };
  const stopped = results.some(stopsRun);
  const lines = results.map(lineOf);
  if (request.settings) lines.unshift(request.logins ? "restored the settings and the logins" : "restored the settings, but for the logins");

  lines.push(`${counts.imported} imported, ${counts.skipped} skipped, ${counts.failed} failed`);
  const sites = results.map(shown);
  const value = { file: request.zip, settings: request.settings, ...counts, stopped, sites };
  const notes = stopped ? ["the import stopped there: the sites after it were not tried"] : [];
  if (counts.failed === 0) return { ok: true, value, lines, notes };

  return { ok: true, value, lines, notes, found: "failed" };
}

/** Put the backup into the install: the settings first when they were asked for, then each chosen site. */
async function send(backup: Backup, request: ImportRequest, chosen: Chosen, { client, io }: Session): Promise<Outcome> {
  const { format } = backup.manifest;

  if (request.settings) {
    const restored = await client.call("importSettings", undefined, { format, settings: { ...backup.settings }, logins: request.logins });
    if (!restored.ok) return { ok: false, problem: problemOf(restored.failure, "changes") };
  }

  const results: Result[] = [];

  for await (const site of backup.sites()) {
    if (chosen !== undefined && !chosen.has(site.label)) continue;

    const done = await importSite(client, io, format, site);
    results.push(done);

    if (stopsRun(done)) break;
  }

  return reported(request, results);
}

/** Say what an import would send, for `--dry-run`. No install is called. */
async function preview(backup: Backup, request: ImportRequest, chosen: Chosen): Promise<Outcome> {
  const sites: Sized[] = [];

  for await (const site of backup.sites()) {
    if (chosen === undefined || chosen.has(site.label)) sites.push(sizeOf(site));
  }

  const lines = sites.map((site) => ["would import", site.label, countText(site.versions, "version"), countText(site.files, "file"), showBytes(site.bytes)].join(GAP));
  if (request.settings) lines.unshift(request.logins ? "would restore the settings and the logins" : "would restore the settings, but for the logins");

  return {
    ok: true,
    value: { dry_run: true, file: request.zip, format: backup.manifest.format, settings: request.settings, sites },
    lines: [...lines, "the backup passed every check; nothing was sent: --dry-run calls no install"],
  };
}

/**
 * Import a backup: every site of it, or the one `--site` names.
 *
 * The whole zip is checked first, and a zip that fails any check is refused with nothing sent. A site the install already has is `skipped`, which is what a run that is started again meets for every site it finished before.
 * A site the install finds too large with every version is sent once more with its live version alone.
 *
 * @param online - runs the sending against the install; it is not called for `--dry-run`, nor for a zip that is refused
 * @returns one line per site and a last line with the counts; an outcome that exits as a failure when any site failed
 */
export async function runImport(request: ImportRequest, online: Online): Promise<Outcome> {
  const opened = await openBackup(request.zip);
  if (!opened.ok) return { ok: false, problem: problem("bad_backup", opened.reason) };

  const { backup } = opened;

  try {
    if (request.settings && backup.settings === undefined) return { ok: false, problem: problem("no_settings") };

    const chosen = await chosenLabels(backup, request.site);
    if (request.site !== undefined && chosen?.size === 0) return { ok: false, problem: problem("not_in_backup", siteWord(request.site)) };

    if (request.dryRun) return await preview(backup, request, chosen);

    return await online((session) => send(backup, request, chosen, session));
  } finally {
    await backup.close();
  }
}
