// The last check or repair of the install's domain, as the install remembers it: when it ran, who ran it, and how each piece stood.
//
//   ok            the piece stands as the install needs it
//   needs_repair  it is missing or changed
//   not_set_up    it is optional, and was left out
//   unread        the run could not say: the token lacked a right, the piece failed, or the run stopped before it
//
// It is a memory of one run, never the state now, and it holds nothing of the token the run was given.
// Beside the run the install keeps one fact of its own: when a user was last added or removed and the change did not reach the domain.
// The domain's login lets in the users it was last given, by a repair or by the install itself, so that change waits for one of the two.
// It keeps the same fact of the settings the domain's rules are written from: those rules stand as they were last written.

import * as v from "valibot";

import { HOLDER, MOMENT } from "./fields";
import type { Mend } from "./problem";
import type { RuleSettings } from "./settings";

/** The longest name of a piece's kind that is kept. */
const MOST_KIND_LENGTH = 100;

/** The longest text about a piece that is kept. */
const MOST_DETAIL_LENGTH = 600;

/** The most pieces one run is remembered with. */
const MOST_PIECES = 200;

/** What a piece can be for, the part that matters most to a person first. */
const WEIGHTS = ["login", "reach", "rest"] as const;

/** What every remembered piece holds: its kind and what names it, both in the provider's words, and what it is for. `login` guards private sites, `reach` is what makes a site answer at its address. */
const NAMED = {
  piece: v.pipe(v.string(), v.maxLength(MOST_KIND_LENGTH)),
  detail: v.pipe(v.string(), v.maxLength(MOST_DETAIL_LENGTH)),
  part: v.picklist(WEIGHTS),
};

/** One piece as a run left it. Only an unread piece says why, and only one unread for a missing right names the right. */
const CHECKED_PIECE = v.union([
  v.strictObject({ ...NAMED, state: v.picklist(["ok", "needs_repair", "not_set_up"]) }),
  v.strictObject({ ...NAMED, state: v.literal("unread"), reason: v.picklist(["failed", "not_run"]) }),
  v.strictObject({ ...NAMED, state: v.literal("unread"), reason: v.literal("missing_right"), right: v.pipe(v.string(), v.maxLength(MOST_KIND_LENGTH)) }),
]);

/** The last run: the moment it ran, who ran it, whether it only read, and every piece in the order the run worked in. */
export const DOMAIN_CHECK = v.strictObject({
  ran_at: MOMENT,
  by: HOLDER,
  run: v.picklist(["check", "repair"]),
  pieces: v.pipe(v.array(CHECKED_PIECE), v.maxLength(MOST_PIECES)),
});

/** The last run as the install reads it back, with the moment the users last changed and nothing carried it to the domain, and the same of the settings the domain's rules are written from: `null` when none waits. */
export type RememberedCheck = DomainCheck & { readonly users_changed_at: number | null; readonly rules_changed_at: number | null };

/** What a try to carry the users to the domain came to, as a change of them is settled by it. */
export interface CarriedUsers {
  /** The users the domain took, in their stored order, or `null` where it is unknown what the domain holds after the try. */
  readonly users: readonly string[] | null;

  /** The mark the try began under, or the moment it began: a mark later than it says the users changed, or another try wrote the domain, while this one was under way. */
  readonly since: number;
}

/** What a try to carry the settings of the domain's rules to the domain came to, as a change of them is settled by it. */
export interface CarriedRules {
  /** The values the domain's rules were written from, or `null` where it is unknown what the rules hold after the try. */
  readonly rules: RuleSettings | null;

  /** The mark the try began under: a mark later than it says the settings changed, or another try wrote the rules, while this one was under way. */
  readonly since: number;
}

/** One remembered piece. */
export type CheckedPiece = v.InferOutput<typeof CHECKED_PIECE>;

/** The last run, as the install keeps it. */
export type DomainCheck = v.InferOutput<typeof DOMAIN_CHECK>;

/** How much a piece matters to what a person must act on, the most first: a piece of the login that is not ok, one that makes a site answer, any other, and last a piece that is ok. */
function weightOf(piece: CheckedPiece): number {
  if (piece.state === "ok") return WEIGHTS.length;

  return WEIGHTS.indexOf(piece.part);
}

/**
 * Say what a run showed that ends problems.
 *
 * @returns `login_stands` for a check or a repair that read a piece of the login and left every one of them ok; `repaired` for a repair that read a piece and left none to repair and none unread. A run that read nothing shows nothing
 */
export function mendsOf(check: Pick<DomainCheck, "run"> & { readonly pieces: readonly CheckedPiece[] }): readonly Mend[] {
  const login = check.pieces.filter((piece) => piece.part === "login");
  const stands = login.length > 0 && login.every((piece) => piece.state === "ok");
  const repaired = check.run === "repair" && check.pieces.length > 0 && check.pieces.every((piece) => piece.state === "ok" || piece.state === "not_set_up");

  return [...(stands ? (["login_stands"] as const) : []), ...(repaired ? (["repaired"] as const) : [])];
}

/**
 * Cut a run's pieces to what is kept: 200 at most, each text at its longest length. Of a longer run the pieces that matter least give way, the last of them first.
 *
 * @returns pieces that pass `DOMAIN_CHECK`, in the run's order, whatever a provider's texts hold
 */
export function keptPieces(pieces: readonly CheckedPiece[]): CheckedPiece[] {
  const places = pieces.map((_piece, place) => place);
  const weighed = places.sort((left, right) => weightOf(pieces[left] as CheckedPiece) - weightOf(pieces[right] as CheckedPiece) || left - right);
  const fitting = new Set(weighed.slice(0, MOST_PIECES));

  return pieces.filter((_piece, place) => fitting.has(place)).map((piece) => {
    const cut = { ...piece, piece: piece.piece.slice(0, MOST_KIND_LENGTH), detail: piece.detail.slice(0, MOST_DETAIL_LENGTH) };

    return "right" in cut ? { ...cut, right: cut.right.slice(0, MOST_KIND_LENGTH) } : cut;
  });
}
