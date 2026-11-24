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

/** What ends a child after 20 seconds whatever it shows then, so a test that fails leaves no child behind. That is later than any test here gives up, and a child at rest before it ends by itself. */
const LAST_RESORT = "setTimeout(() => process.exit(2), 20_000).unref();";

/** What a child prints before the pieces it wrote to its stderr, each as one write gave it. */
const WRITTEN = "written to stderr: ";

/** How many frames of the spinner a child writes where a few show what a test reads. */
const FEW_FRAMES = 4;

/** How many frames the spinner's library draws until its widest one, with three dots after the text. */
const FRAMES_TO_WIDEST = 25;

/** What a child starts with that shows the spinner of the process's screen in a pseudo-terminal: it keeps each piece written to its stderr, and `written` waits until so many of them hold a text. */
const WATCHED_SCREEN = [
  `import { processScreen } from ${JSON.stringify(SCREEN)};`,
  LAST_RESORT,
  "const pieces = [];",
  "const waiting = [];",
  "const write = process.stderr.write.bind(process.stderr);",
  "process.stderr.write = (piece, ...more) => { pieces.push(String(piece)); for (const heard of waiting.splice(0)) heard(); return write(piece, ...more); };",
  "const count = (text) => pieces.filter((piece) => piece.includes(text)).length;",
  "const written = async (text, times) => { while (count(text) < times) await new Promise((heard) => waiting.push(heard)); };",
  "const screen = processScreen({ out: process.stdout, err: process.stderr, colour: { out: true, err: true }, link: () => undefined, input: process.stdin, stop: () => process.exit(1) });",
];

/** What a child runs to show the spinner over the text in `WORK` for as many frames as `FRAMES` says, and then to print what it wrote. */
const SPINNING_ON = [
  ...WATCHED_SCREEN,
  "screen.working(process.env.WORK);",
  "await written(process.env.WORK.slice(0, 8), Number(process.env.FRAMES));",
  "const frames = JSON.stringify(pieces);",
  "screen.rest();",
  `console.log(${JSON.stringify(WRITTEN)} + frames);`,
].join("\n");

/** What a child runs to show three rows as an install settles them, each once its work was said and while it goes on, and a last line after which nothing is worked on. */
const SETTLING = [
  ...WATCHED_SCREEN,
  "let said = 0;",
  "const saidAgain = async () => { await written('Installing', said + 1); said = count('Installing'); };",
  "screen.working('Installing');",
  "for (const row of ['made one', 'made two', 'made three']) {",
  "  await saidAgain();",
  "  screen.line('done', row);",
  "  screen.working('Installing');",
  "}",
  "await saidAgain();",
  "screen.line('plain', 'the end');",
].join("\n");

/** What a child runs to end while its spinner shows, as a command does that is ended from outside its work. */
const ENDING = [...WATCHED_SCREEN, "screen.working('Installing');", "await written('Installing', 1);", "process.exit(3);"].join("\n");

/** How many columns the pseudo-terminal of a child is wide. */
const COLUMNS = 60;

/** The character every control sequence starts with. */
const ESCAPE = "\u001b";

/** What a write starts with that draws a frame over the last one: the cursor to the start of the row, and the erasing from there on, in either of its two spellings. */
const REDRAWS = [`${ESCAPE}[1G${ESCAPE}[J`, `${ESCAPE}[1G${ESCAPE}[0J`] as const;

/** What each of the two sequences about the cursor does to it, by the sequence without its escape character. */
const CURSOR: Readonly<Record<string, string>> = { "[?25l": "hidden", "[?25h": "shown" };

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

/**
 * Run a script to its end in a child whose three streams are one pseudo-terminal, 60 columns wide.
 *
 * @param env - what the child's environment holds beside this process's own
 * @returns the child's exit code, and all the terminal was handed until the child let go of it
 */
async function inTerminal(script: string, env: Readonly<Record<string, string>> = {}): Promise<{ readonly code: number; readonly shown: string }> {
  const reads: string[] = [];
  const decoder = new TextDecoder();
  const read = Promise.withResolvers<void>();
  // The spinner's library draws for a log where `CI` is set, says lines where `ACCESSIBLE` is, and draws slower where `TERM` names a console: a test names the one it reads.
  const child = Bun.spawn([process.execPath, "-e", script], {
    env: { ...process.env, ACCESSIBLE: "", ...env, CI: "", TERM: "xterm" },
    terminal: { cols: COLUMNS, rows: 24, data: (_terminal, piece) => void reads.push(decoder.decode(piece, { stream: true })), exit: () => read.resolve() },
  });
  const code = await child.exited;
  await read.promise;
  child.terminal?.close();

  return { code, shown: reads.join("") };
}

/** The moves of the cursor and the erasures in what a terminal is handed, each without its escape character, in order. */
function movesIn(shown: string): string[] {
  return shown
    .split(ESCAPE)
    .slice(1)
    .flatMap((sequence) => /^\[\d*[A-HJK]/u.exec(sequence)?.[0] ?? []);
}

/**
 * What one write of a child is to the spinner's row.
 *
 * @returns `redrawn` for a write that starts by putting the cursor at the start of the row and erasing from there, and then draws; `drawn` for one that draws and neither moves nor erases, as the first frame is;
 *   `torn` for any other that moves the cursor or erases; and `silent` for one that does nothing to the row
 */
function frameOf(piece: string): "redrawn" | "drawn" | "torn" | "silent" {
  const draws = stripVTControlCharacters(piece) !== "";
  const moves = movesIn(piece);
  const clears = REDRAWS.find((start) => piece.startsWith(start));
  if (draws && clears !== undefined && moves.length === movesIn(clears).length) return "redrawn";

  if (moves.length > 0) return "torn";

  return draws ? "drawn" : "silent";
}

/** What stays on each row a terminal is handed, once the row is left for the next: what was drawn there after the cursor was last put at the row's start and the row erased from there, by the text among `texts` it holds. */
function keptRows(shown: string, texts: readonly string[]): string[] {
  return shown.split("\n").flatMap((row) => {
    const parts = row.split(`${ESCAPE}[1G${ESCAPE}[`);
    // An erasing of what stands before the cursor leaves the row as it is.
    const erased = parts.map((part, at) => at > 0 && /^[02]?[JK]/u.test(part)).lastIndexOf(true);
    const kept = parts.slice(Math.max(erased, 0)).join("");

    return texts.find((text) => kept.includes(text)) ?? [];
  });
}

/** What was done to the cursor in all a terminal was handed, in order. */
function cursorOf(shown: string): string[] {
  return shown.split(ESCAPE).flatMap((sequence) => CURSOR[/^\[\?25[hl]/u.exec(sequence)?.[0] ?? ""] ?? []);
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

  // Drift: on a first install the row flickered wherever the spinner showed. The spinner's library writes the erasing of its row apart from the row's new text, 12 times a second, and counts the cells of a text otherwise than a terminal draws them.
  test.skipIf(process.platform === "win32").each([
    ["a text shorter than the row", "Installing", "Installing", FEW_FRAMES, 0],
    ["a text longer than the row", "Waiting for https://poplin.a-long-account-name.workers.example.com to respond", "Waiting for https://poplin.a-long-account-name.worker", FRAMES_TO_WIDEST, 3],
    ["a text that fits the row alone, and not beside the spinner's frame and dots", "Waiting for https://aaaaaaaaaaaaaaaaaaaaaaa.dev to respond", "Waiting for https://aaaaaaaaaaaaaaaaaaaaaaa.dev to re", FEW_FRAMES, 0],
    ["a text of characters two cells wide", `Publishing: ${"\u7ad9".repeat(40)}`, `Publishing: ${"\u7ad9".repeat(20)}`, FEW_FRAMES, 0],
    ["a text with soft hyphens, which the spinner's library counts a cell each and the width library none", "a\u00adb".repeat(30), `${"a\u00adb".repeat(17)}a\u00ad`, FEW_FRAMES, 0],
    ["a Hindi text, whose vowel signs take a cell each that the spinner's library does not count", "\u0915\u093e".repeat(40), "\u0915\u093e".repeat(26), FEW_FRAMES, 0],
  ])(
    "%s is one row of a terminal 60 columns wide, and each frame is one write: without this a frame is a row erased by one write and drawn by the next, or a block of rows drawn again",
    async (_name, work, row, frames, dots) => {
      const { shown } = await inTerminal(SPINNING_ON, { WORK: work, FRAMES: String(frames) });
      const pieces: string[] = JSON.parse(shown.split(WRITTEN)[1] ?? "[]");
      const drawn = pieces.map((piece) => stripVTControlCharacters(piece).replace(/^\S +/u, "")).filter((text) => text !== "");
      const rows = new Set(drawn.map((text) => text.replace(/\.+$/u, "")));
      const [first, ...later] = pieces.map(frameOf).filter((frame) => frame !== "silent");
      const seen = { rows: [...rows], first: first === "drawn" || first === "redrawn", later, dots: Math.max(...drawn.map((text) => text.length - text.replace(/\.+$/u, "").length)) };

      expect(seen).toEqual({ rows: [row], first: true, later: Array.from({ length: frames - 1 }, () => "redrawn"), dots });
    },
    // The spinner's widest frame comes after two seconds of frames.
    15_000,
  );

  // Drift: each row of an install stopped the spinner and started it anew, so the cursor showed and hid, and the spinner's row was gone for a frame and began its turn again, at every row.
  test.skipIf(process.platform === "win32").each([
    ["a spinner that draws a row gives it to each line and goes on under the line", {}, { kept: ["made one", "made two", "made three", "the end"], cursor: ["hidden", "shown"], erased: true }],
    [
      "work said in lines for a screen reader is said anew after each line, and no row is erased",
      { ACCESSIBLE: "1" },
      { kept: ["Installing", "made one", "Installing", "made two", "Installing", "made three", "Installing", "the end"], cursor: [], erased: false },
    ],
  ])("%s, and is at rest after the last line: without this each row of an install starts the spinner anew, a line leaves the spinner's row standing or erases one that is not there, or a command never ends", async (_name, env, seen) => {
    const { code, shown } = await inTerminal(SETTLING, env);
    const kept = keptRows(shown, ["Installing", "made one", "made two", "made three", "the end"]);

    expect({ code, kept, cursor: cursorOf(shown), erased: movesIn(shown).length > 0 }).toEqual({ code: 0, ...seen });
  });

  test.skipIf(process.platform === "win32")("a process that ends while the spinner shows hands the terminal its cursor back: without this what the spinner's library writes as the process ends is held back, and the cursor stays hidden", async () => {
    const { code, shown } = await inTerminal(ENDING);

    expect({ code, cursor: cursorOf(shown) }).toEqual({ code: 3, cursor: ["hidden", "shown"] });
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
