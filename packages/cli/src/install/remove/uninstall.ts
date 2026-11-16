// `poplin uninstall <provider>`: remove an install from a provider, through the one interface a provider gives.
//
//   words -> a plan -> the answers still open -> look for an install -> the list of what would go -> the install's address, typed -> every row as the provider removes it
//
// A dry run ends at the list, and a run given its proof with `--confirm` skips it. The list is of a run with the same answers: data that a run keeps is listed as kept.
// The provider compares the proof before it removes anything.

import type { Found, Removable, Removal, RemovalRow, Removed, Run } from "../../../../core/src/install/installer";
import { exitCode } from "../../commands/exit-codes";
import type { Io } from "../../commands/records";
import { askToken, askWhere, givenToken, lookFor } from "../ask";
import { runCommand, type Show, stopped } from "../ends";
import type { InstallEnds, Provider, Stop } from "../records";
import { followed, heldStop, NEXT, REFUSED_AS } from "../report";
import { uninstallHelp } from "./help";
import { parseUninstall } from "./parse";
import type { UninstallPlan, UninstallRequest } from "./records";
import { listedLines, removalLine, removalValue, removedLines, unlookedWords, warningLines } from "./report";

/** The command as it is typed after `poplin`, and what runs it again. */
const COMMAND = { name: "uninstall", again: NEXT.uninstall } as const;

/** What the look for an install is called while it runs and in its line. */
const LOOKING = "looking for an install";

/** What ends the line of every stop here. */
const UNTOUCHED = "Nothing was removed.";

/** What a run that met nothing to remove says is there: nothing of an install, or with a run told to keep the data, the data alone. */
const NOTHING = { none: "No install is in this account.", data: "Only the data is left here, and --keep-data keeps it." } as const;

/** The states of a row that is nothing a removal does or was to do: it stays, is kept, or is not this install's. */
const UNTOUCHED_STATES: readonly RemovalRow["state"][] = ["stay", "keep", "skip"];

/** The stop of a run whose person ended a question, which is before any removal. */
const ENDED: Stop = { problem: "stopped", exit: 1, words: `stopped. ${UNTOUCHED}` };

/** What a removal starts from, with the place the provider was last asked about. */
interface Ground {
  readonly found: Removable<unknown>;
  readonly where: unknown;
}

/** A removal that worked through its rows. */
type Listed = Extract<Removed, { readonly ok: true }>;

/** Bring a plan to a request: read the token that is piped, or ask for each answer the plan lacks. The proof is asked for later, once the list was shown. */
async function settled(plan: UninstallPlan, ends: InstallEnds): Promise<UninstallRequest | Stop> {
  const { provider, json } = plan;

  if (plan.asking === "never") {
    const token = await givenToken(plan.token, provider, ends.input, COMMAND.name);

    return typeof token === "object" ? token : { provider, json, asking: "never", mode: plan.mode, where: plan.where, token };
  }

  const where = plan.where.known ? plan.where : await askWhere(plan.where.open, ends.screen);
  if (where === undefined) return ENDED;

  const token = plan.token ?? (await askToken(provider, where.where, ends.screen));

  return token === undefined ? ENDED : { provider, json, asking: "terminal", mode: plan.mode, where: where.where, token };
}

/** What a look found, in the line that says so. */
function foundWords(found: Found<unknown, unknown>): string {
  if (found.state === "whole") return `found: poplin${found.version === undefined ? "" : ` ${found.version}`}, at ${found.address}`;

  const words = { none: "none that is whole", leftover: "none, but something was left behind", started: "one that was started and not finished", held: "a name is held", blocked: "blocked", choice: "more than one place", refused: "no" } as const;

  return words[found.state];
}

/** The stop a look that found nothing a removal can start from is. */
function stopOf(found: Extract<Found<unknown, unknown>, { readonly state: "held" | "blocked" | "refused" }>, provider: Provider): Stop {
  if (found.state === "held") return heldStop(found, NEXT.uninstall(provider), provider);

  if (found.state === "blocked") return { problem: "blocked", exit: 1, blocked: found.blocked };

  if (found.why === "unreachable") return { problem: "unreachable", exit: 5, words: followed(found.words, UNTOUCHED) };

  return { problem: REFUSED_AS[found.why], exit: 1, words: followed(found.words, UNTOUCHED) };
}

/** Look for an install with the token, and take what a removal can start from. */
async function look(request: UninstallRequest, ends: InstallEnds, show: Show): Promise<Ground | Stop> {
  const looked = await lookFor(request, ends, {
    looking: () => show.working(LOOKING),
    found: (found) => show.line(found.state === "whole" ? "note" : "warning", `${LOOKING} ... ${foundWords(found)}`),
  });
  if ("problem" in looked) return looked;

  const { found, where } = looked;

  return found.state === "whole" || found.state === "started" || found.state === "leftover" || found.state === "none" ? { found, where } : stopOf(found, request.provider);
}

/**
 * Ask the provider to list or to remove, and show each row as it is settled. A removal the provider did not start, and one that found nothing of an install, is a stop.
 *
 * @param show - shows each row: as a result, or beside it where the list only precedes the question of the proof
 */
async function removal(ground: Ground, request: UninstallRequest, how: Removal, ends: InstallEnds, show: Pick<Show, "working" | "line">): Promise<Listed | Stop> {
  const doing = how.run === "dry-run" ? "reading what a run would remove" : "removing the install";
  show.working(doing);

  const removed = await request.provider.remove(ground.found, ground.where, how, ends.reach, (row: RemovalRow) => {
    const { tone, text } = removalLine(row, how.run);
    show.line(tone, text);
    show.working(doing);
  });
  if (!removed.ok) return removed.why === "unreachable" ? { problem: "unreachable", exit: 5, words: removed.words } : { problem: removed.why, exit: 1, words: removed.words };

  if (removed.rows.some((row) => !UNTOUCHED_STATES.includes(row.state))) return removed;

  // A kind the token could not look for may still be there, so the stop names it beside what is left.
  const there = removed.rows.some((row) => row.state === "keep") ? NOTHING.data : NOTHING.none;
  const unlooked = unlookedWords(removed, how.run);
  const words = unlooked === undefined ? `${there} ${UNTOUCHED}` : `${there} ${unlooked} ${UNTOUCHED}`;

  return { problem: "no_install", exit: 1, words, next: NEXT.none() };
}

/** Warn, then take the proof: what the person types once they saw what goes. `undefined` once they ended the question, or typed nothing. */
async function typedProof(listed: Listed, data: "remove" | "keep", ends: InstallEnds, show: Show): Promise<string | undefined> {
  for (const line of warningLines(listed, data)) show.aside(line.tone, line.text);

  const typed = await ends.screen.ask(`Type ${listed.confirm} to go on:`);

  return typed === undefined || typed.trim() === "" ? undefined : typed;
}

function ended(removed: Listed, run: Run, ground: Ground, request: UninstallRequest, show: Show): number {
  const lines = run === "dry-run" ? listedLines(removed, request.mode.data) : removedLines(removed, request.provider);
  for (const line of lines) show.line(line.tone, line.text);

  show.value(removalValue(removed, run, ground.found.state, request.provider));

  return exitCode({ kind: removed.ready ? "done" : "failed" });
}

async function work(request: UninstallRequest, ends: InstallEnds, show: Show): Promise<number> {
  const { provider, mode } = request;
  const at = { command: COMMAND, provider, run: mode.mode };
  const ground = await look(request, ends, show);
  if ("problem" in ground) return stopped(ground, show, at);

  const remove = async (confirmed: string, data: "remove" | "keep"): Promise<number> => {
    const removed = await removal(ground, request, { run: "apply", confirmed, data }, ends, show);

    return "problem" in removed ? stopped(removed, show, at) : ended(removed, "apply", ground, request, show);
  };
  if (mode.mode === "apply" && mode.confirm.by === "flag") return remove(mode.confirm.typed, mode.data);

  // A person sees the list before the proof is asked for, also where the result is one JSON value: there it is shown beside the result.
  const beside = mode.mode === "apply" && request.json ? { working: show.working, line: show.aside } : show;
  const listed = await removal(ground, request, { run: "dry-run", data: mode.data }, ends, beside);
  if ("problem" in listed) return stopped(listed, show, at);

  if (mode.mode === "dry-run") return ended(listed, "dry-run", ground, request, show);

  const typed = await typedProof(listed, mode.data, ends, show);

  return typed === undefined ? stopped(ENDED, show, at) : remove(typed, mode.data);
}

/** Settle a plan's open answers, then run it. The token is hidden from the moment it is read. */
async function planned(plan: UninstallPlan, _io: Io, ends: InstallEnds, show: Show, secrets: Set<string>): Promise<number> {
  const request = await settled(plan, ends);
  if ("problem" in request) return stopped(request, show, { command: COMMAND, provider: plan.provider, run: plan.mode.mode });

  secrets.add(request.token);

  return work(request, ends, show);
}

/**
 * Run the words after `poplin uninstall`.
 *
 * @param io - the machine's ends: where to print, the environment, and whether a person is there to ask
 * @param ends - the providers the package carries, the screen, standard input, and what a provider reaches the world through
 * @returns the exit code: 0 removed or a dry run that is ready, 1 nothing or not all was removed, 2 written wrong or an answer missing, 5 no answer. Nothing throws
 */
export function runUninstall(words: readonly string[], io: Io, ends: InstallEnds): Promise<number> {
  return runCommand({ ...COMMAND, parse: parseUninstall, help: uninstallHelp, json: (plan) => plan.json, run: planned }, words, io, ends);
}
