// Write the summary of the free-plan budget job from what the budget test measured, and on a pull request say what the change did to it.
//
//   this run's costs      FREE_PLAN_BUDGET_FILE, written by the budget test's reporter
//   main's costs          a pull request alone: the `free-plan-budget` artifact of the newest CI run of a push to main that ended green
//   the job's summary     one line on what changed, the standing, the actions that moved, one row a ceiling, then every table folded away
//   the annotation        a pull request alone: the first line, as a notice, a warning when a cost rose, an error when the budget is broken
//
// The mark is an HTML entity, so this file holds plain ASCII and GitHub draws it.

import { existsSync, mkdtempDisposableSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { error, notice, summary, warning } from "@actions/core";
import diff from "microdiff";
import * as v from "valibot";

/** The name of the artifact a run keeps its costs in, and of the file in it. */
const ARTIFACT = { name: "free-plan-budget", file: "free-plan-budget.json" } as const;

/** The workflow whose runs on main hold the costs to compare with. */
const WORKFLOW = "ci.yml";

/** What the summary opens with, and the annotation is named. */
const TITLE = "Free-plan budget";

/** What the summary ends with. */
const LEAD = "Measured on the local Workers runtime with the real database driver. Cloudflare's free plan answers one request 50 database queries; a request here may spend 40.";

/** The share of a ceiling from which a row is marked. */
const NEAR = 0.8;

/** The most movers the first line names. */
const MOST_NAMED = 3;

/** The mark of a row near a ceiling, as GitHub draws it. */
const MARK = "&#9888;";

/** What the first line says in place of a comparison when main's costs are not there to compare with. */
const NO_COMPARISON = {
  none: "No run on main to compare with yet.",
  unread: "The costs of the newest run on main could not be read, so nothing is compared.",
} as const;

/** What a row is compared by, each under the name its column carries, with the words for one and for many of it. */
const COUNTS = {
  "Database queries": { of: (row: Row) => row.queries, one: "database query", many: "database queries" },
  "Rows read": { of: (row: Row) => row.read, one: "row read", many: "rows read" },
  "Rows written": { of: (row: Row) => row.written, one: "row written", many: "rows written" },
  "Storage reads": { of: (row: Row) => row.gets + row.heads, one: "storage read", many: "storage reads" },
  "Storage writes": { of: (row: Row) => row.puts, one: "storage write", many: "storage writes" },
  "Storage lists": { of: (row: Row) => row.lists, one: "storage list", many: "storage lists" },
  "Storage deletes": { of: (row: Row) => row.deletes, one: "storage delete", many: "storage deletes" },
} as const;

/** A whole number that is no less than zero. */
const COUNT = v.pipe(v.number(), v.integer(), v.minValue(0));

/** One row of a run's costs. */
const ROW = v.object({
  group: v.string(),
  name: v.string(),
  queries: COUNT,
  read: COUNT,
  written: COUNT,
  gets: COUNT,
  heads: COUNT,
  puts: COUNT,
  lists: COUNT,
  deletes: COUNT,
  ms: v.number(),
  budget: v.object({ queries: COUNT, read: v.optional(COUNT), written: v.optional(COUNT), reads: COUNT, writes: COUNT, deletes: v.optional(COUNT) }),
  uses: v.array(v.object({ ceiling: v.string(), spent: COUNT, most: v.pipe(COUNT, v.minValue(1)), exact: v.optional(v.boolean()) })),
  known: v.optional(v.string()),
});

/** The costs of one run: every row that was measured, the name of every row whose test failed before it was, and the rows of the table of what a person does. */
const COSTS = v.object({ rows: v.array(ROW), unmeasured: v.array(v.string()), actions: v.array(v.record(v.string(), v.union([v.string(), COUNT]))) });

/** One row of a run's costs. */
type Row = v.InferOutput<typeof ROW>;

/** The costs of one run. */
type Costs = v.InferOutput<typeof COSTS>;

/** One cell of a table. */
type Cell = string | number;

/** How loud an annotation is. */
type Level = "notice" | "warning" | "error";

/** What a report is written from. */
interface Compared {
  /** The costs of this run. */
  readonly now: Costs;

  /** The rows of the newest green run on main; `none` while main has no such run that kept its costs, `unread` when they could not be had, and left out for a run that is no pull request. */
  readonly main?: readonly Row[] | keyof typeof NO_COMPARISON;
}

/** What a run reports. */
interface Report {
  /** The first line: what the change did to the costs, or the standing for a run that compares nothing. */
  readonly line: string;

  /** How loud the annotation of a pull request is; left out for a run that is no pull request. */
  readonly level?: Level;

  /** The job's summary, as HTML. */
  readonly html: string;
}

/** One count of one row that differs from main's. */
interface Moved {
  /** The row. */
  readonly name: string;

  /** The column the count is under. */
  readonly kind: keyof typeof COUNTS;

  /** What main counts. */
  readonly before: number;

  /** What this run counts. */
  readonly after: number;
}

/** A row only one of the two runs holds. */
interface Apart {
  /** The row. */
  readonly name: string;

  /** `new` for a row main does not hold, `gone` for one it alone holds. */
  readonly only: "new" | "gone";
}

/** What differs from main: a count of a row, or a whole row. */
type Mover = Moved | Apart;

/** The row that spends the largest share of one ceiling. */
interface Worst {
  readonly ceiling: string;
  readonly name: string;
  readonly spent: number;
  readonly most: number;
  readonly exact?: boolean;
}

/** A number as a person reads it, a comma between the thousands. */
function shown(count: number): string {
  return count.toLocaleString("en-US");
}

/** A part of a whole as a percentage: with one decimal under ten when it is no whole number, else whole. */
function percent(part: number, whole: number): string {
  const of100 = (part * 100) / whole;

  return `${of100.toFixed(of100 < 10 && !Number.isInteger(of100) ? 1 : 0)}%`;
}

/** The share of a ceiling, in bold and marked from the share that is near it. */
function used(spent: number, most: number): string {
  return spent / most >= NEAR ? `<b>${percent(spent, most)}</b> ${MARK}` : percent(spent, most);
}

/** Whether a use is of an allowance a row may spend in full, and is inside it: such a use is near no ceiling. */
function inFull({ spent, most, exact = false }: Pick<Worst, "spent" | "most" | "exact">): boolean {
  return exact && spent <= most;
}

/** The share of a ceiling as its table shows it: an allowance that may be spent in full by its counts, any other by its percentage. */
function share(use: Pick<Worst, "spent" | "most" | "exact">): string {
  return inFull(use) ? `${shown(use.spent)} of ${shown(use.most)} (allowed in full)` : used(use.spent, use.most);
}

/** How far a count moved: the difference with its sign, then the share of what it was; the share is left out for a count that was zero. */
function delta(before: number, after: number): string {
  const sign = after > before ? "+" : "-";
  const by = Math.abs(after - before);

  return before === 0 ? `${sign}${shown(by)}` : `${sign}${shown(by)} (${sign}${percent(by, before)})`;
}

/** A table as HTML, under its head, each number as a person reads it. */
function table(head: readonly string[], rows: readonly (readonly Cell[])[]): string {
  return summary
    .emptyBuffer()
    .addTable([head.map((data) => ({ data, header: true })), ...rows.map((row) => row.map((cell) => (typeof cell === "number" ? shown(cell) : cell)))])
    .stringify();
}

/** How large a mover is, as the share it moved; a row that is new or gone, or a count that was zero, is larger than any share. */
function size(mover: Mover): number {
  if ("only" in mover || mover.before === 0) return Number.MAX_VALUE;

  return Math.abs(mover.after - mover.before) / mover.before;
}

/** Every count of every row, by the row's name and then the count's column. */
function counted(rows: readonly Row[]): Record<string, Record<string, number>> {
  return Object.fromEntries(rows.map((row) => [row.name, Object.fromEntries(Object.entries(COUNTS).map(([kind, { of }]) => [kind, of(row)]))]));
}

/** Every count that differs from main's, the rows main does not hold, and the ones it alone holds, the largest first. A row this run did not measure is none of them. */
function movers(now: Costs, main: readonly Row[]): Mover[] {
  const unmeasured = new Set(now.unmeasured);
  const moved = diff(counted(main), counted(now.rows)).flatMap((change): Mover[] => {
    const [name = "", kind] = change.path.map(String);
    if (change.type === "CHANGE") return [{ name, kind: kind as keyof typeof COUNTS, before: change.oldValue, after: change.value }];

    if (change.type === "CREATE") return [{ name, only: "new" }];

    return unmeasured.has(name) ? [] : [{ name, only: "gone" }];
  });

  return moved.sort((one, other) => size(other) - size(one));
}

/** What one mover did, in words. */
function phrase(mover: Mover): string {
  if ("only" in mover) return `${mover.only === "new" ? "adds" : "removes"} "${mover.name}"`;

  const { name, kind, before, after } = mover;
  const by = Math.abs(after - before);
  const share = before === 0 ? "" : ` (${after > before ? "+" : "-"}${percent(by, before)})`;

  return `${after > before ? "raises" : "lowers"} "${name}" by ${shown(by)} ${COUNTS[kind][by === 1 ? "one" : "many"]}${share}`;
}

/** What the change did to the costs, in one line: the largest movers by name, and how many more there are. */
function changeLine(moved: readonly Mover[]): string {
  if (moved.length === 0) return "This change does not change any action's cost.";

  const named = moved.slice(0, MOST_NAMED).map(phrase);
  const more = moved.length > MOST_NAMED ? [`${moved.length - MOST_NAMED} more`] : [];

  return `This change ${new Intl.ListFormat("en").format([...named, ...more])}. Everything else is unchanged.`;
}

/** One mover as a row of the table of what changed. */
function movedRow(mover: Mover): Cell[] {
  if ("only" in mover) return [mover.name, "-", "-", "-", mover.only];

  return [mover.name, mover.kind, mover.before, mover.after, delta(mover.before, mover.after)];
}

/** The row that spends the largest share of each ceiling, by the ceiling's name; the first of two that spend the same. A row known to be over a ceiling is none of them: the summary lists it apart. */
function worstOf(rows: readonly Row[]): Map<string, Worst> {
  const worst = new Map<string, Worst>();
  for (const row of rows.filter(({ known }) => known === undefined)) {
    for (const use of row.uses) {
      const so = worst.get(use.ceiling);
      if (so === undefined || use.spent / use.most > so.spent / so.most) worst.set(use.ceiling, { ...use, name: row.name });
    }
  }

  return worst;
}

/** What a row is over, in words; empty for a row inside its budget. */
function overBudget(row: Row): string {
  const over = [
    ...(row.queries > row.budget.queries ? [`${row.queries} database queries, budget ${row.budget.queries}`] : []),
    ...(row.read > (row.budget.read ?? row.read) ? [`${row.read} rows read, budget ${row.budget.read}`] : []),
    ...(row.written > (row.budget.written ?? row.written) ? [`${row.written} rows written, budget ${row.budget.written}`] : []),
    ...(row.gets + row.heads > row.budget.reads ? [`${row.gets + row.heads} storage reads, budget ${row.budget.reads}`] : []),
    ...(row.puts + row.lists > row.budget.writes ? [`${row.puts + row.lists} storage writes and lists, budget ${row.budget.writes}`] : []),
    ...(row.deletes > (row.budget.deletes ?? 0) ? [`${row.deletes} storage deletes, budget ${row.budget.deletes ?? 0}`] : []),
  ];

  return over.join("; ");
}

/** What is broken, each in words: a row over a ceiling that is not known to be, a row over its own budget, and the rows not measured. */
function brokenOf(now: Costs): string[] {
  const unknown = now.rows.filter((row) => row.known === undefined);
  const ceilings = unknown.flatMap((row) => row.uses.filter(({ spent, most }) => spent > most).map(({ ceiling, spent, most }) => `"${row.name}" is at ${percent(spent, most)} of ${ceiling}`));
  const budgets = now.rows.flatMap((row) => (overBudget(row) === "" ? [] : [`"${row.name}" is over its budget: ${overBudget(row)}`]));
  const unmeasured = now.unmeasured.map((name) => `"${name}" was not measured, since its test failed first`);

  return [...ceilings, ...budgets, ...unmeasured];
}

/** The standing in one line: what is broken, or the row closest to a ceiling that is no allowance to spend in full. */
function standing(broken: readonly string[], closest: Worst | undefined): string {
  if (broken.length > 0) return `Not within budget: ${broken.join("; ")}.`;

  if (closest === undefined || inFull(closest)) return "All within budget.";

  return `All within budget. Closest: "${closest.name}" at ${percent(closest.spent, closest.most)} of ${closest.ceiling}.`;
}

/** One row a ceiling, in the order given: its worst row, what main's worst spent, what this run's does, how far that moved, the ceiling, and the share of it. */
function ceilingRows(now: readonly Worst[], main: Compared["main"]): Cell[][] {
  const before = typeof main === "object" ? worstOf(main) : undefined;

  return now.map((worst) => {
    const { ceiling, name, spent, most } = worst;
    const was = before?.get(ceiling)?.spent;
    if (was === undefined) return [ceiling, name, "-", spent, "-", most, share(worst)];

    return [ceiling, name, was, spent, was === spent ? "no change" : delta(was, spent), most, share(worst)];
  });
}

/** One row as its group's table shows it, with the largest share of a ceiling it spends; an allowance it may spend in full is none of them. */
function groupRow(row: Row): Cell[] {
  const fullest = row.uses.filter((use) => !inFull(use)).reduce((so, use) => (use.spent / use.most > so.spent / so.most ? use : so), { spent: 0, most: 1 });

  return [row.name, used(fullest.spent, fullest.most), row.queries, row.budget.queries, row.read, row.written, row.gets + row.heads, row.puts, row.lists, row.deletes, row.ms, row.known ?? "-"];
}

/** Every table of a run, each folded away: the actions a person does, then the rows by their group. */
function folded(now: Costs): string {
  const actions = now.actions.length === 0 ? [] : [{ label: "What a person does", body: table(Object.keys(now.actions[0] ?? {}), now.actions.map(Object.values)) }];
  const head = ["Action", "Most of a ceiling", "Database queries", "Most allowed", "Rows read", "Rows written", "Storage reads", "Storage writes", "Storage lists", "Storage deletes", "About ms", "Note"];
  const groups = [...new Set(now.rows.map((row) => row.group))].map((label) => ({ label, body: table(head, now.rows.filter((row) => row.group === label).map(groupRow)) }));

  return [...actions, ...groups].map(({ label, body }) => summary.emptyBuffer().addDetails(label, body).stringify()).join("");
}

/** How loud a pull request's annotation is: an error for a broken budget, a warning for a count that rose or a row that is new, else a notice. */
function levelOf(broken: readonly string[], moved: readonly Mover[]): Level {
  if (broken.length > 0) return "error";

  return moved.some((mover) => ("only" in mover ? mover.only === "new" : mover.after > mover.before)) ? "warning" : "notice";
}

/**
 * Report a run: its first line, how loud a pull request's annotation is, and the job's summary.
 *
 * @returns the summary leads with the first line and the standing, then what moved when anything did, one row a ceiling with the fullest first and the allowances spent in full last, and every table folded away.
 * The buffer of the summary holds the same HTML.
 */
export function budgetReport({ now, main }: Compared): Report {
  const moved = typeof main === "object" ? movers(now, main) : [];
  const fullest = [...worstOf(now.rows).values()].sort((one, other) => other.spent / other.most - one.spent / one.most);
  const worst = [...fullest.filter((use) => !inFull(use)), ...fullest.filter(inFull)];
  const broken = brokenOf(now);
  const stands = standing(broken, worst[0]);
  const known = now.rows.flatMap((row) => (row.known === undefined ? [] : [`${row.name}: ${row.queries} database queries. ${row.known}`]));
  const changed = typeof main === "string" ? NO_COMPARISON[main] : changeLine(moved);
  const parts = [
    ...(main === undefined ? [stands] : [changed, stands]).map((line) => `<p>${line}</p>\n`),
    ...(moved.length > 0 ? [`<h3>What changed</h3>\n${table(["Action", "Count", "Before", "After", "Change"], moved.map(movedRow))}`] : []),
    ...(known.length > 0 ? [`<p>Known to be over a ceiling:</p>\n${summary.emptyBuffer().addList(known).stringify()}`] : []),
    table(["Ceiling", "Worst action", "Before (main)", "After", "Change", "Most", "Used"], ceilingRows(worst, main)),
    folded(now),
    `<p>${LEAD}</p>\n`,
  ];
  const html = summary.emptyBuffer().addHeading(TITLE, 2).addRaw(parts.join("")).stringify();
  if (main === undefined) return { line: stands, html };

  return { line: broken.length > 0 ? `${changed} ${stands}` : changed, level: levelOf(broken, moved), html };
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

/** The rows of the newest CI run of a push to main that ended green; `none` when GitHub lists no such run or the run kept no costs, and `unread` when the list or the run's artifact could not be had. */
async function costsOnMain(): Promise<NonNullable<Compared["main"]>> {
  const listed = await gh(["run", "list", "--workflow", WORKFLOW, "--branch", "main", "--event", "push", "--status", "success", "--limit", "1", "--json", "databaseId", "--jq", ".[0].databaseId // empty"]);
  if (listed === undefined) return "unread";

  const id = listed.trim();
  if (id === "") return "none";

  const kept = await gh(["api", `repos/{owner}/{repo}/actions/runs/${id}/artifacts?name=${ARTIFACT.name}`, "--jq", ".total_count"]);
  if (kept === undefined) return "unread";

  if (kept.trim() === "0") return "none";

  using folder = mkdtempDisposableSync(join(tmpdir(), "free-plan-budget-"));
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
  const now = readCosts(required("FREE_PLAN_BUDGET_FILE"));
  const { line, level } = budgetReport(required("GITHUB_EVENT_NAME") === "pull_request" ? { now, main: await costsOnMain() } : { now });
  // The buffer holds the report: the job's summary takes it.
  await summary.write();
  if (level !== undefined) ({ notice, warning, error })[level](line, { title: TITLE });
}
