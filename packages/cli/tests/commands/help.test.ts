import { afterEach, describe, expect, test } from "bun:test";
import { join } from "node:path";

import { COMMANDS, type CommandName, type CommandSpec, SESSION } from "../../src/commands/command-table";
import { helpText } from "../../src/commands/help";
import { SETTING_SAMPLES } from "../../src/commands/install-settings";
import { parseCommand } from "../../src/commands/parse-command";
import { words } from "./support/command-line";
import { cleanUp, jsonOf, openBench, scratch } from "./support/harness";

/** A site label in the published form. */
const LABEL = "report--k3f9x2ab71qz";

/** The width of the narrowest terminal the help must fit. */
const MAX_LINE = 80;

/** A line of printable ASCII. */
const PRINTABLE_ASCII = /^[\x20-\x7e]*$/;

/** The table, read as plain specs. */
const SPECS: readonly (CommandSpec & { readonly name: CommandName })[] = COMMANDS;

/** A value each flag takes, so a flag can be tried on its command. A new flag with a value fails here until it has one. */
const FLAG_VALUES: Readonly<Record<string, string>> = {
  "--site": LABEL,
  "--name": "docs",
  "--public-name": "docs",
  "--title": "Q3 sales",
  "--search-engines": "on",
  "--embeddable": "off",
  "--expires": "7d",
  "--to": "4",
  "--server": "poplin.example.com",
  "--out": "backup.zip",
};

/** A word for each argument a command needs. */
const ARGUMENTS: Readonly<Record<string, string>> = { path: "./report", site: LABEL, zip: "backup.zip", key: "versions_kept" };

/** The flag that asks for an answer as JSON. */
const JSON_FLAG = "--json";

/** Commands that answer no one site, each with a key of the object its `--json` prints and the words its help names that key by. The logout comes last: it ends the login the others run under. */
const PRINTED: readonly (readonly [line: string, key: string, named: string])[] = [
  ["doctor --json", "checks", "the checks"],
  ["config --json", "values", "the settings"],
  ["whoami --json", "token", "the token"],
  ["update --check --json", "address", "an update link"],
  ["list --json", "sites", "the sites"],
  ["logout --json", "revoked", "revoked"],
];

/** What a flag needs beside it to be a whole command: `set` needs a setting, and a public name goes with `--public`. */
const COMPANIONS: Readonly<Record<string, readonly string[]>> = {
  "set --public-name": ["--public"],
  "publish --public-name": ["--public"],
  "set --json": ["--private"],
  "set --server": ["--private"],
  "import --logins": ["--settings"],
};

function lineWith(spec: CommandSpec, flag: CommandSpec["flags"][number]): string[] {
  const required = spec.arguments.filter((argument) => argument.required).map((argument) => ARGUMENTS[argument.name] ?? "");
  const value = flag.value === undefined ? [] : [FLAG_VALUES[flag.name] ?? ""];

  return [spec.name, ...required, flag.name, ...value, ...(COMPANIONS[`${spec.name} ${flag.name}`] ?? [])];
}

/** Every flag of every command, each beside the command that lists it. */
const LISTED = SPECS.flatMap((spec) => spec.flags.map((flag) => ({ spec, flag })));

/** What the help of a command says its `--json` prints; empty for a command that takes no such flag. */
function jsonLine(command: string): string {
  return SPECS.find((spec) => spec.name === command)?.flags.find((flag) => flag.name === JSON_FLAG)?.about ?? "";
}

function isPrinted(help: string, flag: CommandSpec["flags"][number]): boolean {
  return help.includes(`\n  ${flag.value === undefined ? flag.name : `${flag.name} ${flag.value}`} `);
}

/** The kind a line with this flag answers with: the two flags every command takes answer for themselves. */
function kindWith(spec: CommandSpec, flag: CommandSpec["flags"][number]): string {
  if (flag.name === "--help") return "help";

  if (flag.name === "--version") return "version";

  return spec.name;
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

      return parsed.kind !== "usage-error" || !parsed.message.startsWith("unknown flag");
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

  // Drift: one sentence stood under every command, so doctor, config, update, whoami, and export each promised a site object that none of them answers with.
  test("the help of a command names what its --json really prints: each key below is in the printed object, and the help says its words", async () => {
    const bench = await openBench();
    const rows = [[`export --out "${join(scratch(), "backup.zip")}" --json`, "zip_bytes", "the zip"] as const, ...PRINTED];
    const wrong: string[] = [];

    for (const [line, key, named] of rows) {
      const printed = jsonOf(await bench.run(line));
      if (!(key in printed) || !jsonLine(line.split(" ")[0] ?? "").includes(named)) wrong.push(line);
    }

    expect(wrong).toEqual([]);
  });

  test("every --json line of the help has one form, and only a command that takes one site or a path promises the site", () => {
    const takers = SPECS.filter((spec) => jsonLine(spec.name) !== "");
    const oneSite = takers.filter((spec) => spec.arguments.some((argument) => argument.required && ["site", "path"].includes(argument.name)));

    expect(takers.filter((spec) => !/^print JSON: .*, or the error object$/.test(jsonLine(spec.name))).map((spec) => spec.name)).toEqual([]);
    expect(takers.filter((spec) => /the (site|copy)\b/.test(jsonLine(spec.name))).map((spec) => spec.name)).toEqual(oneSite.map((spec) => spec.name));
  });

  test("every help text is plain ASCII in lines of at most 80 characters and names its command: a terminal 80 wide shows it unbroken", () => {
    const texts = [helpText(), ...SPECS.map((spec) => helpText(spec.name))];
    const lines = texts.flatMap((text) => text.split("\n"));

    expect(lines.filter((line) => line.length > MAX_LINE || !PRINTABLE_ASCII.test(line) || line !== line.trimEnd())).toEqual([]);
    expect(texts.map((text) => text.startsWith("usage: poplin"))).toEqual(texts.map(() => true));
    expect(SPECS.filter((spec) => !helpText().includes(`\n  ${spec.name}`)).map((spec) => spec.name)).toEqual([]);
  });

  test("every example a help text prints runs the command it is printed under: a copied example must not be refused", () => {
    const examples = [
      ...SESSION.map((line) => [undefined, line] as const),
      ...SPECS.flatMap((spec) => spec.examples.map((line) => [spec.name, line] as const)),
    ];
    const refused = examples.filter(([command, line]) => {
      const parsed = parseCommand(words(line));

      return parsed.kind === "usage-error" || parsed.kind === "help" || (command !== undefined && parsed.kind !== command);
    });

    expect(refused).toEqual([]);
    expect(examples.filter(([command, line]) => !helpText(command).includes(`\n  ${line}`))).toEqual([]);
  });

  test("the help of config lists every key core takes and each is accepted: a key added to core is shown and taken without a second list to edit", () => {
    const keys = Object.keys(SETTING_SAMPLES);
    const help = helpText("config");

    expect(keys.length).toBeGreaterThan(0);
    expect(keys.filter((key) => !new RegExp(`[ ,]${key}(,|$)`, "m").test(help) || parseCommand(["config", key]).kind !== "config")).toEqual([]);
  });

  test("the flags that work with no command are printed in the help of poplin itself: without this --version is taken and nowhere shown", () => {
    const alone = LISTED.filter(({ flag }) => ["help", "version"].includes(parseCommand([flag.name]).kind)).map(({ flag }) => flag);

    expect(alone.length).toBeGreaterThan(0);
    expect(alone.filter((flag) => !isPrinted(helpText(), flag))).toEqual([]);
  });
});
