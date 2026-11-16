// Every thing the product does, held to a budget of database queries and of calls to the bucket.
// Drift: one request asked the database 51 questions where Cloudflare's Free plan answers 50, and no test knew what any request costs. A route that grows costly fails here, and a route with no budget cannot be added.

import { reset } from "cloudflare:test";
import type { Api } from "@poplin/app/src/api/api";
import { dataRoutes } from "@poplin/app/src/console/routes";
import { MOST_STORE_CALLS } from "@poplin/app/src/sites/serve";
import type { ExtractSchema } from "hono/types";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import guide from "../../../../docs/run/limits-and-cost.md?raw";
import { API_ROWS } from "./support/budget-rows-api";
import { CONSOLE_ROWS } from "./support/budget-rows-console";
import { ENTRY_ROWS } from "./support/budget-rows-entry";
import { PUBLISH_ROWS } from "./support/budget-rows-publish";
import { ACTION_COUNTS, type ActionCost, actionCosts } from "./support/budget-guide";
import { type Budget, type BudgetRow, type CostLine, costOf } from "./support/budget-stage";

/** One row per thing the product does. */
const ROWS: readonly BudgetRow[] = [...ENTRY_ROWS, ...CONSOLE_ROWS, ...PUBLISH_ROWS, ...API_ROWS];

/** The most queries a row may budget: D1 answers one invocation 50 on the Free plan, and 10 are left for a start of the instance and for what a change adds before anyone looks. */
const MOST_QUERIES = 40;

/** The most calls to the bucket one request may budget: the bound the product sets a copy, the request that makes the most. */
const MOST_STORE_CALLS_A_REQUEST = 250;

/** The most calls one scheduled run may budget: the bound the run sets itself, with the start of its instance. */
const MOST_RUN_CALLS = 300;

/** The most values D1 binds to one statement. */
const MOST_BOUND = 100;

/** Every route of the API by its path and then its method, as the app declares them. One the app declares and this leaves out does not compile, nor one it does not declare. */
const API_ROUTES: { readonly [Path in keyof Routes]: { readonly [Method in keyof Routes[Path]]: true } } = {
  "/api/whoami": { $get: true },
  "/api/token": { $delete: true },
  "/api/tokens": { $get: true, $post: true },
  "/api/tokens/:token": { $delete: true },
  "/api/logins": { $post: true },
  "/api/logins/token": { $post: true },
  "/api/sites": { $get: true },
  "/api/sites/:site": { $get: true, $patch: true, $delete: true },
  "/api/sites/:site/rollback": { $post: true },
  "/api/sites/:site/new-link": { $post: true },
  "/api/sites/:site/restore": { $post: true },
  "/api/sites/:site/duplicate": { $post: true },
  "/api/uploads": { $post: true },
  "/api/uploads/:upload": { $get: true, $delete: true },
  "/api/uploads/:upload/file": { $put: true },
  "/api/uploads/:upload/finish": { $post: true },
  "/api/export/settings": { $get: true },
  "/api/export/sites": { $get: true },
  "/api/export/sites/:site": { $get: true },
  "/api/export/sites/:site/files": { $get: true },
  "/api/export/sites/:site/file": { $get: true },
  "/api/import/settings": { $post: true },
  "/api/import/sites": { $post: true },
  "/api/config": { $get: true, $patch: true },
  "/api/sessions": { $delete: true },
  "/api/audit": { $get: true },
  "/api/domain": { $get: true },
  "/api/update": { $post: true },
  "/api/update/address": { $get: true, $put: true, $delete: true },
};

/** The heading of the guide's table of what an action costs. */
const GUIDE_HEADING = "## What one action costs";

/** A row of that table: the action, then its counts in the order of `ACTION_COUNTS`, a comma between the thousands. */
const GUIDE_ROW = /^\| ([^|]+?) +\| +([\d,]+) +\| +([\d,]+) +\| +([\d,]+) +\| +([\d,]+) +\| +([\d,]+) +\| +([\d,]+) +\|$/gm;

/** What the rows measured so far cost. */
const COSTS: CostLine[] = [];

/** Every route the app declares, by its path and then its method. */
type Routes = ExtractSchema<Api>;

/** Every route the API and the dashboard's data declare, as `METHOD path`, read from the code that answers them. */
function declaredRoutes(): string[] {
  const api = Object.entries(API_ROUTES).flatMap(([path, methods]) => Object.keys(methods).map((method) => `${method.slice(1).toUpperCase()} ${path}`));
  const data = dataRoutes.routes.filter((route) => route.method !== "ALL").map((route) => `${route.method} /data${route.path}`);

  return [...new Set([...api, ...data])].sort();
}

/** What each row of the guide's table states an action costs at the most: the action, then its counts. A row written twice is answered twice. */
function statedInGuide(): (readonly [action: string, cost: ActionCost])[] {
  const table = guide.slice(guide.indexOf(GUIDE_HEADING)).split("\n## ")[0] ?? "";

  return Array.from(table.matchAll(GUIDE_ROW), ([, action = "", ...counts]) => {
    const cost = Object.fromEntries(ACTION_COUNTS.map((count, at) => [count, Number((counts[at] ?? "").replaceAll(",", ""))])) as ActionCost;

    return [action, cost] as const;
  });
}

/** Whether what a row spends, or may spend, is over a ceiling: the queries of one invocation, the bucket calls of one request, every call of one run, or the bucket reads of one page view. A removal is a call, though R2 bills none. */
function overCeiling(row: BudgetRow, { queries, reads, writes, deletes = 0 }: Pick<Budget, "queries" | "reads" | "writes" | "deletes">): boolean {
  const stored = reads + writes + deletes;
  if (row.status === undefined) return queries > MOST_QUERIES || queries + stored > MOST_RUN_CALLS;

  return queries > MOST_QUERIES || stored > MOST_STORE_CALLS_A_REQUEST || (row.group === "One page view of a site" && reads > MOST_STORE_CALLS);
}

beforeEach(async () => {
  await reset();
});

// A row may pin what `Math.random` draws.
afterEach(() => {
  vi.restoreAllMocks();
});

describe("the budget of every request", () => {
  test.for(ROWS)("$name", async (row, { task }) => {
    task.meta.row = row.name;
    const cost = await costOf(row);
    const line: CostLine = { ...cost, group: row.group, name: row.name, budget: row.budget, ...(row.known === undefined ? {} : { known: row.known }), ...(row.guide === undefined ? {} : { guide: row.guide }) };
    COSTS.push(line);
    task.meta.cost = line;
    const spent = { queries: cost.queries, reads: cost.gets + cost.heads, writes: cost.puts + cost.lists, deletes: cost.deletes, read: cost.read, written: cost.written };
    // A row that budgets no removals may make none.
    const most: Budget = { deletes: 0, ...row.budget };
    const over = Object.entries(spent).filter(([what, count]) => count > (most[what as keyof typeof spent] ?? Number.POSITIVE_INFINITY));

    expect(cost.status).toBe(row.status);
    expect(over).toEqual([]);
    expect(cost.bound).toBeLessThanOrEqual(MOST_BOUND);
  });

  // Drift: a budget above a ceiling holds nothing, and a row marked as known to be above one stays marked after it was fixed, so the list of what is left to fix lies.
  test("no budget is over a ceiling, but for the rows marked as known to be, and each of those still measures over one", () => {
    const known = ROWS.filter((row) => row.known !== undefined).map((row) => row.name);
    const budgeted = ROWS.filter((row) => overCeiling(row, row.budget)).map((row) => row.name);
    const measured = ROWS.filter((row) => {
      const cost = COSTS.find((line) => line.name === row.name);

      return cost !== undefined && overCeiling(row, { queries: cost.queries, reads: cost.gets + cost.heads, writes: cost.puts + cost.lists, deletes: cost.deletes });
    }).map((row) => row.name);

    expect([budgeted, measured]).toEqual([known, known]);
  });

  // Drift: a route added to the API or to the dashboard's data with no row here ships with no budget at all.
  test("every route the API and the dashboard's data declare has a row, and every row's route is one they declare", () => {
    const declared = declaredRoutes();
    const budgeted = [...new Set(ROWS.flatMap((row) => (row.route === undefined ? [] : [row.route])))].sort();

    expect(declared.length).toBeGreaterThan(0);
    expect(budgeted).toEqual(declared);
  });

  // Drift: the guide tells a person what an action costs, and nothing ties its numbers to the code: one that grew costlier would leave the page stating less than the truth.
  test("the guide's table of what one action costs names the actions measured here, and states no number below what they cost", () => {
    const rows = statedInGuide();
    const stated = new Map(rows);
    const measured = actionCosts(COSTS);
    const short = Array.from(measured, ([action, cost]) => {
      const says = stated.get(action);
      const holds = says !== undefined && says.requests === cost.requests && ACTION_COUNTS.every((count) => says[count] >= cost[count]);

      return holds ? [] : [{ action, measured: cost, guide: says }];
    }).flat();

    expect(rows.map(([action]) => action).sort()).toEqual([...measured.keys()].sort());
    expect(short).toEqual([]);
  });
});
