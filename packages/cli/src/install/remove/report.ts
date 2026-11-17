// How `poplin uninstall` words what it found and removed: one line per kind of object, the same words for a dry run and for a run but for the tense, and one JSON value for a program.
//
//   a dry run    would remove   <object>   <detail>
//   a run        removed        <object>   <detail>

import type { RemovalRow, RemovalState, Removed, Run } from "../../../../core/src/install/installer";
import { countText, type StateWords, wordedRow } from "../../commands/text";
import type { Line } from "../../local/screen";
import type { Careful, Next, Provider } from "../records";
import { againWords, blockedLines, NEXT, nextLine } from "../report";

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

/** What a person is told of those machines after a removal: the install no longer answers, so a logout revokes nothing, and deletes the login a machine stored. */
const LOGGED_IN_AFTER = `Next: ${LOGOUT} on each machine with a stored login, to delete it`;

/** The states a run's last line counts after the kinds it removed, in the order it names them. */
const COUNTED: readonly RemovalState[] = ["fail", "block", "skip", "stay"];

/** The state a row is counted under where its own has the same word: a kind the run never reached reads skipped, and data that is kept reads unchanged. */
const COUNTED_AS: Readonly<Partial<Record<RemovalState, RemovalState>>> = { "not-run": "skip", keep: "stay" };

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

/** The optional permissions the token lacks, each once, as the rows of the kinds it could not look for name them. */
function lackedOf(removed: Listed): string {
  return LIST.format([...new Set(removed.rows.flatMap((row) => (row.state === "stay" && row.right !== undefined ? [row.right] : [])))]);
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
 * Say which kinds the token could not look for and the permission it lacks, in a dry run or in a run.
 *
 * @returns the sentence; none where the token looked for every kind
 */
export function unlookedWords(removed: Listed, run: Run): string | undefined {
  const unlooked = unlookedOf(removed);
  if (unlooked.length === 0) return undefined;

  return `${LIST.format(unlooked)} ${leftUnlooked(removed, run) ? "may still exist" : "would be skipped"}: the account token lacks ${lackedOf(removed)}`;
}

/**
 * Say what to do about the kinds a run could not look for.
 *
 * @param careful - the careful choices of the run's line, which the sentence names as the next step's command line holds them
 * @param provider - the provider, whose name says where a kind is deleted by hand
 * @param kinds - what the sentence calls the kinds: their names, or `them` after a sentence that named them
 * @returns the `Fix:` line; none for a dry run, and where the token looked for every kind
 */
export function unlookedFix(removed: Listed, run: Run, careful: readonly Careful[], provider: Provider, kinds = LIST.format(unlookedOf(removed))): string | undefined {
  return leftUnlooked(removed, run) ? `Fix: add ${lackedOf(removed)} and ${againWords(careful)}, or delete ${kinds} at ${provider.name}` : undefined;
}

/** The line of the kinds a dry run says the token cannot look for; none where it looks for every kind. */
function unlookedLines(removed: Listed): Line[] {
  const words = unlookedWords(removed, "dry-run");

  return words === undefined ? [] : [{ tone: "warning", text: words }];
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
  const proof = plain(`A real run prompts for ${removed.confirm}, or accepts --confirm ${removed.confirm}`);
  const first = plain(LOGGED_IN);
  if (removed.ready) return [proof, first, ...unlookedLines(removed), { tone: "done", text: `A run would remove ${kinds}` }];

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

  return [...lines.map((text): Line => ({ tone: "warning", text })), ...unlookedLines(listed)];
}

/**
 * Word what a run came to.
 *
 * @param careful - the careful choices of the run's line, which the sentence of a run that left a kind names as the next step's command line holds them
 * @param provider - the provider, whose name says where a kind the token could not look for is deleted by hand
 * @returns the last lines, the first in one shape for every run: what the run came to, then how many kinds it removed and how many it failed at, was blocked at, skipped, and left unchanged.
 *   A run that removed all it was to names what to do about a kind the token could not look for, and the logout that is left; one that did not names what to run next
 */
export function removedLines(removed: Listed, careful: readonly Careful[], provider: Provider): Line[] {
  const shown = removed.rows.map((row) => COUNTED_AS[row.state] ?? shownState(row));
  const others = COUNTED.flatMap((state) => {
    const rows = shown.filter((one) => one === state).length;

    return rows === 0 ? [] : [`, ${rows} ${STATES[state].apply}`];
  });
  const counts = `${countText(count(removed, ["remove", "gone"]), KIND)} removed${others.join("")}`;
  if (!removed.ready) return [...blockedLines(removed.blocked), { tone: "error", text: `The run is incomplete: ${counts}` }, nextLine(removed.blocked, againWords(careful))];

  const fix = unlookedFix(removed, "apply", careful, provider);
  const kept = count(removed, ["keep"]) > 0 ? " and the data is kept" : "";
  const done: Line = { tone: fix === undefined ? "done" : "warning", text: `The install is removed${kept}: ${counts}` };

  return [done, ...(fix === undefined ? [] : [plain(fix)]), plain(LOGGED_IN_AFTER)];
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
