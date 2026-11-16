import { describe, expect, test } from "bun:test";
import { PassThrough } from "node:stream";

import { askLine } from "../../src/local/question";

/** The key Ctrl-C sends on a terminal, and the one Ctrl-D sends. */
const KEYS = { interrupt: "\u0003", end: "\u0004" };

/** A terminal's two ends: what is typed goes into `input`, and `shown` is everything written to it. */
function terminal(): { readonly input: PassThrough; readonly output: NodeJS.WritableStream; readonly shown: () => string } {
  const input = new PassThrough();
  const output = new PassThrough();
  const chunks: string[] = [];
  output.on("data", (chunk: Buffer) => chunks.push(chunk.toString()));

  // The library reads keys, not lines, only from what it takes for a terminal.
  return { input, output: Object.assign(output, { isTTY: true }), shown: () => chunks.join("") };
}

describe("askLine", () => {
  test("a line typed is answered as it was typed", async () => {
    const { input, output } = terminal();
    const asked = askLine("Type its label to go on: ", { input, output, stopped: new AbortController().signal });
    input.write("report--k3f9x2ab71qz\r");

    expect(await asked).toBe("report--k3f9x2ab71qz");
  });

  // Drift: Ctrl-C at a question threw, and the command ended as a failure it had no word for, its line glued to the question.
  test.each([
    ["Ctrl-C at the question", (input: PassThrough) => input.write(KEYS.interrupt)],
    ["Ctrl-D at the question", (input: PassThrough) => input.write(KEYS.end)],
    ["input that ends", (input: PassThrough) => input.end()],
  ])("%s answers nothing and ends the question's line: a stop by the person is no failure", async (_name, stop) => {
    const { input, output, shown } = terminal();
    const asked = askLine("Type its label to go on: ", { input, output, stopped: new AbortController().signal });
    stop(input);

    expect(await asked).toBeUndefined();
    expect(shown().endsWith("\n")).toBe(true);
  });

  test("a stop of the command ends a question that waits, and one put after it: a first Ctrl-C the process hears must not leave the command waiting for a line", async () => {
    const { input, output } = terminal();
    const stop = new AbortController();
    const waiting = askLine("Type its label to go on: ", { input, output, stopped: stop.signal });
    stop.abort();

    expect([await waiting, await askLine("Type its label to go on: ", { ...terminal(), stopped: stop.signal })]).toEqual([undefined, undefined]);
  });
});
