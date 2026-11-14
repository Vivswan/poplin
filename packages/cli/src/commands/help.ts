// The help texts, printed from the command table so that every flag the parser takes is listed and no other.

import { BARE_COMMAND, COMMANDS, type CommandName, type CommandSpec, SESSION } from "./command-table";
import { SETTING_SAMPLES } from "./install-settings";

/** The column the descriptions start at: wide enough for the longest flag with its value. */
const ABOUT_COLUMN = 28;

/** The longest line of a help text. */
const MAX_LINE = 80;

function row(left: string, about: string): string {
  return `  ${left.padEnd(ABOUT_COLUMN - 2)}${about}`.trimEnd();
}

function section(title: string, rows: readonly string[]): string[] {
  if (rows.length === 0) return [];

  return ["", title, ...rows];
}

function argumentsOf(spec: CommandSpec): string {
  return spec.arguments.map((argument) => (argument.required ? ` <${argument.name}>` : ` [<${argument.name}>]`)).join("");
}

/** A comma-separated list broken into indented lines that fit the page. */
function wrapped(words: readonly string[]): string[] {
  const lines: string[] = [];
  let line = " ";

  for (const word of words) {
    if (line.length + word.length + 2 > MAX_LINE) {
      lines.push(line.trimEnd());
      line = " ";
    }

    line += ` ${word},`;
  }

  lines.push(line.slice(0, -1));

  return lines;
}

function flagRow(flag: CommandSpec["flags"][number]): string {
  return row(flag.value === undefined ? flag.name : `${flag.name} ${flag.value}`, flag.about);
}

function overview(): string {
  const [first, ...others]: readonly CommandSpec[] = COMMANDS;
  const everywhere = (first?.flags ?? []).filter((flag) => others.every((spec) => spec.flags.some((other) => other.name === flag.name)));
  const groups = [...new Set(COMMANDS.map((spec: CommandSpec) => spec.group))];
  const listing = groups.flatMap((group) => {
    const commands = COMMANDS.filter((spec) => spec.group === group);

    return section(
      group,
      commands.map((spec) => row(`${spec.name}${argumentsOf(spec)}`, spec.about)),
    );
  });

  return [
    "usage: poplin <path> [flags]       publish a folder, or one HTML file",
    "       poplin <command> [flags]",
    ...listing,
    "",
    "A first word is a path when it starts with . ~ or a drive (C:), or holds / or \\",
    ...section("flags of every command", everywhere.map(flagRow)),
    ...section(
      "examples",
      SESSION.map((example) => `  ${example}`),
    ),
  ].join("\n");
}

function usageOf(spec: CommandSpec): string[] {
  const long = `poplin ${spec.name}${argumentsOf(spec)} [flags]`;
  if (spec.name !== BARE_COMMAND) return [`usage: ${long}`];

  return [`usage: poplin${argumentsOf(spec)} [flags]`, `       ${long}`];
}

function commandHelp(spec: CommandSpec): string {
  const keys = spec.name === "config" ? wrapped(Object.keys(SETTING_SAMPLES)) : [];

  return [
    ...usageOf(spec),
    "",
    spec.about,
    ...section(
      "arguments",
      spec.arguments.map((argument) => row(`<${argument.name}>`, argument.about)),
    ),
    ...section("flags", spec.flags.map(flagRow)),
    ...section("keys", keys),
    ...section(
      "notes",
      (spec.notes ?? []).map((line) => `  ${line}`),
    ),
    ...section(
      "examples",
      spec.examples.map((example) => `  ${example}`),
    ),
  ].join("\n");
}

/**
 * Print the help of one command, or of `poplin` itself.
 *
 * @param topic - the command to explain; every command in one list when absent
 * @returns plain ASCII lines of at most 80 characters, with no trailing newline
 */
export function helpText(topic?: CommandName): string {
  const spec = COMMANDS.find((candidate) => candidate.name === topic);
  if (spec === undefined) return overview();

  return commandHelp(spec);
}
