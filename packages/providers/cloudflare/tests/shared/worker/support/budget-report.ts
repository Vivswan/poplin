// Shows what every row of the budget table cost, once the run ends: as tables on the terminal, and as a JSON file where the run names one.
//
//   always                               the actions a person does, then a table a group, printed
//   FREE_PLAN_BUDGET_FILE names a file   every row as JSON, the rows whose test failed before measuring, and the actions: what scripts/free-plan-budget.ts writes a job's summary from

import { writeFileSync } from "node:fs";
import type { Reporter, TestCase } from "vitest/node";
import { actionCosts } from "./budget-guide";
import type { CostLine, Group } from "./budget-stage";

/** The groups in the order a person reads them. */
const GROUPS: readonly Group[] = ["One page view of a site", "Each dashboard screen", "Publishing", "CLI / agent actions", "Background work"];

/** The heading of the first table: the actions the guide names, each with what its requests cost together. */
const ACTIONS = "What a person does";

/** One table: its heading, and its rows under plain column names. */
interface Table {
  readonly heading: string;
  readonly rows: readonly Readonly<Record<string, string | number>>[];
}

/** One row as a table shows it. */
function shown(line: CostLine): Table["rows"][number] {
  return {
    Action: line.name,
    "Database queries": line.queries,
    "Most allowed": line.budget.queries,
    "Rows read": line.read,
    "Rows written": line.written,
    "Storage reads": line.gets + line.heads,
    "Storage writes": line.puts,
    "Storage lists": line.lists,
    "Storage deletes": line.deletes,
    "About ms": line.ms,
    Note: line.known ?? "",
  };
}

/** The tables of a run: the actions a person does first, then every row by its group. A group no row of the run is in has no table. */
function tablesOf(lines: readonly CostLine[]): Table[] {
  const actions = Array.from(actionCosts(lines), ([action, cost]) => ({
    Action: action,
    Requests: cost.requests,
    "Database queries": cost.queries,
    "Rows read": cost.read,
    "Rows written": cost.written,
    "Storage reads": cost.reads,
    "Storage writes and lists": cost.writes,
  }));
  const groups = GROUPS.map((group) => ({ heading: group, rows: lines.filter((line) => line.group === group).map(shown) }));

  return [{ heading: ACTIONS, rows: actions }, ...groups].filter((table) => table.rows.length > 0);
}

/** A Vitest reporter that gathers the cost each budget test kept on itself, and shows them together. */
export class BudgetReport implements Reporter {
  /** What each row that was measured cost. */
  readonly #lines: CostLine[] = [];

  /** The rows whose test failed before it had measured them. */
  readonly #unmeasured: string[] = [];

  // A watched run starts again on the same reporter: what the run before it measured is not this run's.
  onTestRunStart(): void {
    this.#lines.length = 0;
    this.#unmeasured.length = 0;
  }

  onTestCaseResult(testCase: TestCase): void {
    const { row, cost } = testCase.meta();
    if (cost !== undefined) this.#lines.push(cost);
    else if (row !== undefined) this.#unmeasured.push(row);
  }

  onTestRunEnd(): void {
    if (this.#lines.length + this.#unmeasured.length === 0) return;

    const tables = tablesOf(this.#lines);
    for (const { heading, rows } of tables) {
      console.log(`\n${heading}`);
      console.table(rows);
    }

    const file = process.env.FREE_PLAN_BUDGET_FILE ?? "";
    const actions = tables.find(({ heading }) => heading === ACTIONS)?.rows ?? [];
    if (file !== "") writeFileSync(file, `${JSON.stringify({ rows: this.#lines, unmeasured: this.#unmeasured, actions }, null, 2)}\n`);
  }
}
