// How `poplin doctor --repair` words what it found and did: the install it found, its last lines, its help, and one JSON value for a program.
// Each object's own line is the one `poplin install` prints for it.

import type { Found, Repaired, Run, Whole } from "../../../../core/src/install/installer";
import { type HelpPage, helpPage } from "../../commands/line/help-page";
import { type Line, type Look, PLAIN_LOOK } from "../../local/screen";
import { permissionsPart } from "../ask";
import type { Careful, Next, Provider, Stop } from "../records";
import { carefulOf, carried, changesIn, dryRunLines, followed, heldStop, NEXT, optionRows, REFUSED_AS, refusedWords, repairAfter, rowValues, runLines, runningWords, UNCHANGED, updateWords } from "../report";
import { REPAIR_COMMAND, REPAIR_OPTIONS } from "./parse";

/** How far a line of a list stands in. */
const INDENT = "  ";

/** The problem each of the provider's own refusals of a repair is, as the command's JSON names it, where the same command goes on from it. */
const PROBLEMS = { elsewhere: "other_place", changed: "changed" } as const;

/** The option of an install that takes up what an earlier install left behind: a consent, which the sentence names and no next step carries. */
const ADOPT = "--adopt";

/** What each end of a repair that left nothing undone is called. */
const DONE = { same: "The install needs no repair", mended: "The repair is complete" } as const;

/** A repair that worked through its rows. */
type Mended = Extract<Repaired, { readonly ok: true }>;

/** What a look found that a repair does not go on from, but the choice between places. */
type NotWhole = Exclude<Found<unknown, unknown>, { readonly state: "whole" | "choice" }>;

/** What the repair a run names next holds of the line it was run by: its words, and the way that line names a repair, which keeps its user. */
interface Named {
  readonly words: readonly string[];
  readonly repair: typeof NEXT.repair;
}

/** What to run after a repair that worked through its rows: the login where the install is as it should be now, and the same repair, by what `named` holds, where a run has something to mend yet. */
function nextOf(repaired: Mended, run: Run, named: Named): Next {
  const mended = repaired.ready && (run === "apply" || changesIn(repaired.rows) === 0);

  return mended ? NEXT.login(repaired.address) : named.repair("this", carried(carefulOf(run), repaired.ready), named.words);
}

/** Say which install a look found: its version where it could be read, and where its dashboard is. */
export function foundWords(found: Whole<unknown>): string {
  return `${runningWords(found.version)} is installed at ${found.address}`;
}

/**
 * The stop of a look that found no whole install.
 *
 * @param provider - the provider, which the line that names `poplin install` names
 * @param careful - the careful choices of the repair's line, and `update` whether it asked for the newest release: both kept where the repair itself goes on, which `repair` names with the user of the line
 * @param place - the place the repair looked at, which the install it names carries
 * @returns why nothing is repaired: an account with no install or an unfinished one is sent to `poplin install`, which makes one and goes on with one.
 *   Where the install was started for another place, the sentence and the next step name one line: the install at that place.
 *   Where data was left behind, the sentence names `--adopt` and the next step is the install without it: the consent is a person's to add
 */
export function stopOf(found: NotWhole, provider: Provider, careful: readonly Careful[], place: readonly string[], update: boolean, repair: typeof NEXT.repair): Stop {
  const next = NEXT.install(provider, [], place);
  const install = next.command;

  if (found.state === "none") return { problem: "no_install", exit: 1, words: `This account has no install. ${UNCHANGED}. Fix: ${install}`, next };

  if (found.state === "leftover") return { problem: "no_install", exit: 1, words: followed(found.words, `To reuse them: ${install} ${ADOPT}`), next };

  if (found.state === "started") return { problem: "unfinished", exit: 1, words: `This account has an incomplete install. ${UNCHANGED}. Fix: ${install}`, next };

  if (found.state === "held") return heldStop(found, repair("this", careful, [...updateWords(update), ...place]), provider, place, repair);

  if (found.state === "blocked") return { problem: "blocked", exit: 1, blocked: found.blocked };

  if (found.why === "unreachable") return { problem: "unreachable", exit: 5, words: followed(found.words, `${UNCHANGED}.`) };

  if (found.why === "other_place") {
    // A repair at the place it was started for would stop again: the install is not set, so the install goes on with it there.
    const finish = NEXT.install(provider, [], [found.give]);

    return { problem: "unfinished", exit: 1, words: followed(found.words, `Fix: ${finish.command}`), next: finish };
  }

  return { problem: REFUSED_AS[found.why], exit: 1, words: followed(found.words, `${UNCHANGED}.`) };
}

/**
 * The stop of a repair that changed nothing, in the provider's own words. The repair that goes on from records of another version keeps the careful choices of the line and its place.
 *
 * @param update - whether the line asked for the newest release, which the repair that goes on keeps
 * @param user - the words that add the user the line was given, which the sentence of an install that is behind keeps
 * @param repair - the way the line names a repair as a next step, which keeps that user
 */
export function unmended(repaired: Extract<Repaired, { readonly ok: false }>, careful: readonly Careful[], place: readonly string[], update: boolean, user: readonly string[], repair: typeof NEXT.repair): Stop {
  const words = followed(refusedWords(repaired, user), `${UNCHANGED}.`);
  if (repaired.why === "unreachable") return { problem: "unreachable", exit: 5, words };

  if (repaired.why === "token") return { problem: "token_refused", exit: 1, words };

  if (repaired.why === "another" || repaired.why === "behind") return { problem: "another_version", exit: 1, words, next: repairAfter(repaired, careful, place, update, repair) };

  return { problem: PROBLEMS[repaired.why], exit: 1, words };
}

/**
 * Word what a repair came to.
 *
 * @returns the last lines: of a dry run whether a run would go through and what it would do, and of a run what only a person can do and whether anything is left undone
 */
export function repairedLines(repaired: Mended, run: Run): Line[] {
  const same = changesIn(repaired.rows) === 0;
  if (run === "dry-run") return repaired.ready && same ? [{ tone: "done", text: DONE.same }] : dryRunLines(repaired);

  // What a person is told to do after a run that mended everything stands before its last lines. A step at the dashboard's own address is left to the line that names the dashboard; the JSON value keeps it.
  const told = repaired.ready ? repaired.steps.filter((step) => step.address !== repaired.address).flatMap((step): Line[] => [step.text, `${INDENT}${step.address}`].map((text) => ({ tone: "plain", text }))) : [];

  return [...told, ...runLines(repaired, null, { done: same ? DONE.same : DONE.mended, next: NEXT.repair(), again: NEXT.repair(), repair: NEXT.repair() })];
}

/**
 * The JSON value of a repair that worked through its rows.
 *
 * @param found - the install the repair went on from
 * @param named - the update the line asked for and the place of the install, with the way the line names a repair, which keeps the user it was given to add: without them, the run after a dry run would take no release and add nobody.
 *   A user whose email this machine's shell cannot be given safely is left out of the words, and named as what to add
 * @returns `ok` and `ready` are whether the command exits with 0: nothing is left undone, or a run would leave nothing. `changes` is how many objects were changed or would be.
 *   Each row's state is under `will` in a dry run and under `did` in a run
 */
export function repairedValue(repaired: Mended, run: Run, found: Whole<unknown>, named: Named): Readonly<Record<string, unknown>> {
  return {
    ok: repaired.ready,
    run,
    ready: repaired.ready,
    changes: changesIn(repaired.rows),
    found: { state: found.state, version: found.version ?? null, address: found.address, newest: found.newest ?? null },
    rows: rowValues(repaired.rows, run),
    blocked: repaired.blocked,
    steps: repaired.steps,
    next: nextOf(repaired, run, named),
  };
}

/**
 * Print the help of `poplin doctor --repair`.
 *
 * @param providers - the providers the built package carries
 * @param provider - the provider whose own options and token the help also lists; the only one the package carries when absent
 * @param look - how wide the stream shows it and whether in colour; plain lines of at most 80 characters when absent
 * @returns lines with no trailing newline
 */
export function repairHelp(providers: readonly Provider[], provider?: Provider, look: Look = PLAIN_LOOK): string {
  const [first, ...others] = providers;
  const shown = provider ?? (others.length === 0 ? first : undefined);
  const page: HelpPage = {
    usage: [`poplin ${REPAIR_COMMAND} ${shown === undefined ? "<provider>" : `${others.length === 0 ? "" : `${shown.id} `}${shown.usage}`} [options]`],
    about: "Repair the install at its provider. It needs no login.",
    parts: [
      { title: "Providers:", rows: shown === undefined ? providers.map((one) => [one.id, one.about]) : [] },
      { title: "Options:", rows: optionRows([...(shown?.options ?? []), ...REPAIR_OPTIONS]) },
      permissionsPart("repair", shown),
      { title: "Related:", commands: ["poplin doctor", "poplin update"] },
    ],
  };

  return helpPage(page, look);
}
