import { describe, expect, test } from "bun:test";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { join } from "node:path";
import { PassThrough } from "node:stream";
import { stripVTControlCharacters } from "node:util";

import stringWidth from "string-width";

import { lookOf, plainScreen, processScreen, showsColour } from "../../src/local/screen";

/** The ends of a screen nobody types into and nothing stops, on a terminal that takes no link. */
const NOBODY = { input: new PassThrough(), stop: () => undefined, link: () => undefined };

/** The screen's module, as a path. */
const SCREEN = join(import.meta.dir, "..", "..", "src", "local", "screen.ts");

/** What a child runs to show the spinner of the process's screen: it says so once a stop key reaches the command's own stop. */
const SPINNING = [
  `import { processScreen } from ${JSON.stringify(SCREEN)};`,
  "const stop = () => { console.log('stopped by the command'); process.exit(1); };",
  "const screen = processScreen({ out: process.stdout, err: process.stderr, colour: { out: true, err: true }, link: () => undefined, input: process.stdin, stop });",
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

/** A stream that stands in for a terminal of so many columns, or for one that names no width, read back as the rows it shows with every control sequence taken out. */
function terminal(columns?: number): { readonly stream: NodeJS.WriteStream; readonly text: () => string; readonly widest: () => number; readonly rows: () => string[] } {
  const kept = pipe();
  const shown = (): string[] => stripVTControlCharacters(kept.text()).split("\n");
  const width = columns === undefined ? {} : { columns };

  return {
    stream: Object.assign(kept.stream, { ...width, isTTY: true }),
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

  // Drift: every line was folded at 80 columns whatever the terminal, so the last column of a row had 44 cells on a terminal with 84 free.
  test.each<[string, number | undefined, string[]]>([
    ["120 columns wide, at 120", 120, ["made      Guard rule            stops every method but GET and HEAD, and the paths of scanners that look for what is", `${" ".repeat(34)}not there`]],
    ["that names no width, at 80", undefined, ["made      Guard rule            stops every method but GET and HEAD, and the", `${" ".repeat(34)}paths of scanners that look for what is not`, `${" ".repeat(34)}there`]],
  ])("a terminal %s, folds a wider line at its spaces, its later rows under where `hang` says, and an address stands whole", (_name, columns, folded) => {
    const out = terminal(columns);
    const err = terminal(60);
    const screen = processScreen({ out: out.stream, err: err.stream, colour: { out: true, err: true }, ...NOBODY });
    const address = `https://example.com/${"a".repeat(130)}`;

    screen.line("done", "made      Guard rule            stops every method but GET and HEAD, and the paths of scanners that look for what is not there", 34);
    screen.line("plain", `  ${address}`);
    screen.aside("plain", "a narrower terminal folds a line at its own width and never past it");

    const rows = out.rows();
    expect(rows.slice(0, folded.length).map((row) => row.slice(2))).toEqual(folded);
    expect(out.widest()).toBe(stringWidth(`  ${address}`));
    expect(rows.slice(folded.length)).toEqual([`  ${address}`]);
    expect(err.rows()).toEqual(["a narrower terminal folds a line at its own width and never", "past it"]);
  });

  // Drift: the help of `poplin` typed alone went through the screen, which folded it at 80 on a terminal twice as wide.
  test("a text laid out for its stream is written as it is, on a terminal and off one, and folded only by a terminal narrower than it: without this a help as wide as the terminal is folded again at 80", () => {
    const wide = terminal(200);
    const narrow = terminal(60);
    const laid = `${"wide ".repeat(30)}row\n  under it`;
    const kept: string[] = [];

    processScreen({ out: wide.stream, err: wide.stream, colour: { out: true, err: true }, ...NOBODY }).aside("laid", laid);
    plainScreen({ out: (line) => kept.push(line), err: (line) => kept.push(line) }).aside("laid", laid);
    processScreen({ out: narrow.stream, err: narrow.stream, colour: { out: false, err: false }, ...NOBODY }).aside("laid", laid);

    expect([wide.rows(), kept, narrow.widest() <= 60, narrow.rows().at(-1)]).toEqual([laid.split("\n"), [laid], true, "  under it"]);
  });

  // Drift: the token step was plain lines above the questions of the library, in none of their look, and its one long row ran past a narrow terminal.
  test("a block stands under the library's guide on a terminal that paints: its title, each row folded to the terminal under where `hang` says, and a faint row dimmed", () => {
    const err = terminal(40);
    const screen = processScreen({ out: pipe().stream, err: err.stream, colour: { out: true, err: true }, ...NOBODY });

    screen.block("On the form", [{ text: "1. Choose the place of the store, and under it the row named example", hang: 3 }, { text: "   Stores: Read", faint: true }]);

    // Each row starts with the guide's own three cells, which the library draws.
    expect(err.rows().map((row) => row.slice(3))).toEqual(["", "On the form", "1. Choose the place of the store, and", "   under it the row named example", "   Stores: Read"]);
    expect([err.widest() <= 40, err.text().includes("\u001b[2m   Stores: Read\u001b[22m"), err.text().includes("\u001b[2m1. Choose")]).toEqual([true, true, false]);
  });

  test("where no colour shows, a block is its title and its rows as plain lines of at most 80 columns, on a terminal and off one: without this a log holds the guide's marks, or a row wider than its reader", () => {
    const wide = terminal(200);
    const kept: string[] = [];
    const rows = [{ text: `1. ${"word ".repeat(30)}end`, hang: 3 }, { text: "   Stores: Read", faint: true }];

    processScreen({ out: pipe().stream, err: wide.stream, colour: { out: false, err: false }, ...NOBODY }).block("On the form", rows);
    plainScreen({ out: () => undefined, err: (line) => kept.push(line) }).block("On the form", rows);
    const widest = Math.max(...kept.map((line) => line.length));

    expect(wide.text().split("\n").slice(0, -1)).toEqual(kept);
    expect([kept[0], kept[1]?.startsWith("1. word word"), kept[2]?.startsWith("   word"), kept.at(-1), widest <= 80, wide.text().includes("\u001b")]).toEqual(["On the form", true, true, "   Stores: Read", true, false]);
  });

  // Drift: an address written whole takes six rows of a terminal. A terminal that takes a link shows a few words that open it, and the caller must know where none was shown, to show the address itself.
  test("a link is one row, made by the terminal's own link of the text and the address: under the guide where colour shows, and plain where none does; a terminal that takes no link is written nothing and says so", () => {
    const [painted, plain, none] = [terminal(80), terminal(80), terminal(80)];
    const link = (text: string, address: string): string => `[${text}](${address})`;
    const screens = [
      processScreen({ out: pipe().stream, err: painted.stream, colour: { out: true, err: true }, ...NOBODY, link }),
      processScreen({ out: pipe().stream, err: plain.stream, colour: { out: false, err: false }, ...NOBODY, link }),
      processScreen({ out: pipe().stream, err: none.stream, colour: { out: true, err: true }, ...NOBODY }),
    ];

    expect(screens.map((screen) => screen.link("Open the token form", "https://example.com/form"))).toEqual([true, true, false]);
    expect([painted.rows().map((row) => row.slice(3)), plain.text(), none.text()]).toEqual([["[Open the token form](https://example.com/form)"], "[Open the token form](https://example.com/form)\n", ""]);
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
