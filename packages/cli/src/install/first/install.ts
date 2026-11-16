// `poplin install <provider>`: make a new install at a provider, through the one interface a provider gives. It only makes: where an install is, it says so and changes nothing.
//
//   words -> a plan -> the answers still open -> look for an install -> every row as the provider settles it -> wait for it to answer -> what it came to
//
// A dry run goes the same way and changes nothing. Nothing is kept on this computer, and the token is in no line and no value.

import type { Found, Installed, Question, Run, Startable } from "../../../../core/src/install/installer";
import { exitCode } from "../../commands/exit-codes";
import { logIn } from "../../commands/login";
import { problemLines } from "../../commands/problems";
import type { Io } from "../../commands/records";
import { VERSION } from "../../poplin";
import { installAnswers } from "./answers";
import { askWhere, STOPPED, settle, TOKEN_VARIABLE } from "../ask";
import { guarded, type Show, showOf } from "../ends";
import { installHelp } from "./help";
import { parseInstall } from "./parse";
import type { InstallEnds, InstallRequest, ParsedInstall, Plan, Provider, Stop } from "../records";
import { dryRunLines, rowLine, runLines, runValue, stopLines, stopValue } from "../report";

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

/** The stop of a build that carries no provider. */
const NO_PROVIDER: Stop = { problem: "no_provider", exit: 1, lines: ["this build of poplin carries no provider to install at", "install the published package: npx poplin install"] };

/** The exits of a stop, as the endings the command table knows. */
const ENDINGS = { 1: "failed", 2: "usage-error", 5: "unreachable" } as const;

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

/** Say why the command made no install, and choose its exit code. `run` is on a stop that came after the plan: a program then reads `ready` as it does of a run. */
function stopped(stop: Stop, show: Show, provider: Provider | undefined, run?: Run): number {
  for (const line of stopLines(stop, provider)) show.aside(line.tone, line.text);

  show.value(run === undefined ? stopValue(stop) : { ...stopValue(stop), run, ready: false });

  return exitCode({ kind: ENDINGS[stop.exit] });
}

/** The stop a look that found no ground to start from is. */
function stopOf(found: Exclude<Found<unknown, unknown>, { readonly state: "none" | "started" | "leftover" | "choice" }>): Stop {
  if (found.state === "whole") return { problem: "already_installed", exit: 1, version: found.version, address: found.address, newest: found.newest };

  if (found.state === "held") return { problem: "name_held", exit: 1, words: found.words, address: found.address };

  if (found.state === "blocked") return { problem: "blocked", exit: 1, blocked: found.blocked };

  if (found.why === "unreachable") return { problem: "unreachable", exit: 5, words: `${found.words}. nothing was changed` };

  return { problem: found.why === "token" ? "token_refused" : "no_domain", exit: 1, words: `${found.words}. nothing was changed` };
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

/** Ask which of the places a token shows is meant. A run that asks nothing is told which option answers it. */
async function chosen(question: Question<unknown>, request: InstallRequest, ends: InstallEnds): Promise<{ readonly where: unknown } | Stop> {
  if (request.asking === "never") return { problem: "missing_answer", exit: 2, missing: [{ key: question.key, name: question.name, give: question.give }] };

  return (await askWhere([question], ends.screen)) ?? STOPPED;
}

/**
 * Look for an install with the token, and bring what is found to ground a run can start from.
 *
 * A token that shows more than one place is asked which, and looked with again at the place chosen.
 */
async function look(request: InstallRequest, ends: InstallEnds, show: Show): Promise<Ground | Stop> {
  let { where } = request;

  for (;;) {
    show.working(LOOKING);
    const found = await request.provider.find(request.token, where, ends.reach);
    show.line(found.state === "none" || found.state === "started" ? "note" : "warning", `${LOOKING} ... ${FOUND_WORDS[found.state]}`);

    if (found.state === "none" || found.state === "started" || found.state === "leftover") {
      const ground = await grounded(found, request, ends, show);

      return "problem" in ground ? ground : { found: ground, where };
    }

    if (found.state !== "choice") return stopOf(found);

    const next = await chosen(found.question, request, ends);
    if ("problem" in next) return next;

    ({ where } = next);
  }
}

/** Log this computer in to the install that was made, when the person or the option says so; else say how. */
async function offerLogin(login: "yes" | "no" | "ask", json: boolean, address: string, io: Io, ends: InstallEnds, show: Show): Promise<Readonly<Record<string, unknown>>> {
  const wanted = login === "ask" ? await ends.screen.confirm("Log this computer in now?", true) : login === "yes";

  if (wanted !== true) {
    show.line("plain", `To log this computer in: npx poplin login --server ${address}`);

    return {};
  }

  // The address and the code of the login are shown as lines of this command: with `--json` on stderr, so stdout holds the one value.
  const outcome = await logIn({ kind: "login", publisher: false, browser: true, json: false, server: address }, { ...io, out: json ? io.err : (line) => show.line("plain", line) });
  if (!outcome.ok) {
    for (const line of problemLines(outcome.problem)) show.aside("error", line);

    show.aside("plain", `To try again: npx poplin login --server ${address}`);

    return { login: { ok: false, problem: outcome.problem.code } };
  }

  for (const line of outcome.lines) show.line("plain", line);

  for (const note of outcome.notes ?? []) show.aside("note", note);

  return { login: { ok: true } };
}

/** Wait for an install that was made whole to answer at its address, unless the run was told not to; `null` where nothing is waited for. */
async function waited(installed: Extract<Installed, { readonly ok: true }>, mode: InstallRequest["mode"], ends: InstallEnds, show: Show): Promise<boolean | null> {
  const { address } = installed;
  if (mode.mode === "dry-run" || !mode.wait || !installed.ready || address === undefined) return null;

  show.line("note", `waiting for ${address} to answer`);
  show.working(`waiting for ${address} to answer`);

  return installAnswers(address, ends);
}

/** Say what a run that worked through its rows came to, and offer the login after one that left nothing undone. */
async function ended(installed: Extract<Installed, { readonly ok: true }>, ground: Ground, request: InstallRequest, io: Io, ends: InstallEnds, show: Show): Promise<Ended> {
  const { mode } = request;
  const answers = await waited(installed, mode, ends, show);
  const value = runValue(installed, mode.mode, ground.found.state, answers);
  const code = exitCode({ kind: value.ok === true ? "done" : "failed" });
  const lines = mode.mode === "dry-run" ? dryRunLines(installed) : runLines(installed, request.provider, answers);

  for (const line of lines) show.line(line.tone, line.text);

  if (mode.mode === "dry-run" || value.ok !== true || installed.address === undefined) return { code, value };

  return { code, value: { ...value, ...(await offerLogin(mode.login, request.json, installed.address, io, ends, show)) } };
}

/** Run a request: look, make or say what would be made, and say what it came to. */
async function work(request: InstallRequest, io: Io, ends: InstallEnds, show: Show): Promise<number> {
  const { provider, mode } = request;
  const ground = await look(request, ends, show);
  if ("problem" in ground) return stopped(ground, show, provider, mode.mode);

  if (ground.found.state === "started") show.line("note", "An install was started here and not finished: this run goes on with it.");

  const doing = mode.mode === "dry-run" ? "reading what a run would make" : "making the install";
  show.working(doing);

  const installed = await provider.install(ground.found, ground.where, request.login, mode.mode, ends.reach, (row) => {
    const { tone, text } = rowLine(row, mode.mode);
    show.line(tone, text);
    show.working(doing);
  });

  if (!installed.ok) return stopped({ problem: "unreachable", exit: 5, words: installed.words }, show, provider, mode.mode);

  const { code, value } = await ended(installed, ground, request, io, ends, show);
  show.value(value);

  return code;
}

/** The list of providers, for a line that names none where nobody can be asked. */
function list(providers: readonly Provider[], json: boolean, io: Io): number {
  if (json) io.out(JSON.stringify({ ok: true, providers: providers.map((one) => ({ id: one.id, name: one.name, about: one.about })) }));
  else io.out(installHelp(providers));

  return exitCode({ kind: "done" });
}

/** Ask which provider, where there is more than one; `undefined` once the person ended the question. */
async function picked(providers: readonly Provider[], ends: InstallEnds): Promise<Provider | undefined> {
  const [first, ...others] = providers;
  if (others.length === 0) return first;

  const id = await ends.screen.choose(
    "Where?",
    providers.map((one) => ({ value: one.id, label: one.name, hint: one.about })),
  );

  return providers.find((one) => one.id === id);
}

/** Settle a plan's open answers, then run it. The token is hidden from the moment it is read. */
async function planned(plan: Plan, io: Io, ends: InstallEnds, show: Show, secrets: Set<string>): Promise<number> {
  const request = await settle(plan, ends);
  if ("problem" in request) return stopped(request, show, plan.provider, plan.mode.mode);

  secrets.add(request.token);

  return work(request, io, ends, show);
}

/** Do what a line that was read asks for. */
async function answered(parsed: ParsedInstall, providers: readonly Provider[], io: Io, ends: InstallEnds, secrets: Set<string>): Promise<number> {
  if (parsed.kind === "help" || parsed.kind === "version") {
    io.out(parsed.kind === "help" ? installHelp(providers, parsed.provider) : VERSION);

    return exitCode({ kind: "done" });
  }

  const show = showOf(parsed.kind === "plan" ? parsed.plan.json : parsed.json, io, ends, secrets);
  if (providers.length === 0) return stopped(NO_PROVIDER, show, undefined);

  if (parsed.kind === "list") return list(providers, parsed.json, io);

  if (parsed.kind === "stop") return stopped(parsed.stop, show, undefined);

  if (parsed.kind === "plan") return planned(parsed.plan, io, ends, show, secrets);

  const provider = await picked(providers, ends);

  return provider === undefined ? stopped(STOPPED, show, undefined) : answered(parsed.named(provider), providers, io, ends, secrets);
}

/**
 * Run the words after `poplin install`.
 *
 * @param rawIo - the machine's ends: where to print, the environment, and whether a person is there to ask
 * @param rawEnds - the providers the package carries, the screen, standard input, and what a provider reaches the world through
 * @returns the exit code: 0 installed or a dry run that is ready, 1 nothing or not all was made, 2 written wrong or an answer missing, 5 no answer. Nothing throws
 */
export async function runInstall(words: readonly string[], rawIo: Io, rawEnds: InstallEnds): Promise<number> {
  const held = rawIo.machine.env[TOKEN_VARIABLE] ?? "";
  const secrets = new Set(held === "" ? [] : [held]);
  const { io, ends } = guarded(rawIo, rawEnds, secrets);

  try {
    const providers = await ends.providers();

    return await answered(parseInstall(words, providers, io.machine.env, io.terminal.asks), providers, io, ends, secrets);
  } catch (error) {
    const what = error instanceof Error ? `${error.name}: ${error.message}` : "an unknown failure";
    const said = io.stopped.aborted ? "the command was stopped. Run it again: it goes on from what stands." : `poplin install failed in a way it has no word for: ${what}. Run it again: it goes on from what stands.`;

    return stopped({ problem: io.stopped.aborted ? "stopped" : "crashed", exit: 1, words: said }, showOf(words.includes("--json"), io, ends, secrets), undefined);
  }
}
