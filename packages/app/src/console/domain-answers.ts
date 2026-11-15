// What the Domain screen and the setup screen are answered after a run: every piece as a row to draw, one line that counts what is left, and the steps only a person can do. A run that read no table is answered as a refusal that names the box it is about.
//
//   2 to repair                          Paste the token again and press Repair.
//   Piece         State     Detail
//   DNS record    missing   poplin.example.com
//
// The words are made here, so both screens say the same and the client draws what it is given.

import type { DomainCheck } from "@poplin/core/src/records/domain-check";

import { refusalSentence } from "../dashboard/page/notices";
import type { DomainRun } from "../dashboard/domain/domain-run";
import type { DomainReading, DomainRow, DomainState, DomainStep } from "../dashboard/domain/records";

/** The label of each state and how it is read: `good` stands, `bad` needs work, `idle` was left as it is and is no failure. */
const STATES: Readonly<Record<DomainState, Pick<ShownRow, "state" | "tone">>> = {
  present: { state: "present", tone: "good" },
  missing: { state: "missing", tone: "bad" },
  differs: { state: "differs", tone: "bad" },
  "left-out": { state: "left out", tone: "idle" },
  optional: { state: "not set up: optional", tone: "idle" },
  created: { state: "created", tone: "good" },
  changed: { state: "changed", tone: "good" },
  removed: { state: "removed", tone: "good" },
  failed: { state: "failed", tone: "bad" },
  "not-run": { state: "not run", tone: "idle" },
};

/** The states a repair would change. */
const TO_REPAIR: readonly DomainState[] = ["missing", "differs"];

/** The states of a row that a run with a failure in it left as it was found. */
const UNDONE: readonly DomainState[] = [...TO_REPAIR, "not-run"];

/** The states a repair leaves on what it changed. */
const REPAIRED: readonly DomainState[] = ["created", "changed", "removed"];

/** How a remembered piece is drawn, by its state or by why it was not read, and the state of a run's row it is counted as. A piece no run reached is counted as not done, as one that failed is: nothing says it stands. */
const KEPT: Readonly<Record<Exclude<KeptPiece["state"], "unread"> | UnreadReason, Pick<ShownRow, "state" | "tone"> & { readonly counts: DomainState }>> = {
  ok: { state: "present", tone: "good", counts: "present" },
  needs_repair: { state: "needs repair", tone: "bad", counts: "missing" },
  not_set_up: { state: "not set up", tone: "idle", counts: "left-out" },
  failed: { state: "failed", tone: "bad", counts: "failed" },
  missing_right: { state: "failed", tone: "bad", counts: "failed" },
  not_run: { state: "not run", tone: "idle", counts: "failed" },
};

/** The sentence of a refusal that reads otherwise after a run than after any other request: here it is the database that took no more, after the plug had answered. */
const RUN_SENTENCES: Readonly<Record<string, string>> = {
  allowance_spent: "The database takes no more today: its free allowance for the day is used up. Try again after midnight UTC.",
};

/** The box of the form each refusal is about. A refusal missing here is about no box. */
const ABOUT: Readonly<Record<string, string>> = { token: "token", no_domain: "domain", bad_domain: "domain", bad_login: "login" };

/** What is said after the count when a row failed. */
const AFTER_FAILED = "Each failed row says why, or what to add. Then paste the token and press Repair again.";

/** What is said after the count when rows wait for a repair: the token is never kept, so it is pasted again. */
const AFTER_CHECK = "Paste the token again and press Repair.";

/** What is said after the count of a remembered run that left work. */
const AFTER_OPEN = "Paste a token and press Repair.";

/** One piece as a screen draws it. */
interface ShownRow {
  /** The kind of the piece, in the provider's words. */
  readonly piece: string;

  /** The words of its state. */
  readonly state: string;

  /** How the state is read. */
  readonly tone: "good" | "bad" | "idle";

  /** What names the piece, what was done, or what to add. */
  readonly detail: string;
}

/** The one line over the rows. */
interface Summary {
  /** The count, such as `2 to repair`. */
  readonly line: string;

  /** Whether anything is left to do. */
  readonly tone: "good" | "bad";

  /** What to do next, or `null` when nothing is left. */
  readonly next: string | null;

  /** What is said of the optional pieces that are not set up, or `null` when there is none. */
  readonly optional: string | null;
}

/** A run that read its table, as a screen draws it. */
interface RunDone {
  readonly ok: true;
  readonly run: DomainRun;
  readonly rows: readonly ShownRow[];
  readonly steps: readonly DomainStep[];
  readonly summary: Summary;
}

/** A refusal as the client reads it: the code, the box it is about, and the sentence to show. */
interface RunRefused {
  readonly ok: false;
  readonly code: string;
  readonly about: string | null;
  readonly sentence: string;
}

/** Why a remembered piece was not read. */
type UnreadReason = Extract<KeptPiece, { readonly state: "unread" }>["reason"];

/** One piece as the install remembers it from its last run. */
type KeptPiece = DomainCheck["pieces"][number];

/** What the install remembers of its domain: the last run that read its pieces, `null` before any, and whether that run is too old to go by. */
interface Kept {
  readonly check: DomainCheck | null;
  readonly stale: boolean;
}

/** The remembered run, as a screen draws it. */
interface Last {
  /** When the run was, in milliseconds since the epoch. */
  readonly ran_at: number;

  /** Who ran it. */
  readonly by: string;

  /** Whether it only read. */
  readonly run: DomainRun;

  /** Whether it is too old to go by. */
  readonly stale: boolean;

  /** Every piece as that run left it. */
  readonly rows: readonly ShownRow[];

  /** The line that counts them. */
  readonly summary: Summary;
}

function count(rows: readonly DomainRow[], states: readonly DomainState[]): number {
  return rows.filter((row) => states.includes(row.state)).length;
}

/** An optional piece is no work left over: it is said apart from the count. */
function optionalNote(rows: readonly DomainRow[]): string | null {
  const optional = count(rows, ["optional"]);
  if (optional === 0) return null;

  return `${optional} optional, not set up. The install works without them. Each such row names the right that switches it on.`;
}

/** A run goes on past a row that failed for a right and stops at any other failure, and the rows alone do not say which: the line counts what is left and claims neither. */
function summaryOf(run: DomainRun, rows: readonly DomainRow[]): Summary {
  const optional = optionalNote(rows);
  const failed = count(rows, ["failed"]);
  if (failed > 0) return { line: `${failed + count(rows, UNDONE)} not done`, tone: "bad", next: AFTER_FAILED, optional };

  const waiting = count(rows, TO_REPAIR);
  if (waiting > 0) return { line: `${waiting} to repair`, tone: "bad", next: AFTER_CHECK, optional };

  const repaired = count(rows, REPAIRED);
  if (run === "repair" && repaired > 0) return { line: `${repaired} repaired`, tone: "good", next: null, optional };

  return { line: "Nothing to repair", tone: "good", next: null, optional };
}

/**
 * Write the run the install remembers as a screen draws it on opening.
 *
 * @returns the pieces of that run with the line that counts them; `null` for an install that remembers none
 */
export function keptAnswer(kept: Kept): Last | null {
  const { check, stale } = kept;
  if (check === null) return null;

  const drawn = check.pieces.map((piece) => ({ piece, as: KEPT[piece.state === "unread" ? piece.reason : piece.state] }));
  const counted = summaryOf("check", drawn.map(({ piece, as }) => ({ object: piece.piece, detail: piece.detail, part: piece.part, state: as.counts })));
  const rows = drawn.map(({ piece, as }) => ({ piece: piece.piece, state: as.state, tone: as.tone, detail: piece.detail }));

  return { ran_at: check.ran_at, by: check.by, run: check.run, stale, rows, summary: { ...counted, next: counted.next === null ? null : AFTER_OPEN } };
}

/**
 * Write a refusal of a run as the client reads it.
 *
 * @param code - why the run read no table, or why it was never begun, such as `too_many_tries`
 * @returns the refusal with its sentence, about the box of the form it names: `token`, `domain`, or `login`; `null` for one about no box
 */
export function runRefusal(code: string): RunRefused {
  const sentence = Object.hasOwn(RUN_SENTENCES, code) ? RUN_SENTENCES[code] : undefined;

  return { ok: false, code, about: Object.hasOwn(ABOUT, code) ? (ABOUT[code] ?? null) : null, sentence: sentence ?? refusalSentence(code) };
}

/**
 * Write a run that read its table as a screen draws it.
 *
 * @param reading - the run's reading, with the token already taken out of every text
 * @returns the rows in the run's order, the line that counts them, and the steps only a person can do
 */
export function runDone(run: DomainRun, reading: Extract<DomainReading, { readonly ok: true }>): RunDone {
  const rows = reading.rows.map((row) => ({ piece: row.object, ...STATES[row.state], detail: row.detail }));

  return { ok: true, run, rows, steps: reading.steps, summary: summaryOf(run, reading.rows) };
}
