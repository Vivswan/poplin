// Publish: read the folder, begin the upload, send every file, and finish. A site changes only in the last step, and an upload that cannot be finished is given up.

import type { ROUTES } from "../../../core/src/api/routes";
import { showBytes } from "../../../core/src/records/settings";
import { type PublishFile, readFiles } from "../files/read";
import { readTitle } from "../files/title";
import { type Problem, problem, problemOf } from "./problems";
import type { Io, Outcome, RequestOf, Session } from "./records";
import { addressChange, columns, countText, searchNotes, siteLines } from "./text";
import { callUnhurried, givenUp, giveUpUpload, type Published, sendUpload } from "./upload";
import { siteChanges, siteWord } from "./wire";

/** The page whose own title a site shows while none is typed for it. */
const ENTRY_PAGE = "index.html";

/** What became of an upload that was not finished, in words. */
const AFTERMATH = {
  abandoned: "the upload was given up and no site changed",
  unknown: "the upload could not be given up: it runs out by itself within a day, and poplin list shows whether a site changed",
  live: "the publish went live all the same, and its answer was lost; poplin list shows the site",
  unbegun: "no site changed; an upload the install began all the same runs out by itself within a day",
} as const;

/** The `publish` command as the parser read it. */
type PublishRequest = RequestOf<"publish">;

/** What a publish is begun with. */
type Manifest = NonNullable<(typeof ROUTES)["beginPublish"]["types"]>["body"];

/** A publish with its folder read: the files, and what the install is asked to make of them. */
export interface PublishPlan {
  /** The files to send, in the order the folder was listed. */
  readonly files: readonly PublishFile[];

  /** The sum of their sizes. */
  readonly bytes: number;

  /** How many entries were left out as hidden or `node_modules`. */
  readonly skipped: number;

  /** What `beginPublish` is sent: the settings, the site to update or the name of a new one, and every file's path, size, and content type. */
  readonly manifest: Manifest;
}

/** Counts the files that arrived, and shows the count on the progress line when there is a terminal to show it on. */
interface Progress {
  readonly arrived: (file: PublishFile) => void;
  readonly clear: () => void;
}

function summary(plan: PublishPlan): string {
  const skipped = plan.skipped === 0 ? "" : ` (${plan.skipped} skipped as hidden or node_modules)`;

  return `${countText(plan.files.length, "file")}, ${showBytes(plan.bytes)}${skipped}`;
}

function progressOn(io: Io, plan: PublishPlan): Progress {
  const total = plan.files.length;
  let files = 0;
  let bytes = 0;

  if (!io.terminal.progress) return { arrived: () => undefined, clear: () => undefined };

  return {
    arrived: (file) => {
      files = Math.min(files + 1, total);
      bytes = Math.min(bytes + file.size, plan.bytes);
      io.status(`uploading ${files}/${total} files, ${showBytes(bytes)} of ${showBytes(plan.bytes)}`);
    },
    clear: () => io.status(""),
  };
}

/** The entry page's own title, which every publish sends beside a typed one; `undefined` for a page with none, or one that cannot be read. */
async function pageTitleOf(files: readonly PublishFile[]): Promise<string | undefined> {
  const entry = files.find((file) => file.path === ENTRY_PAGE);
  if (entry === undefined) return undefined;

  return readTitle(entry).catch(() => undefined);
}

function published(plan: PublishPlan, answer: Published): Outcome {
  const { site } = answer;
  const facts = site.created ? [site.access] : [`version ${site.live_version}`, site.access];

  const lines = [`uploaded ${summary(plan)}`, ...siteLines(site.created ? "made" : "updated", site, facts), ...addressChange(answer.before, site)];

  return { ok: true, value: answer, lines, notes: searchNotes(plan.manifest, site) };
}

/**
 * Read the folder or the page a publish names, and decide what the install is asked to make of it. No install is called.
 *
 * @returns the plan, or why nothing can be published: the path cannot be read, or gives a new site no name
 */
export async function planPublish(request: PublishRequest): Promise<{ readonly ok: true; readonly plan: PublishPlan } | { readonly ok: false; readonly problem: Problem }> {
  const listing = await readFiles(request.path);
  if (!listing.ok) return { ok: false, problem: problem("unreadable", listing.reason) };

  const { files, bytes, skipped } = listing;
  const declared = files.map((file) => ({ path: file.path, size: file.size, content_type: file.contentType }));
  const pageTitle = await pageTitleOf(files);
  const changes = pageTitle === undefined ? siteChanges(request.settings) : { ...siteChanges(request.settings), page_title: pageTitle };

  if (request.target.kind === "update") return { ok: true, plan: { files, bytes, skipped, manifest: { ...changes, site: siteWord(request.target.site), files: declared } } };

  if (request.target.name === undefined && !listing.name.ok) return { ok: false, problem: problem("no_name", listing.name.reason) };

  const name = request.target.name ?? (listing.name.ok ? listing.name.value : "");

  return { ok: true, plan: { files, bytes, skipped, manifest: { ...changes, name, files: declared } } };
}

/**
 * Say what a publish would send, for `--dry-run`. No install is called, so nothing anywhere changes.
 */
export function previewPublish(plan: PublishPlan): Outcome {
  const { files, ...asked } = plan.manifest;
  const target = asked.site === undefined ? `would make a new site named ${asked.name}` : `would update ${asked.site}`;
  const rows = files.map((file) => [`  ${file.path}`, showBytes(file.size), file.content_type]);

  return {
    ok: true,
    value: { dry_run: true, ...asked, count: files.length, bytes: plan.bytes, skipped: plan.skipped, files },
    lines: [target, `would upload ${summary(plan)}`, ...columns(rows), "nothing was sent: --dry-run calls no install"],
  };
}

/**
 * Send a planned publish to the install.
 *
 * Four files are sent at once, each up to three times. A publish the install says lacks files is sent those and finished again, up to three finishes in all.
 * A first step answered "too many requests" began nothing, and is made again after the rest the answer asks for, as every later step is.
 *
 * @returns the site as the install answered it. After any failure past the first step, a stop by the person included, the upload is given up, and the problem says what became of it
 */
export async function sendPublish(plan: PublishPlan, session: Session): Promise<Outcome> {
  const { client, io } = session;
  const begun = await callUnhurried(io, () => client.call("beginPublish", undefined, plan.manifest));
  if (!begun.ok) return begun.failure.kind === "refused" ? { ok: false, problem: problemOf(begun.failure) } : givenUp(begun.failure, AFTERMATH.unbegun);

  const upload = begun.value.upload.id;
  const progress = progressOn(io, plan);

  try {
    const finished = await sendUpload(client, upload, plan.files, { arrived: progress.arrived, io });
    if (finished.ok) return published(plan, finished.value);

    // An upload the install finished though its answer was lost is reported as done.
    const became = await giveUpUpload(session, upload);
    if (became.kind === "published") return published(plan, became.answer);

    return givenUp(finished.failure, AFTERMATH[became.kind]);
  } catch (error) {
    await client.call("abandonPublish", { upload });

    throw error;
  } finally {
    progress.clear();
  }
}
