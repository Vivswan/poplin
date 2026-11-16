// Import: check the whole backup, then put its sites back one at a time. A site the install refuses changes nothing there, and the next one is tried.

import pMap from "p-map";
import type * as v from "valibot";

import type { ImportRequest as Begin } from "../../../core/src/actions/begin-import";
import { SETTINGS_ANSWER } from "../../../core/src/actions/store-settings";
import { BEGUN_UPLOAD } from "../../../core/src/actions/uploads";
import { showBytes } from "../../../core/src/records/settings";
import { type Backup, type BackupSite, openBackup } from "../backup/read";
import type { Called, Failure } from "../client/client";
import { sha256Of } from "../files/hash";
import { problem, problemOf } from "./problems";
import type { Outcome, RequestOf, Session } from "./records";
import { countText, dryRunText } from "./text";
import { abandonUpload, callUnhurried, giveUpUpload, sendUpload, type UploadFile } from "./upload";
import { siteWord } from "./wire";

/** What stands between two facts of a line. */
const GAP = "  ";

/** The refusal of a site this install already has, as a run that is started again meets it: the site is passed over, and nothing failed. */
const ALREADY_THERE = "id_taken";

/** The refusal of a site whose versions are together more than one import may carry. */
const TOO_LARGE = "too_large";

/** The statuses of a refusal that every other site would meet too: no login, not an admin's, an install that is asked too often, or one whose database is spent for the day. */
const REFUSED_FOR_ALL: readonly number[] = [401, 403, 429, 503];

/** How many files of a backup are read at once to be hashed. */
const HASHED_AT_ONCE = 4;

/** What goes with a zip refused after the install read the address `--site` gave. */
const ONLY_ASKED = "nothing of the backup was sent: the install was asked only how it reads the site's address";

/** What became of an upload that was not finished, in words. */
const AFTERMATH = {
  abandoned: "the upload was given up and the site was not made",
  unknown: "the upload could not be given up: it runs out by itself within a day, and poplin list shows whether the site was made",
  live: "the site was made all the same, and its answer was lost; poplin list shows it",
} as const;

/** The `import` command as the parser read it. */
type ImportRequest = RequestOf<"import">;

/** The answer to a begun import. */
type Begun = v.InferOutput<typeof BEGUN_UPLOAD>;

/** One file of a backup with the SHA-256 of its bytes. */
type HashedFile = BackupSite["versions"][number]["files"][number] & { readonly sha256: string };

/** The versions of a site of the backup, each file with its hash. */
type HashedVersions = readonly { readonly number: number; readonly files: readonly HashedFile[] }[];

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
 * @param hashed - the site's versions, each file with its hash
 * @param liveOnly - whether the site goes with its live version alone, its record naming no other
 */
function sendingOf(format: number, site: BackupSite, hashed: HashedVersions, liveOnly: boolean): Sending {
  const versions = hashed.filter((version) => !liveOnly || version.number === site.record.live_version);
  const kept = new Set(versions.map((version) => version.number));
  const record = { ...site.record, versions: site.record.versions.filter((version) => kept.has(version.number)) };
  const files = versions.flatMap((version) =>
    version.files.map((file) => ({ path: `v${version.number}/${file.path}`, size: file.size, contentType: file.contentType, sha256: file.sha256, open: () => file.open() })),
  );
  const declared = files.map((file) => ({ path: file.path, size: file.size, content_type: file.contentType, sha256: file.sha256 }));

  return { body: { format, site: record as unknown as Begin["site"], files: declared }, files, liveOnly };
}

/**
 * Hash every file of a site as the zip holds it: each is read whole, a piece at a time, and four of a version at once.
 *
 * @param stopped - aborts when the person stops the command: no further file is opened, and the ones being read are let go
 * @returns the versions with their hashes, or `stopped` when the stop came first
 */
async function hashedVersions(site: BackupSite, stopped: AbortSignal): Promise<HashedVersions | "stopped"> {
  const versions = [];

  try {
    for (const version of site.versions) {
      const files = await pMap(version.files, async (file) => ({ ...file, sha256: await sha256Of(() => file.open(), stopped) }), { concurrency: HASHED_AT_ONCE, signal: stopped });
      versions.push({ number: version.number, files });
    }
  } catch (error) {
    if (stopped.aborted) return "stopped";

    throw error;
  }

  return versions;
}

function isRefusedAs(failure: Failure, code: string): boolean {
  return failure.kind === "refused" && failure.code === code;
}

/** Begin the import of one site with every version the backup holds; one the install finds too large is begun once more with its live version alone. */
async function begin(session: Pick<Session, "client" | "io">, format: number, site: BackupSite, hashed: HashedVersions): Promise<{ readonly begun: Called<Begun>; readonly sending: Sending }> {
  const send = (body: Begin): Promise<Called<Begun>> => callUnhurried(session.io, () => session.client.call(BEGUN_UPLOAD, (api) => api.import.sites.$post({ json: body }), "repeatable"));
  const whole = sendingOf(format, site, hashed, false);
  const begun = await send(whole.body);
  if (begun.ok || !isRefusedAs(begun.failure, TOO_LARGE) || site.versions.length < 2) return { begun, sending: whole };

  const live = sendingOf(format, site, hashed, true);

  return { begun: await send(live.body), sending: live };
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

/** Import one site: begin, send every file, finish. An import that cannot be finished, or that the person stops, is given up, and the site is then not made. */
async function importSite(session: Session, format: number, site: BackupSite): Promise<Result> {
  const { client, io } = session;
  const hashed = await hashedVersions(site, io.stopped);
  if (hashed === "stopped") return unfinished(site, { kind: "stopped" });

  const { begun, sending } = await begin(session, format, site, hashed);
  if (!begun.ok) return unfinished(site, begun.failure);

  const upload = begun.value.upload.id;
  let arrived = 0;

  try {
    const sent = await sendUpload(client, begun.value, sending.files, {
      arrived: () => {
        arrived += 1;
        if (io.terminal.progress) io.status(`importing ${site.label}: ${arrived}/${sending.files.length} files`);
      },
      io,
    });
    if (sent.ok) return finished(site, sending);

    const became = await giveUpUpload(session, upload);
    if (became.kind === "published") return finished(site, sending);

    return unfinished(site, sent.failure, AFTERMATH[became.kind]);
  } catch (error) {
    await abandonUpload(client, upload);

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
async function send(backup: Backup, request: ImportRequest, chosen: Chosen, session: Session): Promise<Outcome> {
  const { client } = session;
  const { format } = backup.manifest;

  if (request.settings) {
    const sent = { format, settings: { ...backup.settings }, logins: request.logins };
    const restored = await client.call(SETTINGS_ANSWER, (api) => api.import.settings.$post({ json: sent }));
    if (!restored.ok) return { ok: false, problem: problemOf(restored.failure, "changes") };
  }

  const results: Result[] = [];

  for await (const site of backup.sites()) {
    if (chosen !== undefined && !chosen.has(site.label)) continue;

    const done = await importSite(session, format, site);
    results.push(done);

    if (stopsRun(done)) break;
  }

  return reported(request, results);
}

/** Say what an import would send, for `--dry-run`. The install is called for nothing but how it reads the address `--site` gave, which `asked` says. */
async function preview(backup: Backup, request: ImportRequest, chosen: Chosen, asked: boolean): Promise<Outcome> {
  const sites: Sized[] = [];

  for await (const site of backup.sites()) {
    if (chosen === undefined || chosen.has(site.label)) sites.push(sizeOf(site));
  }

  const lines = sites.map((site) => ["would import", site.label, countText(site.versions, "version"), countText(site.files, "file"), showBytes(site.bytes)].join(GAP));
  if (request.settings) lines.unshift(request.logins ? "would restore the settings and the logins" : "would restore the settings, but for the logins");

  return {
    ok: true,
    value: { dry_run: true, file: request.zip, format: backup.manifest.format, settings: request.settings, sites },
    lines: [...lines, `the backup passed every check; ${dryRunText(asked)}`],
  };
}

/**
 * Import a backup: every site of it, or the one `--site` names.
 *
 * The whole zip is checked before anything of it is sent, and a zip that fails any check is refused with nothing sent. A site the install already has is `skipped`, which is what a run that is started again meets for every site it finished before.
 * A site the install finds too large with every version is sent once more with its live version alone.
 *
 * @param online - runs the sending against the install; it is not called for `--dry-run`, nor for a zip that is refused
 * @param asked - whether the install was asked how it reads the address `--site` gave
 * @returns one line per site and a last line with the counts; an outcome that exits as a failure when any site failed
 */
export async function runImport(request: ImportRequest, online: Online, asked: boolean): Promise<Outcome> {
  const opened = await openBackup(request.zip);
  if (!opened.ok) return { ok: false, problem: problem("bad_backup", opened.reason, asked ? ONLY_ASKED : undefined) };

  const { backup } = opened;

  try {
    if (request.settings && backup.settings === undefined) return { ok: false, problem: problem("no_settings") };

    const chosen = await chosenLabels(backup, request.site);
    if (request.site !== undefined && chosen?.size === 0) return { ok: false, problem: problem("not_in_backup", siteWord(request.site)) };

    if (request.dryRun) return await preview(backup, request, chosen, asked);

    return await online((session) => send(backup, request, chosen, session));
  } finally {
    await backup.close();
  }
}
