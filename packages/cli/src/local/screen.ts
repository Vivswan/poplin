// What a command that talks with a person shows and asks: coloured lines, questions, and a spinner on a terminal, and plain lines everywhere else.
//
//   a terminal      questions and the spinner on stderr, lines in colour with a mark
//   a pipe, a file  the same lines with no mark and no colour, and no question
//
// The result goes to stdout and everything else to stderr, so a pipe takes the result alone.

import { Readline } from "node:readline/promises";
import { Writable } from "node:stream";
import { styleText } from "node:util";

import { getColumns, isAccessible } from "@clack/core";
import { confirm, isCancel, log, password, select, spinner, text, updateSettings } from "@clack/prompts";
import { Help } from "commander";
import { type ConsolaInstance, createConsola, LogLevels } from "consola";
import libraryWidth from "fast-string-width";
import stringWidth from "string-width";

/** How wide a stream that names no width is taken to be, in the cells of a terminal: a pipe, a file, and a terminal that does not say. */
const ASSUMED_WIDTH = 80;

/** How many cells the mark of a line takes, with the space after it. */
const MARK_WIDTH = 2;

/** How many cells the guide of a block takes, with the two spaces after it. */
const GUIDE_WIDTH = 3;

/** Paints a text whatever stdout is: a block is painted where stderr shows colour. */
const ALWAYS = { validateStream: false } as const;

/** How many cells of its row the spinner takes beside its text: the frame, two spaces, up to three dots, and the last cell, which stays free so that no terminal wraps the row. */
const SPINNER_WIDTH = 7;

/** What takes a text apart into the characters a person sees, each of which a terminal draws whole. */
const CHARACTERS = new Intl.Segmenter();

/** The two pieces the spinner's library writes before the text of a frame it draws over the last one: the cursor to the start of the row, and the erasing from the cursor on. */
const FRAME_START: ReadonlySet<string> = new Set(["\u001b[1G", "\u001b[J"]);

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

/** The look where nobody watches: plain lines of at most the assumed width. */
export const PLAIN_LOOK: Look = { width: ASSUMED_WIDTH, colour: false };

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

/** One row of a block: its text, how far its later rows stand in once it is folded, which is its own indent when left out, and whether it is fainter than the rows around it where the screen paints. */
export interface BlockRow {
  readonly text: string;
  readonly hang?: number;
  readonly faint?: boolean;
}

/** A terminal, or what stands in for one. Each question answers `undefined` when the person stopped it. */
export interface Screen {
  /** Shows one line of the result. `hang` is how far its later rows stand in once a terminal folds it. */
  readonly line: (tone: Tone, text: string, hang?: number) => void;

  /** Shows one line that is no result: a note, a warning, an error. */
  readonly aside: (tone: Tone, text: string, hang?: number) => void;

  /** Shows some rows under one title, which are no result: what a person reads before the question that follows. */
  readonly block: (title: string, rows: readonly BlockRow[]) => void;

  /** Shows a short text that opens an address where it is pressed. It answers `false`, and shows nothing, where the terminal takes no such link: the address is then shown whole by the caller. */
  readonly link: (text: string, address: string) => boolean;

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

  /** Makes a short text that opens an address where it is pressed, for a terminal on the second stream that takes such a link; `undefined` for one that does not. */
  readonly link: (text: string, address: string) => string | undefined;

  /** What a person types into, which the spinner reads its keys from. */
  readonly input: NodeJS.ReadableStream;

  /** Stops the command as its first Ctrl-C does: called when the person presses Ctrl-C or Esc while the spinner shows. */
  readonly stop: () => void;
}

/** A piece of work that the spinner says in lines for a screen reader. It holds no row, so nothing of it is cut or given to a line. */
interface Said {
  readonly draws: false;
}

/** A piece of work that the spinner draws on one row of the terminal. */
interface Drawn {
  readonly draws: true;

  /** Whether a line took the row in this turn, and the work has not said since that it goes on. */
  readonly covered: boolean;
}

/** The piece of work the spinner shows, from the text that starts it to its rest. */
type Work = Said | Drawn;

/** The spinner of a process, as its screen uses it. */
interface Spinning {
  /** Says what is being worked on: it starts the spinner, or gives the one that runs its new text. */
  readonly working: (text: string) => void;

  /** Gives the spinner's row to the line written next. Work that says in the same turn that it goes on keeps its spinner, and any other is at rest once the turn is over. */
  readonly cover: () => void;

  /** Ends the spinner. With `left`, that stays as one line. */
  readonly rest: (left?: string) => void;
}

/**
 * A terminal's stream that is handed each frame of the spinner in one piece.
 *
 * The spinner's library writes a frame over the last one in three: the cursor to the start of the row, the erasing of the row, and the row's new text.
 * A terminal that paints between two of them shows the row empty, which is seen as a flicker.
 * So a piece that is one of the first two, whoever wrote it, is held until the next piece comes.
 */
class Joined extends Writable {
  readonly #to: NodeJS.WriteStream;

  #held = "";

  constructor(to: NodeJS.WriteStream) {
    super({ decodeStrings: false });
    this.#to = to;
  }

  /** Whether the stream behind is a terminal: the library reads the keys of one as a terminal's. */
  get isTTY(): boolean {
    return this.#to.isTTY === true;
  }

  /** How wide the terminal behind is, which the library folds a frame by. */
  get columns(): number {
    return this.#to.columns;
  }

  /** The hook a stream of Node takes each piece through, which fixes its name. */
  override _write(piece: string | Buffer, _encoding: BufferEncoding, done: () => void): void {
    const written = String(piece);
    this.#held += written;

    if (!FRAME_START.has(written)) {
      this.#to.write(this.#held);
      this.#held = "";
    }

    done();
  }
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
 * @param width - the widest a line may be; the assumed width when left out
 * @returns the text, in which only a word wider than the line, such as an address, is wider than it
 */
export function foldedText(text: string, width: number = ASSUMED_WIDTH): string {
  return text
    .split("\n")
    .flatMap((line) => folded(line, width, undefined))
    .join("\n");
}

/**
 * Cut a text to so many cells of a terminal, between two characters.
 *
 * It fits by two counts: the one a terminal's row is measured with, and the one the spinner's library folds a frame by, which is wider for some characters, a soft hyphen among them.
 *
 * @returns the text as it is where it fits, and its start where it does not
 */
function cut(text: string, room: number): string {
  let kept = "";
  for (const { segment } of CHARACTERS.segment(text)) {
    const longer = `${kept}${segment}`;
    // The library counts a text in its composed form.
    if (Math.max(stringWidth(longer), libraryWidth(longer.normalize())) > room) break;

    kept = longer;
  }

  return kept;
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
 * @returns painted and as wide as the terminal where the stream shows colour, and plain at the assumed width everywhere else
 */
export function lookOf(stream: { readonly isTTY?: boolean; readonly columns?: number }, env: Readonly<Record<string, string | undefined>>): Look {
  const colour = showsColour(stream.isTTY, env);

  return colour ? { width: stream.columns ?? PLAIN_LOOK.width, colour } : PLAIN_LOOK;
}

/**
 * A way to write lines to one stream: folded to the terminal's own width where the stream is one, with a mark where colour shows, and as they are everywhere else.
 */
function writer(stream: NodeJS.WriteStream, colour: boolean): (tone: Tone, line: string, hang?: number) => void {
  const width = (): number => stream.columns ?? ASSUMED_WIDTH;
  // A plain line is written by this module: the library would read a backtick in it as a mark of its own.
  const plain = (line: string, hang?: number): void => void stream.write(`${(stream.isTTY === true ? folded(line, width(), hang) : [line]).join("\n")}\n`);
  // A text laid out for the stream is as wide as its look: only a terminal narrower than that, which a plain look of 80 can be, folds it.
  const laid = (text: string): void => void stream.write(`${stream.isTTY === true && stream.columns !== undefined ? foldedText(text, stream.columns) : text}\n`);
  if (!colour) return (tone, line, hang) => (tone === "laid" ? laid(line) : plain(line, hang));

  // Every level goes to the one stream, with a mark, each line as often as it is said and no wider than the terminal: which stream a line is for and whether it shows are the caller's choice, whatever the environment says.
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
 * A way to write a block to one stream, by the library: under its guide where the stream shows colour, each row folded to the terminal, and as plain lines of at most the assumed width everywhere else.
 */
function blockWriter(stream: NodeJS.WriteStream, colour: boolean): Screen["block"] {
  return (title, rows) => {
    const width = colour ? (stream.columns ?? ASSUMED_WIDTH) - GUIDE_WIDTH : Math.min(stream.columns ?? ASSUMED_WIDTH, ASSUMED_WIDTH);
    const lines = rows.flatMap((row) => folded(row.text, width, row.hang).map((line) => (colour && row.faint === true ? styleText("dim", line, ALWAYS) : line)));
    const block = [title, ...lines].join("\n");

    if (colour) log.step(block, { output: stream });
    else log.message(block, { output: stream, withGuide: false, spacing: 0 });
  };
}

/**
 * A screen for where nobody watches: a script, a test, a run whose lines are kept.
 *
 * @param to - what takes each line of the result, each other line, each text of what is being worked on with an empty one at its end, and each question; a question nothing takes is answered as stopped
 * @returns a screen that writes every line as it is, whatever its tone, a block as its title and its rows, and no link, and that nobody chooses or confirms on
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
    block: (title, rows) => {
      for (const line of [title, ...rows.flatMap((row) => folded(row.text, PLAIN_LOOK.width, row.hang))]) to.err(line);
    },
    link: () => false,
    ask: async (question) => to.ask?.(question),
    confirm: async () => undefined,
    choose: async () => undefined,
    working: (shown) => to.status?.(shown),
    rest: () => to.status?.(""),
  };
}

/**
 * The one spinner of a process, on the stream its questions are on.
 *
 * @returns the ways a screen uses it. A spinner that draws is one row of the terminal, with a longer text cut to it, and each of its frames is written in one piece.
 *   A stop key pressed while it shows stops the command by `stop`, as a Ctrl-C at any other moment does
 */
function spinning(streams: Streams): Spinning {
  const said = isAccessible();
  const pen = new Joined(streams.err);
  // The width is read once, here, where the library reads it for its spinner: the screen cuts a text to the row the library folds a frame by.
  const room = getColumns(pen) - SPINNER_WIDTH;
  // The spinner stands alone between lines, so it draws no guide of a question above itself. A signal it hears stops the command, which else would go on.
  const spin = spinner({ output: pen, accessible: said, withGuide: false, cancelMessage: "Cancelled", onCancel: streams.stop });
  let work: Work | undefined;

  /** A text as the spinner shows it: cut to the row where it draws one, and whole where it says work in lines. */
  const fitted = (shown: string): string => (said ? shown : cut(shown, room));

  const begin = (shown: string): Work => {
    spin.start(fitted(shown));
    // The listener stands before the one the spinner's start put on, so it hears a key first.
    streams.input.prependListener("data", stopKey);

    return said ? { draws: false } : { draws: true, covered: false };
  };

  const rest = (left?: string): void => {
    const stays = left !== undefined && streams.colour.err;
    // What is left stays also where a line between took the spinner off: it is started anew to be ended with it.
    if (stays && work === undefined) begin(left);

    if (stays) spin.stop(left);
    else spin.clear();

    streams.input.off("data", stopKey);
    work = undefined;
  };

  // The spinner's library ends the process with code 0 at a stop key. The spinner is cleared here first, which takes that listener off, and the command is stopped by its one way.
  function stopKey(typed: Buffer | string): void {
    if (!STOP_KEYS.has(String(typed))) return;

    rest();
    streams.stop();
  }

  const cover = (): void => {
    if (work === undefined) return;

    // Work said in lines holds no row to give: a line ends it, and it is said anew after the line.
    if (!work.draws) {
      rest();

      return;
    }

    if (work.covered) return;

    const covered: Work = { draws: true, covered: true };
    work = covered;
    queueMicrotask(() => {
      if (work === covered) rest();
    });
    // The cursor to the start of the row and the erasing of the row reach the terminal as one piece.
    void new Readline(streams.err).cursorTo(0).clearLine(0).commit();
  };

  const working = (shown: string): void => {
    if (!streams.colour.err) return;

    if (work === undefined) {
      work = begin(shown);

      return;
    }

    if (work.draws) work = { draws: true, covered: false };

    spin.message(fitted(shown));
  };

  return { working, cover, rest };
}

/**
 * The screen of this process.
 *
 * @param streams - where the result and the rest are written, and whether each shows colour: a stream without is written plain lines
 * @returns a screen whose questions and spinner are on the second stream; a caller asks only where a person is there to answer
 */
export function processScreen(streams: Streams): Screen {
  const line = writer(streams.out, streams.colour.out);
  const aside = writer(streams.err, streams.colour.err);
  const block = blockWriter(streams.err, streams.colour.err);
  const common = { output: streams.err };
  const spin = spinning(streams);
  updateSettings({ aliases: { [END_OF_INPUT]: "cancel" } });

  /** A question is put with the spinner at rest, and a stopped one answers nothing. */
  const asked = async <Answer>(put: () => Promise<Answer | symbol>): Promise<Answer | undefined> => {
    spin.rest();
    const answer = await put();

    return isCancel(answer) ? undefined : (answer as Answer);
  };

  return {
    line: (tone, shown, hang) => {
      spin.cover();
      line(tone, shown, hang);
    },
    aside: (tone, shown, hang) => {
      spin.cover();
      aside(tone, shown, hang);
    },
    block: (title, rows) => {
      spin.rest();
      block(title, rows);
    },
    link: (shown, address) => {
      const painted = streams.colour.err;
      const linked = streams.link(painted ? styleText("underline", shown, ALWAYS) : shown, address);
      if (linked === undefined) return false;

      spin.rest();
      // A link stands under the guide of the block before it, which only a stream that shows colour draws.
      log.message(linked, { ...common, withGuide: painted, spacing: 0 });

      return true;
    },
    ask: (question, secret) =>
      asked<string>(() => (secret === undefined ? text({ ...common, message: question }) : password({ ...common, message: question }))),
    confirm: (question, initial) => asked<boolean>(() => confirm({ ...common, message: question, initialValue: initial })),
    choose: (question, picks) =>
      asked<string>(() => select({ ...common, message: question, options: picks.map((pick) => ({ value: pick.value, label: pick.label, hint: pick.hint })) })),
    working: spin.working,
    rest: spin.rest,
  };
}
