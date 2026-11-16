// Compare what each action cost on this run with the newest run on main, for the one comment a pull request keeps.
//
//   this run's costs      ACTION_COSTS_FILE, written by the budget test's reporter
//   main's costs          the `action-costs` artifact of the newest run of this workflow on main that ended green
//   the comment           COMMENT_FILE: the rows that changed as `old -> new`, or that none did, and every row over its budget
//   the job's summary     the same text, added after the tables the test wrote
//
// The arrows are HTML entities, so this file holds plain ASCII and GitHub draws them.

import { existsSync, mkdtempDisposableSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { summary } from "@actions/core";
import * as v from "valibot";

/** The name of the artifact a run keeps its costs in, and of the file in it. */
const ARTIFACT = { name: "action-costs", file: "action-costs.json" } as const;

/** The workflow whose runs on main hold the costs to compare with. */
const WORKFLOW = "action-costs.yml";

/** What the comment opens with. */
const TITLE = "What each action costs";

/** The arrows of a change, as GitHub draws them. */
const ARROW = { to: "&rarr;", up: "&uarr;", down: "&darr;" } as const;

/** What the comment says in place of a comparison when main's costs are not there to compare with. */
const NO_COMPARISON = {
  none: "No run on main to compare with yet.",
  unread: "The costs of the newest run on main could not be read, so nothing is compared.",
} as const;

/** What a row is compared by, each under the name its column carries. */
const COUNTS = {
  "Database queries": (row: Row) => row.queries,
  "Rows read": (row: Row) => row.read,
  "Rows written": (row: Row) => row.written,
  "Storage reads": (row: Row) => row.gets + row.heads,
  "Storage writes": (row: Row) => row.puts,
  "Storage lists": (row: Row) => row.lists,
} as const;

/** A whole number that is no less than zero. */
const COUNT = v.pipe(v.number(), v.integer(), v.minValue(0));

/** One row of a run's costs, as far as a comparison reads it. */
const ROW = v.object({
  name: v.string(),
  queries: COUNT,
  read: COUNT,
  written: COUNT,
  gets: COUNT,
  heads: COUNT,
  puts: COUNT,
  lists: COUNT,
  budget: v.object({ queries: COUNT, read: v.optional(COUNT), written: v.optional(COUNT), reads: COUNT, writes: COUNT }),
  known: v.optional(v.string()),
});

/** The costs of one run: every row that was measured, and the name of every row whose test failed before it was. */
const COSTS = v.object({ rows: v.array(ROW), unmeasured: v.array(v.string()) });

/** One row of a run's costs. */
type Row = v.InferOutput<typeof ROW>;

/** The costs of one run. */
type Costs = v.InferOutput<typeof COSTS>;

/** What a comparison is written from. */
interface Compared {
  /** The costs of this run. */
  readonly now: Costs;

  /** The rows of the newest green run on main; `none` while main has no such run, and `unread` when its costs could not be had. */
  readonly main: readonly Row[] | keyof typeof NO_COMPARISON;

  /** The address of this run, where the job's summary holds every row. */
  readonly run: string;
}

/** One cell of a changed row: the count alone when it stayed, else the old and the new with the way it went. */
function cell(before: number, after: number): string {
  if (before === after) return String(after);

  return `${before} ${ARROW.to} <b>${after}</b> ${after > before ? ARROW.up : ARROW.down}`;
}

/** What a row is over, in words; empty for a row inside its budget. */
function overBudget(row: Row): string {
  const over = [
    ...(row.queries > row.budget.queries ? [`${row.queries} database queries, budget ${row.budget.queries}`] : []),
    ...(row.read > (row.budget.read ?? row.read) ? [`${row.read} rows read, budget ${row.budget.read}`] : []),
    ...(row.written > (row.budget.written ?? row.written) ? [`${row.written} rows written, budget ${row.budget.written}`] : []),
    ...(row.gets + row.heads > row.budget.reads ? [`${row.gets + row.heads} storage reads, budget ${row.budget.reads}`] : []),
    ...(row.puts + row.lists > row.budget.writes ? [`${row.puts + row.lists} storage writes and lists, budget ${row.budget.writes}`] : []),
  ];

  return over.join("; ");
}

/** The rows that differ from main's, each as the cells of a table's row, with the rows main does not hold and the ones it alone holds. A row this run did not measure is none of them. */
function changes(now: Costs, main: readonly Row[]): string[][] {
  const before = new Map(main.map((row) => [row.name, row]));
  const names = Object.keys(COUNTS) as (keyof typeof COUNTS)[];
  const changed = now.rows.flatMap((row) => {
    const was = before.get(row.name);
    if (was === undefined) return [[`${row.name} (new)`, ...names.map((name) => String(COUNTS[name](row)))]];

    return names.some((name) => COUNTS[name](was) !== COUNTS[name](row)) ? [[row.name, ...names.map((name) => cell(COUNTS[name](was), COUNTS[name](row)))]] : [];
  });
  const held = new Set([...now.rows.map((row) => row.name), ...now.unmeasured]);
  const gone = main.filter((row) => !held.has(row.name)).map((row) => [`${row.name} (gone)`, ...names.map(() => "-")]);

  return [...changed, ...gone];
}

/**
 * Write the comment of a run, as the summary a step of the job adds to.
 *
 * @returns HTML, which GitHub draws in a comment and in a summary alike: the rows that changed against main, the rows not measured, every row over its budget or known to be over a ceiling, and where the whole table is
 */
export function costsComment({ now, main, run }: Compared): string {
  const head = ["Action", ...Object.keys(COUNTS)].map((data) => ({ data, header: true }));
  const changed = typeof main === "string" ? [] : changes(now, main);
  const over = now.rows.flatMap((row) => (overBudget(row) === "" ? [] : [`<b>${row.name}</b> is over its budget: ${overBudget(row)}`]));
  const known = now.rows.flatMap((row) => (row.known === undefined ? [] : [`${row.name}: ${row.queries} database queries. ${row.known}`]));
  summary.emptyBuffer().addHeading(TITLE, 3);

  if (typeof main === "string") summary.addRaw(NO_COMPARISON[main], true);
  else if (changed.length === 0) summary.addRaw("No change against main.", true);
  else summary.addTable([head, ...changed]);

  if (now.unmeasured.length > 0) summary.addRaw("Not measured, since its test failed first:", true).addList([...now.unmeasured]);

  if (over.length > 0) summary.addList(over);

  if (known.length > 0) summary.addRaw("Known to be over a ceiling:", true).addList(known);

  return summary.addRaw("Every action: ").addLink("the summary of this run", run).stringify();
}

/** Read the costs a file holds. */
function readCosts(file: string): Costs {
  return v.parse(COSTS, JSON.parse(readFileSync(file, "utf8")));
}

/** Run `gh` and answer what it printed, or `undefined` when it failed. */
async function gh(args: readonly string[]): Promise<string | undefined> {
  const ran = Bun.spawn(["gh", ...args], { stdout: "pipe", stderr: "inherit" });
  const printed = await new Response(ran.stdout).text();

  return (await ran.exited) === 0 ? printed : undefined;
}

/** The rows of the newest run of this workflow on main that ended green; `none` when GitHub lists no such run, and `unread` when the list or the run's artifact could not be had. */
async function costsOnMain(): Promise<Compared["main"]> {
  const listed = await gh(["run", "list", "--workflow", WORKFLOW, "--branch", "main", "--event", "push", "--status", "success", "--limit", "1", "--json", "databaseId", "--jq", ".[0].databaseId // empty"]);
  if (listed === undefined) return "unread";

  const id = listed.trim();
  if (id === "") return "none";

  using folder = mkdtempDisposableSync(join(tmpdir(), "action-costs-"));
  const fetched = await gh(["run", "download", id, "--name", ARTIFACT.name, "--dir", folder.path]);
  const file = join(folder.path, ARTIFACT.file);

  return fetched !== undefined && existsSync(file) ? readCosts(file).rows : "unread";
}

/** The value of a variable the workflow sets; the step fails by its name when it is not set. */
function required(name: string): string {
  const value = process.env[name] ?? "";
  if (value === "") throw new Error(`${name} is not set`);

  return value;
}

if (import.meta.main) {
  const run = `${required("GITHUB_SERVER_URL")}/${required("GITHUB_REPOSITORY")}/actions/runs/${required("GITHUB_RUN_ID")}`;
  const comment = costsComment({ now: readCosts(required("ACTION_COSTS_FILE")), main: await costsOnMain(), run });
  writeFileSync(required("COMMENT_FILE"), comment);
  // The buffer still holds the comment: the summary takes the same text after the tables the test wrote.
  await summary.write();
}
