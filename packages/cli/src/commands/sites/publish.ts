// Publish: read the folder, begin the upload, send every file, and finish. A site changes only in the last step, and an upload that cannot be finished is given up.

import { pMapSettled } from "p-map";
import type * as v from "valibot";

import type { PUBLISH_REQUEST } from "../../../../core/src/actions/publish/begin-publish";
import { BEGUN_UPLOAD } from "../../../../core/src/actions/publish/uploads";
import { showBytes } from "../../../../core/src/records/settings";
import type { Failure } from "../../client/client";
import { sha256Of } from "../../files/hash";
import { type PublishFile, readFiles } from "../../files/read";
import { firstRootLink } from "../../files/root-links";
import { readTitle } from "../../files/title";
import { type Problem, problem, problemOf } from "../problems";
import type { Io, Outcome, RequestOf, Session } from "../records";
import { addressChange, columns, countText, doneRows, dryRunText, searchNotes, siteLines } from "../text";
import { abandonUpload, callUnhurried, givenUp, giveUpUpload, type Published, sendUpload } from "./upload";
import { siteChanges, siteWord } from "./wire";

/** The page whose own title a site shows while none is typed for it. */
const ENTRY_PAGE = "index.html";

/** How many files are read at once to be hashed. */
const HASHED_AT_ONCE = 4;

/** The refusal of a public name another site holds. */
const NAME_TAKEN = "name_taken";

/** What to do about a taken public name on a publish. */
const ANOTHER_NAME = "Fix: publish again with --public-name <public name>";

/** What became of a publish that was stopped while its files were read. */
const STOPPED_UNSENT = "nothing uploaded, no site changed";

/** What became of an upload that was not finished, in words. */
const AFTERMATH = {
  abandoned: "Nothing changed",
  unknown: "the abort is unconfirmed, and an upload left open expires within 24 h. See: poplin list",
  live: "the publish went live but the response was lost. See: poplin list",
  unbegun: "no site changed. An upload the install started anyway expires within 24 h",
} as const;

/** The `publish` command as the parser read it. */
type PublishRequest = RequestOf<"publish">;

/** What a publish is begun with. */
type Manifest = v.InferInput<typeof PUBLISH_REQUEST>;

/** A publish with its folder read: the files, and what the install is asked to make of them. */
export interface PublishPlan {
  /** The files to send, in the order the folder was listed. */
  readonly files: readonly PublishFile[];

  /** The sum of their sizes. */
  readonly bytes: number;

  /** How many entries were left out as hidden or `node_modules`. */
  readonly skipped: number;

  /** What `beginPublish` is sent: the settings, the site to update or the name of a new one, and every file's path, size, content type, and SHA-256. */
  readonly manifest: Manifest;
}

/** Counts the files that arrived, and shows the count on the line of what is worked on when there is a terminal to show it on. */
interface Progress {
  /** Counts one file that arrived. */
  readonly arrived: (file: PublishFile) => void;

  /** Ends the line: once the publish is live it stays as its heading, and after anything else nothing stays. */
  readonly end: (live: boolean) => void;
}

function summary(plan: PublishPlan): string {
  const skipped = plan.skipped === 0 ? "" : ` (${plan.skipped} skipped: hidden or node_modules)`;

  return `${countText(plan.files.length, "file")}, ${showBytes(plan.bytes)}${skipped}`;
}

function progressOn(io: Io, plan: PublishPlan): Progress {
  const total = plan.files.length;
  const heading = `Publishing ${plan.manifest.name ?? plan.manifest.site}`;
  let files = 0;
  let bytes = 0;

  if (!io.terminal.progress) return { arrived: () => undefined, end: () => undefined };

  io.screen.working(heading);

  return {
    arrived: (file) => {
      files = Math.min(files + 1, total);
      bytes = Math.min(bytes + file.size, plan.bytes);
      io.screen.working(`${heading}: ${files}/${countText(total, "file")}, ${showBytes(bytes)} of ${showBytes(plan.bytes)}`);
    },
    end: (live) => io.screen.rest(live ? heading : undefined),
  };
}

/** The entry page's own title, which every publish sends beside a typed one; `undefined` for a page with none, one that cannot be read, or a read that `stopped` ended. */
async function pageTitleOf(files: readonly PublishFile[], stopped: AbortSignal): Promise<string | undefined> {
  const entry = files.find((file) => file.path === ENTRY_PAGE);
  if (entry === undefined) return undefined;

  return readTitle(entry, stopped).catch(() => undefined);
}

/**
 * Declare every file as a publish sends it, with the SHA-256 of its bytes. Each file is read whole for it, four at a time and a piece at a time.
 *
 * @param stopped - aborts when the person stops the command: no further file is opened, and the ones being read are let go
 * @returns the declared files in the order given, or why there are none: a file could not be read to its end, or the command was stopped
 */
async function declare(files: readonly PublishFile[], stopped: AbortSignal): Promise<{ readonly ok: true; readonly declared: Manifest["files"] } | { readonly ok: false; readonly problem: Problem }> {
  const hashed = async (file: PublishFile): Promise<Manifest["files"][number]> => ({ path: file.path, size: file.size, content_type: file.contentType, sha256: await sha256Of(file.open, stopped) });
  const settled = await pMapSettled(files, hashed, { concurrency: HASHED_AT_ONCE, signal: stopped }).catch(() => undefined);
  if (settled === undefined || stopped.aborted) return { ok: false, problem: problem("stopped", STOPPED_UNSENT) };

  const declared = settled.flatMap((file) => (file.status === "fulfilled" ? [file.value] : []));
  const unread = files[settled.findIndex((file) => file.status === "rejected")];
  if (unread !== undefined) return { ok: false, problem: problem("unreadable", `cannot read ${JSON.stringify(unread.path)}`) };

  return { ok: true, declared };
}

function published(plan: PublishPlan, answer: Published): Outcome {
  const { site } = answer;
  const facts = site.created ? [] : [`version ${site.live_version}`];
  const sent = doneRows([{ tone: "done", done: "uploaded", what: summary(plan) }]);
  const lines = [...sent, ...siteLines(site.created ? "created" : "updated", site, facts, addressChange(answer.before, site))];

  return { ok: true, value: answer, lines, notes: searchNotes(plan.manifest, site) };
}

/**
 * Why the install of a session cannot serve a site's pages: it has no domain, so a site of it sits under a path, where a link that starts with `/` leaves the site.
 *
 * The session is asked how the install's addresses are laid out, and the pages are read only when a site sits under a path.
 *
 * @param files - the files that would be live: those of a publish, or of the live version of a site in a backup
 * @returns the problem `root_links`, which names the first such link of the first file that holds one, or why the install did not answer; `undefined` when the files can be sent
 */
export async function refusedByLayout(files: Parameters<typeof firstRootLink>[0], { layout, io }: Pick<Session, "layout" | "io">): Promise<Problem | undefined> {
  const asked = await callUnhurried(io, layout);
  if (!asked.ok) return problemOf(asked.failure);

  if (asked.value.kind !== "path") return undefined;

  const found = await firstRootLink(files);
  if (found === undefined) return undefined;

  return problem("root_links", `${found.link} in ${found.file}`);
}

/**
 * Read the folder or the page a publish names, and decide what the install is asked to make of it. Every file is read, to be hashed. No install is called.
 *
 * @param stopped - aborts when the person stops the command, which ends the reading of the files
 * @returns the plan, or why nothing can be published: the path or a file under it cannot be read, the path gives a new site no name, or the command was stopped
 */
export async function planPublish(request: PublishRequest, stopped: AbortSignal): Promise<{ readonly ok: true; readonly plan: PublishPlan } | { readonly ok: false; readonly problem: Problem }> {
  const listing = await readFiles(request.path);
  if (stopped.aborted) return { ok: false, problem: problem("stopped", STOPPED_UNSENT) };

  if (!listing.ok) return { ok: false, problem: problem("unreadable", listing.reason) };

  const { files, bytes, skipped } = listing;
  if (request.target.kind === "create" && request.target.name === undefined && !listing.name.ok) return { ok: false, problem: problem("no_name", listing.name.reason) };

  const hashed = await declare(files, stopped);
  if (!hashed.ok) return hashed;

  const { declared } = hashed;
  const pageTitle = await pageTitleOf(files, stopped);
  // A stop while the entry page's title is read ends that read, and is answered here, so no plan goes on to be sent.
  if (stopped.aborted) return { ok: false, problem: problem("stopped", STOPPED_UNSENT) };

  const changes = pageTitle === undefined ? siteChanges(request.settings) : { ...siteChanges(request.settings), page_title: pageTitle };

  if (request.target.kind === "update") return { ok: true, plan: { files, bytes, skipped, manifest: { ...changes, site: siteWord(request.target.site), files: declared } } };

  const name = request.target.name ?? (listing.name.ok ? listing.name.value : "");

  return { ok: true, plan: { files, bytes, skipped, manifest: { ...changes, name, files: declared } } };
}

/**
 * Say what a publish would send, for `--dry-run`. Nothing anywhere changes.
 *
 * @param addressRead - whether the install was asked how it reads the address of the site to update; it is called for nothing else
 */
export function previewPublish(plan: PublishPlan, addressRead: boolean): Outcome {
  const { files, ...asked } = plan.manifest;
  const target = asked.site === undefined ? ["would create", `${asked.name}`] : ["would update", `${asked.site}`];
  const rows = files.map((file) => [`  ${file.path}`, showBytes(file.size), file.content_type]);

  return {
    ok: true,
    value: { dry_run: true, ...asked, count: files.length, bytes: plan.bytes, skipped: plan.skipped, files },
    lines: [...columns([target, ["would upload", summary(plan)]]), ...columns(rows), dryRunText(addressRead)],
  };
}

/** The problem of a publish the install refused to begin. A taken public name is hinted with the publish's own flag: a refused publish made no site to set. */
function refusalOf(failure: Failure): Problem {
  const said = problemOf(failure);

  return said.code === NAME_TAKEN ? { ...said, hint: ANOTHER_NAME } : said;
}

/**
 * Send a planned publish to the install.
 *
 * Nothing is sent to an install without a domain when a page of the plan links with a path that starts with `/`.
 * Four files are sent at once, each to the address its ticket names, and one the install fails on is sent again after a pause, up to three times more. A publish the install says lacks files is sent those and finished again, up to three finishes in all.
 * A first step answered "too many requests" began nothing, and is made again after the rest the answer asks for, as every later step is.
 *
 * @returns the site as the install answered it. After any failure past the first step, a stop by the person included, the upload is given up, and the problem says what became of it
 */
export async function sendPublish(plan: PublishPlan, session: Session): Promise<Outcome> {
  const { client, io } = session;
  const refused = await refusedByLayout(plan.files, session);
  if (refused !== undefined) return { ok: false, problem: refused };

  const begun = await callUnhurried(io, () => client.call(BEGUN_UPLOAD, (api) => api.uploads.$post({ json: plan.manifest }), "repeatable"));
  if (!begun.ok) return begun.failure.kind === "refused" ? { ok: false, problem: refusalOf(begun.failure) } : givenUp(begun.failure, AFTERMATH.unbegun);

  const upload = begun.value.upload.id;
  const progress = progressOn(io, plan);
  const live = (answer: Published): Outcome => {
    progress.end(true);

    return published(plan, answer);
  };

  try {
    const finished = await sendUpload(client, begun.value, plan.files, { arrived: progress.arrived, io });
    if (finished.ok) return live(finished.value);

    // An upload the install finished though its answer was lost is reported as done.
    const became = await giveUpUpload(session, upload);
    if (became.kind === "published") return live(became.answer);

    progress.end(false);

    return givenUp(finished.failure, AFTERMATH[became.kind]);
  } catch (error) {
    progress.end(false);
    await abandonUpload(client, upload);

    throw error;
  }
}
