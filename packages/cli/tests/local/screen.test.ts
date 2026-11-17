import { describe, expect, test } from "bun:test";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { join } from "node:path";
import { PassThrough } from "node:stream";
import { stripVTControlCharacters } from "node:util";

import stringWidth from "string-width";

import { lookOf, processScreen, showsColour } from "../../src/local/screen";

/** The ends of a screen nobody types into and nothing stops. */
const NOBODY = { input: new PassThrough(), stop: () => undefined };

/** The screen's module, as a path. */
const SCREEN = join(import.meta.dir, "..", "..", "src", "local", "screen.ts");

/** What a child runs to show the spinner of the process's screen: it says so once a stop key reaches the command's own stop. */
const SPINNING = [
  `import { processScreen } from ${JSON.stringify(SCREEN)};`,
  "const stop = () => { console.log('stopped by the command'); process.exit(1); };",
  "const screen = processScreen({ out: process.stdout, err: process.stderr, colour: { out: true, err: true }, input: process.stdin, stop });",
  "screen.working('waiting to be allowed');",
  "console.log('spinning');",
].join("\n");

/** A stream that keeps what is written to it, standing in for one of a process that is no terminal. */
function pipe(): { readonly stream: NodeJS.WriteStream; readonly text: () => string } {
  const stream = new PassThrough();
  const chunks: string[] = [];
  stream.on("data", (chunk: Buffer) => chunks.push(chunk.toString()));

  return { stream: stream as unknown as NodeJS.WriteStream, text: () => chunks.join("") };
}

/** A stream that stands in for a terminal of so many columns, read back as the rows it shows with every control sequence taken out. */
function terminal(columns: number): { readonly stream: NodeJS.WriteStream; readonly text: () => string; readonly widest: () => number; readonly rows: () => string[] } {
  const kept = pipe();
  const shown = (): string[] => stripVTControlCharacters(kept.text()).split("\n");

  return {
    stream: Object.assign(kept.stream, { columns, isTTY: true }),
    text: kept.text,
    widest: () => Math.max(...shown().map((row) => stringWidth(row))),
    rows: () => shown().flatMap((row) => (row.trim() === "" ? [] : [row.trimEnd()])),
  };
}

describe("showsColour", () => {
  test.each([
    ["a terminal", true, {}, true],
    ["a pipe or a file", false, {}, false],
    ["a stream that is not known to be a terminal", undefined, {}, false],
    ["a terminal with NO_COLOR set", true, { NO_COLOR: "1" }, false],
    ["a terminal with NO_COLOR set to nothing", true, { NO_COLOR: "" }, true],
    ["a terminal in CI", true, { CI: "true" }, false],
    ["a terminal that takes no control sequence", true, { TERM: "dumb" }, false],
  ])("%s: without this a log of CI or a pipe holds marks, colours, and the frames of the spinner", (_name, isTerminal, env, shows) => {
    expect(showsColour(isTerminal, env)).toBe(shows);
  });
});

describe("lookOf", () => {
  test.each([
    ["a terminal 132 wide", { isTTY: true, columns: 132 }, {}, { width: 132, colour: true }],
    ["a terminal that does not say how wide it is", { isTTY: true }, {}, { width: 80, colour: true }],
    ["a pipe or a file", { columns: 132 }, {}, { width: 80, colour: false }],
    ["a wide terminal with NO_COLOR set", { isTTY: true, columns: 132 }, { NO_COLOR: "1" }, { width: 80, colour: false }],
    ["a wide terminal in CI", { isTTY: true, columns: 132 }, { CI: "true" }, { width: 80, colour: false }],
  ])("%s: a help text is as wide as the terminal only where it is painted, so what a pipe or a log holds stays 80 wide", (_name, stream, env, look) => {
    expect(lookOf(stream, env)).toEqual(look);
  });
});

describe("processScreen", () => {
  test("a terminal that shows no colour still folds a line at its width, with no mark and no control sequence: without this NO_COLOR brings back rows that break in the middle of a word", () => {
    const out = terminal(40);
    const screen = processScreen({ out: out.stream, err: pipe().stream, colour: { out: false, err: false }, ...NOBODY });

    screen.line("done", "made      Store     a store that keeps the files of every site", 20);

    expect(out.text()).toBe(`made      Store     a store that keeps\n${" ".repeat(20)}the files of every\n${" ".repeat(20)}site\n`);
  });

  test("a line said eight times in a row is shown eight times: without this the library folds a repeated notice into a count, and a retry that was made is not seen", () => {
    const err = terminal(80);
    const screen = processScreen({ out: pipe().stream, err: err.stream, colour: { out: true, err: true }, ...NOBODY });

    for (let said = 0; said < 8; said += 1) screen.aside("note", "no connection to the install: trying once more in 1 s");

    expect(err.rows()).toHaveLength(8);
  });

  // Drift: the spinner's library ends the process with code 0 at Ctrl-C and at Esc, so a login or an upload a person stopped would exit as done, with none of the command's words and nothing given up.
  test.each([
    ["Ctrl-C", "\u0003"],
    ["Esc", "\u001b"],
    ["Ctrl-D", "\u0004"],
  ])("%s while the spinner shows stops the command by its own stop, and the process does not end as done", async (_name, key) => {
    const child = spawn(process.execPath, ["-e", SPINNING], { stdio: ["pipe", "pipe", "ignore"] });
    let said = "";
    let typed = false;
    // A child that ended before the key reached it closed the pipe: that is no failure of its own, and the exit code and the output below say how it ended.
    child.stdin.on("error", () => undefined);
    child.stdout.on("data", (chunk: Buffer) => {
      said += chunk.toString();
      // The child says `spinning` once its spinner is up and listens for a key. The key is typed once: what the child says after it is no cue to type again.
      if (typed || !said.includes("spinning")) return;

      typed = true;
      child.stdin.write(key);
    });

    // `close` comes after the child ended and its output was read to the end.
    const [code] = await once(child, "close");

    expect([code, said.includes("stopped by the command")]).toEqual([1, true]);
  });

  test("on a terminal a line wider than 80 columns is folded at its spaces, its later rows under where `hang` says, and an address stands whole: without this a row breaks in the middle of a word", () => {
    const out = terminal(120);
    const err = terminal(60);
    const screen = processScreen({ out: out.stream, err: err.stream, colour: { out: true, err: true }, ...NOBODY });
    const address = `https://example.com/${"a".repeat(90)}`;

    screen.line("done", "made      Guard rule            stops every method but GET and HEAD, and the paths of scanners that look for what is not there", 34);
    screen.line("plain", `  ${address}`);
    screen.aside("plain", "a narrower terminal folds a line at its own width and never past it");

    const rows = out.rows();
    expect(rows.slice(0, 3).map((row) => row.slice(2))).toEqual(["made      Guard rule            stops every method but GET and HEAD, and the", `${" ".repeat(34)}paths of scanners that look for what is not`, `${" ".repeat(34)}there`]);
    expect(out.widest()).toBeLessThanOrEqual(Math.max(80, stringWidth(`  ${address}`)));
    expect(rows.slice(3)).toEqual([`  ${address}`]);
    expect(err.rows()).toEqual(["a narrower terminal folds a line at its own width and never", "past it"]);
  });

  test("where no colour shows, a line is written as it is whatever its tone, the result and the rest apart, and nothing else: without this a pipe or a log file holds marks and control sequences", () => {
    const out = pipe();
    const err = pipe();
    const screen = processScreen({ out: out.stream, err: err.stream, colour: { out: false, err: false }, ...NOBODY });

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
