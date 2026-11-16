// Make the standing test install of the run's account match main: the bucket, the database, the login, the Worker, then what its kind adds.
//
//   where it answers -> the account's plans, all free -> bucket, database, made anew when another build made it -> the login application -> wrangler deploy of the built bundle
//     with a domain      -> the zone plug's repair, which makes every object of the zone as the Domain tab does
//     without a domain   -> the two forwarders -> the key the install keeps
//     -> wait for the install to answer -> the test install's caps
//
// An install without a domain has no plug, so its forwarders, its login, and its key are made by the product's own sync of each.
// It holds no state: every step reads what is there and changes what differs. A token that lacks a permission, or an account with a switch off, stops the piece it belongs to.
// Every piece is printed as it is settled. A piece Cloudflare refused is printed with the step it stopped at, the status, and the error codes, and with nothing else Cloudflare said.
// A piece nothing answers without stops the run as an error, whether it failed or the token lacks its permission.
// Step output: `missing` (a JSON object of what the install lacks and still answers without, each with its reason, for the live suite).

import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { DomainRow, DomainSettings } from "@poplin/app/src/console/domain/records";
import { type Logins, parseLogins } from "@poplin/core/src/auth/logins";
import { BaseBuckets } from "cloudflare/resources/r2/buckets/buckets";

import { keepCopyConfig } from "../../src/deploy/kept-config";
import { isAccessOff, readLoginFacts, syncAccess } from "../../src/zone/access/access";
import type { AccountAddresses } from "../../src/zone/address-layout";
import { type CloudflareFailure, callCloudflare } from "../../src/zone/client";
import { syncDatabase } from "../../src/zone/database/database";
import { syncForwarders } from "../../src/zone/forwarders/forwarders";
import { syncJobs } from "../../src/zone/jobs/jobs";
import { INSTALL_OBJECTS } from "../../src/zone/install-objects";
import { privateSitesPattern } from "../../src/zone/layout";
import type { Report } from "../../src/zone/sync";
import { createDomainPlug, keysMended } from "../../src/zone/zone-plug";
import { capInstall } from "./caps";
import { readFreePlans } from "./plan";
import { sendLive } from "./send";
import { settleDatabase } from "./shape";
import { removeTokens, seedToken } from "./tokens";
import { BUCKET, type Found, findInstall, isStop, liveLogin, openRun, type Run, reportStop, SCRIPT, type Stop, stopOf } from "./util";

/** This package's folder. */
const PACKAGE = join(import.meta.dir, "..", "..");

/** The login an install with no login of a person starts with: nobody can log in as it. */
const NOBODY = "owner@example.com";

/** The binding of an install with no login application: a team that does not exist, and an audience no token names. */
const NO_ACCESS = { team_domain: "access-off.invalid", audience: "0".repeat(64) };

/** The settings a live install starts with, where they differ from the defaults: a short trash, and room for the suite's own requests. */
const LIVE_SETTINGS = { trash_days: "1", visitor_requests_per_minute: "120" };

/** How long the install has to answer after a deploy, and how often it is asked, in milliseconds. */
const READY = { withinMs: 300_000, everyMs: 5_000 };

/** The most characters of the install's own words a failed wait repeats. */
const SAID_LENGTH = 200;

/** The states of a row that the repair left as wanted. */
const SETTLED: ReadonlySet<DomainRow["state"]> = new Set(["present", "created", "changed", "removed"]);

/** The objects nothing answers without. */
const VITAL: ReadonlySet<string> = new Set(["DNS record", "Worker route"]);

/** How the repair words a refusal by Cloudflare, with its status. */
const REFUSAL_STATUS = /refused with status \d+/;

/** How the repair words a refusal of a token that lacks a permission. */
const NOT_PERMITTED = /status 40[13]/;

/** What a login needs on an account whose Access is off: no API switches it on. */
const ACCESS_OFF = "Access switched on for the account";

/** The row of the key that sends files straight to the bucket. */
const UPLOAD_KEY = "Upload key";

/** What a run lacks whose repair made that key, or could not read it. */
const FRESH_KEY = "an upload key older than two and a half minutes (this run made the key, or could not read it, and the bucket refuses a new one for about two minutes)";

/** What the live suite calls the thing each optional object gives. */
const CAPABILITIES: Readonly<Record<string, string>> = {
  "Redirect rule": "https-redirect",
  "WAF rule": "guard-rules",
  "Rate rule": "rate-rule",
  "Bot settings": "bot-block",
  "Access application": "access",
  "Access policy": "access",
  "Access open paths": "access",
  Key: "kept-key",
  Workflow: "jobs",
  "Upload key": "upload-key",
};

/** An error code of Cloudflare's, as wrangler prints it. */
const ERROR_CODE = /\[code: (\d+)\]/g;

/** The code Cloudflare refuses a token with that lacks a permission. */
const NOT_AUTHENTICATED = "10000";

/** What an install lacks whose Workflow was not made. */
const NO_WORKFLOW = "the Worker's Workflow, which Cloudflare did not make";

/** What a run says it found of an install of each kind: where it answers. */
const FOUND_AS = { domain: "Zone", "account address": "Free address" } as const;

/** What the Worker's `ACCESS` binding holds. */
type AccessBinding = typeof NO_ACCESS;

/** The variables a run reads. */
type Environment = Readonly<Record<string, string | undefined>>;

/** One row of the summary: a piece of the install, what the run did to it, and what it needs when it was skipped. */
interface Piece {
  readonly piece: string;
  readonly result: string;
  readonly needs?: string;
}

/** What a run gathers: the summary's rows and what the install lacks. */
interface Progress {
  readonly pieces: Piece[];
  readonly missing: Record<string, string>;
}

/** Add a piece to the summary's rows and print it, so the log shows how far a run came. */
function note(run: Run, progress: Progress, piece: Piece): void {
  progress.pieces.push(piece);
  run.say(piece.needs === undefined ? `${piece.piece}: ${piece.result}` : `${piece.piece}: ${piece.result}: needs ${piece.needs}`);
}

/** How many objects a sync made, changed, left, and would not touch. */
function countsOf(report: Report): string {
  return `created ${report.created.length}, changed ${report.changed.length}, left ${report.left.length}, not poplin's ${report.skipped.length}`;
}

/**
 * Tell which piece a call to Cloudflare stopped, and at which step of its plan where the failure names one.
 *
 * @param permission - the token permission the piece needs
 * @returns the stop, told as a row: the status and the error codes of a refusal, and nothing else Cloudflare said
 */
function stopAt(run: Run, progress: Progress, piece: string, failure: CloudflareFailure & { readonly failed?: string }, permission: string): Stop {
  const stop = stopOf(failure, permission);
  const stopped = failure.failed === undefined ? "stopped" : `stopped at ${failure.failed}`;
  note(run, progress, stop.kind === "skipped" ? { piece, result: stopped, needs: stop.needs } : { piece, result: `${stopped}: ${stop.what}` });

  return stop;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
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

async function ensureBucket(run: Run): Promise<Stop | "created" | "present"> {
  const listed = await callCloudflare(run.connection, (api) => new BaseBuckets(api).list({ account_id: run.accountId, name_contains: BUCKET }));
  if (!listed.ok) return stopOf(listed, "Workers R2 Storage: Edit");

  if (listed.value.buckets?.some((bucket) => bucket.name === BUCKET) === true) return "present";

  const created = await callCloudflare(run.connection, (api) => new BaseBuckets(api).create({ account_id: run.accountId, name: BUCKET }));

  return created.ok ? "created" : stopOf(created, "Workers R2 Storage: Edit");
}

/** The login an install wants in front of it: its whole dashboard hostname, and every address of a private site, which without a domain is one host. */
function loginOf(found: Found, logins: Logins): Parameters<typeof syncAccess>[2] {
  if (found.kind === "domain") return { hostname: found.layout.adminHostname, logins, privateSites: privateSitesPattern(found.layout) };

  return { hostname: found.layout.adminHost, logins, privateSites: found.layout.privateHost };
}

/** Make the login application and read what the Worker checks a login against. A login the account or the token cannot give is a skip, and the Worker is bound to no team. */
async function ensureAccess(run: Run, found: Found, login: string, progress: Progress): Promise<AccessBinding | Stop> {
  const skip = (needs: string): AccessBinding => {
    note(run, progress, { piece: "Login binding", result: "skipped", needs });
    progress.missing.access = needs;

    return NO_ACCESS;
  };
  const stopped = (stop: Stop): AccessBinding | Stop => (stop.kind === "skipped" ? skip(stop.needs) : stop);

  const logins = parseLogins([login]);
  if (!logins.ok) return skip("a login that is an email address");

  const synced = await syncAccess(run.connection, run.accountId, loginOf(found, logins.value), "apply");
  if (!synced.ok && isAccessOff(synced)) return skip(ACCESS_OFF);

  if (!synced.ok) return stopped(stopAt(run, progress, "Login application", synced, "Access: Apps and Policies: Edit"));

  note(run, progress, { piece: "Login application", result: countsOf(synced.report) });

  // The applications were listed a moment ago to make the login, so a refusal here is of the team's domain.
  const facts = await readLoginFacts(run.connection, run.accountId);
  if (!facts.ok) return stopped(stopOf(facts, "Access: Organizations, Identity Providers, and Groups: Read"));

  if (facts.value === undefined) return skip("the login application's audience and the team's domain");

  const { teamDomain, audience } = facts.value;
  run.hide(audience);
  run.hide(teamDomain);
  note(run, progress, { piece: "Login binding", result: "bound" });

  return { team_domain: teamDomain, audience };
}

/**
 * The Worker's configuration for the test install: the repository's own, with the test account's id, bucket, database, login, and where the install answers.
 *
 * An install without a domain answers on the Worker's own free address, so that address is switched on for it, and off for one with a domain.
 *
 * @returns what wrangler uploads the built bundle by: the file as it is, already minified, so `minify` is left out; the map the build wrote beside it goes with it, as the repository's own configuration says
 */
export async function workerConfig(
  run: Pick<Run, "accountId">,
  found: Found,
  bound: { readonly databaseId: string; readonly access: AccessBinding; readonly login: string },
): Promise<Record<string, unknown>> {
  const own: unknown = Bun.JSONC.parse(await Bun.file(join(PACKAGE, "..", "..", "wrangler.jsonc")).text());
  if (!isRecord(own)) throw new Error("wrangler.jsonc holds no configuration");

  const zone = found.kind === "domain" ? { domain: found.layout.domain } : { account_address: found.layout.account };

  // The Worker's name goes wherever an install's own name does: the Workflow is named after it. Wrangler makes the Workflow at Cloudflare right after each upload.
  return {
    ...keepCopyConfig(own, { name: SCRIPT }),
    $schema: undefined,
    minify: undefined,
    main: join(PACKAGE, "dist", "worker.js"),
    no_bundle: true,
    workers_dev: found.kind === "account address",
    preview_urls: false,
    r2_buckets: [{ binding: "SITES", bucket_name: BUCKET }],
    d1_databases: [{ binding: "DB", database_name: INSTALL_OBJECTS.database, database_id: bound.databaseId }],
    vars: { ZONE: zone, ACCESS: bound.access, FIRST_SETTINGS: { ...LIVE_SETTINGS, logins: bound.login }, ACCOUNT_ID: run.accountId, WORKER_NAME: SCRIPT },
  };
}

/** Upload the built bundle with wrangler. None of its output is printed, and its log file goes into the scratch folder that is removed. */
async function deployWorker(run: Run, config: Record<string, unknown>): Promise<Stop | undefined> {
  const folder = mkdtempSync(join(tmpdir(), "poplin-live-deploy-"));

  try {
    const file = join(folder, "wrangler.json");
    writeFileSync(file, JSON.stringify(config));
    const wrangler = Bun.spawn([join(PACKAGE, "node_modules", ".bin", "wrangler"), "deploy", "--config", file], {
      cwd: PACKAGE,
      env: {
        ...process.env,
        CLOUDFLARE_API_TOKEN: run.connection.key,
        CLOUDFLARE_ACCOUNT_ID: run.accountId,
        WRANGLER_SEND_METRICS: "false",
        WRANGLER_WRITE_LOGS: "false",
        WRANGLER_LOG_PATH: folder,
        CI: "true",
      },
      stdout: "pipe",
      stderr: "pipe",
    });
    const [code, out, err] = await Promise.all([wrangler.exited, new Response(wrangler.stdout).text(), new Response(wrangler.stderr).text()]);
    if (code === 0) return undefined;

    // Wrangler's own words may name the zone, an account, or the token's holder, so only the error codes Cloudflare gave leave this function.
    const codes = [...new Set([...`${out}\n${err}`.matchAll(ERROR_CODE)].map((match) => match[1]))];
    if (codes.includes(NOT_AUTHENTICATED)) return { kind: "skipped", needs: "the token permission Workers Scripts: Edit" };

    return { kind: "failed", what: `wrangler deploy exited ${code} with codes ${codes.join(", ")}` };
  } finally {
    rmSync(folder, { recursive: true, force: true });
  }
}

/**
 * Say what a row the repair did not settle needs, in words that quote nothing Cloudflare said.
 *
 * @returns the lack of the account or the token, or `undefined` for a failure that is neither; an object the token has no optional permission for is a lack, never a failure
 */
export function needOf(row: DomainRow): string | undefined {
  if (row.state === "not-run") return "the repair to reach it: an earlier object was skipped";

  if (row.state === "left-out") return `the zone to allow it: ${row.detail.slice(row.detail.indexOf(": ") + 2)}`;

  // The Worker's login variable is read from the Access application, so it is missing wherever the application is.
  if (row.state === "missing" && (row.object.startsWith("Access") || row.object === "Worker variable")) return ACCESS_OFF;

  if (row.state === "optional") return `the token permission for the ${row.object}`;

  // An install answers without its Workflow: only a copy too large for one request needs it. One that was not made is a lack, which skips the check of that copy, and stops no run.
  if (row.object === "Workflow" && row.state === "failed") return NO_WORKFLOW;

  // Cloudflare refuses the bot settings of a plan that has none through the API, whatever the token may do.
  if (row.object === "Bot settings" && REFUSAL_STATUS.test(row.detail)) return "a plan whose bot settings the API can change";

  return NOT_PERMITTED.test(row.detail) ? `the token permission for the ${row.object}` : undefined;
}

/** What is told of a row the repair did not settle. Its detail may quote Cloudflare, which may name a person or the zone, so only the status of a refusal is kept. */
function unsettledResult(row: DomainRow): string {
  const refusal = REFUSAL_STATUS.exec(row.detail)?.[0];

  return refusal === undefined ? row.state : `${row.state} (${refusal})`;
}

/** Whether a row is the upload key's, of a key that was not there before the run: made by it, or not read. */
function isFreshKey(row: { readonly object: string; readonly state: string }): boolean {
  return row.object === UPLOAD_KEY && row.state !== "present";
}

/** Run the zone plug's repair, the same code the Domain tab runs, and sort its rows into the summary and the lacking things. */
async function repairZone(run: Run, found: Extract<Found, { readonly kind: "domain" }>, login: string, progress: Progress): Promise<Stop | undefined> {
  const logins = parseLogins([login]);
  if (!logins.ok) return { kind: "failed", what: "the first login is no email address" };

  const plug = createDomainPlug({ accountId: run.accountId, script: SCRIPT, layout: found.layout });
  const settings: DomainSettings = { logins: [...logins.value], outside_pages: "blocked", search_engines_allowed: false, block_bots: "auto" };
  const reading = await plug.repair(run.connection.key, async () => settings);
  if (!reading.ok) return { kind: "failed", what: `the zone plug refused the run (${reading.refusal})` };

  return sortRows(run, progress, reading.rows);
}

/** Sort the rows of a repair into the summary and the lacking things, and answer what stops the run. */
function sortRows(run: Run, progress: Progress, rows: readonly DomainRow[]): Stop | undefined {
  let failed: Stop | undefined;
  let skipped: Stop | undefined;

  // A key this run made is one the bucket refuses for its first minutes: the check of the way a file goes then counts on no direct ticket.
  if (rows.some(isFreshKey)) progress.missing["settled-upload-key"] ??= FRESH_KEY;

  for (const row of rows) {
    if (SETTLED.has(row.state)) {
      note(run, progress, { piece: row.object, result: row.state });
      continue;
    }

    const needs = needOf(row);
    const capability = CAPABILITIES[row.object];
    note(run, progress, { piece: row.object, result: unsettledResult(row), needs });

    if (needs === undefined) failed ??= { kind: "failed", what: `the ${row.object} is ${row.state}` };

    // A vital object the zone holds in another form is left out and may still answer: the wait for the install decides.
    if (needs !== undefined && VITAL.has(row.object) && row.state !== "left-out") skipped ??= { kind: "skipped", needs };

    if (needs !== undefined && capability !== undefined) progress.missing[capability] ??= needs;
  }

  // A failure anywhere outranks a skip: the rows come sorted, so an object that was never reached may stand before the one that failed.
  return failed ?? skipped;
}

/** Make the two forwarders of an install without a domain. A Worker of a forwarder's name that is not poplin's stops the run: the sites of its kind would answer nowhere. */
async function ensureForwarders(run: Run, layout: AccountAddresses, progress: Progress): Promise<Stop | undefined> {
  const synced = await syncForwarders(run.connection, run.accountId, layout, "apply");
  if (!synced.ok) return stopAt(run, progress, "Forwarders", synced, "Workers Scripts: Edit");

  note(run, progress, { piece: "Forwarders", result: countsOf(synced.report) });
  if (synced.report.skipped.length === 0) return undefined;

  return { kind: "failed", what: `${synced.report.skipped.length} of the 2 forwarders' names are held by a Worker without poplin's tag` };
}

/**
 * Give the Worker of an install without a domain the two keys it keeps, where it holds one that Cloudflare does not list as active and whole.
 *
 * The keys are read, made, and written by the piece the Domain tab's repair runs; a value goes from Cloudflare onto the Worker and is never printed. A token that may not make a key is a lack the suite skips for.
 */
async function ensureKeys(run: Run, progress: Progress): Promise<Stop | undefined> {
  const reading = await keysMended(run.connection, { script: SCRIPT, accountId: run.accountId, zoneId: undefined, key: undefined, uploadKeyId: undefined, now: undefined });

  return sortRows(run, progress, reading.rows);
}

/** Make the Worker's Workflow where the deploy left none, by the call the zone plug's repair makes. One that is not made is a lack the suite skips for, and stops no run. */
async function ensureJobs(run: Run, progress: Progress): Promise<void> {
  const synced = await syncJobs(run.connection, { accountId: run.accountId, script: SCRIPT }, "apply");
  const { created, changed, skipped } = synced.report;

  if (synced.ok && skipped.length === 0) {
    const kept = changed.length > 0 ? "changed" : "present";
    note(run, progress, { piece: "Workflow", result: created.length > 0 ? "created" : kept });

    return;
  }

  // Only the status of a refusal is told: Cloudflare's words may name the account.
  const refused = !synced.ok && synced.failure === "refused" ? ` (refused with status ${synced.status})` : "";
  note(run, progress, { piece: "Workflow", result: `${synced.ok ? "left out" : "failed"}${refused}`, needs: NO_WORKFLOW });
  progress.missing.jobs ??= NO_WORKFLOW;
}

/**
 * Make what an install without a domain adds to its deployed Worker: the two forwarders, the two keys it keeps, then its Workflow.
 *
 *  progress - gathers a row for each, and the things only a zone gives, whose checks the suite is told to skip
 *  what stopped the run, or `undefined`; a token that may not make the key stops nothing, and neither does a Workflow that was not made
 */
export async function settleFreeAddress(run: Run, layout: AccountAddresses, progress: Progress): Promise<Stop | undefined> {
  const stopped = (await ensureForwarders(run, layout, progress)) ?? (await ensureKeys(run, progress));
  if (stopped === undefined) await ensureJobs(run, progress);

  return stopped;
}

/** Make what the install's kind adds to its deployed Worker: the zone's objects by the Domain tab's repair, or the forwarders and the keys of an install without a domain. */
function settleKind(run: Run, found: Found, login: string, progress: Progress): Promise<Stop | undefined> {
  return found.kind === "domain" ? repairZone(run, found, login, progress) : settleFreeAddress(run, found.layout, progress);
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

/** Ask the install's API until it answers as a Worker that started: a 401 to a request with no token. */
async function waitUntilReady(found: Found): Promise<Stop | undefined> {
  const address = `https://${found.adminHost}/api/whoami`;
  const deadline = Date.now() + READY.withinMs;
  let last = { status: 0, told: "0" };

  while (Date.now() < deadline) {
    last = await answerOf(fetch(address, { redirect: "manual", signal: AbortSignal.timeout(READY.everyMs) }));
    if (last.status === 401) return undefined;

    await Bun.sleep(READY.everyMs);
  }

  return { kind: "failed", what: `the install did not answer within ${READY.withinMs / 1000} seconds (last status ${last.told})` };
}

/** Give the install its caps with a token made for the one call, and remove the token's row. A row that stays stops the run as caps that were refused do. */
async function capTestInstall(run: Run, found: Found, databaseId: string): Promise<Stop | undefined> {
  const token = await seedToken(run, databaseId, Date.now());
  if (typeof token !== "string") return token;

  const uncapped = await capInstall({ server: `https://${found.adminHost}`, token, fetch: sendLive });
  const kept = await removeTokens(run, databaseId, Date.now());

  return uncapped ?? kept;
}

/** Every step in order; answers what stopped the run, or `undefined` once the install answers. */
async function converge(run: Run, progress: Progress, env: Environment): Promise<Stop | undefined> {
  const found = await findInstall(run, env);
  if (isStop(found)) return found;

  note(run, progress, { piece: FOUND_AS[found.kind], result: "found" });

  const paid = await checkPlans(run, found, progress);
  if (paid !== undefined) return paid;

  const login = liveLogin(run, env) ?? NOBODY;
  const bucket = await ensureBucket(run);
  if (typeof bucket !== "string") return bucket;

  note(run, progress, { piece: "R2 bucket", result: bucket });

  const database = await syncDatabase(run.connection, run.accountId, "apply");
  if (!database.ok) return database.failure === "no-id" ? { kind: "failed", what: "Cloudflare named no database" } : stopOf(database, "D1: Edit");

  if (database.id === undefined) return { kind: "failed", what: "the database has no id" };

  run.hide(database.id);
  const settled = await settleDatabase(run, database.id);
  if (isStop(settled)) return settled;

  note(run, progress, { piece: "Database", result: settled.result });

  const access = await ensureAccess(run, found, login, progress);
  if (isStop(access)) return access;

  const deployed = await deployWorker(run, await workerConfig(run, found, { databaseId: settled.id, access, login }));
  if (deployed !== undefined) return deployed;

  note(run, progress, { piece: "Worker", result: "deployed" });

  const unready = (await settleKind(run, found, login, progress)) ?? (await waitUntilReady(found));
  if (unready !== undefined) return unready;

  const uncapped = await capTestInstall(run, found, settled.id);
  if (uncapped !== undefined) return uncapped;

  note(run, progress, { piece: "Storage and file caps", result: "set" });

  return undefined;
}

/**
 * Make the install match main, and tell the log, the step summary, and the step's output what came of it.
 *
 * @param env - where the zone's name and the login are read from: the same variables the run was opened from
 * @returns the exit code: 0 only once the install answers
 */
export async function convergeInstall(run: Run, env: Environment): Promise<number> {
  const progress: Progress = { pieces: [], missing: {} };
  const stopped = await converge(run, progress, env);
  const rows = progress.pieces.map((piece) => `| ${piece.piece} | ${piece.result} | ${piece.needs ?? ""} |`);

  run.summarize(["### The test install", "", "| Piece | Result | Skipped: needs |", "| --- | --- | --- |", ...rows, ""].join("\n"));
  run.output("missing", JSON.stringify(progress.missing));

  for (const [lacking, needs] of Object.entries(progress.missing)) run.annotate("warning", `The checks of ${lacking} are skipped: the install needs ${needs}.`);

  if (stopped !== undefined) return reportStop(run, stopped, "The test install could not be made ready");

  run.say("The test install answers.");

  return 0;
}

if (import.meta.main) process.exitCode = await convergeInstall(openRun(), process.env);
