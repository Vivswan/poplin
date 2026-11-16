// How `poplin install` words what it found and did: one line per object, the same words for a dry run and for a run but for the tense, and one JSON value for a program.
//
//   a dry run    would make   <object>   <detail>
//   a run        made         <object>   <detail>

import type { Blocked, Installed, OptionRow, Row, RowState, Run } from "../../../core/src/install/installer";
import type { TokenFacts } from "../../../core/src/install/token-facts";
import { columns, countText } from "../commands/text";
import type { Tone } from "../local/screen";
import type { Provider, Stop } from "./records";

/** The word of each state in a dry run and in a run, and what kind of line it is. */
const STATES: Readonly<Record<RowState, StateWords>> = {
  make: { "dry-run": "would make", apply: "made", tone: "done" },
  change: { "dry-run": "would change", apply: "changed", tone: "done" },
  remove: { "dry-run": "would remove", apply: "removed", tone: "done" },
  leave: { "dry-run": "would leave", apply: "left", tone: "note" },
  "leave-out": { "dry-run": "would leave out", apply: "left out", tone: "warning" },
  block: { "dry-run": "blocked", apply: "stopped", tone: "error" },
  fail: { "dry-run": "failed", apply: "failed", tone: "error" },
  "not-run": { "dry-run": "not run", apply: "not run", tone: "warning" },
};

/** The states of an object a run did not bring to what it should be. */
const UNDONE: ReadonlySet<RowState> = new Set(["block", "fail", "not-run"]);

/** The states a dry run counts in its last line, in the order it names them, each with its word there. */
const COUNTED: readonly (readonly [RowState, string])[] = [
  ["make", "make"],
  ["change", "change"],
  ["remove", "remove"],
  ["leave-out", "leave out"],
];

/** How wide the column of an object's name is at least, so that the rows of a run line up as they are printed one by one. */
const OBJECT_WIDTH = 20;

/** What stands between two columns of a row. */
const GAP = "  ";

/** What a line that stands under another starts with. */
const INDENT = "  ";

/** How some parts are joined into one phrase: `a and b`, `a, b, and c`. */
const LIST = new Intl.ListFormat("en", { style: "long", type: "conjunction" });

/** The line every stop before the first change ends in. */
export const UNCHANGED = "nothing was changed";

/** The word of one state of a row in a dry run and in a run, and what kind of line it is. */
export interface StateWords {
  readonly "dry-run": string;
  readonly apply: string;
  readonly tone: Tone;
}

/** How the last lines of a run are worded: what a run that left nothing undone is called, and the command that goes on from what stands after one that did not, as a sentence names it. */
export interface Ending {
  readonly done: string;
  readonly next: string;
}

/** One line as it is shown: its text, and what kind of line it is. */
export interface Line {
  readonly tone: Tone;
  readonly text: string;
}


function plain(text: string): Line {
  return { tone: "plain", text };
}

/**
 * Put the command's own words after a sentence a provider said, which ends with a full stop or without one.
 *
 * @returns the two with one full stop between them
 */
export function followed(sentence: string, tail: string): string {
  return `${sentence.replace(/\.$/, "")}. ${tail}`;
}

/** The lines of what stops a piece until a person acts: what it is, then the address to open, under it. */
export function blockedLines(blocked: readonly Blocked[]): Line[] {
  return blocked.flatMap((one) => [{ tone: "warning", text: one.words }, plain(`${INDENT}${one.address}`)]);
}

/** The four commands that own an install that is there, each with what it is for. */
function ownerLines(provider: Provider, version: string | undefined, newest: string | undefined): string[] {
  const out = newest === undefined || newest === version ? "" : `(${newest} is out)`;
  const rows = [
    ["to check it", "npx poplin doctor", ""],
    ["to mend it", "npx poplin doctor --repair", ""],
    ["to update it", "npx poplin update", out],
    ["to remove it", `npx poplin uninstall ${provider.id}`, ""],
  ];

  return columns(rows).map((line) => `${INDENT}${line}`);
}

/**
 * Lay one row out in columns: its state's word, as wide as the widest word of the run, then its object and its detail.
 *
 * @param states - the words of every state a row of this command can have
 * @param run - whether the row is of a dry run or of a run
 */
export function wordedRow<State extends string>(states: Readonly<Record<State, StateWords>>, row: { readonly state: State; readonly object: string; readonly detail: string }, run: Run): Line {
  const all: readonly StateWords[] = Object.values(states);
  const width = Math.max(...all.map((words) => words[run].length));
  const words = states[row.state];

  return { tone: words.tone, text: [words[run].padEnd(width), row.object.padEnd(OBJECT_WIDTH), row.detail].join(GAP).trimEnd() };
}

/** The rows of some options in a help text: each as it is typed, what it means, and the variable that answers the same. */
export function optionLines(rows: readonly OptionRow[]): string[] {
  return columns(rows.map((row) => [row.value === null ? row.flag : `${row.flag} ${row.value}`, row.about, row.variable === null ? "" : `(${row.variable})`])).map((line) => `${INDENT}${line}`);
}

/**
 * Word one object of an install.
 *
 * @param run - whether the row is of a dry run or of a run: the state's word differs, and nothing else
 * @returns the line, and what kind of line it is
 */
export function rowLine(row: Row, run: Run): Line {
  return wordedRow(STATES, row, run);
}

/**
 * The rows of a run, as its JSON value holds them.
 *
 * @returns each object with its detail, its state under `will` in a dry run and under `did` in a run, and the permission it lacks where it names one
 */
export function rowValues(rows: readonly Row[], run: Run): Readonly<Record<string, unknown>>[] {
  const key = run === "dry-run" ? "will" : "did";

  return rows.map((row) => ({ object: row.object, [key]: row.state, detail: row.detail, ...(row.right === undefined ? {} : { right: row.right }) }));
}

/**
 * Word what a dry run came to.
 *
 * @returns the last lines: whether a run would go through, with what it would do counted, and what stops it when something does
 */
export function dryRunLines(installed: Pick<Extract<Installed, { readonly ok: true }>, "rows" | "blocked" | "ready">): Line[] {
  const count = (state: RowState): number => installed.rows.filter((row) => row.state === state).length;
  const proof = "the token's permissions: each read was allowed, and a write is proven by the run";

  if (!installed.ready) {
    const undone = [...UNDONE].filter((state) => count(state) > 0).map((state) => `${count(state)} ${STATES[state]["dry-run"]}`);

    return [...blockedLines(installed.blocked), { tone: "error", text: `not ready: ${undone.length === 0 ? "a person must act first" : LIST.format(undone)}. ${UNCHANGED}` }];
  }

  const parts = COUNTED.filter(([state]) => count(state) > 0).map(([state, word]) => `${word} ${count(state)}`);

  return [plain(proof), { tone: "done", text: `ready: a run would ${parts.length === 0 ? "change nothing" : LIST.format(parts)}. ${UNCHANGED}` }];
}

/**
 * Word what a run came to.
 *
 * @param provider - the provider, whose name says where the token can be deleted
 * @param answers - whether the install answered at its address once it was made; `null` for a run that did not wait
 * @param ending - what a run that left nothing undone is called, and what to run after one that did
 * @returns the last lines: what the run is called and the dashboard's address, or what is not done and what only a person can do. A run that never learned its address names none
 */
export function runLines(installed: Pick<Extract<Installed, { readonly ok: true }>, "rows" | "steps" | "blocked" | "address" | "ready">, provider: Provider, answers: boolean | null, ending: Ending): Line[] {
  const { address } = installed;
  const silent: Line = { tone: "warning", text: `no answer yet at ${address}: it can take a few more minutes` };
  const answer = answers === null ? [] : [answers ? plain(`${address} answers`) : silent];
  const dashboard = address === undefined ? [] : [plain(`Your dashboard: ${address}`)];
  const stored = plain(`The token was used for this run and is stored nowhere. You can delete it at ${provider.name}.`);

  if (installed.ready) return [...answer, { tone: "done", text: ending.done }, ...dashboard, stored];

  const undone = installed.rows.filter((row) => UNDONE.has(row.state)).length;
  const steps = installed.steps.flatMap((step) => [`${INDENT}${step.text}`, `${INDENT}${step.address}`]);
  const byHand = steps.length === 0 ? [] : [`Do this in your browser, then run ${ending.next}:`, ...steps];

  return [...answer, ...blockedLines(installed.blocked), ...byHand.map(plain), { tone: "error", text: `${undone} not done. Run ${ending.next}: it goes on from what stands.` }, stored];
}

/**
 * Word what the account token must be, before a person is asked for it.
 *
 * @returns the permissions, the optional ones with what each adds, the form's address, and what else the form asks, a permission the link cannot choose among it
 */
export function factsLines(facts: TokenFacts): string[] {
  const optional = facts.tokenOptional.map((one) => `${INDENT}${one.right}: ${one.adds}`);

  return [
    `The account token needs ${countText(facts.tokenRights.length, "permission")}, for ${facts.tokenFor}:`,
    `${INDENT}${facts.tokenRights.join(", ")}`,
    ...(optional.length === 0 ? [] : ["Optional:", ...optional]),
    "This link opens the form with each one chosen that a link can choose:",
    `${INDENT}${facts.tokenLink}`,
    facts.tokenNote,
  ];
}

/** The words of a stop that is one message: its first line says what it is, and the rest stand under it. */
function stopWords(stop: Exclude<Stop, { readonly problem: "missing_answer" | "blocked" }>, provider: Provider | undefined): string[] {
  if (stop.problem === "usage" || stop.problem === "no_provider") return [...stop.lines];

  if (stop.problem === "leftover") return [stop.words, "To use it, with what it holds: run this again with --adopt. To set it aside, rename or delete it here:", `${INDENT}${stop.address}`, UNCHANGED];

  if (stop.problem === "name_held") return [stop.words, `${INDENT}${stop.address}`, UNCHANGED];

  if (stop.problem !== "already_installed") return [stop.words];

  const version = stop.version ?? "(version not read)";
  const owners = provider === undefined ? [] : ownerLines(provider, stop.version, stop.newest);

  return [`This account already holds poplin ${version}, at ${stop.address}. ${UNCHANGED}. The way on is npx poplin doctor --repair.`, ...owners];
}

/**
 * Word why a command stopped before its work was done.
 *
 * @param provider - the provider the line names, when the command got as far as one
 * @param command - the command as it is typed after `poplin`, such as `install`
 * @returns the lines for a person, the first of which says what it is
 */
export function stopLines(stop: Stop, provider: Provider | undefined, command: string): Line[] {
  if (stop.problem === "missing_answer") return stop.missing.map((one) => ({ tone: "error", text: `poplin ${command}: an answer is missing: ${one.name}. ${one.give}` }));

  if (stop.problem === "blocked") return [...blockedLines(stop.blocked), { tone: "error", text: UNCHANGED }];

  return stopWords(stop, provider).map((text, at) => (at === 0 ? { tone: "error", text } : plain(text)));
}

/**
 * The JSON value of a command that made no install.
 *
 * @returns `ok` false, the problem's code, and what a program needs of it: the answers that are missing, the install that is there, or what blocks
 */
export function stopValue(stop: Stop): Readonly<Record<string, unknown>> {
  const said = { ok: false, problem: stop.problem };

  if (stop.problem === "usage" || stop.problem === "no_provider") return { ...said, words: stop.lines };

  if (stop.problem === "missing_answer") return { ...said, missing: stop.missing.map((one) => one.key) };

  if (stop.problem === "blocked") return { ...said, blocked: stop.blocked };

  if (stop.problem === "leftover" || stop.problem === "name_held") return { ...said, words: stop.words, address: stop.address };

  if (stop.problem !== "already_installed") return { ...said, words: stop.words };

  return { ...said, found: { version: stop.version ?? null, address: stop.address, newest: stop.newest ?? null } };
}

/**
 * The JSON value of a dry run or a run that worked through its rows.
 *
 * @param found - what the look for an install found, which the run went on from
 * @param answers - whether the install answered at its address once it was made; `null` for a dry run and for a run that did not wait
 * @returns the same value for both, but for `run` and the key of each row's state: `will` in a dry run, `did` in a run. `ok` is whether the command exits with 0
 */
export function runValue(installed: Extract<Installed, { readonly ok: true }>, run: Run, found: string, answers: boolean | null): Readonly<Record<string, unknown>> {
  return {
    ok: installed.ready && answers !== false,
    run,
    ready: installed.ready,
    found: { state: found },
    release: installed.release ?? null,
    address: installed.address ?? null,
    answers,
    token: { proof: installed.proof },
    rows: rowValues(installed.rows, run),
    blocked: installed.blocked,
    steps: installed.steps,
  };
}
