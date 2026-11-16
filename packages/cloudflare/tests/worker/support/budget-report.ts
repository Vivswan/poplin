// Shows what every row of the budget table cost, once the run ends: as tables on the terminal, as the job's summary on GitHub, and as a JSON file where the run names one.
//
//   always                               the actions a person does, then a table a group, printed
//   GITHUB_STEP_SUMMARY is set           the same tables, added to the job's summary
//   ACTION_COSTS_FILE names a file       every row as JSON, and the rows whose test failed before measuring, for a later run to compare against

import { writeFileSync } from "node:fs";
import { summary } from "@actions/core";
import type { Reporter, TestCase } from "vitest/node";
import { actionCosts } from "./budget-guide";
import type { CostLine, Group } from "./budget-stage";

/** The groups in the order a person reads them. */
const GROUPS: readonly Group[] = ["One page view of a site", "Each dashboard screen", "Publishing", "CLI / agent actions", "Background work"];

/** The heading of the summary. */
const TITLE = "What each action costs";

/** What the summary says under its heading. */
const LEAD = "Measured on the local Workers runtime with the real database driver. Cloudflare's free plan answers one request 50 database queries; a request here may spend 40.";

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

  onTestCaseResult(testCase: TestCase): void {
    const { row, cost } = testCase.meta();
    if (cost !== undefined) this.#lines.push(cost);
    else if (row !== undefined) this.#unmeasured.push(row);
  }

  async onTestRunEnd(): Promise<void> {
    if (this.#lines.length + this.#unmeasured.length === 0) return;

    const tables = tablesOf(this.#lines);
    for (const { heading, rows } of tables) {
      console.log(`\n${heading}`);
      console.table(rows);
    }

    const file = process.env.ACTION_COSTS_FILE ?? "";
    if (file !== "") writeFileSync(file, `${JSON.stringify({ rows: this.#lines, unmeasured: this.#unmeasured }, null, 2)}\n`);

    if ((process.env.GITHUB_STEP_SUMMARY ?? "") === "") return;

    summary.addHeading(TITLE, 2).addRaw(LEAD, true);
    for (const { heading, rows } of tables) {
      const head = Object.keys(rows[0] ?? {}).map((data) => ({ data, header: true }));
      summary.addHeading(heading, 3).addTable([head, ...rows.map((row) => Object.values(row).map(String))]);
    }

    await summary.write();
  }
}
