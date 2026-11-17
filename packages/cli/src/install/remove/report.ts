// How `poplin uninstall` words what it found and removed: one line per kind of object, the same words for a dry run and for a run but for the tense, and one JSON value for a program.
//
//   a dry run    would remove   <object>   <detail>
//   a run        removed        <object>   <detail>

import type { RemovalRow, RemovalState, Removed, Run } from "../../../../core/src/install/installer";
import { countText, type StateWords, wordedRow } from "../../commands/text";
import type { Line } from "../../local/screen";
import type { Careful, Next } from "../records";
import { againWords, blockedLines, NEXT } from "../report";

/** The word of each state in a dry run and in a run, and what kind of line it is. */
const STATES: Readonly<Record<RemovalState, StateWords>> = {
  remove: { "dry-run": "would remove", apply: "removed", tone: "done" },
  gone: { "dry-run": "not found", apply: "not found", tone: "note" },
  keep: { "dry-run": "unchanged", apply: "unchanged", tone: "note" },
  stay: { "dry-run": "unchanged", apply: "unchanged", tone: "note" },
  skip: { "dry-run": "would skip", apply: "skipped", tone: "warning" },
  block: { "dry-run": "blocked", apply: "blocked", tone: "error" },
  fail: { "dry-run": "failed", apply: "failed", tone: "error" },
  "not-run": { "dry-run": "would skip", apply: "skipped", tone: "warning" },
};

/** The states of a kind a run did not remove though it was to. */
const UNDONE: readonly RemovalState[] = ["block", "fail", "not-run"];

/** How some kinds are joined into one phrase: `a and b`, `a, b, and c`. */
const LIST = new Intl.ListFormat("en", { style: "long", type: "conjunction" });

/** What a row of a removal counts: one kind of resource, however many of it the install has. */
const KIND = "resource type";

/** What a person runs on a machine that is logged in to the install. */
const LOGOUT = "npx poplin logout";

/** What a person is told of the machines that are logged in, before a removal. */
const LOGGED_IN = `Uninstall does not log machines out. Run ${LOGOUT} on each machine first.`;

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

/** The state a row is worded as: a kind the token could not look for was skipped, whatever the install has of it. */
function shownState(row: RemovalRow): RemovalState {
  return row.state === "stay" && row.right !== undefined ? "skip" : row.state;
}

/** Whether a run could not look for a kind: one the install made may still be there, and the same command takes it once the token has the permission. */
function leftUnlooked(removed: Listed, run: Run): boolean {
  return run === "apply" && unlookedOf(removed).length > 0;
}

/**
 * What to run after a removal that left nothing it was to remove, or met nothing to remove: nothing, or this command again where a run could not look for a kind, as its sentence says.
 *
 * @param again - what runs this command again, with the careful choices of its line
 */
export function afterRemoval(removed: Listed, run: Run, again: Next): Next {
  return leftUnlooked(removed, run) ? again : NEXT.none();
}

/**
 * Say which kinds the token could not look for, in a dry run or in a run.
 *
 * @param careful - the careful choices of the run's line, which the sentence names as the next step's command line holds them
 * @returns the sentence, and a run's `Fix:` for a kind that may still be there; none where the token looked for every kind
 */
export function unlookedWords(removed: Listed, run: Run, careful: readonly Careful[]): readonly string[] {
  return unlookedLines(removed, run, careful).map((line) => line.text);
}

/** The lines of the kinds the token could not look for, a run's with what to do about them; none where it looked for every kind. */
function unlookedLines(removed: Listed, run: Run, careful: readonly Careful[] = []): Line[] {
  const unlooked = unlookedOf(removed);
  if (unlooked.length === 0) return [];

  const why = "the account token lacks an optional permission";
  if (!leftUnlooked(removed, run)) return [{ tone: "warning", text: `${LIST.format(unlooked)} would be skipped: ${why}` }];

  return [{ tone: "warning", text: `${LIST.format(unlooked)} may still exist: ${why}` }, plain(`Fix: add the permission and ${againWords(careful)}, or delete them manually`)];
}

/**
 * Word one kind of object of a removal.
 *
 * @param run - whether the row is of a dry run or of a run: the state's word differs, and nothing else
 */
export function removalLine(row: RemovalRow, run: Run): Line {
  return wordedRow(STATES, { ...row, state: shownState(row) }, run);
}

/**
 * Word what a dry run came to.
 *
 * @param data - whether a run with the same answers removes the sites' files and the database too
 * @returns the last lines: what a run takes as its proof, what to do first, how many kinds it would remove, and what stops it when something does
 */
export function listedLines(removed: Listed, data: "remove" | "keep"): Line[] {
  const kinds = countText(count(removed, ["remove"]), KIND);
  const proof = plain(`Without --dry-run, pass --confirm ${removed.confirm} or type it at the prompt`);
  const first = plain(LOGGED_IN);
  if (removed.ready) return [proof, first, ...unlookedLines(removed, "dry-run"), { tone: "done", text: `A run would remove ${kinds}` }];

  const undone = UNDONE.filter((state) => count(removed, [state]) > 0).map((state) => `${count(removed, [state])} ${STATES[state].apply}`);

  return [proof, ...blockedLines(removed.blocked), { tone: "error", text: `A run would be incomplete: ${undone.join(", ")}. It would remove the other ${kinds}.` }];
}

/**
 * Word what a person is told before the name is typed.
 *
 * @param listed - the list the person was just shown
 * @returns the lines of the warning; the question follows them
 */
export function warningLines(listed: Listed): Line[] {
  const lines = ["An uninstall cannot be undone", LOGGED_IN];

  return [...lines.map((text): Line => ({ tone: "warning", text })), ...unlookedLines(listed, "dry-run")];
}

/**
 * Word what a run came to.
 *
 * @param careful - the careful choices of the run's line, which the sentence of a run that left a kind names as the next step's command line holds them
 * @returns the last lines: that the install is removed, how many kinds stay and which the token could not look for, and that a logout is left to run; or what is not done
 */
export function removedLines(removed: Listed, careful: readonly Careful[]): Line[] {
  const left = count(removed, UNDONE);
  const removedCount = count(removed, ["remove", "gone"]);
  const kinds = countText(removedCount, KIND);
  if (!removed.ready) return [...blockedLines(removed.blocked), { tone: "error", text: `${kinds} ${removedCount === 1 ? "was" : "were"} removed and ${left} ${left === 1 ? "remains" : "remain"}` }, plain(`Next: ${againWords(careful)}`)];

  const shown = removed.rows.map(shownState);
  const others = (["skip", "stay"] as const).flatMap((state) => {
    const rows = shown.filter((one) => one === state || (state === "stay" && one === "keep")).length;

    return rows === 0 ? [] : [`, ${rows} ${STATES[state].apply}`];
  });
  const unlooked = unlookedLines(removed, "apply", careful);
  const whole = unlooked.length === 0;
  const done: Line = { tone: whole ? "done" : "warning", text: `The install is removed: ${kinds} removed${others.join("")}` };
  const logout = plain(`Next: ${LOGOUT} on each machine still logged in`);

  return [done, ...unlooked, logout];
}

/**
 * The JSON value of a dry run or a run that worked through its rows.
 *
 * @param found - what the look for an install found, which the run went on from
 * @param again - what runs this command again, with the careful choices the next step keeps
 * @returns the same value for both, but for `run` and the key of each row's state: `will` in a dry run, `did` in a run. `ok` is whether the command exits with 0, and `next` names this command until a run removed all it was to.
 *   `unlooked` names each kind the token could not look for, which may still be there: after a run that has one, `next` names this command too
 */
export function removalValue(removed: Listed, run: Run, found: string, again: Next): Readonly<Record<string, unknown>> {
  const key = run === "dry-run" ? "will" : "did";
  const rows = removed.rows.map(({ object, state, detail, ...held }) => ({ object, [key]: state, detail, ...held }));
  const next = run === "apply" && removed.ready ? afterRemoval(removed, run, again) : again;

  return { ok: removed.ready, run, ready: removed.ready, found: { state: found }, confirm: removed.confirm, rows, blocked: removed.blocked, unlooked: unlookedOf(removed), next };
}
