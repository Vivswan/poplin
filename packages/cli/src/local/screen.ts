// What a command that talks with a person shows and asks: coloured lines, questions, and a spinner on a terminal, and plain lines everywhere else.
//
//   a terminal      questions and the spinner on stderr, lines in colour with a mark
//   a pipe, a file  the same lines with no mark and no colour, and no question
//
// The result goes to stdout and everything else to stderr, so a pipe takes the result alone.

import { confirm, isCancel, password, select, spinner, text, updateSettings } from "@clack/prompts";
import { Help } from "commander";
import { type ConsolaInstance, createConsola, LogLevels } from "consola";
import stringWidth from "string-width";

/** The widest a line is shown, in the cells of a terminal: a narrower terminal's own width counts where it is known. */
const MAX_WIDTH = 80;

/** How many cells the mark of a line takes, with the space after it. */
const MARK_WIDTH = 2;

/** The narrowest column that is still folded: under it a line is left to the terminal. */
const MIN_FOLD = 20;

/** The value of `TERM` on a terminal that takes no control sequence. */
const PLAIN_TERMINAL = "dumb";

/** What a terminal sends for Ctrl-D, which ends a question as Ctrl-C does. */
const END_OF_INPUT = "\u0004";

/** What a terminal sends for the keys that stop the spinner's library: Ctrl-C, Esc, and Ctrl-D. */
const STOP_KEYS: ReadonlySet<string> = new Set(["\u0003", "\u001b", END_OF_INPUT]);

/** The library's folding of a text at its spaces, measured in the cells of a terminal. It breaks no word: one wider than the line stands alone on a row. */
const FOLDER = Object.assign(new Help(), { minWidthToWrap: MIN_FOLD, displayWidth: (shown: string): number => stringWidth(shown) });

/** The look where nobody watches: plain lines of at most the widest width of the screen. */
export const PLAIN_LOOK: Look = { width: MAX_WIDTH, colour: false };

/** What a line is, which on a terminal chooses its mark and its colour. A `laid` one is a text already laid out for the stream, written as it is where it fits. */
export type Tone = "done" | "note" | "warning" | "error" | "plain" | "laid";

/** One line as it is shown: its text, what kind of line it is, and how far its later rows stand in once it is folded; the line's own indent when left out. */
export interface Line {
  readonly tone: Tone;
  readonly text: string;
  readonly hang?: number;
}

/** How a text laid out in columns is shown on a stream: how wide its lines may be, and whether it is painted. */
export interface Look {
  readonly width: number;
  readonly colour: boolean;
}

/** One answer a person can choose: what choosing it gives, its name, and a line about it. */
export interface Pick {
  readonly value: string;
  readonly label: string;
  readonly hint: string;
}

/** A terminal, or what stands in for one. Each question answers `undefined` when the person stopped it. */
export interface Screen {
  /** Shows one line of the result. `hang` is how far its later rows stand in once a terminal folds it. */
  readonly line: (tone: Tone, text: string, hang?: number) => void;

  /** Shows one line that is no result: a note, a warning, an error. */
  readonly aside: (tone: Tone, text: string, hang?: number) => void;

  /** Asks for a line of text; with `secret` what is typed is not shown. */
  readonly ask: (question: string, secret?: "secret") => Promise<string | undefined>;

  /** Asks yes or no; Enter gives `initial`. */
  readonly confirm: (question: string, initial: boolean) => Promise<boolean | undefined>;

  /** Asks for one of some answers. */
  readonly choose: (question: string, picks: readonly Pick[]) => Promise<string | undefined>;

  /** Says what is being worked on until the next line or `rest`. */
  readonly working: (text: string) => void;

  /** Ends what `working` began. With `left`, that stays as one line where work shows; nothing stays where none does. */
  readonly rest: (left?: string) => void;
}

/** The streams of a process, whether each shows colour, and what stops the command. */
interface Streams {
  /** Where the lines of the result go. */
  readonly out: NodeJS.WriteStream;

  /** Where every other line, each question, and the spinner go. */
  readonly err: NodeJS.WriteStream;

  /** Whether each of the two shows colour, marks, and the spinner. */
  readonly colour: { readonly out: boolean; readonly err: boolean };

  /** What a person types into, which the spinner reads its keys from. */
  readonly input: NodeJS.ReadableStream;

  /** Stops the command as its first Ctrl-C does: called when the person presses Ctrl-C or Esc while the spinner shows. */
  readonly stop: () => void;
}

/** Write one line through consola, by its tone. An error and a warning are kept on one line, with no badge. */
function say(consola: ConsolaInstance, tone: Tone, line: string): void {
  const ways: Readonly<Record<Tone, () => void>> = {
    done: () => consola.success(line),
    note: () => consola.info(line),
    warning: () => consola.warn({ message: line, badge: false }),
    error: () => consola.error({ message: line, badge: false }),
    plain: () => consola.log(line),
    laid: () => consola.log(line),
  };

  ways[tone]();
}

/**
 * Fold one line to a width, at its spaces.
 *
 * @param hang - how far the rows after the first stand in, which is also where the folded part of the line starts; the line's own indent when left out
 * @returns the rows, the first of which starts as the line does
 */
function folded(line: string, width: number, hang: number | undefined): string[] {
  if (stringWidth(line) <= width) return [line];

  const indent = hang ?? line.length - line.trimStart().length;
  const head = line.slice(0, indent);
  if (stringWidth(head) !== indent || width - indent < MIN_FOLD) return FOLDER.boxWrap(line, width).split("\n");

  const [first = "", ...rest] = FOLDER.boxWrap(line.slice(indent), width - indent).split("\n");

  return [`${head}${first}`, ...rest.map((row) => `${" ".repeat(indent)}${row}`)];
}

/**
 * Fold a text of many lines as a terminal shows it: each line at its spaces, its later rows under its own indent. A colour sequence takes no room.
 *
 * @param width - the widest a line may be; the widest width of the screen when left out
 * @returns the text, in which only a word wider than the line, such as an address, is wider than it
 */
export function foldedText(text: string, width: number = MAX_WIDTH): string {
  return text
    .split("\n")
    .flatMap((line) => folded(line, width, undefined))
    .join("\n");
}

/**
 * Whether a stream shows colour, marks, and the spinner: a terminal does, unless `NO_COLOR` or `CI` is set or the terminal takes no control sequence.
 *
 * @param terminal - whether the stream is a terminal
 */
export function showsColour(terminal: boolean | undefined, env: Readonly<Record<string, string | undefined>>): boolean {
  const set = (name: string): boolean => (env[name] ?? "") !== "";

  return terminal === true && !set("NO_COLOR") && !set("CI") && env.TERM !== PLAIN_TERMINAL;
}

/**
 * How a text laid out in columns is shown on a stream.
 *
 * @returns painted and as wide as the terminal where the stream shows colour, and plain at the widest width of the screen everywhere else
 */
export function lookOf(stream: { readonly isTTY?: boolean; readonly columns?: number }, env: Readonly<Record<string, string | undefined>>): Look {
  const colour = showsColour(stream.isTTY, env);

  return colour ? { width: stream.columns ?? PLAIN_LOOK.width, colour } : PLAIN_LOOK;
}

/**
 * A way to write lines to one stream: folded to the terminal where the stream is one, with a mark where colour shows, and as they are everywhere else.
 */
function writer(stream: NodeJS.WriteStream, colour: boolean): (tone: Tone, line: string, hang?: number) => void {
  const width = (): number => Math.min(stream.columns ?? MAX_WIDTH, MAX_WIDTH);
  // A plain line is written by this module: the library would read a backtick in it as a mark of its own.
  const plain = (line: string, hang?: number): void => void stream.write(`${(stream.isTTY === true ? folded(line, width(), hang) : [line]).join("\n")}\n`);
  // A text laid out for the stream is as wide as its look: only a terminal narrower than that, which a plain look of 80 can be, folds it.
  const laid = (text: string): void => void stream.write(`${stream.isTTY === true && stream.columns !== undefined ? foldedText(text, stream.columns) : text}\n`);
  if (!colour) return (tone, line, hang) => (tone === "laid" ? laid(line) : plain(line, hang));

  // Every level goes to the one stream, with a mark, each line as often as it is said and no wider than the widest: which stream a line is for and whether it shows are the caller's choice, whatever the environment says.
  // The options stand in a constant because the types TypeScript reads are the browser build's, which name no `fancy`.
  const marked = { fancy: true, level: LogLevels.info, throttle: 0, stdout: stream, stderr: stream, formatOptions: { date: false, compact: true, columns: width() } };
  const consola = createConsola(marked);

  return (tone, line, hang) => {
    if (tone === "laid") return laid(line);
    if (tone === "plain") return plain(line, hang);

    const [first = "", ...rest] = folded(line, width() - MARK_WIDTH, hang);

    say(consola, tone, [first, ...rest.map((row) => `${" ".repeat(MARK_WIDTH)}${row}`)].join("\n"));
  };
}

/**
 * A screen for where nobody watches: a script, a test, a run whose lines are kept.
 *
 * @param to - what takes each line of the result, each other line, each text of what is being worked on with an empty one at its end, and each question; a question nothing takes is answered as stopped
 * @returns a screen that writes every line as it is, whatever its tone, and that nobody chooses or confirms on
 */
export function plainScreen(to: {
  readonly out: (line: string) => void;
  readonly err: (line: string) => void;
  readonly status?: (text: string) => void;
  readonly ask?: (question: string) => Promise<string | undefined>;
}): Screen {
  return {
    line: (_tone, shown) => to.out(shown),
    aside: (_tone, shown) => to.err(shown),
    ask: async (question) => to.ask?.(question),
    confirm: async () => undefined,
    choose: async () => undefined,
    working: (shown) => to.status?.(shown),
    rest: () => to.status?.(""),
  };
}

/**
 * The screen of this process.
 *
 * @param streams - where the result and the rest are written, and whether each shows colour: a stream without is written plain lines
 * @returns a screen whose questions and spinner are on the second stream; a caller asks only where a person is there to answer.
 *   A stop key pressed while the spinner shows stops the command by `stop`, as a Ctrl-C at any other moment does
 */
export function processScreen(streams: Streams): Screen {
  const line = writer(streams.out, streams.colour.out);
  const aside = writer(streams.err, streams.colour.err);
  const common = { output: streams.err };
  // The spinner stands alone between lines, so it draws no guide of a question above itself. A signal it hears stops the command, which else would go on.
  const spin = spinner({ ...common, withGuide: false, cancelMessage: "stopped", onCancel: streams.stop });
  updateSettings({ aliases: { [END_OF_INPUT]: "cancel" } });
  let spinning = false;

  const rest = (left?: string): void => {
    // What is left stays also where a line between took the spinner off: it is started anew to be ended with it.
    if (left !== undefined && !spinning && streams.colour.err) spin.start(left);

    if (left !== undefined && streams.colour.err) spin.stop(left);
    else if (spinning) spin.clear();

    streams.input.off("data", stopKey);
    spinning = false;
  };

  // The spinner's library ends the process with code 0 at a stop key. The spinner is cleared here first, which takes that listener off, and the command is stopped by its one way.
  function stopKey(typed: Buffer | string): void {
    if (!STOP_KEYS.has(String(typed))) return;

    rest();
    streams.stop();
  }

  /** A question is put with the spinner at rest, and a stopped one answers nothing. */
  const asked = async <Answer>(put: () => Promise<Answer | symbol>): Promise<Answer | undefined> => {
    rest();
    const answer = await put();

    return isCancel(answer) ? undefined : (answer as Answer);
  };

  return {
    line: (tone, shown, hang) => {
      rest();
      line(tone, shown, hang);
    },
    aside: (tone, shown, hang) => {
      rest();
      aside(tone, shown, hang);
    },
    ask: (question, secret) =>
      asked<string>(() => (secret === undefined ? text({ ...common, message: question }) : password({ ...common, message: question }))),
    confirm: (question, initial) => asked<boolean>(() => confirm({ ...common, message: question, initialValue: initial })),
    choose: (question, picks) =>
      asked<string>(() => select({ ...common, message: question, options: picks.map((pick) => ({ value: pick.value, label: pick.label, hint: pick.hint })) })),
    working: (shown) => {
      if (!streams.colour.err) return;

      if (spinning) {
        spin.message(shown);

        return;
      }

      spin.start(shown);
      // The listener stands before the one the spinner's start put on, so it hears a key first.
      streams.input.prependListener("data", stopKey);
      spinning = true;
    },
    rest,
  };
}
