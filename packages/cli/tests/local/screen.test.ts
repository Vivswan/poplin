import { describe, expect, test } from "bun:test";
import { PassThrough } from "node:stream";

import { processScreen } from "../../src/local/screen";

/** A stream that keeps what is written to it, standing in for one of a process that is no terminal. */
function pipe(): { readonly stream: NodeJS.WriteStream; readonly text: () => string } {
  const stream = new PassThrough();
  const chunks: string[] = [];
  stream.on("data", (chunk: Buffer) => chunks.push(chunk.toString()));

  return { stream: stream as unknown as NodeJS.WriteStream, text: () => chunks.join("") };
}

describe("processScreen", () => {
  test("where no colour shows, a line is written as it is whatever its tone, the result and the rest apart, and nothing else: without this a pipe or a log file holds marks and control sequences", () => {
    const out = pipe();
    const err = pipe();
    const screen = processScreen({ out: out.stream, err: err.stream, colour: { out: false, err: false } });

    screen.working("looking for an install");
    screen.line("done", "made      Store                 poplin-sites");
    screen.line("error", "failed    Keys                  status 500");
    screen.aside("warning", "The login product is not switched on for this account");
    screen.working("making the install");
    screen.rest();
    screen.line("plain", "Your dashboard: https://poplin.example.com");

    expect(out.text()).toBe("made      Store                 poplin-sites\nfailed    Keys                  status 500\nYour dashboard: https://poplin.example.com\n");
    expect(err.text()).toBe("The login product is not switched on for this account\n");
  });
});
