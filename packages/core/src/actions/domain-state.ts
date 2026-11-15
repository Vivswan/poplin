// What the install remembers of its domain: the last check or repair, how old that memory is, and the one thing a person must act on.
//
//   never checked                      note none
//   every needed piece ok              note none
//   the login needs repair             login_broken        private sites may be locked
//   a record or route needs repair     sites_unreachable   sites may not open
//   the users changed since a repair   users_changed       the domain's login still lets in the users of the last repair
//   any other piece needs repair       needs_repair
//   a piece could not be read          not_read
//   any of the four found, 30 days old check_again         the memory is too old to raise an alarm
//
// That the users changed is a fact the install wrote itself, so it stays raised however old the run is.
// A piece that is optional and was left out raises nothing. The record is a memory of one run: nothing here asks the provider.

import * as v from "valibot";

import type { Actor } from "../auth/scopes";
import { type CheckedPiece, DOMAIN_CHECK } from "../records/domain-check";
import { COUNT } from "../records/fields";
import { type Install, type Refused, refuse } from "./records";
import { DAY_MS } from "./site-object";

/** How old a remembered run may be and still raise its note: a domain changes only when a person changes it at the provider, and after a month the memory says too little of the state now to alarm anyone. */
const STALE_AFTER_MS = 30 * DAY_MS;

/** The sentence a person reads for each note. A code with no sentence does not compile. */
export const DOMAIN_SENTENCES: Readonly<Record<DomainNote["code"], string>> = {
  login_broken: "The login for private sites is missing or changed, so private sites may be locked. Open Domain and press Repair.",
  sites_unreachable: "A record or route of the domain is missing or changed, so sites may not open. Open Domain and press Repair.",
  users_changed: "Users changed. Open Domain and press Repair.",
  needs_repair: "A piece of the domain is missing or changed. Open Domain and press Repair.",
  not_read: "A piece of the domain could not be read. Open Domain and press Check.",
  check_again: "The last check of the domain is over 30 days old. Open Domain and press Check.",
};

/** The notes that outrank a change of the users: with one of them raised, private sites may be locked or sites may not open. */
const URGENT: readonly string[] = ["login_broken", "sites_unreachable"];

/** The one thing to act on: which sentence says it, and the kind of the piece it is about, in the provider's words. `users_changed` and `check_again` are about no piece, and `check_again` is never an alarm. */
const DOMAIN_NOTE = v.union([
  v.object({ code: v.picklist(["login_broken", "sites_unreachable", "needs_repair", "not_read"]), about: v.string() }),
  v.object({ code: v.picklist(["users_changed", "check_again"]), about: v.null() }),
]);

/** What the action answers: the last run and its age in milliseconds, both `null` before any run was kept; whether it is over 30 days old; whether the users changed with no repair after it; and what a person must act on. */
export const DOMAIN_STATE = v.object({ check: v.nullable(DOMAIN_CHECK), age: v.nullable(COUNT), stale: v.boolean(), waits: v.boolean(), note: v.union([v.literal("none"), DOMAIN_NOTE]) });

/** The one thing to act on. */
type DomainNote = v.InferOutput<typeof DOMAIN_NOTE>;

/** What the install remembers of its domain. */
type DomainState = { readonly ok: true } & Readonly<v.InferOutput<typeof DOMAIN_STATE>>;

/** The note of a run's pieces, the most serious first: the login, then what makes a site answer, then the first other piece that needs repair or could not be read. */
function noteOf(pieces: readonly CheckedPiece[]): "none" | Extract<DomainNote, { about: string }> {
  const broken = pieces.filter((piece) => piece.state === "needs_repair");
  const login = broken.find((piece) => piece.part === "login");
  if (login !== undefined) return { code: "login_broken", about: login.piece };

  const reach = broken.find((piece) => piece.part === "reach");
  if (reach !== undefined) return { code: "sites_unreachable", about: reach.piece };

  const [other] = broken;
  if (other !== undefined) return { code: "needs_repair", about: other.piece };

  const unread = pieces.find((piece) => piece.state === "unread");

  return unread === undefined ? "none" : { code: "not_read", about: unread.piece };
}

/**
 * Say what the install remembers of its domain, and the one thing to act on. It is one read of the database, and asks the provider nothing.
 *
 * @returns the last run with its age and the note; `none` before any run and when every needed piece stood. A run over 30 days old raises `check_again` in place of whatever it found, and nothing when it found nothing.
 *   Users that changed with no repair after it raise `users_changed` over all but a broken login or site that a run under 30 days old found.
 *   `not_allowed` for anyone but an admin
 */
export async function domainState(install: Pick<Install, "database" | "now">, actor: Actor): Promise<DomainState | Refused<"not_allowed">> {
  if (actor.scope !== "admin") return refuse("not_allowed");

  const remembered = await install.database.readDomainCheck();
  if (remembered === undefined) return { ok: true, check: null, age: null, stale: false, waits: false, note: "none" };

  const { users_changed_at: changedAt, ...check } = remembered;
  const age = Math.max(0, install.now() - check.ran_at);
  const stale = age > STALE_AFTER_MS;
  const waits = changedAt !== null;
  const found = noteOf(check.pieces);
  const urgent = !stale && found !== "none" && URGENT.includes(found.code);
  if (waits && !urgent) return { ok: true, check, age, stale, waits, note: { code: "users_changed", about: null } };

  return { ok: true, check, age, stale, waits, note: stale && found !== "none" ? { code: "check_again", about: null } : found };
}
