// How `poplin doctor --repair` words what it found and did: the install it found, its last lines, its help, and one JSON value for a program.
// Each object's own line is the one `poplin install` prints for it.

import type { Found, Repaired, Run, Whole } from "../../../../core/src/install/installer";
import { columns } from "../../commands/text";
import { TOKEN_HELP } from "../ask";
import type { Careful, Next, Provider, Stop } from "../records";
import { carefulOf, carried, changesIn, DRY_RUN_HELP, dryRunLines, followed, heldStop, type Line, NEXT, optionLines, REFUSED_AS, repairAfter, rowValues, runLines, runningWords, UNCHANGED } from "../report";
import { REPAIR_COMMAND, REPAIR_OPTIONS } from "./parse";

/** How far a line of a list stands in. */
const INDENT = "  ";

/** The problem each of the provider's own refusals of a repair is, as the command's JSON names it, where the same command goes on from it. */
const PROBLEMS = { elsewhere: "other_place", changed: "changed" } as const;

/** The option of an install that takes up what an earlier install left behind: a consent, which the sentence names and no next step carries. */
const ADOPT = "--adopt";

/** What each end of a repair that left nothing undone is called. */
const DONE = { same: `the install is as it should be. ${UNCHANGED}`, mended: "the install is mended." } as const;

/** A repair that worked through its rows. */
type Mended = Extract<Repaired, { readonly ok: true }>;

/** What a look found that a repair does not go on from, but the choice between places. */
type NotWhole = Exclude<Found<unknown, unknown>, { readonly state: "whole" | "choice" }>;

function indented(lines: readonly string[]): string[] {
  return lines.map((line) => `${INDENT}${line}`);
}

/** What to run after a repair that worked through its rows: the login where the install is as it should be now, and the same repair, by the words in `named`, where a run has something to mend yet. */
function nextOf(repaired: Mended, run: Run, named: readonly string[]): Next {
  const mended = repaired.ready && (run === "apply" || changesIn(repaired.rows) === 0);

  return mended ? NEXT.login(repaired.address) : NEXT.repair("this", carried(carefulOf(run), repaired.ready), named);
}

/** Say which install a look found: its version where it could be read, and where its dashboard is. */
export function foundWords(found: Whole<unknown>): string {
  return `found: ${runningWords(found.version)}, at ${found.address}`;
}

/**
 * The stop of a look that found no whole install.
 *
 * @param provider - the provider, which the line that names `poplin install` names
 * @param careful - the careful choices of the repair's line, kept where the repair itself goes on
 * @param place - the place the repair looked at, which the install it names carries
 * @returns why nothing is repaired: an account with no install or an unfinished one is sent to `poplin install`, which makes one and goes on with one.
 *   Where the install was started for another place, the sentence and the next step name one line: the install at that place.
 *   Where data was left behind, the sentence names `--adopt` and the next step is the install without it: the consent is a person's to add
 */
export function stopOf(found: NotWhole, provider: Provider, careful: readonly Careful[], place: readonly string[]): Stop {
  const next = NEXT.install(provider, [], place);
  const install = next.command;

  if (found.state === "none") return { problem: "no_install", exit: 1, words: `No install is in this account. To make one: ${install}`, next };

  if (found.state === "leftover") return { problem: "no_install", exit: 1, words: followed(found.words, `To make an install that uses it: ${install} ${ADOPT}`), next };

  if (found.state === "started") return { problem: "unfinished", exit: 1, words: `An install was started in this account and not finished. To finish it: ${install}`, next };

  if (found.state === "held") return heldStop(found, NEXT.repair("this", careful, place), provider, place);

  if (found.state === "blocked") return { problem: "blocked", exit: 1, blocked: found.blocked };

  if (found.why === "unreachable") return { problem: "unreachable", exit: 5, words: followed(found.words, UNCHANGED) };

  if (found.why === "other_place") {
    // A repair at the place it was started for would stop again: the install is not set, so the install goes on with it there.
    const finish = NEXT.install(provider, [], [found.give]);

    return { problem: "unfinished", exit: 1, words: followed(found.words, `To finish it: ${finish.command}`), next: finish };
  }

  return { problem: REFUSED_AS[found.why], exit: 1, words: followed(found.words, UNCHANGED) };
}

/** The stop of a repair that changed nothing, in the provider's own words. The repair that goes on from records of another version keeps the careful choices of the line and its place. */
export function unmended(repaired: Extract<Repaired, { readonly ok: false }>, careful: readonly Careful[], place: readonly string[]): Stop {
  const words = followed(repaired.words, UNCHANGED);
  if (repaired.why === "unreachable") return { problem: "unreachable", exit: 5, words };

  if (repaired.why === "token") return { problem: "token_refused", exit: 1, words };

  if (repaired.why === "another") return { problem: "another_version", exit: 1, words, next: repairAfter(repaired, careful, place) };

  return { problem: PROBLEMS[repaired.why], exit: 1, words };
}

/**
 * Word what a repair came to.
 *
 * @param provider - the provider, whose name says where the token can be deleted
 * @returns the last lines: of a dry run whether a run would go through and what it would do, and of a run what only a person can do and whether anything is left undone
 */
export function repairedLines(repaired: Mended, run: Run, provider: Provider): Line[] {
  const same = changesIn(repaired.rows) === 0;
  if (run === "dry-run") return repaired.ready && same ? [{ tone: "done", text: DONE.same }] : dryRunLines(repaired);

  // What a person is told to do after a run that mended everything, such as where to log in, stands before its last lines.
  const told = repaired.ready ? repaired.steps.flatMap((step): Line[] => [step.text, `${INDENT}${step.address}`].map((text) => ({ tone: "plain", text }))) : [];

  return [...told, ...runLines(repaired, provider, null, { done: same ? DONE.same : DONE.mended, next: NEXT.repair(), again: NEXT.repair(), repair: NEXT.repair() })];
}

/**
 * The JSON value of a repair that worked through its rows.
 *
 * @param found - the install the repair went on from
 * @param named - the place of the install and the user the line was given to add, which the repair named next carries: without the user, the run after a dry run would add nobody
 * @returns `ok` and `ready` are whether the command exits with 0: nothing is left undone, or a run would leave nothing. `changes` is how many objects were changed or would be.
 *   Each row's state is under `will` in a dry run and under `did` in a run
 */
export function repairedValue(repaired: Mended, run: Run, found: Whole<unknown>, named: readonly string[]): Readonly<Record<string, unknown>> {
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
 * @returns lines with no trailing newline; a provider's are as long as its own words make them
 */
export function repairHelp(providers: readonly Provider[], provider?: Provider): string {
  const [first, ...others] = providers;
  const shown = provider ?? (others.length === 0 ? first : undefined);
  const listed = shown === undefined ? [["Providers:", ...indented(columns(providers.map((one) => [one.id, one.about])))]] : [];
  const own = shown === undefined ? [] : [[`Options of ${shown.name}:`, ...optionLines(shown.options)], [...shown.tokenHelp]];

  return [
    [`poplin ${REPAIR_COMMAND} ${shown === undefined ? "<provider>" : `${others.length === 0 ? "" : `${shown.id} `}${shown.usage}`} [options]`],
    ["Mend your install at its provider, with an account token. It needs no login,", "so it is the way back in. It finds the install first, then makes each piece", "that is missing or differs, and leaves the rest."],
    ["An install behind the newest release is brought to it: the way an install", "takes a release it cannot take by itself. One that runs the newest is left."],
    ...listed,
    ["Options:", ...optionLines(REPAIR_OPTIONS)],
    [...DRY_RUN_HELP],
    ...own,
    [...TOKEN_HELP, "The token an install is made with has every permission a repair needs."],
    ["--add-user stores the email only after the provider took a change of who may", "log in from this token: a token that may only read adds nobody."],
    indented(columns([["poplin doctor", "check the install with this computer's login, and change nothing"]])),
  ]
    .map((lines) => lines.join("\n"))
    .join("\n\n");
}
