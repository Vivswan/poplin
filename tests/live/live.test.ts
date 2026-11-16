// The live suite: every check against a deployed install, over HTTPS. It runs only with POPLIN_LIVE=1, and is told the install by the environment:
//
//   POPLIN_LIVE_DOMAIN    the install's domain
//   POPLIN_LIVE_TOKEN     an admin's token of the install; absent, the checks that need one are skipped
//   POPLIN_LIVE_LOGIN     a login the install is told to let in; absent, its logins stay as they are
//   POPLIN_LIVE_MANY_FILES  1 to publish two thousand small files; any other value skips that check
//   POPLIN_LIVE_RUN       what tells this run's sites from another's; `local` when absent
//   POPLIN_LIVE_MISSING   a JSON object of what the install is known to lack, each with its reason
//   POPLIN_LIVE_REPORT    a file that receives the table of outcomes
//   CLOUDFLARE_API_TOKEN, CLOUDFLARE_ACCOUNT_ID   the key and the account the login list is read with at Cloudflare; absent, the check of the users is skipped
//
// On an install with a token, the suite first sets the two settings it counts on: `trash_days` and `visitor_requests_per_minute`.
// Every request passes two meters: the bucket writes and lists it asks for, and the rows it makes the database write. A request past either ceiling is held back, and the run ends red with one line that says which.
// Nothing here prints the domain, the token, or the login: a failure names the check and what was expected.

import { afterAll, beforeAll, describe, test } from "bun:test";
import { writeFileSync } from "node:fs";

import { CEILINGS, meterBucket } from "../../packages/cloudflare/scripts/live/budget";
import { readLoginList } from "../../packages/cloudflare/scripts/live/login-list";
import { meterRows, ROW_CEILINGS } from "../../packages/cloudflare/scripts/live/rows";
import { openBench } from "./bench";
import { probeMissing } from "./capabilities";
import { CHECKS } from "./checks";
import type { Missing, Outcome } from "./records";
import { outcomeTable, runCheck } from "./report";

/** Whether the suite runs at all. */
const LIVE = process.env.POPLIN_LIVE === "1";

/** How long one check may take: the publish of many files is thousands of requests, and the burst waits out the rate rule's block. */
const CHECK_TIMEOUT_MS = 900_000;

/** How many files the publish of many small files holds. */
const MANY_FILES = 2000;

/** Why the publish of many small files is skipped: it costs a run thousands of requests. */
const NOT_ASKED = "a run started by hand with the many-files check switched on (POPLIN_LIVE_MANY_FILES=1)";

/** Why the check of the users is skipped on a run that cannot read Cloudflare's list. */
const NO_PROVIDER_KEY = "CLOUDFLARE_API_TOKEN and CLOUDFLARE_ACCOUNT_ID, to read the login list at Cloudflare";

/** Why the checks that need a token are skipped when the run has none. */
const NO_TOKEN = "an admin token of the install in POPLIN_LIVE_TOKEN";

function setting(name: string): string | undefined {
  const value = process.env[name];

  return value === undefined || value === "" ? undefined : value;
}

/** The key and the account the run reads Cloudflare with, where it was given both. */
function providerOf(): { readonly key: string; readonly accountId: string } | undefined {
  const [key, accountId] = [setting("CLOUDFLARE_API_TOKEN"), setting("CLOUDFLARE_ACCOUNT_ID")];

  return key === undefined || accountId === undefined ? undefined : { key, accountId };
}

/** What the run already knows the install to lack. */
function knownMissing(): Missing {
  const known: Missing = JSON.parse(setting("POPLIN_LIVE_MISSING") ?? "{}");
  if (setting("POPLIN_LIVE_TOKEN") === undefined) known.token = NO_TOKEN;

  if (setting("POPLIN_LIVE_MANY_FILES") !== "1") known["many-files"] = NOT_ASKED;

  if (providerOf() === undefined) known["login-list"] = NO_PROVIDER_KEY;

  return known;
}

describe.skipIf(!LIVE)("a deployed install", () => {
  const missing: Missing = {};
  const outcomes: Outcome[] = [];
  // A request past the ceiling of bucket writes and lists is held back, which fails its check, and the run says so in one line.
  const meter = meterBucket((input, init) => fetch(input, init), setting("POPLIN_LIVE_MANY_FILES") === "1" ? CEILINGS.manyFiles : CEILINGS.checks);
  const rows = meterRows(meter.fetch, ROW_CEILINGS.checks);
  const provider = providerOf();
  const opened = LIVE
    ? openBench({
        domain: setting("POPLIN_LIVE_DOMAIN") ?? "",
        token: setting("POPLIN_LIVE_TOKEN"),
        run: setting("POPLIN_LIVE_RUN") ?? "local",
        missing,
        login: setting("POPLIN_LIVE_LOGIN"),
        fetch: rows.fetch,
        pause: (ms) => Bun.sleep(ms),
        now: () => Date.now(),
        say: (line) => console.log(line),
        manyFiles: MANY_FILES,
        loginList: provider === undefined ? undefined : () => readLoginList({ key: provider.key }, provider.accountId),
      })
    : undefined;

  beforeAll(async () => {
    if (opened === undefined) return;

    if (opened.bench.domain === "") throw new Error("POPLIN_LIVE_DOMAIN is not set");

    Object.assign(missing, await probeMissing(opened.bench, knownMissing()));
    await opened.settle();
    await opened.sweep();
  }, CHECK_TIMEOUT_MS);

  afterAll(async () => {
    const report = setting("POPLIN_LIVE_REPORT");
    if (report !== undefined) writeFileSync(report, outcomeTable(outcomes));

    // A meter that stopped the run holds back the sweep's removals too, so the sweep then fails: the stop is what the run says, and the reset removes what is left.
    const swept = await Promise.resolve(opened?.sweep()).then(
      () => undefined,
      (error: unknown) => ({ error }),
    );
    opened?.close();
    console.log(`Bucket writes and lists the checks asked for: ${meter.spent()}`);
    console.log(`Rows written this run: ${rows.written()} of at most ${ROW_CEILINGS.checks}`);

    const stopped = meter.stopped() ?? rows.stopped();
    if (stopped === undefined && swept !== undefined) throw swept.error;

    if (stopped === undefined) return;

    console.log(`::error::The live checks ${stopped}.`);
    throw new Error(`The live checks ${stopped}.`);
  }, CHECK_TIMEOUT_MS);

  for (const check of CHECKS) {
    test(
      `${check.id}: ${check.name}`,
      async () => {
        if (opened === undefined) return;

        let failure: unknown;
        const outcome = await runCheck(opened.bench, check, (error) => {
          failure = error;
        });
        outcomes.push(outcome);
        if (outcome.result === "skipped") console.log(`skipped ${check.id}: needs ${outcome.reason}`);

        if (failure !== undefined) throw failure;
      },
      CHECK_TIMEOUT_MS,
    );
  }
});
