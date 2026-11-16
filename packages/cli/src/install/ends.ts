// What the install commands reach in this process: the providers beside the built command, the terminal, standard input, and the network.
// A command works through the same ends with every token hidden, and shows its lines for a person or as one JSON value.

import { text } from "node:stream/consumers";
import { fileURLToPath } from "node:url";

import type { Io } from "../commands/records";
import { hide, written } from "../commands/util";
import { loadProviders } from "../local/providers";
import { processScreen, type Screen, type Tone } from "../local/screen";
import type { InstallEnds } from "./records";

/** The folder of the providers, beside the file this code is built into. */
const PROVIDERS = fileURLToPath(new URL("./providers/", import.meta.url));

/** The value of `TERM` on a terminal that takes no control sequence. */
const PLAIN_TERMINAL = "dumb";

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

/**
 * The same screen and the same machine's ends, with every token taken out of each line, each question, and each choice before it is shown.
 *
 * Stdout is left to its writers: the screen, the one JSON value written without tokens, and the help, which holds nothing a person or a variable gave.
 */
export function guarded(io: Io, ends: InstallEnds, secrets: ReadonlySet<string>): { readonly io: Io; readonly ends: InstallEnds } {
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
export function showOf(json: boolean, io: Io, ends: InstallEnds, secrets: ReadonlySet<string>): Show {
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
