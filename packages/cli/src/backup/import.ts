// Import: check the whole backup, then put its sites back one at a time. A site the install refuses changes nothing there, and the next one is tried.

import pMap from "p-map";
import type * as v from "valibot";

import type { ImportRequest as Begin } from "../../../core/src/actions/backup/begin-import";
import { SETTINGS_ANSWER } from "../../../core/src/actions/install/store-settings";
import { BEGUN_UPLOAD } from "../../../core/src/actions/publish/uploads";
import { showBytes } from "../../../core/src/records/settings";
import { type Backup, type BackupSite, openBackup } from "./read";
import type { Called, Failure } from "../client/client";
import { sha256Of } from "../files/hash";
import { aboutOf, type Problem, problem, problemOf } from "../commands/problems";
import { refusedByLayout } from "../commands/sites/publish";
import type { Outcome, RequestOf, Session } from "../commands/records";
import type { Line, Tone } from "../local/screen";
import { countText, dryRunText } from "../commands/text";
import { abandonUpload, callUnhurried, giveUpUpload, sendUpload, type UploadFile } from "../commands/sites/upload";
import { siteWord } from "../commands/sites/wire";

/** What stands between two facts of a line. */
const GAP = "  ";

/** What kind of line the row of a site is, by what became of the site. */
const RESULT_TONES: Readonly<Record<Result["result"], Tone>> = { imported: "done", skipped: "note", failed: "error" };

/** The refusal of a site this install already has, as a run that is started again meets it: the site is passed over, and nothing failed. */
const ALREADY_THERE = "id_taken";

/** The refusal of a site whose versions are together more than one import may carry. */
const TOO_LARGE = "too_large";

/** The statuses of a refusal that every other site would meet too: no login, not an admin's, an install that is asked too often, or one whose database is spent for the day. */
const REFUSED_FOR_ALL: readonly number[] = [401, 403, 429, 503];

/** How many files of a backup are read at once to be hashed. */
const HASHED_AT_ONCE = 4;

/** What goes with a zip refused after the install read the URL `--site` gave. */
const ONLY_ASKED = "Nothing was uploaded. Only read-only requests resolved the site URL.";

/** The refusal of a site whose live pages this install cannot serve; every other refusal before a site is begun is the install not answering, which each later site would meet too. */
const ROOT_LINKS = "root_links";

/** The refusal of a site whose public name another site of this install holds. */
const NAME_TAKEN = "name_taken";

/** The way through for a site whose public name another site of the install holds, a site in the trash included: no flag imports it under another name. */
const NAME_TAKEN_STEP =
  "Another site of this install has that public name, also while trashed. Fix: free the name with poplin set <that site> --unlisted, after poplin restore <that site> if trashed, then poplin import <zip> --site <label>";

/** What a dry run cannot see: it reads the zip alone, and what the install already holds shows only once a site is sent. */
const NOT_CHECKED = "A dry run does not check ids and public names the install already has";

/** What became of an upload that was not finished, in words. */
const AFTERMATH = {
  abandoned: "upload aborted, site not created",
  unknown: "the abort is unconfirmed, and an upload left open expires within 24 h. See: poplin list",
  live: "the site was created but the response was lost. See: poplin list",
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

/** What became of one site of the backup: it was made, or it was not and the code says why. `stops` is set by a failure every later site would meet too, to how a run that stops there exits. */
type Result =
  | (Sized & { readonly result: "imported"; readonly live_only?: true })
  | (Sized & { readonly result: "skipped" | "failed"; readonly code: string; readonly message: string; readonly stops?: Problem["exit"] });

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

function sentenceOf(said: Problem): string {
  const about = aboutOf(said);

  return about === undefined ? said.message : `${said.message} (${about})`;
}

/** A site of which nothing was sent: its live version has a link the install cannot serve, or the install did not say how its addresses are laid out. */
function unsent(site: BackupSite, said: Problem): Result {
  const stops = said.code === ROOT_LINKS ? {} : { stops: said.exit };

  return { ...sizeOf(site), result: "failed", code: said.code, message: sentenceOf(said), ...stops };
}

function unfinished(site: BackupSite, failure: Failure, aftermath?: string): Result {
  const said = problemOf(failure);
  const sentence = sentenceOf(said);
  const message = aftermath === undefined ? sentence : `${sentence}: ${aftermath}`;
  const result = isRefusedAs(failure, ALREADY_THERE) ? "skipped" : "failed";
  const forAll = failure.kind !== "refused" || REFUSED_FOR_ALL.includes(failure.status);

  return { ...sizeOf(site), result, code: said.code, message, ...(forAll ? { stops: said.exit } : {}) };
}

function finished(site: BackupSite, sending: Sending): Result {
  if (!sending.liveOnly) return { ...sizeOf(site), result: "imported" };

  const bytes = sending.files.reduce((sum, file) => sum + file.size, 0);

  return { ...sizeOf(site), result: "imported", versions: 1, files: sending.files.length, bytes, live_only: true };
}

/** Import one site: check its live pages as a publish does, begin, send every file, finish. An import that cannot be finished, or that the person stops, is given up, and the site is then not made. */
async function importSite(session: Session, format: number, site: BackupSite): Promise<Result> {
  const { client, io } = session;
  const live = site.versions.find((version) => version.number === site.record.live_version);
  const refused = await refusedByLayout(live?.files ?? [], session);
  if (refused !== undefined) return unsent(site, refused);

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
        if (io.terminal.progress) io.screen.working(`Importing ${site.label}: ${arrived}/${countText(sending.files.length, "file")}`);
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
    if (io.terminal.progress) io.screen.rest();
  }
}

function stopsRun(done: Result): boolean {
  return done.result !== "imported" && done.stops !== undefined;
}

/** A result as `--json` prints it: without the mark that only steers the run. */
function shown(done: Result): Result {
  if (done.result === "imported") return done;

  const { stops, ...said } = done;

  return said;
}

function lineOf(done: Result): Line {
  if (done.result !== "imported") return { tone: RESULT_TONES[done.result], text: [done.result, done.label, `${done.code}: ${done.message}`].join(GAP) };

  const versions = done.live_only === true ? "live version only" : countText(done.versions, "version");

  return { tone: RESULT_TONES.imported, text: ["imported", done.label, versions, countText(done.files, "file"), showBytes(done.bytes)].join(GAP) };
}

function reported(request: ImportRequest, results: readonly Result[]): Outcome {
  const count = (result: Result["result"]): number => results.filter((done) => done.result === result).length;
  const counts = { imported: count("imported"), skipped: count("skipped"), failed: count("failed") };
  const stopped = results.some(stopsRun);
  const lines: (string | Line)[] = results.map(lineOf);
  if (request.settings) lines.unshift(request.logins ? "Restored the settings and the users" : "Restored the settings except the users");

  lines.push(`${counts.imported} imported, ${counts.skipped} skipped, ${counts.failed} failed`);
  const sites = results.map(shown);
  const value = { file: request.zip, settings: request.settings, ...counts, stopped, sites };
  const notes = stopped ? ["Import stopped. The remaining sites were not attempted."] : [];
  if (results.some((done) => done.result === "failed" && done.code === NAME_TAKEN)) notes.push(NAME_TAKEN_STEP);

  if (counts.failed === 0) return { ok: true, value, lines, notes };

  // A run the install gave no answer to exits as every command does that it gave none to.
  const ending = results.find(stopsRun);

  return { ok: true, value, lines, notes, found: ending?.result === "failed" && ending.stops === "unreachable" ? "unreachable" : "failed" };
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
  if (request.settings) lines.unshift(request.logins ? "Would restore the settings and the users" : "Would restore the settings except the users");

  return {
    ok: true,
    value: { dry_run: true, file: request.zip, format: backup.manifest.format, settings: request.settings, sites },
    lines: [...lines, "The backup passed every check", dryRunText(asked)],
    notes: [NOT_CHECKED],
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
