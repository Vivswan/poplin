// The release an install runs, brought to the newest one by a repair: the way an install takes a release it cannot take by itself.
//
//   the install runs      its Worker's row    sent
//   the newest release    left                nothing
//   an older one          changed             the release's checked files in one upload, then the database's steps
//   an older one, and the newest release is one this poplin cannot place
//                         none                the repair stops before it mends anything: the newest poplin places it, and mends the rest
//   a newer one           none                the repair stops before it mends anything: this poplin would put older pieces back
//   a version not read    left                nothing: no tag says it is behind
//
// The upload is the install's own update, sent with the person's token in place of the kept key: the same checked files, the same four calls, every binding the Worker has kept by name.
// It states the update it is where the website names the version the install ran, so the release's code knows the version it can go back to.
// A dry run fetches and checks the same files, and sends Cloudflare nothing.

import { OWN_SCHEMA } from "@poplin/core/src/database/open";
import type { Reach, Row, Whole } from "@poplin/core/src/install/installer";
import { isAbove } from "@poplin/core/src/records/release";
import type { LastUpdate } from "@poplin/core/src/records/update";
import { newestRelease, type Release } from "../../../release/update/newest-release";
import { openUpload } from "../../../release/update/upload";
import type { CloudflareFailure } from "../../client";
import type { Place } from "../../first/find";
import { failureWords, LACKS } from "../../first/rows";
import { INSTALL_OBJECTS } from "../../install-objects";
import type { Mode } from "../../sync";
import { type Stepped, stepDatabase } from "./settings";

/** The name of the install's Worker. */
const SCRIPT = INSTALL_OBJECTS.worker;

/** The command of the newest poplin that goes on where this one stops. */
const NEWEST_POPLIN = "npx poplin@latest doctor --repair";

/** What the row of the database's steps is called. */
const STEPS = "Database steps";

/** What a row says, after the Worker's or the database's name. */
const WORDS = {
  unread: "its version is not read, so no release is put in place",
  noNewest: "the project's website named no release, so nothing says whether a newer one is out. Run this again",
  unreachable: "the release's files could not be fetched. Run this again",
  no_release: "the project's website names no release now. Run this again",
  bad_release: "the release's files are not the ones the project published. Nothing was uploaded",
  newer_release: `this release needs a newer poplin: ${NEWEST_POPLIN}`,
  token: "Cloudflare refused the token",
  silent: "no answer from Cloudflare. The release may be in: run this again",
  part: "the Worker's bindings were not read whole. Run this again",
  load: "Cloudflare refused the release's code: it stops as it starts. The install runs the version it ran",
  schedule: "Cloudflare did not take it. The install sets it with its next update",
  another: "its records are of another poplin than this release's, so no step was run",
  waits: "its records are read once the release is in place",
  allowance: "the database's free allowance for the day is used up. The install runs its steps when it next answers",
} as const;

/** The row that says the install's records wait for a release that is not in place, where they are of another schema than this poplin's. */
export const RECORDS_WAIT: Row = { object: STEPS, state: "not-run", detail: `${INSTALL_OBJECTS.database}: ${WORDS.waits}` };

/** What a repair hands over to bring the install's code to the newest release. */
interface Asked {
  /** The install as the look found it: the version it runs, and the newest release the website named. */
  readonly found: Whole<Place>;

  /** The id of the database the Worker is bound to. */
  readonly databaseId: string;

  /** Whether the run changes anything. */
  readonly mode: Mode;

  /** The world: the website, the release's page, and the clock. */
  readonly reach: Reach;

  /** How a refusal is read, and a permission named, by the table of rights both kinds of install share: the caller hands it over, so this file loads no kind's code. */
  readonly rights: { readonly lacks: (failure: CloudflareFailure) => boolean; readonly nameOf: (object: "D1 database" | "Worker variable") => string };
}

/**
 * What became of the install's code.
 *
 * `left` is a Worker nothing is done to. `placed` is a release a run put in place, or a dry run read that a run would. `unplaced` is one that is not in place, which a row says why.
 * `stop` is an install the newest poplin alone goes on with: one of a newer release than the newest this poplin reads, or behind a release this poplin cannot place. Nothing is mended, and its words say what to run.
 */
type Settled = { readonly state: "left" | "placed" | "unplaced"; readonly rows: readonly Row[] } | { readonly state: "stop"; readonly words: string };

/** The Worker's row. */
function workerRow(state: Row["state"], detail: string, right?: string): Row {
  return { object: "Worker", state, detail: `${SCRIPT}${detail}`, ...(right === undefined ? {} : { right }) };
}

/** The update an upload states, so the release's code knows the version before it; `undefined` where the website does not name that version, which nothing goes back to. */
function updateOf(release: Release, from: string, at: number): LastUpdate | undefined {
  const pin = Object.hasOwn(release.pins, from) ? release.pins[from] : undefined;

  return pin === undefined ? undefined : { from, to: release.bundle.version, schema: pin.schema, at };
}

/** The row of the database's steps, after a release was put in place or a dry run read that one would be; none for a database that is at the release's schema. */
function stepsRow(stepped: Stepped, rights: Asked["rights"]): Row | undefined {
  const name = INSTALL_OBJECTS.database;
  if (stepped.state === "current") return undefined;

  if (stepped.state === "behind") return { object: STEPS, state: "change", detail: `${name}: schema ${stepped.from} to ${OWN_SCHEMA}` };

  if (stepped.state === "another") return { object: STEPS, state: "block", detail: `${name}: ${WORDS.another}` };

  if (stepped.state === "failed") return { object: STEPS, state: "fail", detail: `${name}: step ${stepped.step} did not run, and nothing of it was kept. The install runs it when it next answers` };

  const { failure } = stepped;
  if (failure.failure === "allowance") return { object: STEPS, state: "fail", detail: `${name}: ${WORDS.allowance}` };

  const right = rights.nameOf("D1 database");

  return rights.lacks(failure) ? { object: STEPS, state: "block", detail: `${name}: ${LACKS}: ${right}`, right } : { object: STEPS, state: "fail", detail: `${name}: ${failureWords(failure)}` };
}

/** Send the one upload of a release with the token, and say in rows what Cloudflare made of it. */
async function uploaded(asked: Asked, release: Release, from: string): Promise<Extract<Settled, { readonly rows: readonly Row[] }>> {
  const { place } = asked.found;
  const worker = { accountId: place.accountId, script: SCRIPT };
  const first = (lacking: readonly string[]): ReturnType<Release["first"]> => release.first({ script: SCRIPT, bucket: INSTALL_OBJECTS.bucket, databaseId: asked.databaseId }).filter((binding) => lacking.includes(binding.name));
  const upload = await openUpload({ connection: place.connection }, worker, { by: "repair", first });
  const put = upload.ok ? await upload.value.put(release.bundle, updateOf(release, from, asked.reach.now()), undefined) : upload;
  const change = `: ${from} to ${release.bundle.version}`;
  if (put.ok) {
    const unset: Row[] = put.unset === undefined ? [] : [{ object: "Sweep trigger", state: "fail", detail: `${release.bundle.deploy.crons.join(", ")}: ${WORDS.schedule}` }];

    return { state: "placed", rows: [workerRow("change", change), ...unset] };
  }

  const right = asked.rights.nameOf("Worker variable");
  if (put.refusal === "lacks_right") return { state: "unplaced", rows: [workerRow("block", `${change}: ${LACKS}: ${right}`, right)] };

  if (put.refusal === "needs_hand") return { state: "unplaced", rows: [workerRow("block", `${change}: ${WORDS.newer_release}`)] };

  if (put.refusal === "version_refused") return { state: "unplaced", rows: [workerRow("fail", `${change}: ${put.load ? WORDS.load : `refused with status ${put.status}`}`)] };

  const why = { no_key: WORDS.token, key_refused: WORDS.token, unreachable: WORDS.silent, unread: WORDS.part }[put.refusal];

  return { state: "unplaced", rows: [workerRow("fail", `${change}: ${why}`)] };
}

/** Fetch the newest release and put it in place of an older one, then run the database's steps; a dry run reads what a run would do. */
async function taken(asked: Asked, from: string): Promise<Settled> {
  const release = await newestRelease(asked.reach);
  // A release this code cannot read as an upload, or of another schema than its own, is one whose steps it cannot run and whose pieces it cannot mend: the newest poplin does both.
  if (release === "newer_release" || (typeof release !== "string" && release.schema !== OWN_SCHEMA)) return { state: "stop", words: `The newest release is one this poplin cannot put in place. Run the newest poplin: ${NEWEST_POPLIN}` };

  if (typeof release === "string") return { state: "unplaced", rows: [workerRow("fail", `, runs ${from}: ${WORDS[release]}`)] };

  const placed = asked.mode === "plan" ? ({ state: "placed", rows: [workerRow("change", `: ${from} to ${release.bundle.version}`)] } as const) : await uploaded(asked, release, from);
  if (placed.state !== "placed") return placed;

  const { place } = asked.found;
  const steps = stepsRow(await stepDatabase(place.connection, { accountId: place.accountId, databaseId: asked.databaseId }, { mode: asked.mode, now: asked.reach.now() }), asked.rights);

  return { state: "placed", rows: [...placed.rows, ...(steps === undefined ? [] : [steps])] };
}

/**
 * Bring the code of an install to the newest release, or with a dry run say what a run would do.
 *
 * An install that runs the newest release gets no upload, and one that runs a newer release than the newest this poplin reads is never put back.
 *
 * @returns the Worker's row, and after an upload the row of the database's steps where it had any to run; or the words of an install that is newer than this poplin reads
 */
export async function syncRelease(asked: Asked): Promise<Settled> {
  const { version, newest } = asked.found;
  if (version === undefined) return { state: "left", rows: [workerRow("leave", `: ${WORDS.unread}`)] };

  if (newest === undefined) return { state: "unplaced", rows: [workerRow("fail", `, runs ${version}: ${WORDS.noNewest}`)] };

  if (version === newest) return { state: "left", rows: [workerRow("leave", `, runs ${version}`)] };

  if (isAbove(version, newest)) return { state: "stop", words: `The install runs ${version}, and the newest release this poplin reads is ${newest}. Nothing is put back to an older release. Run the newest poplin: ${NEWEST_POPLIN}` };

  return taken(asked, version);
}
