// Make the standing test install match main: the bucket, the database, the login, the Worker, then every object of the zone as the Domain tab's own repair makes it.
//
//   the zone -> bucket, database -> the login application -> wrangler deploy of the built bundle -> the zone plug's repair -> wait for the install to answer
//
// It holds no state: every step reads what is there and changes what differs. A token that lacks a permission, or an account with a switch off, stops the piece it belongs to.
// Every piece is printed as it is settled. A piece nothing answers without stops the run as an error, whether it failed or the token lacks its permission.
// Step output: `missing` (a JSON object of what the install lacks and still answers without, each with its reason, for the live suite).

import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { DomainRow, DomainSettings } from "@poplin/app/src/dashboard/domain/records";
import { parseLogins } from "@poplin/core/src/auth/logins";
import { BaseBuckets } from "cloudflare/resources/r2/buckets/buckets";

import { isAccessOff, readLoginFacts, syncAccess } from "../../src/zone/access/access";
import { callCloudflare } from "../../src/zone/client";
import { syncDatabase } from "../../src/zone/database/database";
import { INSTALL_OBJECTS } from "../../src/zone/install-objects";
import { privateSitesPattern } from "../../src/zone/layout";
import { createDomainPlug } from "../../src/zone/zone-plug";
import { type Found, findInstall, isStop, liveLogin, openRun, type Run, reportStop, type Stop, stopOf } from "./util";

/** This package's folder. */
const PACKAGE = join(import.meta.dir, "..", "..");

/** The Worker's name on the test account. */
const SCRIPT = "poplin";

/** The bucket that holds the test install's sites. */
const BUCKET = "poplin-live-sites";

/** The login an install with no login of a person starts with: nobody can log in as it. */
const NOBODY = "owner@example.com";

/** The binding of an install with no login application: a team that does not exist, and an audience no token names. */
const NO_ACCESS = { team_domain: "access-off.invalid", audience: "0".repeat(64) };

/** The settings a live install starts with, where they differ from the defaults: a short trash, and room for the suite's own requests. */
const LIVE_SETTINGS = { dashboard_title: "poplin live checks", trash_days: "1", visitor_requests_per_minute: "120" };

/** How long the install has to answer after a deploy, and how often it is asked, in milliseconds. */
const READY = { withinMs: 300_000, everyMs: 5_000 };

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

/** What the live suite calls the thing each optional object gives. */
const CAPABILITIES: Readonly<Record<string, string>> = {
  "Redirect rule": "https-redirect",
  "WAF rule": "guard-rules",
  "Rate rule": "rate-rule",
  "Bot settings": "bot-block",
  "Access application": "access",
  "Access policy": "access",
};

/** An error code of Cloudflare's, as wrangler prints it. */
const ERROR_CODE = /\[code: (\d+)\]/g;

/** The code Cloudflare refuses a token with that lacks a permission. */
const NOT_AUTHENTICATED = "10000";

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

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

async function ensureBucket(run: Run): Promise<Stop | "created" | "present"> {
  const listed = await callCloudflare(run.connection, (api) => new BaseBuckets(api).list({ account_id: run.accountId, name_contains: BUCKET }));
  if (!listed.ok) return stopOf(listed, "Workers R2 Storage: Edit");

  if (listed.value.buckets?.some((bucket) => bucket.name === BUCKET) === true) return "present";

  const created = await callCloudflare(run.connection, (api) => new BaseBuckets(api).create({ account_id: run.accountId, name: BUCKET }));

  return created.ok ? "created" : stopOf(created, "Workers R2 Storage: Edit");
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

  const synced = await syncAccess(
    run.connection,
    run.accountId,
    { hostname: found.layout.adminHostname, logins: logins.value, privateSites: privateSitesPattern(found.layout) },
    "apply",
  );
  if (!synced.ok && isAccessOff(synced)) return skip(ACCESS_OFF);

  if (!synced.ok) return stopped(stopOf(synced, "Access: Apps and Policies: Edit"));

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

/** The Worker's configuration for the test install: the repository's own, with the test account's id, bucket, database, zone, and login. */
async function workerConfig(run: Run, found: Found, bound: { readonly databaseId: string; readonly access: AccessBinding; readonly login: string }): Promise<Record<string, unknown>> {
  const base: unknown = Bun.JSONC.parse(await Bun.file(join(PACKAGE, "..", "..", "wrangler.jsonc")).text());
  if (!isRecord(base)) throw new Error("wrangler.jsonc holds no configuration");

  return {
    ...base,
    $schema: undefined,
    name: SCRIPT,
    main: join(PACKAGE, "dist", "worker.js"),
    no_bundle: true,
    workers_dev: false,
    preview_urls: false,
    r2_buckets: [{ binding: "SITES", bucket_name: BUCKET }],
    d1_databases: [{ binding: "DB", database_name: INSTALL_OBJECTS.database, database_id: bound.databaseId }],
    vars: { ZONE: { domain: found.layout.domain }, ACCESS: bound.access, FIRST_SETTINGS: { ...LIVE_SETTINGS, logins: bound.login }, ACCOUNT_ID: run.accountId, WORKER_NAME: SCRIPT },
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

  // Cloudflare refuses the bot settings of a plan that has none through the API, whatever the token may do.
  if (row.object === "Bot settings" && REFUSAL_STATUS.test(row.detail)) return "a plan whose bot settings the API can change";

  return NOT_PERMITTED.test(row.detail) ? `the token permission for the ${row.object}` : undefined;
}

/** What is told of a row the repair did not settle. Its detail may quote Cloudflare, which may name a person or the zone, so only the status of a refusal is kept. */
function unsettledResult(row: DomainRow): string {
  const refusal = REFUSAL_STATUS.exec(row.detail)?.[0];

  return refusal === undefined ? row.state : `${row.state} (${refusal})`;
}

/** Run the zone plug's repair, the same code the Domain tab runs, and sort its rows into the summary and the lacking things. */
async function repairZone(run: Run, found: Found, login: string, progress: Progress): Promise<Stop | undefined> {
  const logins = parseLogins([login]);
  if (!logins.ok) return { kind: "failed", what: "the first login is no email address" };

  const plug = createDomainPlug({ accountId: run.accountId, script: SCRIPT, layout: found.layout });
  const settings: DomainSettings = { logins: [...logins.value], outside_pages: "blocked", search_engines_allowed: false, block_bots: "auto" };
  const reading = await plug.repair(run.connection.key, async () => settings);
  if (!reading.ok) return { kind: "failed", what: `the zone plug refused the run (${reading.refusal})` };

  let failed: Stop | undefined;
  let skipped: Stop | undefined;

  for (const row of reading.rows) {
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

/** Ask the install's API until it answers as a Worker that started: a 401 to a request with no token. */
async function waitUntilReady(found: Found): Promise<Stop | undefined> {
  const address = `https://${found.layout.adminHostname}/api/whoami`;
  const deadline = Date.now() + READY.withinMs;
  let status = 0;

  while (Date.now() < deadline) {
    status = await fetch(address, { redirect: "manual", signal: AbortSignal.timeout(READY.everyMs) }).then(
      (response) => response.status,
      () => 0,
    );
    if (status === 401) return undefined;

    await Bun.sleep(READY.everyMs);
  }

  return { kind: "failed", what: `the install did not answer within ${READY.withinMs / 1000} seconds (last status ${status})` };
}

/** Every step in order; answers what stopped the run, or `undefined` once the install answers. */
async function converge(run: Run, progress: Progress, env: Environment): Promise<Stop | undefined> {
  const found = await findInstall(run, env);
  if (isStop(found)) return found;

  note(run, progress, { piece: "Zone", result: "found" });

  const login = liveLogin(run, env) ?? NOBODY;
  const bucket = await ensureBucket(run);
  if (typeof bucket !== "string") return bucket;

  note(run, progress, { piece: "R2 bucket", result: bucket });

  const database = await syncDatabase(run.connection, run.accountId, "apply");
  if (!database.ok) return database.failure === "no-id" ? { kind: "failed", what: "Cloudflare named no database" } : stopOf(database, "D1: Edit");

  if (database.id === undefined) return { kind: "failed", what: "the database has no id" };

  run.hide(database.id);
  note(run, progress, { piece: "Database", result: "present" });

  const access = await ensureAccess(run, found, login, progress);
  if (isStop(access)) return access;

  const deployed = await deployWorker(run, await workerConfig(run, found, { databaseId: database.id, access, login }));
  if (deployed !== undefined) return deployed;

  note(run, progress, { piece: "Worker", result: "deployed" });

  return (await repairZone(run, found, login, progress)) ?? (await waitUntilReady(found));
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
