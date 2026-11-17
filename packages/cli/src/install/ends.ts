// What the install commands reach in this process: the providers beside the built command, the terminal, standard input, and the network.
// A command of the family runs in one frame: its words read, its help and its list answered, its stops worded, every token hidden, and its lines shown for a person or as one JSON value.

import { text } from "node:stream/consumers";
import { fileURLToPath } from "node:url";

import type { Run } from "../../../core/src/install/installer";
import { exitCode } from "../commands/exit-codes";
import type { Io } from "../commands/records";
import { guardedScreen, written } from "../commands/util";
import { pasted, runnerOf } from "../local/invoked";
import { loadProviders } from "../local/providers";
import type { Tone } from "../local/screen";
import { VERSION } from "../poplin";
import { STOPPED, TOKEN_VARIABLE } from "./ask";
import type { Careful, InstallEnds, Next, Parsed, Provider, Stop } from "./records";
import { stopLines, stopValue } from "./report";

/** The folder of the providers, beside the file this code is built into. */
const PROVIDERS = fileURLToPath(new URL("./providers/", import.meta.url));

/** The stops that say the install is at another place than the line named: the command that goes on carries no place, and the sentence names the option. */
const ELSEWHERE: ReadonlySet<Stop["problem"]> = new Set(["other_place"]);

/** The exits of a stop, as the endings the command table knows. */
const ENDINGS = { 1: "failed", 2: "usage-error", 5: "unreachable" } as const;

/** How a command says what it does: lines for a person, or nothing but the one JSON value at its end. */
export interface Show {
  /** One line of the result; `hang` is how far its later rows stand in once a terminal folds it. */
  readonly line: (tone: Tone, text: string, hang?: number) => void;

  /** One line that is no result. */
  readonly aside: (tone: Tone, text: string, hang?: number) => void;

  /** What is being worked on, until the next line. */
  readonly working: (text: string) => void;

  /** The one JSON value of a run for a program. */
  readonly value: (value: unknown) => void;
}

/** One command of the family, as it is run from the words after it. */
export interface CommandRun<Planned> {
  /** The command as it is typed after `poplin`, such as `install`. */
  readonly name: string;

  /** What runs the command again, at the provider the line got as far as, with the careful choices of the line and the place the run knows: the next step of a stop that names no other. */
  readonly again: (provider: Provider | undefined, careful: readonly Careful[], place: readonly string[]) => Next;

  /** The careful choices the command takes, each as the word a line gives it by. */
  readonly careful: readonly Careful[];

  /** Reads the words into what they ask for. */
  readonly parse: (words: readonly string[], providers: readonly Provider[], env: Io["machine"]["env"], canAsk: boolean) => Parsed<Planned>;

  /** The help of the command, or of one provider. */
  readonly help: (providers: readonly Provider[], provider?: Provider) => string;

  /** Whether a plan asked for the one JSON value. */
  readonly json: (plan: Planned) => boolean;

  /** Runs a plan to its exit code. A token it reads is added to `secrets` before any line is shown. */
  readonly run: (plan: Planned, io: Io, ends: InstallEnds, show: Show, secrets: Set<string>) => Promise<number>;
}

/** A line as it was given: its command, and the careful choices among its words. */
interface Line<Planned> {
  readonly command: CommandRun<Planned>;
  readonly careful: readonly Careful[];
}

/** Where a stop came: in which command, with which careful choices on its line, at which provider when the line got as far as one, at which place once the run knows it, and in which kind of run when it came after the plan. */
interface StoppedAt {
  readonly command: Pick<CommandRun<never>, "name" | "again">;
  readonly careful: readonly Careful[];
  readonly provider?: Provider | undefined;
  readonly place?: readonly string[];
  readonly run?: Run;
}

/**
 * The same machine's ends and the same screen, which is the one the command's own ends hold, with every token and every control character taken out of what is shown.
 *
 * The one JSON value holds each text as it came, since JSON escapes it. Stdout is left to its writers: the screen, the one JSON value written without tokens, and the help, which holds nothing a person or a variable gave.
 */
function guarded(io: Io, ends: InstallEnds, secrets: ReadonlySet<string>): { readonly io: Io; readonly ends: InstallEnds } {
  const screen = guardedScreen(ends.screen, secrets);

  return { io: { ...io, screen }, ends: { ...ends, screen } };
}

/** The ways to show for one command. With `--json` no line reaches stdout but the one value, and what is no result goes to stderr as it is. */
function showOf(json: boolean, io: Io, ends: InstallEnds, secrets: ReadonlySet<string>): Show {
  const value = (said: unknown): void => io.out(written(said, secrets));

  if (json) return { line: () => undefined, aside: (_tone, text) => io.screen.aside("plain", text), working: () => undefined, value };

  return { line: ends.screen.line, aside: ends.screen.aside, working: ends.screen.working, value: () => undefined };
}

/**
 * The ends of this process.
 *
 * The screen is the machine's own. A request and a wait end when the person stops the command.
 *
 * @param io - the machine's ends, whose stop ends each request and each wait
 */
export function processEnds(io: Io): InstallEnds {
  const sleep = async (milliseconds: number): Promise<void> => {
    if ((await io.pause(milliseconds)) === "interrupted") throw new Error("the command was stopped");
  };

  return {
    providers: () => loadProviders(PROVIDERS),
    screen: io.screen,
    input: () => text(process.stdin),
    reach: {
      fetch: (input, init) => fetch(input, { ...init, signal: init?.signal == null ? io.stopped : AbortSignal.any([init.signal, io.stopped]) }),
      now: () => Date.now(),
      sleep,
    },
    sleep,
  };
}

/** Say why the command stopped before its work was done, and choose its exit code. A program reads `ready` of a stop that came after the plan as it does of a run. */
export function stopped(stop: Stop, show: Show, at: StoppedAt): number {
  for (const line of stopLines(stop, at.provider, at.command.name)) show.aside(line.tone, line.text);

  const place = ELSEWHERE.has(stop.problem) ? [] : (at.place ?? []);
  const value = stopValue(stop, at.command.again(at.provider, at.careful, place));
  show.value(at.run === undefined ? value : { ...value, run: at.run, ready: false });

  return exitCode({ kind: ENDINGS[stop.exit] });
}

/** The list of providers, for a line that names none where nobody can be asked. */
function list<Planned>(command: CommandRun<Planned>, providers: readonly Provider[], json: boolean, io: Io): number {
  if (json) io.out(JSON.stringify({ ok: true, providers: providers.map((one) => ({ id: one.id, name: one.name, about: one.about })) }));
  else io.out(pasted(command.help(providers), runnerOf(io.machine.env)));

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

/**
 * Do what a line that was read asks for.
 *
 * @param line - the command, and the careful choices among the line's words: a stop before the plan has no other reading of them
 */
async function answered<Planned>(line: Line<Planned>, parsed: Parsed<Planned>, providers: readonly Provider[], io: Io, ends: InstallEnds, secrets: Set<string>): Promise<number> {
  const { command } = line;
  const { name } = command;
  if (parsed.kind === "help" || parsed.kind === "version") {
    io.out(parsed.kind === "help" ? pasted(command.help(providers, parsed.provider), runnerOf(io.machine.env)) : VERSION);

    return exitCode({ kind: "done" });
  }

  const show = showOf(parsed.kind === "plan" ? command.json(parsed.plan) : parsed.json, io, ends, secrets);
  if (providers.length === 0) return stopped({ problem: "no_provider", exit: 1, lines: [`this build of poplin carries no provider to ${name} at`, `install the published package: npx poplin ${name}`] }, show, line);

  if (parsed.kind === "list") return list(command, providers, parsed.json, io);

  if (parsed.kind === "stop") return stopped(parsed.stop, show, { ...line, provider: parsed.provider });

  if (parsed.kind === "plan") return command.run(parsed.plan, io, ends, show, secrets);

  const provider = await picked(providers, ends);

  return provider === undefined ? stopped(STOPPED, show, line) : answered(line, parsed.named(provider), providers, io, ends, secrets);
}

/**
 * Run the words after one command of the family, with every token hidden from what it shows.
 *
 * @param rawIo - the machine's ends: where to print, the environment, and whether a person is there to ask
 * @param rawEnds - the providers the package carries, the screen, standard input, and what a provider reaches the world through
 * @returns the command's exit code; a failure it has no word for is exit 1, so nothing throws
 */
export async function runCommand<Planned>(command: CommandRun<Planned>, words: readonly string[], rawIo: Io, rawEnds: InstallEnds): Promise<number> {
  const held = rawIo.machine.env[TOKEN_VARIABLE] ?? "";
  const secrets = new Set(held === "" ? [] : [held]);
  const { io, ends } = guarded(rawIo, rawEnds, secrets);
  const line = { command, careful: command.careful.filter((choice) => words.includes(choice)) };

  try {
    const providers = await ends.providers();

    return await answered(line, command.parse(words, providers, io.machine.env, io.terminal.asks), providers, io, ends, secrets);
  } catch (error) {
    const what = error instanceof Error ? `${error.name}: ${error.message}` : "an unknown failure";
    const said = io.stopped.aborted ? "the command was stopped. Run it again: it goes on from what stands." : `poplin ${command.name} failed in a way it has no word for: ${what}. Run it again: it goes on from what stands.`;

    return stopped({ problem: io.stopped.aborted ? "stopped" : "crashed", exit: 1, words: said }, showOf(words.includes("--json"), io, ends, secrets), line);
  }
}
