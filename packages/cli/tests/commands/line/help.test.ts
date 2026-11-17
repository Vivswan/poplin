import { afterEach, describe, expect, test } from "bun:test";
import { COMMANDS, type CommandName, type CommandSpec, SESSION } from "../../../src/commands/command-table";
import { helpText } from "../../../src/commands/line/help";
import { SETTING_SAMPLES } from "../../../src/commands/install/install-settings";
import { parseCommand } from "../../../src/commands/line/parse-command";
import { words } from "../support/command-line";
import { cleanUp } from "../support/harness";

/** A site label in the published form. */
const LABEL = "report--k3f9x2ab71qz";

/** The width of a help text where no terminal is. */
const MAX_LINE = 80;

/** A width no line of a help text reaches, so nothing is folded at it. */
const UNFOLDED = 1000;

/** A line of printable ASCII. */
const PRINTABLE_ASCII = /^[\x20-\x7e]*$/;

/** The table, read as plain specs. */
const SPECS: readonly (CommandSpec & { readonly name: CommandName })[] = COMMANDS;

/** A value each flag takes, so a flag can be tried on its command: by its name, or by its command and its name where the command takes another value than the rest. A new flag with a value fails here until it has one. */
const FLAG_VALUES: Readonly<Record<string, string>> = {
  "--site": LABEL,
  "--name": "docs",
  "--public-name": "docs",
  "--title": "Q3 sales",
  "--search-engines": "on",
  "--embeddable": "off",
  "--expires": "7d",
  "--to": "4",
  "update --to": "0.2.0",
  "--server": "poplin.example.com",
  "--out": "backup.zip",
  "--add-user": "you@example.com",
};

/** A word for each argument a command needs. */
const ARGUMENTS: Readonly<Record<string, string>> = { path: "./report", site: LABEL, zip: "backup.zip", key: "versions_kept" };

/** What a flag needs beside it to be a whole command: `set` needs a setting, a public name goes with `--public`, and the options of a repair go with `--repair`. */
const COMPANIONS: Readonly<Record<string, readonly string[]>> = {
  "set --public-name": ["--public"],
  "publish --public-name": ["--public"],
  "set --json": ["--private"],
  "set --dry-run": ["--private"],
  "config --dry-run": ["versions_kept", "10"],
  "set --server": ["--private"],
  "import --users": ["--settings"],
  "doctor --update": ["--repair"],
  "doctor --dry-run": ["--repair"],
  "doctor --add-user": ["--repair"],
  "doctor --yes": ["--repair"],
  "doctor --token-stdin": ["--repair"],
};

function lineWith(spec: CommandSpec, flag: CommandSpec["flags"][number]): string[] {
  const required = spec.arguments.filter((argument) => argument.required).map((argument) => ARGUMENTS[argument.name] ?? "");
  const value = flag.value === undefined ? [] : [FLAG_VALUES[`${spec.name} ${flag.name}`] ?? FLAG_VALUES[flag.name] ?? ""];

  return [spec.name, ...required, flag.name, ...value, ...(COMPANIONS[`${spec.name} ${flag.name}`] ?? [])];
}

/** Every flag of every command, each beside the command that lists it. */
const LISTED = SPECS.flatMap((spec) => spec.flags.map((flag) => ({ spec, flag })));

function isPrinted(help: string, flag: CommandSpec["flags"][number]): boolean {
  const term = flag.value === undefined ? flag.name : `${flag.name} ${flag.value}`;

  return `${help}\n`.includes(`\n  ${term} `) || `${help}\n`.includes(`\n  ${term}\n`);
}

/** The kind a line with this flag answers with: the two flags every command takes answer for themselves, and so does the one that makes `doctor` a repair. */
function kindWith(spec: CommandSpec, flag: CommandSpec["flags"][number]): string {
  if (flag.name === "--help") return "help";

  if (flag.name === "--version") return "version";

  // A line of `doctor` that carries `--repair` is a repair, whose own parser reads the rest.
  return spec.name === "doctor" && lineWith(spec, flag).includes("--repair") ? "provider" : spec.name;
}

afterEach(cleanUp);

describe("helpText", () => {
  test("every flag of every command parses on that command and is printed in its help: without this a flag is documented and refused, or accepted and undocumented", () => {
    const broken = LISTED.filter(({ spec, flag }) => parseCommand(lineWith(spec, flag)).kind !== kindWith(spec, flag) || !isPrinted(helpText(spec.name), flag));

    expect(broken.map(({ spec, flag }) => `${spec.name} ${flag.name}`)).toEqual([]);
  });

  test("a flag is refused on every command that does not list it: without this the help of a command leaves out a flag it takes", () => {
    const foreign = SPECS.flatMap((spec) => LISTED.filter(({ flag }) => !spec.flags.some((own) => own.name === flag.name)).map(({ flag }) => ({ spec, flag })));
    const accepted = foreign.filter(({ spec, flag }) => {
      const parsed = parseCommand(lineWith(spec, flag));

      return parsed.kind !== "usage-error" || !parsed.message.startsWith("Unknown option");
    });

    expect(foreign.length).toBeGreaterThan(0);
    expect(accepted.map(({ spec, flag }) => `${spec.name} ${flag.name}`)).toEqual([]);
  });

  test("a flag takes a value in every command that lists it, or in none: the words are split into flags and arguments before the command is known", () => {
    const takesValue = new Map(LISTED.map(({ flag }) => [flag.name, flag.value !== undefined]));

    expect(LISTED.filter(({ flag }) => takesValue.get(flag.name) !== (flag.value !== undefined)).map(({ spec, flag }) => `${spec.name} ${flag.name}`)).toEqual(
      [],
    );
  });

  test("every help text is plain ASCII in lines of at most 80 characters and names its command where no look is given: a pipe, a file, and a log of CI hold no colour sequence", () => {
    const texts = [helpText(), ...SPECS.map((spec) => helpText(spec.name))];
    const lines = texts.flatMap((text) => text.split("\n"));

    expect(lines.filter((line) => line.length > MAX_LINE || !PRINTABLE_ASCII.test(line) || line !== line.trimEnd())).toEqual([]);
    expect(texts.map((text) => text.startsWith("Usage: poplin"))).toEqual(texts.map(() => true));
    expect(SPECS.filter((spec) => !helpText().includes(`\n  ${spec.name}`)).map((spec) => spec.name)).toEqual([]);
  });

  test("a terminal 200 wide folds nothing, and one 60 wide folds: the help follows the terminal, not a fixed 80", () => {
    const rows = (width: number): string[] => [undefined, ...SPECS.map((spec) => spec.name)].flatMap((topic) => helpText(topic, { width, colour: false }).split("\n"));

    expect([rows(200), rows(60).length > rows(200).length]).toEqual([rows(UNFOLDED), true]);
  });

  test("a painted help has its titles bold, what is typed cyan, and what is read dim, each line closed: a description in bright black is unreadable on a dark theme", () => {
    const painted = helpText("doctor", { width: MAX_LINE, colour: true }).split("\n");

    expect(painted.slice(0, 3)).toEqual(["\x1b[1mUsage:\x1b[22m \x1b[36mpoplin\x1b[39m \x1b[36mdoctor\x1b[39m [options]", "", "\x1b[2mCheck the install, or repair it with --repair\x1b[22m"]);
    expect(painted).toContain("\x1b[1mOptions:\x1b[22m");
    expect(painted).toContain("  \x1b[36m--json\x1b[39m");
    expect(painted).toContain(`  \x1b[36m--yes\x1b[39m${" ".repeat(20)}\x1b[2mNever prompt. A missing answer stops the run.\x1b[22m`);
    expect(painted.slice(-4, -2)).toEqual(["\x1b[1mExamples:\x1b[22m", "  \x1b[36mpoplin doctor --repair --dry-run\x1b[39m"]);
  });

  test("the flags of doctor that only act with --repair stand in a part of their own, and each is refused without it: a flag listed beside --json reads as one of a check", () => {
    const [options = "", repair = ""] = helpText("doctor").split("\n\nWith --repair:\n");
    const block = `\n${repair.split("\n\n")[0] ?? ""}`;
    const under = LISTED.filter(({ spec, flag }) => spec.name === "doctor" && isPrinted(block, flag));
    const refused = under.map(({ flag }) => parseCommand(["doctor", flag.name, ...(flag.value === undefined ? [] : [FLAG_VALUES[flag.name] ?? ""])]));

    expect(under.map(({ flag }) => flag.name)).toEqual(["--update", "--dry-run", "--add-user", "--yes", "--token-stdin"]);
    expect(under.filter(({ flag }) => isPrinted(options, flag))).toEqual([]);
    expect(refused.map((parsed) => parsed.kind === "usage-error" && parsed.message.endsWith("requires --repair"))).toEqual(under.map(() => true));
  });

  test("every example a help text prints runs the command it is printed under: a copied example must not be refused", () => {
    const examples = [
      ...SESSION.map((line) => [undefined, line] as const),
      ...SPECS.flatMap((spec) => spec.examples.map((line) => [spec.name, line] as const)),
    ];
    const refused = examples.filter(([command, line]) => {
      const parsed = parseCommand(words(line));

      // An example of `doctor` that carries `--repair` is a repair, whose own parser reads the rest.
      return parsed.kind === "usage-error" || parsed.kind === "help" || (command !== undefined && parsed.kind !== (line.includes(" --repair") ? "provider" : command));
    });

    expect(refused).toEqual([]);
    expect(examples.filter(([command, line]) => !helpText(command).includes(`\n  ${line}`))).toEqual([]);
  });

  test("the help of config lists every key core takes and each is accepted: a key added to core is shown and taken without a second list to edit", () => {
    const keys = Object.keys(SETTING_SAMPLES);
    const help = helpText("config");

    expect(keys.length).toBeGreaterThan(0);
    expect(keys.filter((key) => !help.includes(`\n  ${key} `) || parseCommand(["config", key]).kind !== "config")).toEqual([]);
  });

  test("the flags that work with no command are printed in the help of poplin itself: without this --version is taken and nowhere shown", () => {
    const alone = LISTED.filter(({ flag }) => ["help", "version"].includes(parseCommand([flag.name]).kind)).map(({ flag }) => flag);

    expect(alone.length).toBeGreaterThan(0);
    expect(alone.filter((flag) => !isPrinted(helpText(), flag))).toEqual([]);
  });

  test("the overview lists the commands under their groups in one order, and uninstall ends the group of install: a command moved to another group would drag uninstall after it", () => {
    const parts = helpText()
      .split("\n\n")
      .slice(1, 8)
      .map((part) => part.split("\n").map((line) => line.trim().split(" ")[0]));

    expect(parts).toEqual([
      ["Publish:", "publish"],
      ["Sites:", "set", "show", "rollback", "new-link", "duplicate", "delete", "restore", "list"],
      ["Auth:", "login", "logout", "whoami"],
      ["Install:", "install", "config", "doctor", "update", "uninstall"],
      ["Backup:", "export", "import"],
      ["Agent:", "mcp"],
      ["Help:", "help"],
    ]);
  });
});
