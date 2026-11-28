// The settings the domain's rules are written from, carried to those rules by the install itself after a change of them, with the key the install keeps.
//
//   the rules took the settings                carried   the change waits for the scheduled run to confirm it
//   the same, on a try that confirms           carried   the change waits no more, where the rules stood and nothing was written
//   the provider keeps no such rules           carried   the change waits no more: there is nothing to confirm
//   no change of them waits                    carried   the provider is asked nothing
//   the install holds no key                   waits     a repair on Domain writes the rules, as it always did
//   the key is refused, or lacks a right       waits     noted as a problem of the domain
//   the domain is not at the provider          waits     noted as a problem of the domain
//   the provider gave no usable answer         waits     the scheduled run tries again
//   the same, on an install that keeps no run of its domain: nothing remembers that the change waits, so it is noted as a problem too
//   values that were stale when the provider took them, there: written once more, and noted as a problem if stale again
//
// The change is stored before any of this, with a mark that it waits, and stands whatever the provider answers.
// A try gives that mark a later one and reads the settings in one statement, writes the rules, and settles in a second statement.
// A read of the rules just after a write may still answer them as they were, so a try can leave out a write the rules need: no try after a change lets the mark go.
// The scheduled run tries again once the mark is old enough, as a try that confirms, and that one lets the mark go: only where it wrote nothing, the stored values are the ones it compared, and no mark was set since the run saw it.
// A try sets no mark of its own: one the provider refused leaves waiting exactly what waited.
// A version may want a rule the one before did not make: the run after an update sets the change to wait and carries the rules anew, and the run after it confirms them as it confirms any change.

import { noteProblem } from "@poplin/core/src/actions/install/problems";
import type { Install } from "@poplin/core/src/actions/records";
import type { CarriedRules } from "@poplin/core/src/records/domain-check";
import { RULE_SETTINGS, type RuleSettings } from "@poplin/core/src/records/settings";
import type { Context } from "hono";

import { type FollowRefusal, type FollowTry, trusts } from "../access/users-follow";
import { runPastAnswer } from "../later";

/** How often one change writes the rules: once, and once more for settings that changed while the first were written. */
const MOST_TRIES = 2;

/** The refusals no later try mends: a person must repair the domain. */
const NOTED: readonly FollowRefusal[] = ["key_refused", "lacks_right", "not_made"];

/** Why a change waits: a refusal of the provider's side, settings that changed again while they were carried, or, as `forgotten`, a try that failed on an install with nothing to remember it by. */
type Waiting = FollowRefusal | "changed_again" | "forgotten";

/** Whether the provider took the stored settings, and why not where it did not. */
type Followed = { readonly carried: true } | { readonly carried: false; readonly why: Waiting };

/** What became of the rules in a try the provider took: `written`, `stood` where they read as the settings ask and nothing was written, or `none` where the provider keeps no such rules. */
type Outcome = "written" | "stood" | "none";

/** The provider's side of the rules of the domain that are written from the install's settings. */
export interface RulesFollow {
  /** Whether the install holds a key, so a change is carried with no person. No call to the provider. */
  holdsKey(): boolean;

  /** Make the rules match the settings, and nothing else of the domain. It throws for nothing the provider answers, and no answer holds the key. A try that stopped part of the way is a refusal, and one the provider took says what became of the rules. */
  push(rules: RuleSettings): Promise<{ readonly ok: true; readonly rules: Outcome } | { readonly ok: false; readonly refusal: FollowRefusal }>;
}

function rulesOf(settings: RuleSettings): RuleSettings {
  return { outside_pages: settings.outside_pages, search_engines_allowed: settings.search_engines_allowed };
}

function same(left: RuleSettings, right: RuleSettings): boolean {
  return RULE_SETTINGS.every((key) => left[key] === right[key]);
}

/**
 * Say what a try the provider took settles the change with. Rules the provider does not keep need no read to confirm them.
 *
 * @param trusted - whether the try may trust its read of the rules: a first try, made long enough after the last change or try before it
 */
function carriedBy(rules: RuleSettings, outcome: Outcome, since: number, trusted: boolean): CarriedRules {
  const confirmed = outcome === "none" || (outcome === "stood" && trusted);

  return confirmed ? { rules, since, confirmed } : { rules, since };
}

/**
 * Say whether a change of the settings names one the domain's rules are written from.
 *
 * @param changes - the body of a change, unchecked
 */
export function namesRule(changes: unknown): boolean {
  return typeof changes === "object" && changes !== null && RULE_SETTINGS.some((key) => key in changes);
}

/**
 * Set a change of the rules' settings to wait anew, whether or not one waited, so that only a try that confirms the rules ends it.
 *
 * @returns whether the install keeps a run of its domain, which is what remembers the change
 */
async function waitAnew(install: Pick<Install, "database" | "now">): Promise<boolean> {
  return (await install.database.settleRules({ rules: null, since: 0 }, install.now())).waits;
}

/**
 * Leave a change waiting after a try the provider refused, and note the one no later try mends: a refusal a person must repair, and any refusal on an install that keeps no run of its domain to remember the change by.
 *
 * A refused try may have written a part of the rules, so what they hold is unknown: the change is set to wait anew, also where a newer try had settled it meanwhile.
 */
async function refused(install: Pick<Install, "database" | "now">, refusal: FollowRefusal): Promise<Followed> {
  const remembers = await waitAnew(install);
  if (!remembers || NOTED.includes(refusal)) await noteProblem(install, "rules_not_carried");

  return { carried: false, why: !remembers && refusal === "unreachable" ? "forgotten" : refusal };
}

/**
 * Carry the settings of the domain's rules to the provider where a change of them waits, and settle the change where a try that confirms found the rules standing.
 *
 * @param how - since when nothing must have changed or tried for this try's read of the rules to be trusted; left out, the try trusts no read, and the change waits on for one that does
 * @returns whether the provider took the stored settings. A refusal leaves the change waiting, and one that no later try mends is noted as the problem `rules_not_carried`.
 *   So are values that stayed stale on an install with no run to wait in. An install with no key is asked nothing, and notes nothing
 * @throws {Error} the database failed: the change waits on
 */
export async function followRules(install: Pick<Install, "database" | "now">, follow: RulesFollow, how: FollowTry = "carry"): Promise<Followed> {
  if (!follow.holdsKey()) return { carried: false, why: "no_key" };

  let waits = false;
  let stale = false;

  for (let tries = 0; tries < MOST_TRIES; tries += 1) {
    const { settings, mark, last } = await install.database.claimRules(install.now());
    // An install with no settings has no rules to write, and one whose change was settled meanwhile has none to carry, unless this very call wrote stale values a moment ago.
    if (settings === undefined || (mark === null && !stale)) return { carried: true };

    const rules = rulesOf(settings);
    const pushed = await follow.push(rules);
    if (!pushed.ok) return refused(install, pushed.refusal);

    // A second try comes just after the first one's write, so its read confirms nothing.
    // An install that kept no run of its domain at the claim may keep one by now, with a later change settled in it: the try settles all the same, and writes nothing where there is still no run.
    const settled = await install.database.settleRules(carriedBy(rules, pushed.rules, mark ?? 0, tries === 0 && trusts(how, last)), install.now());
    waits = settled.waits;
    // Only the stored settings say that the values written are those of an earlier moment: the mark waits on after every try that confirmed nothing.
    stale = settled.settings !== undefined && !same(rulesOf(settled.settings), rules);
    if (!stale) return { carried: true };
  }

  if (waits) return { carried: false, why: "changed_again" };

  // Stale values with no run to wait in: nothing carries them later.
  await noteProblem(install, "rules_not_carried");

  return { carried: false, why: "forgotten" };
}

/**
 * Carry the settings of the domain's rules to the provider whether or not a change of them waits: for the run after an update, since a version may want a rule the one before did not make.
 *
 * The change is set to wait first, so the rules are written as after a change, and the next try that confirms them ends the waiting. An install that keeps no run of its domain has nothing to wait in, and is written all the same.
 *
 * @returns what a try after a change answers: an install with no key is asked nothing, and a refusal is noted as a change's would be
 * @throws {Error} the database failed: nothing was carried
 */
export async function carryRulesAnew(install: Pick<Install, "database" | "now">, follow: RulesFollow): Promise<Followed> {
  if (!follow.holdsKey()) return { carried: false, why: "no_key" };

  await waitAnew(install);

  return followRules(install, follow);
}

/**
 * Carry the settings of the domain's rules after a change of them was stored, with no answer held for it where the host keeps a request alive past its answer.
 *
 * Nothing it does changes the answer. A try that fails leaves the change waiting under its mark, for the scheduled run to carry.
 *
 * @param context - the request the change came in
 * @param follow - the provider's side of the rules; without one, or with one that holds no key, nothing is read or asked
 */
export async function carryRules(context: Context, install: Pick<Install, "database" | "now">, follow: RulesFollow | undefined): Promise<void> {
  if (follow === undefined || !follow.holdsKey()) return;

  await runPastAnswer(
    context,
    followRules(install, follow).then(
      () => undefined,
      () => undefined,
    ),
  );
}
