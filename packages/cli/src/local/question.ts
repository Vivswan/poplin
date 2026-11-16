// One question a command puts to the person at the terminal, and the line typed in answer.

import { once } from "node:events";
import { createInterface } from "node:readline/promises";

/** Where a question is put, and what ends it. */
interface Ends {
  /** What the person types into. */
  readonly input: NodeJS.ReadableStream;

  /** Where the question is written: not the stream of the result. */
  readonly output: NodeJS.WritableStream;

  /** Aborts when the person stops the command, which ends a question that waits. */
  readonly stopped: AbortSignal;
}

/**
 * Ask one question and read the line typed.
 *
 * @returns the line, or `undefined` once the person stopped the question: Ctrl-C or Ctrl-D at it, or a stop of the command while it waits. The line of a stopped question is ended, so what is printed next starts a line of its own
 */
export async function askLine(question: string, ends: Ends): Promise<string | undefined> {
  const terminal = createInterface({ input: ends.input, output: ends.output });
  // The library leaves a question open for ever once its input closed.
  const closed = once(terminal, "close").then(() => undefined);

  const typed = await Promise.race([terminal.question(question, { signal: ends.stopped }), closed]).catch(() => undefined);
  terminal.close();
  if (typed === undefined) ends.output.write("\n");

  return typed;
}
