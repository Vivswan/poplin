// What the Domain screen is answered after a run: every piece as a row to draw, one line that counts what is left, and the steps only a person can do. A run that read no table is answered as a refusal that names the box it is about.
//
//   2 to repair                      or, with nothing to repair after a user was added or removed: Users changed. Press Repair.
//   Piece         State     Detail
//   DNS record    missing   poplin.example.com
//
// The words are made here, and the client draws what it is given.

import type { DomainCheck } from "@poplin/core/src/records/domain-check";
import { domainStateWords } from "@poplin/core/src/records/domain-states";

import { refusalSentence } from "./notices";
import type { DomainRun } from "./domain/domain-run";
import type { DomainReading, DomainRow, DomainState, DomainStep } from "./domain/records";

/** How each state is read: `good` stands, `bad` needs work, `idle` was left as it is and is no failure. Its words are core's. */
const TONES: Readonly<Record<DomainState, ShownRow["tone"]>> = {
  present: "good",
  missing: "bad",
  differs: "bad",
  "left-out": "idle",
  optional: "idle",
  created: "good",
  changed: "good",
  removed: "good",
  failed: "bad",
  "not-run": "idle",
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
  not_set_up: { state: "optional", tone: "idle", counts: "left-out" },
  failed: { state: "failed", tone: "bad", counts: "failed" },
  missing_right: { state: "failed", tone: "bad", counts: "failed" },
  not_run: { state: "not run", tone: "idle", counts: "failed" },
};

/** The sentence of a refusal that reads otherwise after a run than after any other request: here it is the database that took no more, after the plug had answered. */
const RUN_SENTENCES: Readonly<Record<string, string>> = {
  allowance_spent: "The database takes no more today: its free allowance for the day is used up. Try again after midnight UTC.",
};

/** The line of a domain with nothing to repair whose users changed since the last repair: the login lets in the users of that repair. */
const USERS_CHANGED: Summary = { line: "Users changed. Press Repair.", tone: "bad" };

/** The box of the form each refusal is about. A refusal missing here is about no box. */
const ABOUT: Readonly<Record<string, string>> = { token: "token" };

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
}

/** A run that read its table, as a screen draws it. */
interface RunDone {
  readonly ok: true;
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

/** What the install remembers of its domain: the last run that read its pieces, `null` before any, whether that run is too old to go by, and whether the users changed with no repair after it. */
interface Kept {
  readonly check: DomainCheck | null;
  readonly stale: boolean;
  readonly waits: boolean;
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

  /** Whether the users changed with no repair after it. */
  readonly waits: boolean;

  /** Every piece as that run left it. */
  readonly rows: readonly ShownRow[];

  /** The line that counts them. */
  readonly summary: Summary;
}

function count(rows: readonly DomainRow[], states: readonly DomainState[]): number {
  return rows.filter((row) => states.includes(row.state)).length;
}

/** A run goes on past a row that failed for a right and stops at any other failure, and the rows alone do not say which: the line counts what is left and claims neither. An optional piece that is not set up is no work left over. */
function summaryOf(run: DomainRun, rows: readonly DomainRow[], waits: boolean): Summary {
  const failed = count(rows, ["failed"]);
  if (failed > 0) return { line: `${failed + count(rows, UNDONE)} not done`, tone: "bad" };

  const waiting = count(rows, TO_REPAIR);
  if (waiting > 0) return { line: `${waiting} to repair`, tone: "bad" };

  if (waits) return USERS_CHANGED;

  const repaired = count(rows, REPAIRED);
  if (run === "repair" && repaired > 0) return { line: `${repaired} repaired`, tone: "good" };

  return { line: "Nothing to repair", tone: "good" };
}

/**
 * Write the run the install remembers as a screen draws it on opening.
 *
 * @returns the pieces of that run with the line that counts them; `null` for an install that remembers none
 */
export function keptAnswer(kept: Kept): Last | null {
  const { check, stale, waits } = kept;
  if (check === null) return null;

  const drawn = check.pieces.map((piece) => ({ piece, as: KEPT[piece.state === "unread" ? piece.reason : piece.state] }));
  const counted = drawn.map(({ piece, as }) => ({ object: piece.piece, detail: piece.detail, part: piece.part, state: as.counts }));
  const summary = summaryOf("check", counted, waits);
  const rows = drawn.map(({ piece, as }) => ({ piece: piece.piece, state: as.state, tone: as.tone, detail: piece.detail }));

  return { ran_at: check.ran_at, by: check.by, run: check.run, stale, waits, rows, summary };
}

/**
 * Write a refusal of a run as the client reads it.
 *
 * @param code - why the run read no table, or why it was never begun, such as `too_many_tries`
 * @param tokenFor - what a token of this install must be made for, which a refused token is told
 * @returns the refusal with its sentence, about the box of the form it names, `token`; `null` for one about no box
 */
export function runRefusal(code: string, tokenFor: string): RunRefused {
  const sentences: Readonly<Record<string, string>> = { ...RUN_SENTENCES, token: `Account token refused: paste the whole account token, made for ${tokenFor}.` };
  const sentence = Object.hasOwn(sentences, code) ? sentences[code] : undefined;

  return { ok: false, code, about: Object.hasOwn(ABOUT, code) ? (ABOUT[code] ?? null) : null, sentence: sentence ?? refusalSentence(code) };
}

/**
 * Write a run that read its table as a screen draws it.
 *
 * @param reading - the run's reading, with the token already taken out of every text
 * @param waits - whether the users changed with no repair after it, this run included
 * @returns the rows in the run's order, the line that counts them, and the steps only a person can do
 */
export function runDone(run: DomainRun, reading: Extract<DomainReading, { readonly ok: true }>, waits: boolean): RunDone {
  const rows = reading.rows.map((row) => ({ piece: row.object, state: domainStateWords(row.state), tone: TONES[row.state], detail: row.detail }));

  return { ok: true, rows, steps: reading.steps, summary: summaryOf(run, reading.rows, waits) };
}
