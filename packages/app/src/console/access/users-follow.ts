// The users carried to the login in front of the install, by itself, after every change of them: the provider's list is written with the key the install keeps.
//
//   the list took the users                    carried   the change waits no more
//   the install holds no key                   waits     Domain says to press Repair, which makes a key
//   the key is refused, or lacks a right       waits     noted as a problem of the domain
//   the list is not at the provider            waits     noted as a problem of the domain
//   the provider gave no usable answer         waits     the scheduled run tries again
//   the list was written, the rest refused     waits     as its refusal above, in words that claim nothing of the list
//   the same, on an install that keeps no run of its domain: nothing remembers that the change waits, so it is noted as a problem too
//
// The change of the users is stored before any of this, and stands whatever the provider answers.
// The list carried is read after the change was stored, under a mark set in the same step. The change is settled only if the stored users are still that list and no mark was set since: by a later change, or by another try at the provider.
// A list that is stale by then is carried once more, and where that is too the change is left waiting.
// A try the provider refused sets a mark anew before it answers: its write of the list may have landed after a newer one that was settled meanwhile.
// The list is written whole by every try. The alerts that go to the first user are compared, and a read just after a write may still answer them as they were: they wait under a mark of their own, which no try after a change lets go.
// The scheduled run tries again once that mark is old enough, as a try that confirms, and lets it go where nothing but the list was written.

import { noteProblem } from "@poplin/core/src/actions/install/problems";
import type { Install } from "@poplin/core/src/actions/records";
import type { Login } from "@poplin/core/src/auth/logins";

import type { KeyRefusal } from "../key/records";

/** How often one change carries a list: once, and once more for a list that changed while the first was under way. */
const MOST_TRIES = 2;

/** What the screen says, after the word that the change is saved, of each way it did not reach the provider's list. `{where}` is the provider's name for itself. */
const SENTENCES: Readonly<Record<Waiting, string>> = {
  no_key: "poplin holds no key for {where}, so the login list there is as it was. Open Domain and press Repair.",
  key_refused: "{where} refused poplin's key, so the login list there is as it was. Open Domain and press Repair.",
  lacks_right: "poplin's key may not change the login list at {where}. Open Domain and press Repair.",
  not_made: "The login list at {where} is missing. Open Domain and press Repair.",
  unreachable: "The login list at {where} was not reached; it is tried again by itself.",
  forgotten: "The login list at {where} is not up to date. Open Domain and press Repair.",
  half_retried: "The login list at {where} was written, but the change is not complete; the rest is tried again by itself.",
  half_refused: "The login list at {where} was written, but the change is not complete. Open Domain and press Repair.",
  changed_again: "The users changed again meanwhile; the login list at {where} is brought up to date by itself.",
};

/** The refusals no later try mends: a person must repair the domain. An install with no key says so on Domain already. */
const NOTED: readonly FollowRefusal[] = ["key_refused", "lacks_right", "not_made"];

/** Why the provider's list did not take the users: one of the four answers of a call made with the install's key, or `not_made` for a list that is not at the provider, which a repair makes. */
export type FollowRefusal = KeyRefusal | "not_made";

/** Why a change waits: a refusal of the provider's side, users that changed again while they were carried, or as `forgotten` a try that failed on an install that remembers none. The `half` ones are a try that wrote the list and was refused the rest. */
type Waiting = FollowRefusal | "changed_again" | "forgotten" | "half_retried" | "half_refused";

/** How a try reads the provider: as `carry` it trusts no read. Otherwise it trusts its reads where nothing changed or tried after a moment, one long enough ago that the provider's reads show every write made by then. */
export type FollowTry = "carry" | { readonly quietSince: number };

/** What one try at the provider answered: `stood` says that the alerts read as going to the first user, so the list alone was written. A refusal says `written` where the list itself took the users and what else follows them did not. */
type Pushed = { readonly ok: true; readonly stood: boolean } | { readonly ok: false; readonly refusal: FollowRefusal; readonly written?: true };

/** A try at the provider that was refused. */
type Refusal = Extract<Pushed, { readonly ok: false }>;

/** The provider's side of the users: the list of who may log in, and whatever else there follows the first of them. */
export interface UsersFollow {
  /** The provider's name for itself, as a sentence says where the list is. */
  readonly where: string;

  /** Whether the install holds a key, so a change that waits is carried by a later try with no person. No call to the provider. */
  holdsKey(): boolean;

  /** Write the users into the provider's list, and nothing else of the login. It throws for nothing the provider answers, and no answer holds the key. */
  push(users: readonly Login[]): Promise<Pushed>;
}

/** Whether the users reached the provider, and for a change that waits the sentence a screen shows after the word that it is saved. */
type Followed = { readonly carried: true } | { readonly carried: false; readonly why: Waiting; readonly sentence: string };

/**
 * Say whether a try may trust what it read at the provider.
 *
 * @param last - the moment of the last change or try before this one, `undefined` where there was none
 * @returns `false` for a try that carries, and for one that came after a change or a try later than the moment it names
 */
export function trusts(how: FollowTry, last: number | undefined): boolean {
  return how !== "carry" && last !== undefined && last <= how.quietSince;
}

function waits(follow: UsersFollow, why: Waiting): Followed {
  return { carried: false, why, sentence: SENTENCES[why].replace("{where}", follow.where) };
}

function same(left: readonly Login[], right: readonly Login[]): boolean {
  return left.length === right.length && left.every((login, at) => login === right[at]);
}

/** The words of a refusal: its own, or for a try that wrote the list those that claim nothing of the list. A later try mends some, but none on an install that remembers nothing: there a person is told to repair. */
function waitingOf(pushed: Refusal, remembers: boolean): Waiting {
  const mends = remembers && !NOTED.includes(pushed.refusal);
  if (pushed.written === true) return mends ? "half_retried" : "half_refused";

  return mends || NOTED.includes(pushed.refusal) ? pushed.refusal : "forgotten";
}

/**
 * Leave a change waiting after a try the provider refused, and note the one no later try mends: a refusal a person must repair, and any refusal on an install that keeps no run of its domain to remember the change by.
 *
 * A mark is set anew whatever became of the one the try began under: the try may have written a list that is stale by now, after another try settled a newer one.
 * It is set too where the try began under none and a first run of the domain was kept while it was under way. On an install that still keeps none, the statement writes nothing.
 *
 * @param since - the mark the try began under, `undefined` on an install that kept no run then
 */
async function refused(install: Pick<Install, "database" | "now">, follow: UsersFollow, pushed: Refusal, since: number | undefined): Promise<Followed> {
  const { waits: remembers } = await install.database.settleUsers({ users: null, since: since ?? 0 }, install.now());
  if (!remembers || NOTED.includes(pushed.refusal)) await noteProblem(install, "users_not_carried");

  return waits(follow, waitingOf(pushed, remembers));
}

/**
 * Carry the users to the provider after a change of them was stored, and settle the change where the provider took them.
 *
 * Each try marks the users as waiting and reads them in one statement, writes them to the provider, and settles in a second statement, which lets the mark go only if nothing set one meanwhile.
 * A try the provider refused sets the mark anew in one more statement, and an install with no key is asked nothing at all.
 *
 * @param how - since when nothing must have changed or tried for this try's read of the alerts to be trusted; left out, the try trusts no read, and the alerts wait on for one that does
 * @returns whether the provider holds the stored users now. A refusal leaves the change waiting, and one that no later try mends is noted as the problem `users_not_carried`
 * @throws {Error} the database failed: the change waits on, unless the failure was of the statement that settles a list another try has since replaced at the provider
 */
export async function followUsers(install: Pick<Install, "database" | "now">, follow: UsersFollow, how: FollowTry = "carry"): Promise<Followed> {
  if (!follow.holdsKey()) return waits(follow, "no_key");

  let remembers = true;

  for (let tries = 0; tries < MOST_TRIES; tries += 1) {
    const claimed = await install.database.claimUsers(install.now());
    const { users } = claimed;
    // An install with no settings has no users to carry.
    if (users === undefined) return { carried: true };

    remembers = claimed.mark !== undefined;
    const pushed = await follow.push(users);
    if (!pushed.ok) return refused(install, follow, pushed, claimed.mark);

    const since = claimed.mark ?? 0;
    // A second try comes just after the first one's write, so its read confirms nothing.
    const confirmed = pushed.stood && tries === 0 && trusts(how, claimed.last);
    const settled = await install.database.settleUsers(confirmed ? { users, since, confirmed } : { users, since }, install.now());
    if (!settled.waits && settled.users !== undefined && same(settled.users, users)) return { carried: true };
  }

  if (remembers) return waits(follow, "changed_again");

  await noteProblem(install, "users_not_carried");

  return waits(follow, "forgotten");
}
