// The ceilings of the free-plan budget: what an action is counted by, the limit of Cloudflare's free plan it falls under, and the line poplin draws under that limit.
//
//   counted                                Cloudflare counts it as
//   the database queries of a request      D1: the queries of one invocation
//   the database queries of a run          the same
//   the bucket calls of a request          Workers: the subrequests of one invocation to Cloudflare's own services
//   the bucket reads of a page view        the same
//   every call of a run                    the same, for its database queries and its bucket calls together; D1 holds the queries among them to its own limit too
//   the rows read, the rows written        D1: the rows of a day
//
// The budget test holds every action under them (tests/shared/worker/request-budget.test.ts), and the job's report shows both limits of each (scripts/free-plan-budget.ts).

import { MOST_STORE_CALLS } from "@poplin/app/src/sites/serve";

import { CLOUDFLARE_FREE, type PlanLimit } from "./free-limits";

/** The most queries a request or a run may budget: 10 under D1's limit are left for a start of the instance and for what a change adds before anyone looks. */
const MOST_QUERIES = 40;

/** The most calls to the bucket one request may budget: the bound the product sets a copy, the request that makes the most. */
const MOST_STORE_CALLS_A_REQUEST = 250;

/** The most calls one scheduled run may budget: the bound the run sets itself, with the start of its instance. */
const MOST_RUN_CALLS = 300;

/** Every ceiling, by the name the report shows it under. */
export const CEILINGS = {
  "Database queries, one request": { cloudflare: CLOUDFLARE_FREE.queriesAnInvocation, own: MOST_QUERIES },
  "Database queries, one scheduled run": { cloudflare: CLOUDFLARE_FREE.queriesAnInvocation, own: MOST_QUERIES },
  "Bucket calls, one request": { cloudflare: CLOUDFLARE_FREE.serviceCallsAnInvocation, own: MOST_STORE_CALLS_A_REQUEST },
  "Bucket reads, one page view": { cloudflare: CLOUDFLARE_FREE.serviceCallsAnInvocation, own: MOST_STORE_CALLS, exact: true },
  "Every call, one scheduled run": { cloudflare: CLOUDFLARE_FREE.serviceCallsAnInvocation, own: MOST_RUN_CALLS },
  "Rows read, of one day's": { cloudflare: CLOUDFLARE_FREE.rowsReadADay },
  "Rows written, of one day's": { cloudflare: CLOUDFLARE_FREE.rowsWrittenADay },
} as const satisfies Record<string, Ceiling>;

/** One ceiling of the budget. */
export interface Ceiling {
  /** What Cloudflare's free plan allows. */
  readonly cloudflare: PlanLimit;

  /** The line poplin draws under that; left out where it draws none, and Cloudflare's limit is the ceiling. */
  readonly own?: number;

  /** Set for a line an action may spend in full by design: at its most it is near no ceiling, and over it is broken like any other. */
  readonly exact?: true;
}

/** The limit a ceiling holds an action to, and whose it is: poplin's own line where it draws one, else Cloudflare's limit. */
export function heldTo({ cloudflare, own }: Ceiling): { readonly most: number; readonly whose: "poplin's own" | "Cloudflare's" } {
  return own === undefined ? { most: cloudflare.most, whose: "Cloudflare's" } : { most: own, whose: "poplin's own" };
}
