// How `poplin uninstall` words what it found and removed: one line per kind of object, the same words for a dry run and for a run but for the tense, and one JSON value for a program.
//
//   a dry run    would remove   <object>   <detail>
//   a run        removed        <object>   <detail>

import type { RemovalRow, RemovalState, Removed, Run } from "../../../../core/src/install/installer";
import { countText } from "../../commands/text";
import type { Provider } from "../records";
import { blockedLines, type Line, type StateWords, wordedRow } from "../report";

/** The word of each state in a dry run and in a run, and what kind of line it is. */
const STATES: Readonly<Record<RemovalState, StateWords>> = {
  remove: { "dry-run": "would remove", apply: "removed", tone: "done" },
  gone: { "dry-run": "already gone", apply: "already gone", tone: "note" },
  keep: { "dry-run": "would keep", apply: "kept", tone: "note" },
  stay: { "dry-run": "stays", apply: "stays", tone: "note" },
  skip: { "dry-run": "would skip", apply: "skipped", tone: "warning" },
  block: { "dry-run": "blocked", apply: "stopped", tone: "error" },
  fail: { "dry-run": "failed", apply: "failed", tone: "error" },
  "not-run": { "dry-run": "not run", apply: "not run", tone: "warning" },
};

/** The states of a kind a run did not remove though it was to. */
const UNDONE: readonly RemovalState[] = ["block", "fail", "not-run"];

/** A removal that worked through its rows. */
type Listed = Extract<Removed, { readonly ok: true }>;

function plain(text: string): Line {
  return { tone: "plain", text };
}

function count(removed: Listed, states: readonly RemovalState[]): number {
  return removed.rows.filter((row) => states.includes(row.state)).length;
}

/**
 * Word one kind of object of a removal.
 *
 * @param run - whether the row is of a dry run or of a run: the state's word differs, and nothing else
 */
export function removalLine(row: RemovalRow, run: Run): Line {
  return wordedRow(STATES, row, run);
}

/**
 * Word what a dry run came to.
 *
 * @returns the last lines: what a run takes as its proof, how many kinds it would remove, and what stops it when something does
 */
export function listedLines(removed: Listed): Line[] {
  const kinds = countText(count(removed, ["remove"]), "kind");
  const proof = plain(`A run asks you to type this, or takes it with --confirm: ${removed.confirm}`);
  const data = plain("The sites' files and the database go last: --keep-data leaves them.");
  if (removed.ready) return [proof, data, { tone: "done", text: `ready: a run would remove ${kinds}. nothing was removed` }];

  const undone = UNDONE.filter((state) => count(removed, [state]) > 0).map((state) => `${count(removed, [state])} ${STATES[state]["dry-run"]}`);

  return [proof, ...blockedLines(removed.blocked), { tone: "error", text: `not ready: ${undone.join(", ")}. A run would remove the other ${kinds}. nothing was removed` }];
}

/**
 * Word what a person is told before the name is typed.
 *
 * @param data - whether the run removes the sites' files and the database too
 * @returns the lines of the warning; the question follows them
 */
export function warningLines(data: "remove" | "keep"): Line[] {
  const kept = data === "keep" ? " The sites' files and the database stay." : "";

  return [{ tone: "warning", text: `This removes everything listed above. It cannot be undone.${kept}` }];
}

/**
 * Word what a run came to.
 *
 * @param provider - the provider, whose name says where the token can be deleted
 * @returns the last lines: that the install is removed, or what is not done
 */
export function removedLines(removed: Listed, provider: Provider): Line[] {
  const stored = plain(`The token was used for this run and is stored nowhere. You can delete it at ${provider.name}.`);
  const left = count(removed, UNDONE);
  const kinds = countText(count(removed, ["remove", "gone"]), "kind");
  if (removed.ready) return [{ tone: "done", text: `the install is removed. ${kinds} removed, 0 left.` }, plain("On each computer that was logged in: npx poplin logout"), stored];

  return [...blockedLines(removed.blocked), { tone: "error", text: `${left} not done, ${kinds} removed. Run this command again: it removes what is left.` }, stored];
}

/**
 * The JSON value of a dry run or a run that worked through its rows.
 *
 * @param found - what the look for an install found, which the run went on from
 * @returns the same value for both, but for `run` and the key of each row's state: `will` in a dry run, `did` in a run. `ok` is whether the command exits with 0
 */
export function removalValue(removed: Listed, run: Run, found: string): Readonly<Record<string, unknown>> {
  const key = run === "dry-run" ? "will" : "did";
  const rows = removed.rows.map(({ object, state, detail, ...held }) => ({ object, [key]: state, detail, ...held }));

  return { ok: removed.ready, run, ready: removed.ready, found: { state: found }, confirm: removed.confirm, rows, blocked: removed.blocked };
}
