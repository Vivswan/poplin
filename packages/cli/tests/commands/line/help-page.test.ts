import { describe, expect, test } from "bun:test";
import { stripVTControlCharacters } from "node:util";

import type { Installer, OptionRow } from "../../../../core/src/install/installer";
import { COMMANDS } from "../../../src/commands/command-table";
import { helpText } from "../../../src/commands/line/help";
import { helpPage } from "../../../src/commands/line/help-page";
import { installHelp } from "../../../src/install/first/help";
import { SHARED_OPTIONS } from "../../../src/install/first/parse";
import { uninstallHelp } from "../../../src/install/remove/help";
import { UNINSTALL_OPTIONS } from "../../../src/install/remove/parse";
import { REPAIR_OPTIONS } from "../../../src/install/repair/parse";
import { repairHelp } from "../../../src/install/repair/report";
import { pasted } from "../../../src/local/invoked";
import { foldedText, type Look } from "../../../src/local/screen";
import { emptyAccount, standIn } from "../../install/support/stand-in";

/** The widths of a terminal a help is laid out for: a narrow one, the plain width, and two wider ones. */
const WIDTHS = [60, 80, 120, 200] as const;

/** A line that titles a part: one capitalised word, or the flag the part's flags go with, and a colon. */
const TITLE = /^(?:[A-Z][a-z]+|With --[a-z-]+):$/;

/** The parts that hold no rows: command lines as they are typed, the permissions of a token a point each under one line, and the names of the settings. */
const WRITTEN: ReadonlySet<string> = new Set(["Examples:", "Related:", "Token:", "Keys:"]);

/** A row of a part: a term, then two spaces or more and what the term means, or nothing where the term's name says it. */
const ROW = /^ {2}(\S.*?)(?: {2,}(\S.*))?$/;

/** A line that goes on under the description of a row. */
const UNDER = /^ {20,}\S/;

/** The longest a line of a description is, so that it stands whole beside the widest term on a line of 80. */
const LONGEST = 53;

/** How many lines a description has at most: what the term means, and two cases a person must know before a run. */
const MOST_LINES = 3;

/** A width no line of a help text reaches, so nothing is folded at it. */
const UNFOLDED = 1000;

/** The one made-up provider. */
const PROVIDER = standIn(emptyAccount()) as Installer<unknown, unknown>;

/** A second provider beside it, for a build that carries two. */
const OTHER = standIn(emptyAccount(), "other") as Installer<unknown, unknown>;

/** Every help text poplin prints, by the line that asks for it, with the options its Options part must list where the command reads rows of them. */
const HELPS: readonly { readonly line: string; readonly text: (look?: Look) => string; readonly options?: readonly OptionRow[] }[] = [
  { line: "poplin --help", text: (look) => helpText(undefined, look) },
  ...COMMANDS.map((spec) => ({ line: `poplin ${spec.name} --help`, text: (look?: Look) => helpText(spec.name, look) })),
  { line: "poplin install --help", text: (look) => installHelp([PROVIDER], undefined, look), options: SHARED_OPTIONS },
  { line: "poplin install stand-in --help", text: (look) => installHelp([PROVIDER], PROVIDER, look), options: [...PROVIDER.options, ...SHARED_OPTIONS] },
  { line: "poplin uninstall --help", text: (look) => uninstallHelp([PROVIDER], undefined, look), options: UNINSTALL_OPTIONS },
  { line: "poplin uninstall stand-in --help", text: (look) => uninstallHelp([PROVIDER], PROVIDER, look), options: [...PROVIDER.options, ...UNINSTALL_OPTIONS] },
  { line: "poplin doctor --repair --help", text: (look) => repairHelp([PROVIDER], undefined, look), options: [...PROVIDER.options, ...REPAIR_OPTIONS] },
  { line: "poplin doctor --repair --help, two providers", text: (look) => repairHelp([PROVIDER, OTHER], undefined, look), options: REPAIR_OPTIONS },
  { line: "poplin doctor --repair other --help", text: (look) => repairHelp([PROVIDER, OTHER], OTHER, look), options: [...OTHER.options, ...REPAIR_OPTIONS] },
];

/** The rows of a help text, each with the title of its part: a line that goes on under a description is no row. */
function rowsOf(text: string): { readonly title: string; readonly term: string; readonly about: string }[] {
  let title = "";

  return text.split("\n").flatMap((line) => {
    if (!line.startsWith(" ") && line.endsWith(":")) title = line;
    const row = WRITTEN.has(title) ? null : ROW.exec(line);

    return row === null ? [] : [{ title, term: row[1] ?? "", about: row[2] ?? "" }];
  });
}

/** The blocks of a help text between empty lines, without the names of the settings, which are one list folded to the width. */
function blocksOf(text: string): string[][] {
  return text
    .split("\n\n")
    .map((block) => block.split("\n"))
    .filter(([title]) => title !== "Keys:");
}

/** The lines of a block that are prose: neither its title, a usage, a row or what goes on under one, a point, nor a command line. */
function proseOf(block: readonly string[]): string[] {
  const [title = ""] = block;
  if (title.startsWith("Usage:") || title === "Examples:" || title === "Related:") return [];

  return block.filter((line) => line !== title || !TITLE.test(title)).filter((line) => !(title !== "Token:" && ROW.test(line)) && !UNDER.test(line) && !line.startsWith("  - "));
}

describe("helpPage", () => {
  test("a page lays its usage out under one title, folds what the command does, and leaves an empty part out: every help of poplin is this one layout", () => {
    const page = { usage: ["poplin wash <cloth> [options]", "poplin <cloth>"], about: "Wash a cloth.", parts: [{ title: "Options:", rows: [["--cold", "Use cold water"] as const, ["--json", ""] as const] }, { title: "Examples:" }] };

    expect(helpPage(page, { width: 80, colour: false })).toBe(`Usage: poplin wash <cloth> [options]\n       poplin <cloth>\n\nWash a cloth.\n\nOptions:\n  --cold${" ".repeat(19)}Use cold water\n  --json`);
  });

  test("a point folded at a narrow width goes on under its words, not under its dash: a list whose rows start at the dash reads as more points", () => {
    const page = { usage: ["poplin wash"], parts: [{ title: "Token:", text: "Needs:", points: ["Wash and rinse every cloth of the house in cold water"] }] };

    expect(helpPage(page, { width: 40, colour: false }).split("\n").slice(2)).toEqual(["Token:", "  Needs:", "  - Wash and rinse every cloth of the", "    house in cold water"]);
  });

  // Drift: a note under the options grew into paragraphs nobody read, and a description folded at 80 pushed the next flag out of sight.
  test.each(HELPS)("$line has no notes and no two lines of prose together, and each description is whole lines of at most 53 characters, three at most", ({ text }) => {
    const plain = text();
    const lines = plain.split("\n");
    const under = lines.map((line, index) => (ROW.test(line) && !UNDER.test(line) ? lines.slice(index + 1).findIndex((next) => !UNDER.test(next)) : 0));

    expect([lines.includes("Notes:"), blocksOf(plain).filter((block) => proseOf(block).length > 1)]).toEqual([false, []]);
    expect(blocksOf(plain)).toEqual(blocksOf(text({ width: UNFOLDED, colour: false })));
    expect(rowsOf(plain).filter((row) => row.about.length > LONGEST)).toEqual([]);
    expect(lines.filter((line) => UNDER.test(line) && line.trim().length > LONGEST)).toEqual([]);
    expect(under.filter((more) => more >= MOST_LINES)).toEqual([]);
  });

  test.each(HELPS)("$line painted holds no bright black, which a dark theme hides, and paints what is read dim", ({ text }) => {
    const painted = text({ width: 80, colour: true });

    expect([painted.includes("\x1b[90m"), painted.includes("\x1b[2m")]).toEqual([false, true]);
  });

  // Drift: the helps of install, uninstall and a repair were written apart from the command table's, so a change of the look or the voice reached one family and not the other.
  test.each(HELPS)("$line starts with its usage, titles each part with one capitalised word, and starts each description with a capital", ({ text }) => {
    const plain = text();
    const lines = plain.split("\n");

    expect([plain.startsWith("Usage: poplin "), lines.filter((line) => !line.startsWith(" ") && line.endsWith(":") && !TITLE.test(line))]).toEqual([true, []]);
    expect(rowsOf(plain).filter((row) => row.about !== "" && !/^["A-Z]/.test(row.about))).toEqual([]);
    expect(lines.filter((line) => line.length > 80 || !/^[\x20-\x7e]*$/.test(line) || line !== line.trimEnd())).toEqual([]);
  });

  test.each(HELPS.flatMap((help) => (help.options === undefined ? [] : [{ line: help.line, text: help.text, options: help.options }])))(
    "$line lists every option its parser reads, the provider's own among them, then the two flags every command takes, and no other",
    ({ text, options }) => {
      const listed = rowsOf(text()).flatMap((row) => (row.title === "Options:" ? [row.term] : []));

      expect(listed).toEqual([...options.map((row) => (row.value === null ? row.flag : `${row.flag} ${row.value}`)), "--help", "--version"]);
    },
  );

  // Drift: a colour sequence counted as room would fold a painted line earlier than the plain one, and a painted `poplin` would keep its name under npx.
  test.each(WIDTHS)("at %i wide every painted help, with its sequences taken off, is the plain help of that width, however poplin was started", (width) => {
    const shown = (text: (look: Look) => string, colour: boolean, runner: "poplin" | "npx poplin"): string => foldedText(pasted(text({ width, colour }), runner), width);
    const pairs = HELPS.flatMap(({ line, text }) => (["poplin", "npx poplin"] as const).map((runner) => ({ line, painted: shown(text, true, runner), plain: shown(text, false, runner) })));

    expect(pairs.filter(({ painted, plain }) => stripVTControlCharacters(painted) !== plain || painted === plain || plain.includes("\x1b")).map(({ line }) => line)).toEqual([]);
    expect(pairs.flatMap(({ plain }) => plain.split("\n")).filter((row) => row.length > width)).toEqual([]);
  });
});
