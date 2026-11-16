// How `poplin uninstall` words what it found and removed: one line per kind of object, the same words for a dry run and for a run but for the tense, and one JSON value for a program.
//
//   a dry run    would remove   <object>   <detail>
//   a run        removed        <object>   <detail>

import type { RemovalRow, RemovalState, Removed, Run } from "../../../../core/src/install/installer";
import { countText } from "../../commands/text";
import type { Next, Provider } from "../records";
import { blockedLines, type Line, NEXT, type StateWords, wordedRow } from "../report";

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

/** How some kinds are joined into one phrase: `a and b`, `a, b, and c`. */
const LIST = new Intl.ListFormat("en", { style: "long", type: "conjunction" });

/** What a person runs on a computer that is logged in to the install. */
const LOGOUT = "npx poplin logout";

/** A removal that worked through its rows. */
type Listed = Extract<Removed, { readonly ok: true }>;

function plain(text: string): Line {
  return { tone: "plain", text };
}

function count(removed: Listed, states: readonly RemovalState[]): number {
  return removed.rows.filter((row) => states.includes(row.state)).length;
}

/** The kinds the token could not look for: each is made with an optional permission the token lacks, so one may still be there. */
function unlookedOf(removed: Listed): string[] {
  return removed.rows.filter((row) => row.state === "stay" && row.right !== undefined).map((row) => row.object);
}

/**
 * Say which kinds the token could not look for, in a dry run or in a run.
 *
 * @returns the sentences, a run's with what to do about a kind that may still be there; `undefined` where the token looked for every kind
 */
export function unlookedWords(removed: Listed, run: Run): string | undefined {
  const unlooked = unlookedOf(removed);
  if (unlooked.length === 0) return undefined;

  const were = unlooked.length === 1 ? "was not" : "were not";
  const kinds = `${countText(unlooked.length, "kind")} ${run === "dry-run" ? "would not be" : were} looked for, since the token lacks an optional permission: ${LIST.format(unlooked)}.`;
  const byHand = "If the install made one, it is still there: delete it by hand, or add the permission and run this command again.";

  return run === "dry-run" ? kinds : `${kinds} ${byHand}`;
}

/** The line of the kinds the token could not look for; none where it looked for every kind. */
function unlookedLines(removed: Listed, run: Run): Line[] {
  const words = unlookedWords(removed, run);

  return words === undefined ? [] : [{ tone: "warning", text: words }];
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
 * @param data - whether a run with the same answers removes the sites' files and the database too
 * @returns the last lines: what a run takes as its proof, what to do first, how many kinds it would remove, and what stops it when something does
 */
export function listedLines(removed: Listed, data: "remove" | "keep"): Line[] {
  const kinds = countText(count(removed, ["remove"]), "kind");
  const proof = plain(`A run asks you to type this, or takes it with --confirm: ${removed.confirm}`);
  const kept = plain(data === "keep" ? "The sites' files and the database stay: --keep-data was given." : "The sites' files and the database go last: --keep-data leaves them.");
  const first = plain(`A removal logs no computer out: run ${LOGOUT} on each one first.`);
  if (removed.ready) return [proof, kept, first, ...unlookedLines(removed, "dry-run"), { tone: "done", text: `ready: a run would remove ${kinds}. nothing was removed` }];

  const undone = UNDONE.filter((state) => count(removed, [state]) > 0).map((state) => `${count(removed, [state])} ${STATES[state]["dry-run"]}`);

  return [proof, ...blockedLines(removed.blocked), { tone: "error", text: `not ready: ${undone.join(", ")}. A run would remove the other ${kinds}. nothing was removed` }];
}

/**
 * Word what a person is told before the name is typed.
 *
 * @param listed - the list the person was just shown
 * @param data - whether the run removes the sites' files and the database too
 * @returns the lines of the warning; the question follows them
 */
export function warningLines(listed: Listed, data: "remove" | "keep"): Line[] {
  const kept = data === "keep" ? " The sites' files and the database stay." : "";
  const lines = [`This removes every row above that says ${STATES.remove["dry-run"]}. It cannot be undone.${kept}`, `It logs no computer out. Run ${LOGOUT} on each one first: after the removal a logout cannot reach the install.`];

  return [...lines.map((text): Line => ({ tone: "warning", text })), ...unlookedLines(listed, "dry-run")];
}

/**
 * Word what a run came to.
 *
 * @param provider - the provider, whose name says where the token can be deleted
 * @returns the last lines: that the install is removed, how many kinds stay and which the token could not look for, and what a logout says now; or what is not done
 */
export function removedLines(removed: Listed, provider: Provider): Line[] {
  const stored = plain(`The token was used for this run and is stored nowhere. You can delete it at ${provider.name}.`);
  const left = count(removed, UNDONE);
  const kinds = countText(count(removed, ["remove", "gone"]), "kind");
  if (!removed.ready) return [...blockedLines(removed.blocked), { tone: "error", text: `${left} not done, ${kinds} removed. Run this command again: it removes what is left.` }, stored];

  const stays = count(removed, ["stay"]);
  const unlooked = unlookedLines(removed, "apply");
  const whole = unlooked.length === 0;
  const done: Line = { tone: whole ? "done" : "warning", text: `the install is removed${whole ? "" : ", but for what the token could not look for"}. ${kinds} removed, 0 left, ${stays} ${stays === 1 ? "stays" : "stay"}.` };
  const byHand = stays === 0 ? [] : [plain("Each row that says stays names what is yours to do by hand.")];
  const logout = plain(`On each computer that is still logged in: ${LOGOUT}. It forgets the login there, and says the install could not be reached.`);

  return [done, ...byHand, ...unlooked, logout, stored];
}

/**
 * The JSON value of a dry run or a run that worked through its rows.
 *
 * @param found - what the look for an install found, which the run went on from
 * @param provider - the provider, which the command line of the next step names
 * @returns the same value for both, but for `run` and the key of each row's state: `will` in a dry run, `did` in a run. `ok` is whether the command exits with 0, and `next` names this command until a run removed all it was to.
 *   `unlooked` names each kind the token could not look for, which may still be there
 */
export function removalValue(removed: Listed, run: Run, found: string, provider: Provider): Readonly<Record<string, unknown>> {
  const key = run === "dry-run" ? "will" : "did";
  const rows = removed.rows.map(({ object, state, detail, ...held }) => ({ object, [key]: state, detail, ...held }));
  const next: Next = run === "apply" && removed.ready ? NEXT.none() : NEXT.uninstall(provider);

  return { ok: removed.ready, run, ready: removed.ready, found: { state: found }, confirm: removed.confirm, rows, blocked: removed.blocked, unlooked: unlookedOf(removed), next };
}
