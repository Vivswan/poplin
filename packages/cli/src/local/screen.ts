// What a command that talks with a person shows and asks: coloured lines, questions, and a spinner on a terminal, and plain lines everywhere else.
//
//   a terminal      questions and the spinner on stderr, lines in colour with a mark
//   a pipe, a file  the same lines with no mark and no colour, and no question
//
// The result goes to stdout and everything else to stderr, so a pipe takes the result alone.

import { confirm, isCancel, password, select, spinner, text } from "@clack/prompts";
import { type ConsolaInstance, createConsola } from "consola";

/** What a line is, which on a terminal chooses its mark and its colour. */
export type Tone = "done" | "note" | "warning" | "error" | "plain";

/** One answer a person can choose: what choosing it gives, its name, and a line about it. */
export interface Pick {
  readonly value: string;
  readonly label: string;
  readonly hint: string;
}

/** A terminal, or what stands in for one. Each question answers `undefined` when the person stopped it. */
export interface Screen {
  /** Shows one line of the result. */
  readonly line: (tone: Tone, text: string) => void;

  /** Shows one line that is no result: a note, a warning, an error. */
  readonly aside: (tone: Tone, text: string) => void;

  /** Asks for a line of text; with `secret` what is typed is not shown. */
  readonly ask: (question: string, secret?: "secret") => Promise<string | undefined>;

  /** Asks yes or no; Enter gives `initial`. */
  readonly confirm: (question: string, initial: boolean) => Promise<boolean | undefined>;

  /** Asks for one of some answers. */
  readonly choose: (question: string, picks: readonly Pick[]) => Promise<string | undefined>;

  /** Says what is being worked on until the next line or `rest`. */
  readonly working: (text: string) => void;

  /** Ends what `working` began. */
  readonly rest: () => void;
}

/** The two streams of a process, and whether each shows colour. */
interface Streams {
  readonly out: NodeJS.WriteStream;
  readonly err: NodeJS.WriteStream;
  readonly colour: { readonly out: boolean; readonly err: boolean };
}

/** Write one line through consola, by its tone. An error and a warning are kept on one line, with no badge. */
function say(consola: ConsolaInstance, tone: Tone, line: string): void {
  const ways: Readonly<Record<Tone, () => void>> = {
    done: () => consola.success(line),
    note: () => consola.info(line),
    warning: () => consola.warn({ message: line, badge: false }),
    error: () => consola.error({ message: line, badge: false }),
    plain: () => consola.log(line),
  };

  ways[tone]();
}

/** A way to write lines to one stream: through consola where colour shows, and as they are where it does not. */
function writer(stream: NodeJS.WriteStream, colour: boolean): (tone: Tone, line: string) => void {
  if (!colour) return (_tone, line) => void stream.write(`${line}\n`);

  // Every level goes to the one stream: which stream a line is for is the caller's choice, not its level's.
  const consola = createConsola({ stdout: stream, stderr: stream, formatOptions: { date: false, compact: true } });

  return (tone, line) => say(consola, tone, line);
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
  const common = { output: streams.err };
  // The spinner stands alone between lines, so it draws no guide of a question above itself.
  const spin = spinner({ ...common, withGuide: false });
  let spinning = false;

  const rest = (): void => {
    if (spinning) spin.clear();

    spinning = false;
  };

  /** A question is put with the spinner at rest, and a stopped one answers nothing. */
  const asked = async <Answer>(put: () => Promise<Answer | symbol>): Promise<Answer | undefined> => {
    rest();
    const answer = await put();

    return isCancel(answer) ? undefined : (answer as Answer);
  };

  return {
    line: (tone, shown) => {
      rest();
      line(tone, shown);
    },
    aside: (tone, shown) => {
      rest();
      aside(tone, shown);
    },
    ask: (question, secret) => asked<string>(() => (secret === undefined ? text({ ...common, message: question }) : password({ ...common, message: question }))),
    confirm: (question, initial) => asked<boolean>(() => confirm({ ...common, message: question, initialValue: initial })),
    choose: (question, picks) => asked<string>(() => select({ ...common, message: question, options: picks.map((pick) => ({ value: pick.value, label: pick.label, hint: pick.hint })) })),
    working: (shown) => {
      if (!streams.colour.err) return;

      if (spinning) spin.message(shown);
      else spin.start(shown);

      spinning = true;
    },
    rest,
  };
}
