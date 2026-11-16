// Run the live suite against the standing test install of the run's account: make this run's token, run the tests as a child, and remove the token.
//
// The child gets the install's domain, or the account's name in its free address for an install without a domain, the poplin token, and the login in its environment,
// and the Cloudflare key and account: one check reads the login list with them, and one a job. Every line it prints passes through here with the hidden values taken out.
// Argument: the JSON object of what the install lacks, as the converge step answered it.

import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createInterface } from "node:readline";
import { Readable } from "node:stream";

import { findDatabase, removeTokens, seedToken } from "./tokens";
import { type Found, findInstall, isStop, liveLogin, openRun, type Run, reportStop, type Stop } from "./util";

/** The repository's folder. */
const ROOT = join(import.meta.dir, "..", "..", "..", "..", "..");

/** The variables of this process the child keeps: where its tools are, the suite's two switches, and nothing of the account. */
const KEPT = ["PATH", "HOME", "TMPDIR", "RUNNER_TEMP", "CI", "LANG", "POPLIN_LIVE_MANY_FILES", "POPLIN_LIVE_LOAD"];

/** The event of the workflow's run at midnight, as GitHub names it to every step. */
const MIDNIGHT = "schedule";

/** Print what a stream holds, a whole line at a time, with every hidden value taken out. */
async function relay(run: Run, stream: ReadableStream<Uint8Array>): Promise<void> {
  for await (const line of createInterface({ input: Readable.from(stream) })) run.say(line);
}

/** Whether this run copies a site too large for one request: the run of each midnight, and one started by hand with the many-files check. Every other run leaves it out, since it costs over two hundred writes to the bucket. */
function copiesByJob(env: Readonly<Record<string, string | undefined>>): boolean {
  return env.GITHUB_EVENT_NAME === MIDNIGHT || env.POPLIN_LIVE_MANY_FILES === "1";
}

/** Run the tests as a child and answer its exit code, with the table of outcomes added to the summary. */
async function runTests(run: Run, found: Found, token: string, missing: string): Promise<number> {
  const folder = mkdtempSync(join(tmpdir(), "poplin-live-report-"));
  const report = join(folder, "outcomes.md");
  const kept = Object.fromEntries(KEPT.flatMap((name) => (process.env[name] === undefined ? [] : [[name, process.env[name]]])));
  const login = liveLogin(run);

  try {
    const child = Bun.spawn([process.execPath, "test", "./packages/providers/cloudflare/live/live.test.ts"], {
      cwd: ROOT,
      env: {
        ...kept,
        POPLIN_LIVE: "1",
        // The suite writes every address of the install from the one name its kind has: the domain, or the account's name in its free address.
        ...(found.kind === "domain" ? { POPLIN_LIVE_DOMAIN: found.layout.domain } : { POPLIN_LIVE_ACCOUNT_ADDRESS: found.layout.account }),
        POPLIN_LIVE_TOKEN: token,
        ...(login === undefined ? {} : { POPLIN_LIVE_LOGIN: login }),
        POPLIN_LIVE_RUN: run.id,
        POPLIN_LIVE_MISSING: missing,
        POPLIN_LIVE_REPORT: report,
        POPLIN_LIVE_JOB_COPY: copiesByJob(process.env) ? "1" : "0",
        // The check of the users reads Cloudflare's login list itself. Every line the child prints passes `relay`, which takes the key out.
        CLOUDFLARE_API_TOKEN: run.connection.key,
        CLOUDFLARE_ACCOUNT_ID: run.accountId,
      },
      stdout: "pipe",
      stderr: "pipe",
    });
    const [code] = await Promise.all([child.exited, relay(run, child.stdout), relay(run, child.stderr)]);
    run.summarize(`### The live checks\n\n${existsSync(report) ? readFileSync(report, "utf8") : "The tests ended before they wrote their outcomes."}`);

    return code;
  } finally {
    rmSync(folder, { recursive: true, force: true });
  }
}

/** Every step in order; answers the exit code of the tests, or what stopped the run before them. */
async function runSuite(run: Run, missing: string): Promise<number | Stop> {
  const found = await findInstall(run);
  if (isStop(found)) return found;

  const database = await findDatabase(run);
  if (database === undefined) return { kind: "skipped", needs: "the install's database, which the converge step makes" };

  if (typeof database !== "string") return database;

  const swept = await removeTokens(run, database, Date.now());
  if (swept !== undefined) return swept;

  const token = await seedToken(run, database, Date.now());
  if (typeof token !== "string") return token;

  try {
    return await runTests(run, found, token, missing);
  } finally {
    await removeTokens(run, database, Date.now());
  }
}

const run = openRun();
const ended = await runSuite(run, process.argv[2] ?? "{}");

process.exitCode = typeof ended === "number" ? ended : reportStop(run, ended, "The live checks could not start");
