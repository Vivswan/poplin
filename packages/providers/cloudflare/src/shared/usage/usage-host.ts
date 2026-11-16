// Cloudflare's side of the Usage screen: the free plan's limits no setting holds, the dashboard pages that show an account's own figures, and those figures where the install keeps a key that reads them.
//
//   line        Cloudflare's page                the free plan
//   requests    Workers & Pages                  100,000 requests a day
//   database    D1                               5,000,000 rows read and 100,000 rows written a day
//   storage     R2                               10 GB stored; 1,000,000 Class A and 10,000,000 Class B operations a month
//   requests    Workers & Pages                  10 ms of processing a request
//   database    D1                               500 MB a database, 5 GB an account
//   jobs        Workflows                        100 running at one time
//
// What Cloudflare counts reaches its figures about ten minutes later, which the screen says beside them.
// The figures are asked for only when the Usage screen is opened, never on a visitor's request, and an instance asks again after five minutes at the earliest, or once the UTC day changed.
// A reading that failed is kept for one minute, so a key just put right is tried again soon.

import type { Keyed } from "@poplin/app/src/console/key/records";
import type { HostFigures, UsageHost } from "@poplin/app/src/console/usage/records";
import type { RowsUsed } from "@poplin/core/src/database/database";
import { dayOf } from "@poplin/core/src/records/views";

import type { KeptKey } from "../install/key/kept-key";
import { readFigures } from "./figures";

/** Cloudflare's dashboard, which shows an account's pages under its id. */
const DASHBOARD = "https://dash.cloudflare.com";

/** How long an instance keeps the figures it read, and how long a reading that failed. */
const KEPT_MS = { figures: 300_000, failure: 60_000 } as const;

/** How far behind the moment Cloudflare's figures run: what it counts reaches them about ten minutes later. */
const BEHIND_MS = 600_000;

/** What Cloudflare's free plan takes without a bill of what the Usage screen shows. https://developers.cloudflare.com/workers/platform/limits/, /d1/platform/pricing/, /d1/platform/limits/, /r2/pricing/, and /workflows/reference/limits/ */
const FREE = {
  requestsPerDay: 100_000,
  rowsReadPerDay: 5_000_000,
  rowsWrittenPerDay: 100_000,
  storedBytes: 10_000_000_000,
  storageWritesPerMonth: 1_000_000,
  storageReadsPerMonth: 10_000_000,
  databaseBytes: 500_000_000,
  accountDatabaseBytes: 5_000_000_000,
  processingMs: 10,
  jobsAtOnce: 100,
} as const;

/** What the host's side is built from. */
interface Parts {
  /** The id of the account the Worker runs in, as its variable holds it. */
  readonly accountId: string;

  /** The rows D1 used on a UTC day that this instance counted and has not written to the day yet. */
  readonly unwrittenRows: (day: string) => RowsUsed;

  /** The bytes the install's database held when it last answered this instance; `undefined` before its first answer. */
  readonly databaseBytes: () => number | undefined;

  /** The name of the install's own Workflow, which runs its jobs. */
  readonly workflow: string;

  /** The install's kept key; `undefined` for an install that keeps none. */
  readonly key: KeptKey | undefined;
}

/** The reading an instance last began: when, and its answer once it is there. */
interface Reading {
  readonly at: number;
  readonly answer: Promise<Keyed<HostFigures>>;
  failed: boolean;
}

/** Whether a reading still stands at a moment: begun on the same UTC day, the figures' own, and no longer ago than its kind is kept. */
function stands(reading: Reading, now: number): boolean {
  return dayOf(reading.at) === dayOf(now) && now - reading.at < (reading.failed ? KEPT_MS.failure : KEPT_MS.figures);
}

/** Read the figures, or hand back the reading this instance began a short while ago, also while it is still on its way. An install without a key makes no call, so nothing is kept for it. */
function officialOf(parts: Parts): NonNullable<UsageHost["official"]> {
  let last: Reading | undefined;

  return (now) => {
    if (parts.key === undefined) return readFigures(parts, now);

    if (last !== undefined && stands(last, now)) return last.answer;

    const reading: Reading = { at: now, answer: readFigures(parts, now), failed: false };
    last = reading;
    void reading.answer.then((answer) => {
      reading.failed = !answer.ok;
    });

    return reading.answer;
  };
}

/**
 * Make Cloudflare's side of the Usage screen for one Worker instance.
 *
 * @returns the limits, the pages of the account `accountId` names, the rows this instance counted and has not written, the size of the database, and the reading of the figures with the kept key
 */
export function createUsageHost(parts: Parts): UsageHost {
  const account = `${DASHBOARD}/${parts.accountId}`;

  return {
    name: "Cloudflare",
    limits: FREE,
    links: { requests: `${account}/workers-and-pages`, database: `${account}/workers/d1`, storage: `${account}/r2/overview`, jobs: `${account}/workers/workflows` },
    behindMs: BEHIND_MS,
    databaseBytes: parts.databaseBytes,
    unwrittenRows: parts.unwrittenRows,
    official: officialOf(parts),
  };
}
