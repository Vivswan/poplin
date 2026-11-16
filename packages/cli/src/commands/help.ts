// The help texts, laid out by commander from the command table so that every flag the parser takes is listed and no other.

import type { Command, Help } from "commander";

import { BARE_COMMAND, COMMANDS, type CommandName, type CommandSpec, INSTALL_COMMAND, SESSION } from "./command-table";
import { SETTING_SAMPLES } from "./install-settings";
import { argumentsOf, buildProgram } from "./program";

/** How wide the left column of a list is, so that the descriptions start at column 28: wide enough for the longest flag with its value. */
const TERM_WIDTH = 24;

/** The longest line of a help text. */
const MAX_LINE = 80;

/** How far a line of a list stands in. */
const INDENT = "  ";

/** What the first line of a usage starts with, and what stands under it on the next. */
const USAGE = { first: "usage: ", next: "       " } as const;

/** One part of a help text: a title, when it has one, over its lines. A part with no line is left out. */
interface Section {
  readonly title?: string;
  readonly lines: readonly string[];
}

function specOf(command: Command): CommandSpec | undefined {
  return COMMANDS.find((spec) => spec.name === command.name());
}

function indented(lines: readonly string[]): string[] {
  return lines.map((line) => `${INDENT}${line}`);
}

function flagRows(flags: CommandSpec["flags"], helper: Help): string[] {
  return flags.map((flag) => helper.formatItem(flag.value === undefined ? flag.name : `${flag.name} ${flag.value}`, TERM_WIDTH, flag.about, helper));
}

function joined(usage: readonly string[], sections: readonly Section[]): string {
  const parts = sections.filter((section) => section.lines.length > 0).map((section) => [...(section.title === undefined ? [] : [section.title]), ...section.lines]);

  return [usage.map((line, index) => `${index === 0 ? USAGE.first : USAGE.next}${line}`), ...parts].map((lines) => lines.join("\n")).join("\n\n");
}

/** The help of `poplin` itself: every command under its group, the flags every command takes, and a short session. */
function overview(program: Command, helper: Help): string {
  const [first, ...others]: readonly CommandSpec[] = COMMANDS;
  const everywhere = (first?.flags ?? []).filter((flag) => others.every((spec) => spec.flags.some((other) => other.name === flag.name)));
  const groups = helper.groupItems([...program.commands], helper.visibleCommands(program), (command) => command.helpGroup());
  const term = (command: Command): string => `${command.name()} ${argumentsOf(specOf(command) ?? INSTALL_COMMAND)}`.trimEnd();
  const listing = [...groups].map(([title, commands]) => ({
    title,
    lines: commands.map((command) => helper.formatItem(term(command), TERM_WIDTH, helper.subcommandDescription(command), helper)),
  }));

  return joined(
    [`${program.name()} <path> [flags]       publish a folder, or one HTML file`, `${program.name()} <command> [flags]`],
    [
      ...listing,
      { lines: ["A first word is a path when it starts with . ~ or a drive (C:), or holds / or \\"] },
      { title: "flags of every command", lines: flagRows(everywhere, helper) },
      { title: "examples", lines: indented(SESSION) },
    ],
  );
}

/** The help of one command: what it takes, and what the table adds in notes and examples. */
function commandHelp(command: Command, spec: CommandSpec, helper: Help): string {
  const usage = helper.commandUsage(command);
  const keys = spec.name === "config" ? helper.boxWrap(Object.keys(SETTING_SAMPLES).join(", "), MAX_LINE - INDENT.length).split("\n") : [];

  return joined(spec.name === BARE_COMMAND ? [usage.replace(` ${spec.name} `, " "), usage] : [usage], [
    { lines: [helper.commandDescription(command)] },
    {
      title: "arguments",
      lines: helper.visibleArguments(command).map((argument) => helper.formatItem(`<${argument.name()}>`, TERM_WIDTH, helper.argumentDescription(argument), helper)),
    },
    { title: "flags", lines: flagRows(spec.flags, helper) },
    { title: "keys", lines: indented(keys) },
    { title: "notes", lines: indented(spec.notes ?? []) },
    { title: "examples", lines: indented(spec.examples) },
  ]);
}

/**
 * Print the help of one command, or of `poplin` itself.
 *
 * @param topic - the command to explain; every command in one list when absent
 * @returns plain ASCII lines of at most 80 characters, with no trailing newline
 */
export function helpText(topic?: CommandName): string {
  const program = buildProgram();
  const command = program.commands.find((candidate) => candidate.name() === topic) ?? program;
  const spec = specOf(command);

  return command
    .configureHelp({ helpWidth: MAX_LINE, formatHelp: (shown, helper) => (spec === undefined ? overview(shown, helper) : commandHelp(shown, spec, helper)) })
    .helpInformation();
}
