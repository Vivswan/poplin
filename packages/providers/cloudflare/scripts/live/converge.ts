// Make the standing test install of the run's account match the commit, through the commands a person installs, mends, and removes an install with.
//
//   where it answers -> the account's plans, all free -> what stands, and whether this commit's install would have made it
//   -> a test account alone: nothing is made, mended, or removed on any other
//     asked to start over, or another build made the database, bound the Worker to another bucket, or left an install unfinished
//                         -> `poplin uninstall`, the data with it -> then as an account with no install
//     no install          -> `poplin install`: the bucket, the database, the first upload of this commit's build, then the repair of its kind
//     an install          -> this commit's build by the upload an install updates itself with -> `poplin doctor --repair`
//                            a repair that refuses a database a schema step behind runs again after the first wait below, once the new Worker brought it forward
//     -> `poplin install` once more, which makes nothing on an install that stands: it must read the release this commit's build stated
//     -> wait for the install to answer and its database to hold this commit's schema -> wait for the new deployment to answer the run's token -> the test install's caps
//
// The commands run in this process and take the commit's build as the newest release: commands.ts says how. Nothing here makes, mends, or removes a piece of an install itself.
// It holds no state: each run reads what is there. A row is printed as its object and what was done, and of a call that failed how: its status and codes, a wait asked for, or no answer. Nothing else of its detail, which may name what the account holds.
// A repair with a row that failed on a call Cloudflare asked to wait for, or gave no answer to, is run once more a minute later. A refusal is never asked again.
// A piece the install answers without, lacking a token permission or an account switch only a person can flip, is told as a lack, which the live suite skips for. One nothing answers without stops the run as an error, failed or not permitted.
//
// The last wait asks the install who the run's token is: once, or 12 times in a row, 3 s apart, each on its own connection, where the install was made anew or its database brought forward.
//   the new deployment                                                         200
//   the build before, bound to the database that was deleted                   503, always: a 200 here is the new deployment's
//   the build before, started anew on a database with a schema step it lacks   503
//   the build before, started earlier, on that database                        200: it reads the token it is asked for and no schema again
// A row of 200s says for how long no request met an instance that fails, never that no instance of the deployment before is left. No check sends anything again: this wait alone waits a 503 out.
//
// Step output: `missing` (a JSON object of what the install lacks and still answers without, each with its reason, for the live suite).

import { OWN_SCHEMA } from "@poplin/core/src/database/open";
import { isPlainVersion } from "@poplin/core/src/records/update";
import pRetry from "p-retry";

import type { Fetch } from "../../../../cli/src/client/client";
import { failureWords } from "../../src/shared/install/first/rows";
import { OUTLASTED } from "../../src/shared/install/first/waits";
import { INSTALL_OBJECTS } from "../../src/shared/install/install-objects";
import { checkedBundle } from "../../src/shared/release/update/bundle-files";
import { openUpload } from "../../src/shared/release/update/upload";
import { capInstall } from "./caps";
import { type Answer, type CommandRow, command, type Ends, type Published, placeWords, publish, reachOf, readBuilt } from "./commands";
import { readFreePlans } from "./plan";
import { sendLive } from "./send";
import { holdsOwnSchema, lastAsked, readStanding } from "./shape";
import { refuseOtherAccount } from "./test-account";
import { findDatabase, removeTokens, seedToken } from "./tokens";
import { type Found, findInstall, isStop, liveLogin, openRun, type Run, reportStop, SCRIPT, type Stop } from "./util";

/** The login an install with no login of a person starts with: nobody can log in as it. */
const NOBODY = "owner@example.com";

/** What the variable that asks for a start-over must hold: the workflow's ticked box. */
const ASKED = "true";

/** How long the install has to answer after a deploy, and how often it is asked, in milliseconds. */
const READY = { withinMs: 300_000, everyMs: 5_000 };

/** The most characters of the install's own words a failed wait repeats. */
const SAID_LENGTH = 200;

/** What a command did to a row, or left of it, as a run tells it. */
const TOLD: Readonly<Record<string, string>> = {
  make: "made",
  change: "changed",
  remove: "removed",
  leave: "left",
  "leave-out": "left out",
  block: "stopped",
  fail: "failed",
  "not-run": "not run",
  gone: "gone",
  keep: "kept",
  stay: "stays",
  skip: "not this install's",
};

/** The states of a row that a command left as wanted. */
const SETTLED: ReadonlySet<string> = new Set(["make", "change", "remove", "leave"]);

/** How a row ends that failed on a call Cloudflare asked to wait for, or gave no answer to: what a later run of the same command may not meet. */
const PASSES: readonly string[] = [failureWords({ ok: false, failure: "rate-limited" }), failureWords({ ok: false, failure: "network", message: "" })];

/** How long a run rests before it runs a repair once more, in milliseconds. */
const AGAIN_AFTER_MS = 60_000;

/** The states of a removal's row that left something the removal was to take. */
const NOT_REMOVED: ReadonlySet<string> = new Set(["block", "fail", "not-run"]);

/** The objects nothing answers without. */
const VITAL: ReadonlySet<string> = new Set(["R2 bucket", "D1 database", "Worker", "Cron trigger", "workers.dev route", "Forwarder", "DNS record", "Worker route"]);

/** How a row words a refusal by Cloudflare, with its status. */
const REFUSAL_STATUS = /refused with status \d+/;

/** How a row words a call that failed, in whole: a refusal's status and the numbers of its codes, a wait asked for that outlasted the command's own waits, a wait asked for, or no answer. */
const CALL_FAILED = new RegExp(`${REFUSAL_STATUS.source}(?: and codes \\d+(?:, \\d+)*)?|${OUTLASTED}|${PASSES.join("|")}`);

/** How a row words a refusal of a token that lacks a permission. */
const NOT_PERMITTED = /status 40[13]/;

/** What a login needs on an account whose Access is off: no API switches it on. */
const ACCESS_OFF = "Access switched on for the account";

/** The row of each of the account's three login methods. */
const LOGIN_METHOD = "Login method";

/** What an install lacks whose passkeys Cloudflare did not make: its users log in with the email code. */
const NO_PASSKEYS = "passkeys, which Cloudflare did not make for the account";

/** What an install lacks whose account holds no login method of its own members: its users log in with the email code. */
const NO_CLOUDFLARE = "the login of the Cloudflare account's own members, which the account holds no method of";

/** How the row of that method starts. */
const CLOUDFLARE_ROW = `${INSTALL_OBJECTS.cloudflareMethod}:`;

/** How the row of the Worker's login variable starts where the login it is read from is not there. */
const LOGIN_VARIABLE = `${INSTALL_OBJECTS.accessBinding}:`;

/** The row of the key that sends files straight to the bucket. */
const UPLOAD_KEY = "Upload key";

/** What a run lacks whose command made that key, or could not read it. */
const FRESH_KEY = "an upload key older than two and a half minutes (this run made the key, or could not read it, and the bucket refuses a new one for about two minutes)";

/** What the live suite calls the thing each optional object gives. */
const CAPABILITIES: Readonly<Record<string, string>> = {
  "Redirect rule": "https-redirect",
  "WAF rule": "guard-rules",
  "Bot settings": "bot-block",
  "Access application": "access",
  "Access policy": "access",
  [LOGIN_METHOD]: "login-methods",
  Key: "kept-key",
  Workflow: "jobs",
  "Upload key": "upload-key",
};

/** What an install lacks whose Workflow was not made. */
const NO_WORKFLOW = "the Worker's Workflow, which Cloudflare did not make";

/** What a run says it found of an install of each kind: where it answers. */
const FOUND_AS = { domain: "Zone", "account address": "Free address" } as const;

/** The problem `poplin install` stops with on an account that holds an install. */
const ALREADY_INSTALLED = "already_installed";

/** The problem `poplin doctor --repair` stops with on a database at another schema than this commit's. */
const ANOTHER_VERSION = "another_version";

/** The problem `poplin uninstall` stops with on an account that holds nothing of an install. */
const NO_INSTALL = "no_install";

/** The answer of the install to a token it knows. */
const TOKEN_KNOWN = 200;

/** What a deploy that stranded the build before must show: how many answers in a row, over how long at least, in milliseconds. */
const ROW_NEEDED = { answers: 12, overMs: 30_000 } as const;

/** What any other deploy must show: one answer. */
const ONE_NEEDED = { answers: 1, overMs: 0 } as const;

/** How often the install is asked, how long one answer may take, and how long after the wait began the last request may start, in milliseconds. */
const PACE = { everyMs: 3_000, answerMs: 5_000, withinMs: 180_000 } as const;

/** The variables a run reads. */
type Environment = Readonly<Record<string, string | undefined>>;

/** One row of the summary: a piece of the install, what the run did to it, and what it needs when it was skipped. */
interface Piece {
  readonly piece: string;
  readonly result: string;
  readonly needs?: string | undefined;
}

/** What a run gathers: the summary's rows and what the install lacks. */
interface Progress {
  readonly pieces: Piece[];
  readonly missing: Record<string, string>;
}

/** What a run is made with, beside the account: this commit's build as a release, what the commands reach the world through and rest by, and what sends a request to the install. */
export interface World {
  readonly release: Published;
  readonly ends: Ends;
  readonly fetch: Fetch;
}

/** The install once the commands are through with it: its database, and whether the build that ran before can no longer answer from it once it starts anew. */
interface Made {
  readonly id: string;
  readonly strandsOlder: boolean;
}

/** What the wait is given. */
interface Waiting {
  /** The origin the install's API answers on. */
  readonly server: string;

  /** A token whose row the database of this run's install holds. */
  readonly token: string;

  /** What sends a request. */
  readonly fetch: Fetch;

  /** Whether the build that ran before can no longer answer from the database once it starts anew. */
  readonly strandsOlder: boolean;

  /** The clock, in milliseconds. */
  readonly now: () => number;

  /** Waits for so many milliseconds. */
  readonly pause: (ms: number) => Promise<void>;
}

/** What a wait that ended well counted. */
interface Arrived {
  /** The answers of 200 in a row the wait ended on. */
  readonly answers: number;

  /** How long that row took, in milliseconds. */
  readonly overMs: number;

  /** The requests before that row that got no 200: another status, or no answer in time. */
  readonly others: number;
}

/** The install as the wait for its new deployment and the caps reach it: every part of that wait but the token and what the run did to the database. */
type Reached = Omit<Waiting, "token" | "strandsOlder">;

/** A repair that came to its rows with one that failed on a call Cloudflare asked to wait for, or gave no answer to. */
class Passing extends Error {
  constructor(
    readonly repaired: Answer,
    readonly rows: readonly CommandRow[],
    readonly row: CommandRow,
  ) {
    super("a call of the repair got no answer in time");
  }
}

/** Add a piece to the summary's rows and print it, so the log shows how far a run came. */
function note(run: Run, progress: Pick<Progress, "pieces">, piece: Piece): void {
  progress.pieces.push(piece);
  run.say(piece.needs === undefined ? `${piece.piece}: ${piece.result}` : `${piece.piece}: ${piece.result}: needs ${piece.needs}`);
}

/** Stop a run on an account that pays for something, before anything is made. A token that cannot read the plans is told as a lack, and the run goes on. */
async function checkPlans(run: Run, found: Found, progress: Progress): Promise<Stop | undefined> {
  const plans = await readFreePlans(run, found.zone);
  if (!isStop(plans)) {
    note(run, progress, { piece: "Account plans", result: `free (${plans.subscriptions} subscriptions: ${plans.free} at a price of 0, ${plans.ended} ended)` });

    return undefined;
  }

  if (plans.kind === "failed") return plans;

  note(run, progress, { piece: "Account plans", result: "not read", needs: plans.needs });
  run.annotate("warning", `The account's plans were not read, so nothing checked that they are free: the run needs ${plans.needs}.`);

  return undefined;
}

/** What the live suite calls the login method a row left out. */
function leftOutMethod(row: CommandRow): "cloudflare-login" | "passkeys" {
  return row.detail.startsWith(CLOUDFLARE_ROW) ? "cloudflare-login" : "passkeys";
}

/**
 * Say what a row a command did not settle needs, in words that quote nothing Cloudflare said.
 *
 * @returns the lack of the account or the token, or `undefined` for a failure that is neither; an object that was left out is a lack, never a failure
 */
function needOf(row: CommandRow): string | undefined {
  if (row.state === "not-run") return "the run to reach it: an earlier object was not settled";

  if (row.state === "leave-out" && row.object === LOGIN_METHOD) return row.detail.startsWith(CLOUDFLARE_ROW) ? NO_CLOUDFLARE : NO_PASSKEYS;

  if (row.state === "leave-out") return `the ${row.object}, which was left out: the token lacks its optional permission, or the account holds it in another form`;

  if (row.state === "block" && row.right !== undefined) return `the token permission ${row.right}`;

  // The Worker's login variable is read from the Access application, so it is missing wherever the application is.
  if (row.state === "block" && (row.object.startsWith("Access") || row.object === LOGIN_METHOD || row.detail.startsWith(LOGIN_VARIABLE))) return ACCESS_OFF;

  // An install answers without its Workflow: only a copy too large for one request needs it. One that was not made is a lack, which skips the check of that copy, and stops no run.
  if (row.object === "Workflow" && row.state === "fail") return NO_WORKFLOW;

  // Cloudflare refuses the bot settings of a plan that has none through the API, whatever the token may do.
  if (row.object === "Bot settings" && REFUSAL_STATUS.test(row.detail)) return "a plan whose bot settings the API can change";

  return NOT_PERMITTED.test(row.detail) ? `the token permission for the ${row.object}` : undefined;
}

/** What is told of a row: what the command did, and of a row it did not settle how its call failed, alone. The rest of its detail names its subject, which may be one the account holds and the run hides nothing of. */
function resultOf(row: CommandRow): string {
  const did = TOLD[row.state] ?? row.state;
  const failed = SETTLED.has(row.state) ? undefined : CALL_FAILED.exec(row.detail)?.[0];

  return failed === undefined ? did : `${did} (${failed})`;
}

/** Whether a row is the upload key's, of a key that was not there before the run: made by it, or not read. */
function isFreshKey(row: CommandRow): boolean {
  return row.object === UPLOAD_KEY && row.state !== "leave";
}

/** Tell the suite of a key this run made: the bucket refuses one for its first minutes, so the check of the way a file goes then counts on no direct ticket. */
function noteFreshKey(progress: Progress, rows: readonly CommandRow[]): void {
  if (rows.some(isFreshKey)) progress.missing["settled-upload-key"] ??= FRESH_KEY;
}

/** Sort the rows of an install or a repair into the summary and the lacking things, and answer what stops the run. */
function sortRows(run: Run, progress: Progress, rows: readonly CommandRow[]): Stop | undefined {
  let failed: Stop | undefined;
  let skipped: Stop | undefined;

  noteFreshKey(progress, rows);

  for (const row of rows) {
    if (SETTLED.has(row.state)) {
      note(run, progress, { piece: row.object, result: resultOf(row) });
      continue;
    }

    const needs = needOf(row);
    // A login method that is left out leaves the email code standing: the suite checks the login's page for the methods that are there.
    const capability = row.object === LOGIN_METHOD && row.state === "leave-out" ? leftOutMethod(row) : CAPABILITIES[row.object];
    note(run, progress, { piece: row.object, result: resultOf(row), needs });

    if (needs === undefined) failed ??= { kind: "failed", what: `the ${row.object} is ${resultOf(row)}` };

    // A vital object the account holds in another form is left out and may still answer: the wait for the install decides.
    if (needs !== undefined && VITAL.has(row.object) && row.state !== "leave-out") skipped ??= { kind: "skipped", needs };

    if (needs !== undefined && capability !== undefined) progress.missing[capability] ??= needs;
  }

  // A failure anywhere outranks a skip: the rows come in the order of the work, so an object that was never reached may stand before the one that failed.
  return failed ?? skipped;
}

/** The stop of a command that came to no rows: its problem's code alone, since its own lines are in the log already. */
function stopOf(name: string, answer: Exclude<Answer, { readonly kind: "rows" }>): Stop {
  return { kind: "failed", what: answer.kind === "stopped" ? `poplin ${name} stopped (${answer.problem})` : `poplin ${name} printed no value a run can read (exit ${answer.code})` };
}

/**
 * Take the test install off its account with `poplin uninstall`, the sites' files and the database with it.
 *
 * @param world - what the command reaches the world through and rests by
 * @param progress - takes each row of the removal as it is printed
 * @param why - what the log says of it: that it was asked for, or what another build made
 * @returns what stopped the run, or `undefined` once nothing of an install is left; a removal that left a kind stops the run, and the next run removes the rest
 */
export async function startOver(run: Run, found: Found, world: Pick<World, "ends">, progress: Pick<Progress, "pieces">, why: string): Promise<Stop | undefined> {
  note(run, progress, { piece: "Start over", result: why });

  const words = ["cloudflare", ...placeWords(run, found), "--json"];
  const listed = await command(run, "uninstall", [...words, "--dry-run"], world.ends);
  if (listed.kind === "stopped" && listed.problem === NO_INSTALL) {
    note(run, progress, { piece: "Removal", result: "nothing of an install is there" });

    return undefined;
  }

  if (listed.kind !== "rows") return stopOf("uninstall", listed);

  if (listed.confirm === undefined) return { kind: "failed", what: "poplin uninstall named nothing to confirm a removal with" };

  const began = world.ends.reach.now();
  const removed = await command(run, "uninstall", [...words, `--confirm=${listed.confirm}`], world.ends);
  if (removed.kind !== "rows") return stopOf("uninstall", removed);

  for (const row of removed.rows) note(run, progress, { piece: row.object, result: row.count === undefined ? resultOf(row) : `${resultOf(row)} (${row.count} in it)` });

  const kinds = removed.rows.filter((row) => row.state === "remove").length;
  note(run, progress, { piece: "Removal", result: `${kinds} kinds in ${Math.round((world.ends.reach.now() - began) / 1000)} seconds` });
  const left = removed.rows.filter((row) => NOT_REMOVED.has(row.state)).map((row) => `${row.object}: ${resultOf(row)}`);

  return left.length === 0 ? undefined : { kind: "failed", what: `poplin uninstall left the ${left.join(", the ")}` };
}

/**
 * Put this commit's build in place of the code a standing install runs, by the upload an install updates itself with: every binding the Worker has is kept, and the run's token stands where the kept key does.
 *
 * @param from - the version the install ran, where the look for it read a released one
 * @returns what stopped the run, or `undefined` once Cloudflare took the upload and the release's sweep trigger
 */
async function putCommit(run: Run, world: World, progress: Progress, from: string | undefined): Promise<Stop | undefined> {
  const { release, ends } = world;
  const upload = await openUpload({ connection: { ...run.connection, fetch: ends.reach.fetch } }, { accountId: run.accountId, script: SCRIPT });
  if (!upload.ok) return { kind: "failed", what: `the Worker was not opened for an upload (${upload.refusal})` };

  const checked = await checkedBundle({ fetch: (url, init) => ends.reach.fetch(url, init) }, release.version, release.pin);
  if (!checked.ok) return { kind: "failed", what: `this commit's build was not taken as a release (${checked.why})` };

  const put = await upload.value.put(checked.bundle, { from: from ?? release.version, to: release.version, schema: OWN_SCHEMA, at: ends.reach.now() }, undefined);
  if (!put.ok) return { kind: "failed", what: `Cloudflare did not take the upload (${put.refusal}${put.refusal === "version_refused" ? `, status ${put.status}` : ""})` };

  if (put.unset !== undefined) return { kind: "failed", what: "Cloudflare took the upload and not the sweep trigger" };

  note(run, progress, { piece: "Worker's code", result: `this commit's build, by the upload of an update (${from ?? "no released version"} -> ${release.version})` });

  return undefined;
}

/**
 * Read what the install answered, for the log: its status, and the first line of a body in plain text, which is how the Worker says why it cannot start.
 *
 * @returns the status alone for any other body, and status 0 for no answer
 */
export async function answerOf(asking: Promise<Response>): Promise<{ readonly status: number; readonly told: string }> {
  const response = await asking.catch(() => undefined);
  if (response === undefined) return { status: 0, told: "0" };

  const { status } = response;
  const plain = response.headers.get("Content-Type")?.startsWith("text/plain") === true;
  // A body that breaks off leaves the status, which did arrive.
  const [line = ""] = plain ? (await response.text().catch(() => "")).split("\n") : [];

  return { status, told: line === "" ? String(status) : `${status}: ${line.slice(0, SAID_LENGTH)}` };
}

/**
 * Ask the install's API until it answers as a Worker that started, a 401 to a request with no token, and the database it is bound to holds this commit's schema.
 *
 * An instance of the build before answers that 401 too. The schema is read through Cloudflare's API: a Worker that started on that database left it there, and only then does the database take a token's row.
 */
async function waitUntilReady(run: Run, found: Found, databaseId: string, world: World): Promise<Stop | undefined> {
  const address = `https://${found.adminHost}/api/whoami`;
  const { reach, sleep } = world.ends;
  const deadline = reach.now() + READY.withinMs;
  let last = { status: 0, told: "0" };

  while (reach.now() < deadline) {
    last = await answerOf(world.fetch(address, { redirect: "manual", signal: AbortSignal.timeout(READY.everyMs) }));
    const holds = last.status === 401 ? await holdsOwnSchema(run, databaseId) : false;
    if (holds === true) return undefined;

    if (holds !== false) return holds;

    await sleep(READY.everyMs);
  }

  const behind = last.status === 401 ? ", and its database does not hold this commit's schema" : "";

  return { kind: "failed", what: `the install did not answer within ${READY.withinMs / 1000} seconds (last status ${last.told})${behind}` };
}

/** Find the database the install is bound to, and wait until the install answers on it at this commit's schema. */
async function readyDatabase(run: Run, found: Found, world: World): Promise<string | Stop> {
  const database = await findDatabase(run);
  if (database === undefined) return { kind: "failed", what: "the account holds no database of the install" };

  if (typeof database !== "string") return database;

  return (await waitUntilReady(run, found, database, world)) ?? database;
}

/** Tell when the install's sweep last asked for a newer version: the one thing a run can read of a sweep trigger that fires. It stops no run. */
async function tellSweep(run: Run, world: World, progress: Progress, database: string): Promise<void> {
  const asked = await lastAsked(run, database);
  if (typeof asked === "object") return;

  const minutes = asked === undefined ? undefined : Math.round((world.ends.reach.now() - asked) / 60_000);
  note(run, progress, { piece: "Sweep", result: minutes === undefined ? "has not asked for a newer version yet" : `last asked for a newer version ${minutes} minutes ago` });
}

/**
 * Run a repair, and once more after a rest where a row of it failed on a call Cloudflare asked to wait for, or gave no answer to. A refusal is never asked again.
 *
 * The rest is on the run's own clock: the library waits none. A key the first run made is told to the suite, since the second finds it standing.
 *
 * @returns what the last run answered
 */
async function ridingOut(run: Run, world: World, progress: Progress, repair: () => Promise<Answer>): Promise<Answer> {
  const attempt = async (): Promise<Answer> => {
    const repaired = await repair();
    const rows = repaired.kind === "rows" ? repaired.rows : [];
    const passing = rows.find((row) => row.state === "fail" && PASSES.some((words) => row.detail.endsWith(words)));
    if (passing !== undefined) throw new Passing(repaired, rows, passing);

    return repaired;
  };
  const again = async ({ error }: { readonly error: Error }): Promise<boolean> => {
    if (!(error instanceof Passing)) return false;

    noteFreshKey(progress, error.rows);
    note(run, progress, { piece: "Repair", result: `run once more after ${AGAIN_AFTER_MS / 1000} seconds: the ${error.row.object} is ${resultOf(error.row)}` });
    await world.ends.sleep(AGAIN_AFTER_MS);

    return true;
  };

  try {
    return await pRetry(attempt, { retries: 1, minTimeout: 0, maxTimeout: 0, shouldRetry: again });
  } catch (error) {
    if (error instanceof Passing) return error.repaired;

    throw error;
  }
}

/**
 * Mend the install that stands: this commit's build in place of its code, `poplin doctor --repair`, then the wait for it.
 *
 * The repair comes first, since an install that lost a piece answers nowhere until it is mended. It reads the install's settings from its database and refuses one at another schema than this commit's:
 * the new Worker brings such a database forward on its first request, so the run then waits for that and repairs again. A repair Cloudflare asked to wait for is run once more too.
 *
 * @param standing - the version the install ran, where it is a released one, and whether its database held every schema step of this commit before the upload
 */
async function mend(run: Run, found: Found, world: World, progress: Progress, standing: { readonly version: string | undefined; readonly current: boolean }): Promise<Made | Stop> {
  const uploaded = await putCommit(run, world, progress, standing.version);
  if (uploaded !== undefined) return uploaded;

  const repair = (): Promise<Answer> => ridingOut(run, world, progress, () => command(run, "repair", ["--repair", ...placeWords(run, found), "--yes", "--json"], world.ends));
  const first = await repair();
  const behind = first.kind === "stopped" && first.problem === ANOTHER_VERSION;
  const forward = behind ? await readyDatabase(run, found, world) : undefined;
  if (typeof forward === "object") return forward;

  const repaired = behind ? await repair() : first;
  if (repaired.kind !== "rows") return stopOf("doctor --repair", repaired);

  const stopped = sortRows(run, progress, repaired.rows);
  if (stopped !== undefined) return stopped;

  const database = forward ?? (await readyDatabase(run, found, world));
  if (typeof database !== "string") return database;

  await tellSweep(run, world, progress, database);

  return { id: database, strandsOlder: !standing.current };
}

/**
 * Read which release the install runs once the run changed it, by the look `poplin install` begins with: on an install that stands the command makes nothing.
 *
 * Cloudflare makes a version of the Worker for every change of its settings, and tags none the change does not tag. A release read from a tag is no longer read after the first such change.
 *
 * @param words - the words of the run's own `poplin install`
 * @param after - what the run did last to the Worker, as the summary's row says it
 * @returns what stopped the run, where the command read another release than this commit's build, or none
 */
async function checkRelease(run: Run, world: World, progress: Progress, words: readonly string[], after: string): Promise<Stop | undefined> {
  // The command tells an install that stands in lines the summary has no use for a second time.
  const looked = await command({ ...run, say: () => undefined }, "install", words, world.ends);
  const read = looked.kind === "stopped" && looked.problem === ALREADY_INSTALLED && looked.version === world.release.version;
  if (!read) return { kind: "failed", what: `poplin install did not read the install as this commit's build after ${after}` };

  note(run, progress, { piece: "Release", result: `read as ${world.release.version} after ${after}` });

  return undefined;
}

/**
 * Bring the account to an install that runs this commit's build: `poplin install` where none is, and the upload and the repair where one is. Then read its release back.
 *
 * @param login - the first login of an install the run makes
 * @param current - whether a database that stands held every schema step of this commit
 * @returns the install's database, and whether the build that ran before is left unable to answer; or what stopped the run
 */
async function settle(run: Run, found: Found, login: string, current: boolean, world: World, progress: Progress): Promise<Made | Stop> {
  const words = ["cloudflare", ...placeWords(run, found), `--user=${login}`, "--yes", "--adopt", "--no-log-in", "--json"];
  const made = await makeOrMend(run, found, { words, current }, world, progress);
  if (isStop(made.made)) return made.made;

  return (await checkRelease(run, world, progress, words, made.after)) ?? made.made;
}

/** Run `poplin install`, and mend the install it finds; `after` is what the run did last to the Worker. */
async function makeOrMend(run: Run, found: Found, asked: { readonly words: readonly string[]; readonly current: boolean }, world: World, progress: Progress): Promise<{ readonly made: Made | Stop; readonly after: string }> {
  const { words, current } = asked;
  const installed = await command(run, "install", words, world.ends);
  if (installed.kind === "stopped" && installed.problem === ALREADY_INSTALLED) {
    // The version is a text anybody with the account's token can write, so only one written as a release's is told.
    const version = installed.version !== undefined && isPlainVersion(installed.version) ? installed.version : undefined;
    note(run, progress, { piece: "Install", result: `found, runs ${version ?? "no released version"}` });

    return { made: await mend(run, found, world, progress, { version, current }), after: "the upload and the repair" };
  }

  const after = "the install wrote its settings";
  if (installed.kind !== "rows") return { made: stopOf("install", installed), after };

  note(run, progress, { piece: "Install", result: "none found, so poplin install ran" });
  const stopped = sortRows(run, progress, installed.rows);
  if (stopped !== undefined) return { made: stopped, after };

  const database = await readyDatabase(run, found, world);

  return { made: typeof database === "string" ? { id: database, strandsOlder: true } : database, after };
}

/** Ask the install who the token is, on a connection of its own, and answer the status; 0 for no answer in time. */
async function askWhoami(given: Pick<Waiting, "server" | "token" | "fetch">): Promise<number> {
  const init = { headers: { Authorization: `Bearer ${given.token}` }, redirect: "manual", keepalive: false, signal: AbortSignal.timeout(PACE.answerMs) } as const;
  const answer = await given.fetch(`${given.server}/api/whoami`, init).catch(() => undefined);
  // The body is dropped unread, so the connection is not held for it.
  await answer?.body?.cancel().catch(() => undefined);

  return answer?.status ?? 0;
}

/**
 * Wait until the install answers the run's token: once, or twelve times in a row where the build before can no longer answer.
 *
 * @returns what the wait counted; or, once a request would start more than three minutes after the first, a failure that names the last status and no address
 */
export async function awaitNewDeployment(given: Waiting): Promise<Arrived | Stop> {
  const wanted = given.strandsOlder ? ROW_NEEDED : ONE_NEEDED;
  const began = given.now();
  let row = { answers: 0, since: began };
  let others = 0;
  let last = 0;

  for (let next = began; next - began <= PACE.withinMs; next = given.now() + PACE.everyMs) {
    if (next > began) await given.pause(PACE.everyMs);

    last = await askWhoami(given);
    const at = given.now();
    row = last === TOKEN_KNOWN ? { answers: row.answers + 1, since: row.answers === 0 ? at : row.since } : { answers: 0, since: at };
    if (last !== TOKEN_KNOWN) others += 1;

    if (row.answers >= wanted.answers && at - row.since >= wanted.overMs) return { answers: row.answers, overMs: at - row.since, others };
  }

  const seconds = PACE.withinMs / 1000;

  return { kind: "failed", what: `the install did not answer the run's token within ${seconds} seconds (needed in a row: ${wanted.answers}; not a ${TOKEN_KNOWN}: ${others}; last status: ${last})` };
}

/** How a wait for the new deployment is told: the answers it ended on, and how many requests before them got no 200. */
function arrivalOf(arrived: Arrived): string {
  const before = arrived.others === 0 ? "" : `, after ${arrived.others} requests that got no 200`;
  if (arrived.answers === 1) return `answered the run's token${before}`;

  return `answered the run's token ${arrived.answers} times in a row over ${Math.round(arrived.overMs / 1000)} seconds${before}`;
}

/**
 * With a token made for these calls: wait until the install answers it as the new deployment does, give the install its caps, and remove the token's row. A row that stays stops the run as caps that were refused do.
 *
 * @param install - where the install's API answers, what sends a request to it, and the clock and the pause of the wait
 * @param settled - the install's database, and whether the build before can no longer answer from it
 * @returns what stopped the run, or `undefined` once the install took its caps and holds no row of the token
 */
export async function confirmAndCap(run: Run, install: Reached, settled: Made, progress: Progress): Promise<Stop | undefined> {
  const token = await seedToken(run, settled.id, Date.now());
  if (typeof token !== "string") return token;

  const reached = { server: install.server, token, fetch: install.fetch };
  const arrived = await awaitNewDeployment({ ...install, token, strandsOlder: settled.strandsOlder });
  if (!isStop(arrived)) note(run, progress, { piece: "New deployment", result: arrivalOf(arrived) });

  const uncapped = isStop(arrived) ? arrived : await capInstall(reached);
  const kept = await removeTokens(run, settled.id, Date.now());
  if (uncapped === undefined && kept === undefined) note(run, progress, { piece: "Storage and file caps", result: "set" });

  return uncapped ?? kept;
}

/** Every step in order; answers what stopped the run, or `undefined` once the install answers. */
async function converge(run: Run, progress: Progress, env: Environment, world: World): Promise<Stop | undefined> {
  const found = await findInstall(run, env);
  if (isStop(found)) return found;

  note(run, progress, { piece: FOUND_AS[found.kind], result: "found" });

  const refused = (await checkPlans(run, found, progress)) ?? (await refuseOtherAccount(run, found.zone));
  if (refused !== undefined) return refused;

  const standing = await readStanding(run);
  if (isStop(standing)) return standing;

  const asked = env.POPLIN_LIVE_START_OVER === ASKED ? "asked for" : undefined;
  const why = standing.drift === undefined ? asked : `another build made it: ${standing.drift}`;
  const stopped = why === undefined ? undefined : await startOver(run, found, world, progress, why);
  if (stopped !== undefined) return stopped;

  const made = await settle(run, found, liveLogin(run, env) ?? NOBODY, why === undefined && standing.current, world, progress);
  if (isStop(made)) return made;

  return confirmAndCap(run, { server: `https://${found.adminHost}`, fetch: world.fetch, now: world.ends.reach.now, pause: world.ends.sleep }, made, progress);
}

/** The world of a real run: this commit's build as the release, the network as it is, and the clock. */
async function ownWorld(): Promise<World> {
  const release = await publish(await readBuilt());

  return { release, ends: { reach: reachOf(release, fetch), sleep: Bun.sleep }, fetch: sendLive };
}

/**
 * Make the install match the commit, and tell the log, the step summary, and the step's output what came of it.
 *
 * @param env - where the zone's name, the login, and the asking for a start-over are read from: the same variables the run was opened from
 * @returns the exit code: 0 only once the install answers
 */
export async function convergeInstall(run: Run, env: Environment, world: World): Promise<number> {
  const progress: Progress = { pieces: [], missing: {} };
  const stopped = await converge(run, progress, env, world);
  const rows = progress.pieces.map((piece) => `| ${piece.piece} | ${piece.result} | ${piece.needs ?? ""} |`);

  run.summarize(["### The test install", "", "| Piece | Result | Skipped: needs |", "| --- | --- | --- |", ...rows, ""].join("\n"));
  run.output("missing", JSON.stringify(progress.missing));

  for (const [lacking, needs] of Object.entries(progress.missing)) run.annotate("warning", `The checks of ${lacking} are skipped: the install needs ${needs}.`);

  if (stopped !== undefined) return reportStop(run, stopped, "The test install could not be made ready");

  run.say("The test install answers.");

  return 0;
}

if (import.meta.main) process.exitCode = await convergeInstall(openRun(), process.env, await ownWorld());
