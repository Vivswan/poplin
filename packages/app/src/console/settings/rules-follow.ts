// The settings the domain's rules are written from, carried to those rules by the install itself after a change of them, with the key the install keeps.
//
//   the rules took the settings                carried   the change waits no more
//   no change of them waits                    carried   the provider is asked nothing
//   the install holds no key                   waits     a repair on Domain writes the rules, as it always did
//   the key is refused, or lacks a right       waits     noted as a problem of the domain
//   the domain is not at the provider          waits     noted as a problem of the domain
//   the provider gave no usable answer         waits     the scheduled run tries again
//   the same, on an install that keeps no run of its domain: nothing remembers that the change waits, so it is noted as a problem too
//
// The change is stored before any of this, with a mark that it waits, and stands whatever the provider answers.
// A try gives that mark a later one and reads the settings in one statement, writes the rules, and settles in a second statement, which lets the mark go only while the stored values are the ones written and no mark was set since.
// A try sets no mark of its own: one the provider refused leaves waiting exactly what waited.

import { noteProblem } from "@poplin/core/src/actions/problems";
import type { Install } from "@poplin/core/src/actions/records";
import { RULE_SETTINGS, type RuleSettings } from "@poplin/core/src/records/settings";
import type { Context } from "hono";

import type { FollowRefusal } from "../access/users-follow";
import { runPastAnswer } from "../later";

/** How often one change writes the rules: once, and once more for settings that changed while the first were written. */
const MOST_TRIES = 2;

/** The refusals no later try mends: a person must repair the domain. */
const NOTED: readonly FollowRefusal[] = ["key_refused", "lacks_right", "not_made"];

/** Why a change waits: a refusal of the provider's side, settings that changed again while they were carried, or, as `forgotten`, a try that failed on an install with nothing to remember it by. */
type Waiting = FollowRefusal | "changed_again" | "forgotten";

/** Whether the rules hold the stored settings now, and why not where a change waits. */
type Followed = { readonly carried: true } | { readonly carried: false; readonly why: Waiting };

/** The provider's side of the rules of the domain that are written from the install's settings. */
export interface RulesFollow {
  /** Whether the install holds a key, so a change is carried with no person. No call to the provider. */
  holdsKey(): boolean;

  /** Make the rules match the settings, and nothing else of the domain. It throws for nothing the provider answers, and no answer holds the key. A try that stopped part of the way is a refusal. */
  push(rules: RuleSettings): Promise<{ readonly ok: true } | { readonly ok: false; readonly refusal: FollowRefusal }>;
}

function rulesOf(settings: RuleSettings): RuleSettings {
  return { outside_pages: settings.outside_pages, search_engines_allowed: settings.search_engines_allowed };
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
 * Leave a change waiting after a try the provider refused, and note the one no later try mends: a refusal a person must repair, and any refusal on an install that keeps no run of its domain to remember the change by.
 *
 * @param mark - the mark the try began under, `undefined` where the install kept no run then. One may have been kept while the provider was asked, so the change is set to wait there once more
 */
async function refused(install: Pick<Install, "database" | "now">, refusal: FollowRefusal, mark: number | undefined): Promise<Followed> {
  const remembers = mark !== undefined || (await install.database.settleRules({ rules: null, since: 0 }, install.now())).waits;
  if (!remembers || NOTED.includes(refusal)) await noteProblem(install, "rules_not_carried");

  return { carried: false, why: !remembers && refusal === "unreachable" ? "forgotten" : refusal };
}

/**
 * Carry the settings of the domain's rules to the provider where a change of them waits, and settle the change where the provider took them.
 *
 * @returns whether the rules hold the stored settings now. A refusal leaves the change waiting, and one that no later try mends is noted as the problem `rules_not_carried`. An install with no key is asked nothing, and notes nothing
 * @throws {Error} the database failed: the change waits on
 */
export async function followRules(install: Pick<Install, "database" | "now">, follow: RulesFollow): Promise<Followed> {
  if (!follow.holdsKey()) return { carried: false, why: "no_key" };

  for (let tries = 0; tries < MOST_TRIES; tries += 1) {
    const { settings, mark } = await install.database.claimRules(install.now());
    // An install with no settings has no rules to write, and one whose change was settled meanwhile has none to carry.
    if (settings === undefined || mark === null) return { carried: true };

    const rules = rulesOf(settings);
    const pushed = await follow.push(rules);
    if (!pushed.ok) return refused(install, pushed.refusal, mark);

    // An install that kept no run of its domain at the claim may keep one by now, with a later change settled in it: the try settles all the same, and writes nothing where there is still no run.
    if (!(await install.database.settleRules({ rules, since: mark ?? 0 }, install.now())).waits) return { carried: true };
  }

  return { carried: false, why: "changed_again" };
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
