// What the install commands reach in this process: the providers beside the built command, the terminal, standard input, and the network.
// A command of the family runs in one frame: its words read, its help and its list answered, its stops worded, every token hidden, and its lines shown for a person or as one JSON value.

import { text } from "node:stream/consumers";
import { fileURLToPath } from "node:url";

import type { Run } from "../../../core/src/install/installer";
import { exitCode } from "../commands/exit-codes";
import type { Io } from "../commands/records";
import { hide, written } from "../commands/util";
import { loadProviders } from "../local/providers";
import { processScreen, type Screen, type Tone } from "../local/screen";
import { VERSION } from "../poplin";
import { STOPPED, TOKEN_VARIABLE } from "./ask";
import type { InstallEnds, Next, Parsed, Provider, Stop } from "./records";
import { stopLines, stopValue } from "./report";

/** The folder of the providers, beside the file this code is built into. */
const PROVIDERS = fileURLToPath(new URL("./providers/", import.meta.url));

/** The value of `TERM` on a terminal that takes no control sequence. */
const PLAIN_TERMINAL = "dumb";

/** The exits of a stop, as the endings the command table knows. */
const ENDINGS = { 1: "failed", 2: "usage-error", 5: "unreachable" } as const;

/** How a command says what it does: lines for a person, or nothing but the one JSON value at its end. */
export interface Show {
  /** One line of the result. */
  readonly line: (tone: Tone, text: string) => void;

  /** One line that is no result. */
  readonly aside: (tone: Tone, text: string) => void;

  /** What is being worked on, until the next line. */
  readonly working: (text: string) => void;

  /** The one JSON value of a run for a program. */
  readonly value: (value: unknown) => void;
}

/** One command of the family, as it is run from the words after it. */
export interface CommandRun<Planned> {
  /** The command as it is typed after `poplin`, such as `install`. */
  readonly name: string;

  /** What runs the command again, at the provider the line got as far as: the next step of a stop that names no other. */
  readonly again: (provider: Provider | undefined) => Next;

  /** Reads the words into what they ask for. */
  readonly parse: (words: readonly string[], providers: readonly Provider[], env: Io["machine"]["env"], canAsk: boolean) => Parsed<Planned>;

  /** The help of the command, or of one provider. */
  readonly help: (providers: readonly Provider[], provider?: Provider) => string;

  /** Whether a plan asked for the one JSON value. */
  readonly json: (plan: Planned) => boolean;

  /** Runs a plan to its exit code. A token it reads is added to `secrets` before any line is shown. */
  readonly run: (plan: Planned, io: Io, ends: InstallEnds, show: Show, secrets: Set<string>) => Promise<number>;
}

/** Where a stop came: in which command, at which provider when the line got as far as one, and in which kind of run when it came after the plan. */
interface StoppedAt {
  readonly command: Pick<CommandRun<never>, "name" | "again">;
  readonly provider?: Provider | undefined;
  readonly run?: Run;
}

/**
 * The same screen and the same machine's ends, with every token taken out of each line, each question, and each choice before it is shown.
 *
 * Stdout is left to its writers: the screen, the one JSON value written without tokens, and the help, which holds nothing a person or a variable gave.
 */
function guarded(io: Io, ends: InstallEnds, secrets: ReadonlySet<string>): { readonly io: Io; readonly ends: InstallEnds } {
  const safe = (text: string): string => hide(text, secrets);
  const { screen } = ends;
  const hiding: Screen = {
    line: (tone, text) => screen.line(tone, safe(text)),
    aside: (tone, text) => screen.aside(tone, safe(text)),
    ask: (question, secret) => screen.ask(safe(question), secret),
    confirm: (question, initial) => screen.confirm(safe(question), initial),
    choose: (question, picks) =>
      screen.choose(
        safe(question),
        picks.map((pick) => ({ value: pick.value, label: safe(pick.label), hint: safe(pick.hint) })),
      ),
    working: (text) => screen.working(safe(text)),
    rest: screen.rest,
  };

  return { io: { ...io, err: (line) => io.err(safe(line)) }, ends: { ...ends, screen: hiding } };
}

/** The ways to show for one command. With `--json` no line reaches stdout but the one value, and what is no result goes to stderr as it is. */
function showOf(json: boolean, io: Io, ends: InstallEnds, secrets: ReadonlySet<string>): Show {
  const value = (said: unknown): void => io.out(written(said, secrets));

  if (json) return { line: () => undefined, aside: (_tone, text) => io.err(text), working: () => undefined, value };

  return { line: ends.screen.line, aside: ends.screen.aside, working: ends.screen.working, value: () => undefined };
}

/**
 * The ends of this process.
 *
 * Colour shows on a stream that is a terminal, unless `NO_COLOR` is set or the terminal takes no control sequence. A request and a wait end when the person stops the command.
 *
 * @param io - the machine's ends, whose stop ends each request and each wait
 */
export function processEnds(io: Io): InstallEnds {
  const { env } = io.machine;
  const plain = (env.NO_COLOR ?? "") !== "" || env.TERM === PLAIN_TERMINAL;

  return {
    providers: () => loadProviders(PROVIDERS),
    screen: processScreen({ out: process.stdout, err: process.stderr, colour: { out: process.stdout.isTTY === true && !plain, err: process.stderr.isTTY === true && !plain } }),
    input: () => text(process.stdin),
    reach: {
      fetch: (input, init) => fetch(input, { ...init, signal: init?.signal == null ? io.stopped : AbortSignal.any([init.signal, io.stopped]) }),
      now: () => Date.now(),
    },
    sleep: async (milliseconds) => {
      if ((await io.pause(milliseconds)) === "interrupted") throw new Error("the command was stopped");
    },
  };
}

/** Say why the command stopped before its work was done, and choose its exit code. A program reads `ready` of a stop that came after the plan as it does of a run. */
export function stopped(stop: Stop, show: Show, at: StoppedAt): number {
  for (const line of stopLines(stop, at.provider, at.command.name)) show.aside(line.tone, line.text);

  const value = stopValue(stop, at.command.again(at.provider));
  show.value(at.run === undefined ? value : { ...value, run: at.run, ready: false });

  return exitCode({ kind: ENDINGS[stop.exit] });
}

/** The list of providers, for a line that names none where nobody can be asked. */
function list<Planned>(command: CommandRun<Planned>, providers: readonly Provider[], json: boolean, io: Io): number {
  if (json) io.out(JSON.stringify({ ok: true, providers: providers.map((one) => ({ id: one.id, name: one.name, about: one.about })) }));
  else io.out(command.help(providers));

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

/** Do what a line that was read asks for. */
async function answered<Planned>(command: CommandRun<Planned>, parsed: Parsed<Planned>, providers: readonly Provider[], io: Io, ends: InstallEnds, secrets: Set<string>): Promise<number> {
  const { name } = command;
  if (parsed.kind === "help" || parsed.kind === "version") {
    io.out(parsed.kind === "help" ? command.help(providers, parsed.provider) : VERSION);

    return exitCode({ kind: "done" });
  }

  const show = showOf(parsed.kind === "plan" ? command.json(parsed.plan) : parsed.json, io, ends, secrets);
  if (providers.length === 0) return stopped({ problem: "no_provider", exit: 1, lines: [`this build of poplin carries no provider to ${name} at`, `install the published package: npx poplin ${name}`] }, show, { command });

  if (parsed.kind === "list") return list(command, providers, parsed.json, io);

  if (parsed.kind === "stop") return stopped(parsed.stop, show, { command });

  if (parsed.kind === "plan") return command.run(parsed.plan, io, ends, show, secrets);

  const provider = await picked(providers, ends);

  return provider === undefined ? stopped(STOPPED, show, { command }) : answered(command, parsed.named(provider), providers, io, ends, secrets);
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

  try {
    const providers = await ends.providers();

    return await answered(command, command.parse(words, providers, io.machine.env, io.terminal.asks), providers, io, ends, secrets);
  } catch (error) {
    const what = error instanceof Error ? `${error.name}: ${error.message}` : "an unknown failure";
    const said = io.stopped.aborted ? "the command was stopped. Run it again: it goes on from what stands." : `poplin ${command.name} failed in a way it has no word for: ${what}. Run it again: it goes on from what stands.`;

    return stopped({ problem: io.stopped.aborted ? "stopped" : "crashed", exit: 1, words: said }, showOf(words.includes("--json"), io, ends, secrets), { command });
  }
}
