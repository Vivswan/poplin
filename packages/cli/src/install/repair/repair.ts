// `poplin doctor --repair`: mend the install at its provider, with an account token and no login, through the one interface a provider gives. It is the way back in.
//
//   words -> a plan -> the answers still open -> look for the install -> every row as the provider settles it -> what it came to
//
// A dry run goes the same way and changes nothing. Nothing is kept on this computer, and the token is in no line and no value.

import type { Token, Whole } from "../../../../core/src/install/installer";
import { exitCode } from "../../commands/exit-codes";
import type { Io } from "../../commands/records";
import { askToken, askWhere, givenToken, lookFor, STOPPED } from "../ask";
import { runCommand, type Show, stopped } from "../ends";
import type { Careful, InstallEnds, Next, Provider, Stop } from "../records";
import { carefulOf, NEXT, placeOf, repairFor, rowLine, type Unsettled, updateWords, userOption } from "../report";
import { parseRepair, REPAIR_COMMAND, type RepairPlan } from "./parse";
import { foundWords, repairedLines, repairedValue, repairHelp, stopOf, unmended } from "./report";

/** What the look for an install is called while it runs. */
const LOOKING = "Checking the account for an install";

/** The careful choice the command takes. */
const CAREFUL = ["--dry-run"] as const;

/** A plan with every answer in: where the install is, and the token. */
interface Request {
  readonly plan: RepairPlan;
  readonly where: unknown;
  readonly token: Token;
}

/**
 * The command as it is typed after `poplin`, what runs it again, and the careful choice it takes.
 *
 * @param update - whether the line asked for the newest release: the same command again asks for it too
 * @param repair - the way the line names a repair as a next step: `NEXT.repair` before its words are read, and then the way that keeps the user it was given to add
 */
function commandOf(update: boolean, repair: typeof NEXT.repair): { readonly name: string; readonly again: (provider: Provider | undefined, careful: readonly Careful[], place: readonly string[]) => Next; readonly careful: readonly Careful[] } {
  return { name: REPAIR_COMMAND, again: (_provider, careful, place) => repair("this", careful, [...updateWords(update), ...place]), careful: CAREFUL };
}

/** Bring a plan to a request: read the token that is piped, or ask for each answer the plan lacks. A stop holds the place the run knew by then. */
async function settled(plan: RepairPlan, ends: InstallEnds): Promise<Request | Unsettled> {
  if (plan.asking === "never") {
    const token = await givenToken(plan.token, plan.provider, ends.input);

    return typeof token === "object" ? { stop: token, place: placeOf(plan.provider, plan.where) } : { plan, where: plan.where, token };
  }

  const where = plan.where.known ? plan.where : await askWhere(plan.where.open, ends.screen);
  if (where === undefined) return { stop: STOPPED, place: [] };

  const token = plan.token ?? (await askToken(plan.provider, where.where, ends.screen, "repair"));

  return token === undefined ? { stop: STOPPED, place: placeOf(plan.provider, where.where) } : { plan, where: where.where, token };
}

/**
 * Look for the install with the token; a token that shows more than one place is asked which.
 *
 * @returns the whole install and the place it was found at, or why there is none to repair
 */
async function look(request: Request, ends: InstallEnds, show: Show, repair: typeof NEXT.repair): Promise<{ readonly found: Whole<unknown>; readonly where: unknown } | Stop> {
  const { plan, token, where } = request;
  const looked = await lookFor({ provider: plan.provider, token, where, asking: plan.asking, work: "repair" }, ends, {
    looking: () => show.working(LOOKING),
    found: (found) => {
      if (found.state === "whole") show.line("note", foundWords(found));
    },
  });
  if ("problem" in looked) return looked;

  return looked.found.state === "whole" ? { found: looked.found, where: looked.where } : stopOf(looked.found, plan.provider, carefulOf(plan.run), placeOf(plan.provider, looked.where), plan.update, repair);
}

/** Settle a plan's open answers, find the install, and mend it or say what a run would change. The token is hidden from the moment it is read. */
async function planned(plan: RepairPlan, io: Io, ends: InstallEnds, show: Show, secrets: Set<string>): Promise<number> {
  const { provider, run, update } = plan;
  const user = userOption(plan.addUser, io.machine.platform);
  const repair = repairFor(user);
  const line = { command: commandOf(update, repair), careful: carefulOf(run), provider, run };
  const request = await settled(plan, ends);
  if ("stop" in request) return stopped(request.stop, show, { ...line, place: request.place });

  secrets.add(request.token);
  const at = { ...line, place: placeOf(provider, request.where) };
  const ground = await look(request, ends, show, repair);
  if ("problem" in ground) return stopped(ground, show, at);

  const doing = run === "dry-run" ? "Planning the repair" : "Repairing the install";
  show.working(doing);

  const repaired = await provider.repair(ground.found, ground.where, { run, update, addUser: plan.addUser }, ends.reach, (row) => {
    const { tone, text, hang } = rowLine(row, run);
    show.line(tone, text, hang);
    show.working(doing);
  });
  if (!repaired.ok) return stopped(unmended(repaired, at.careful, at.place, update, user.words, repair), show, at);

  for (const line of repairedLines(repaired, run, provider)) show.line(line.tone, line.text);

  show.value(repairedValue(repaired, run, ground.found, { words: [...updateWords(update), ...at.place], repair }));

  return exitCode({ kind: repaired.ready ? "done" : "failed" });
}

/**
 * Run the words after `poplin doctor`, of a line that carries `--repair`.
 *
 * @param io - the machine's ends: where to print, the environment, and whether a person is there to ask
 * @param ends - the providers the package carries, the screen, standard input, and what a provider reaches the world through
 * @returns the exit code: 0 nothing is left undone, or a dry run says a run would leave nothing; 1 something is, or would be, or no whole install is there; 2 written wrong or an answer missing; 5 no answer. Nothing throws
 */
export function runRepair(words: readonly string[], io: Io, ends: InstallEnds): Promise<number> {
  return runCommand({ ...commandOf(words.includes("--update"), NEXT.repair), parse: parseRepair, help: repairHelp, json: (plan) => plan.json, run: planned }, words, io, ends);
}
