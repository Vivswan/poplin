// `poplin install <provider>`: make a new install at a provider, through the one interface a provider gives. It only makes: where an install is, it says so and changes nothing.
//
//   words -> a plan -> the answers still open -> look for an install -> every row as the provider settles it -> wait for it to answer -> what it came to
//
// A dry run goes the same way and changes nothing. Nothing is kept on this computer, and the token is in no line and no value.

import type { Found, Installed, Startable, Whole } from "../../../../core/src/install/installer";
import { exitCode } from "../../commands/exit-codes";
import { logIn } from "../../commands/login";
import { problemLines } from "../../commands/problems";
import type { Io } from "../../commands/records";
import { installAnswers } from "./answers";
import { lookFor, STOPPED, settle } from "../ask";
import { runCommand, type Show, stopped } from "../ends";
import { installHelp } from "./help";
import { parseInstall } from "./parse";
import type { Careful, InstallEnds, InstallRequest, Next, Plan, Provider, Stop } from "../records";
import { carefulOf, carried, changesIn, dryRunLines, followed, heldStop, NEXT, REFUSED_AS, repairAfter, rowLine, runLines, runValue, UNCHANGED } from "../report";

/** What the look for an install is called while it runs and in its line. */
const LOOKING = "looking for an install";

/** What each state of a look is, in the line that says what was found. */
const FOUND_WORDS: Readonly<Record<Found<unknown, unknown>["state"], string>> = {
  none: "none",
  leftover: "none, but something was left behind",
  started: "one that was started and not finished",
  whole: "found",
  held: "a name is held",
  blocked: "blocked",
  choice: "more than one place",
  refused: "no",
};

/** The command as it is typed after `poplin`, what runs it again, and the careful choice it takes. `--adopt` is none: it is a consent, given anew as a removal's proof is, and a line without it changes nothing. */
const COMMAND = { name: "install", again: NEXT.install, careful: ["--dry-run"] } as const;

/** What follows the name of a run that named no release: it went on with a program that was there, and uploaded none. */
const UNCHECKED = "Its code was there before this run, and this run did not check it against a release.";

/** What a look came to that a run goes on from, with the place the provider was last asked about. */
interface Ground {
  readonly found: Startable<unknown>;
  readonly where: unknown;
}

/** What a run that worked through its rows came to: the exit code, and what `--json` prints. */
interface Ended {
  readonly code: number;
  readonly value: Readonly<Record<string, unknown>>;
}

/**
 * The stop of an install that is there: this command changes nothing of it, and says what goes on from it.
 *
 * A repair's dry run, which only reads, says whether the install needs mending: one that does not is logged in to, and one that does is mended.
 * Where the provider refuses that read, its own sentence says why, such as an install that answers at another place than the one named.
 *
 * @param where - the place the provider was last asked about
 */
async function standing(found: Whole<unknown>, where: unknown, request: InstallRequest, ends: InstallEnds): Promise<Stop> {
  const there = { problem: "already_installed", exit: 1, version: found.version, address: found.address, newest: found.newest } as const;
  const read = await request.provider.repair(found, where, { run: "dry-run", addUser: undefined }, ends.reach, () => undefined);
  if (!read.ok) return { ...there, mend: "unread", unread: read.words, next: repairAfter(read) };

  if (!read.ready || changesIn(read.rows) > 0) return { ...there, mend: "something", next: NEXT.repair() };

  return { ...there, mend: "nothing", next: NEXT.login(found.address) };
}

/** The stop a look that found no ground to start from is, and no install either. */
function stopOf(found: Exclude<Found<unknown, unknown>, { readonly state: "none" | "started" | "leftover" | "choice" | "whole" }>, provider: Provider, careful: readonly Careful[]): Stop {
  if (found.state === "held") return heldStop(found, NEXT.install(provider, careful), provider);

  if (found.state === "blocked") return { problem: "blocked", exit: 1, blocked: found.blocked };

  if (found.why === "unreachable") return { problem: "unreachable", exit: 5, words: followed(found.words, UNCHANGED) };

  return { problem: REFUSED_AS[found.why], exit: 1, words: followed(found.words, UNCHANGED) };
}

/** Decide whether a run takes what an earlier install left behind: the option said so, or a person is asked. */
async function adopted(found: Extract<Found<unknown, unknown>, { readonly state: "leftover" }>, request: InstallRequest, ends: InstallEnds, show: Show): Promise<Startable<unknown> | Stop> {
  const { state: _state, ...left } = found;
  const { adopt } = request.mode;
  if (adopt === "yes") return { ...left, state: "adopted" };

  if (adopt === "no") return { problem: "leftover", exit: 1, words: found.words, address: found.address };

  show.aside("warning", found.words);
  const use = await ends.screen.confirm("Use it, with what it holds?", false);
  if (use === undefined) return STOPPED;

  return use ? { ...left, state: "adopted" } : { problem: "leftover", exit: 1, words: found.words, address: found.address };
}

/** Say what is switched off that a run does not stop for, and on a terminal let the person stop a run before it starts. */
async function noted(found: Startable<unknown>, request: InstallRequest, ends: InstallEnds, show: Show): Promise<Startable<unknown> | Stop> {
  for (const note of found.notes) {
    show.aside("warning", note.words);
    show.aside("plain", `  ${note.address}`);
  }

  if (found.notes.length === 0 || request.asking === "never" || request.mode.mode === "dry-run") return found;

  const on = await ends.screen.confirm("Go on all the same? No stops here, so that you can switch it on first.", false);

  return on === true ? found : STOPPED;
}

/** Bring a state a run can go on from to its ground: what was left behind is taken or not, and what is switched off is said. */
async function grounded(found: Extract<Found<unknown, unknown>, { readonly state: "none" | "started" | "leftover" }>, request: InstallRequest, ends: InstallEnds, show: Show): Promise<Startable<unknown> | Stop> {
  const taken = found.state === "leftover" ? await adopted(found, request, ends, show) : found;

  return "problem" in taken ? taken : noted(taken, request, ends, show);
}

/** Look for an install with the token, and bring what is found to ground a run can start from. */
async function look(request: InstallRequest, ends: InstallEnds, show: Show): Promise<Ground | Stop> {
  const looked = await lookFor({ ...request, work: "install" }, ends, {
    looking: () => show.working(LOOKING),
    found: (found) => show.line(found.state === "none" || found.state === "started" ? "note" : "warning", `${LOOKING} ... ${FOUND_WORDS[found.state]}`),
  });
  if ("problem" in looked) return looked;

  const { found, where } = looked;
  if (found.state === "whole") {
    show.working("reading whether it needs mending");

    return standing(found, where, request, ends);
  }

  if (found.state !== "none" && found.state !== "started" && found.state !== "leftover") return stopOf(found, request.provider, carefulOf(request.mode.mode));

  const ground = await grounded(found, request, ends, show);

  return "problem" in ground ? ground : { found: ground, where };
}

/** Log this computer in to the install that was made, when the person or the option says so; else say how. Answers what the value of the run gains: how the login went, and after one that worked, that nothing is left to run. */
async function offerLogin(login: "yes" | "no" | "ask", json: boolean, address: string, io: Io, ends: InstallEnds, show: Show): Promise<Readonly<Record<string, unknown>>> {
  const wanted = login === "ask" ? await ends.screen.confirm("Log this computer in now?", true) : login === "yes";

  if (wanted !== true) {
    show.line("plain", `To log this computer in: ${NEXT.login(address).command}`);

    return {};
  }

  // The address and the code of the login are shown as lines of this command: with `--json` on stderr, so stdout holds the one value.
  const outcome = await logIn({ kind: "login", publisher: false, browser: true, json: false, server: address }, { ...io, out: json ? io.err : (line) => show.line("plain", line) });
  if (!outcome.ok) {
    for (const line of problemLines(outcome.problem)) show.aside("error", line);

    show.aside("plain", `To try again: ${NEXT.login(address).command}`);

    return { login: { ok: false, problem: outcome.problem.code } };
  }

  for (const line of outcome.lines) show.line("plain", line);

  for (const note of outcome.notes ?? []) show.aside("note", note);

  return { login: { ok: true }, next: NEXT.none() };
}

/** Wait for an install that was made whole to answer at its address, unless the run was told not to; `null` where nothing is waited for. */
async function waited(installed: Extract<Installed, { readonly ok: true }>, mode: InstallRequest["mode"], ends: InstallEnds, show: Show): Promise<boolean | null> {
  const { address } = installed;
  if (mode.mode === "dry-run" || !mode.wait || !installed.ready || address === undefined) return null;

  show.line("note", `waiting for ${address} to answer`);
  show.working(`waiting for ${address} to answer`);

  return installAnswers(address, ends);
}

/**
 * Say what to run after a run that worked through its rows.
 *
 * A dry run is followed by the run, and an install that was made by the login at its address.
 * A run that left something undone and got as far as writing where the install answers has made an install that is found whole: this command makes no change to it, and the repair finishes it.
 * So the account is looked in once more, and what is found there says which.
 */
async function nextAfter(installed: Extract<Installed, { readonly ok: true }>, ground: Ground, request: InstallRequest, ends: InstallEnds): Promise<Next> {
  const { provider } = request;
  if (request.mode.mode === "dry-run") return NEXT.install(provider, carried(carefulOf("dry-run"), installed.ready));

  if (installed.ready) return installed.address === undefined ? NEXT.none() : NEXT.login(installed.address);

  const found = await provider.find(request.token, ground.where, ends.reach, "install");

  return found.state === "whole" ? NEXT.repair() : NEXT.install(provider);
}

/**
 * Say what a run that left nothing undone is called: installed, or made where its address gave no answer yet.
 *
 * @param release - the version the run uploaded; `undefined` for a run that went on with code that was there
 * @param answers - whether the install answered at its address; `null` for a run that did not wait
 */
function doneWords(release: string | undefined, answers: boolean | null): string {
  const state = answers === false ? "is made, and its address does not answer yet." : "is installed.";

  return release === undefined ? `poplin ${state} ${UNCHECKED}` : `poplin ${release} ${state}`;
}

/** Say what a run that worked through its rows came to, and offer the login after one that left nothing undone. */
async function ended(installed: Extract<Installed, { readonly ok: true }>, ground: Ground, request: InstallRequest, io: Io, ends: InstallEnds, show: Show): Promise<Ended> {
  const { mode } = request;
  const answers = await waited(installed, mode, ends, show);
  const next = await nextAfter(installed, ground, request, ends);
  const value = runValue(installed, mode.mode, ground.found.state, answers, next);
  const code = exitCode({ kind: value.ok === true ? "done" : "failed" });
  const done = doneWords(installed.release, answers);
  const lines = mode.mode === "dry-run" ? dryRunLines(installed) : runLines(installed, request.provider, answers, { done, next, again: NEXT.install(request.provider) });

  for (const line of lines) show.line(line.tone, line.text);

  if (mode.mode === "dry-run" || value.ok !== true || installed.address === undefined) return { code, value };

  return { code, value: { ...value, ...(await offerLogin(mode.login, request.json, installed.address, io, ends, show)) } };
}

/** Run a request: look, make or say what would be made, and say what it came to. */
async function work(request: InstallRequest, io: Io, ends: InstallEnds, show: Show): Promise<number> {
  const { provider, mode } = request;
  const ground = await look(request, ends, show);
  const at = { command: COMMAND, careful: carefulOf(mode.mode), provider, run: mode.mode };
  if ("problem" in ground) return stopped(ground, show, at);

  if (ground.found.state === "started") show.line("note", "An install was started here and not finished: this run goes on with it.");

  const doing = mode.mode === "dry-run" ? "reading what a run would make" : "making the install";
  show.working(doing);

  const installed = await provider.install(ground.found, ground.where, request.login, mode.mode, ends.reach, (row) => {
    const { tone, text } = rowLine(row, mode.mode);
    show.line(tone, text);
    show.working(doing);
  });

  if (!installed.ok) return stopped({ problem: "unreachable", exit: 5, words: installed.words }, show, at);

  const { code, value } = await ended(installed, ground, request, io, ends, show);
  show.value(value);

  return code;
}

/** Settle a plan's open answers, then run it. The token is hidden from the moment it is read. */
async function planned(plan: Plan, io: Io, ends: InstallEnds, show: Show, secrets: Set<string>): Promise<number> {
  const request = await settle(plan, ends);
  if ("problem" in request) return stopped(request, show, { command: COMMAND, careful: carefulOf(plan.mode.mode), provider: plan.provider, run: plan.mode.mode });

  secrets.add(request.token);

  return work(request, io, ends, show);
}

/**
 * Run the words after `poplin install`.
 *
 * @param io - the machine's ends: where to print, the environment, and whether a person is there to ask
 * @param ends - the providers the package carries, the screen, standard input, and what a provider reaches the world through
 * @returns the exit code: 0 installed or a dry run that is ready, 1 nothing or not all was made, 2 written wrong or an answer missing, 5 no answer. Nothing throws
 */
export function runInstall(words: readonly string[], io: Io, ends: InstallEnds): Promise<number> {
  return runCommand({ ...COMMAND, parse: parseInstall, help: installHelp, json: (plan) => plan.json, run: planned }, words, io, ends);
}
