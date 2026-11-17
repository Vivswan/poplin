// The help texts of the command table, so that every flag the parser takes is listed and no other.

import type { Command } from "commander";

import { type Look, PLAIN_LOOK } from "../../local/screen";
import { BARE_COMMAND, COMMANDS, type CommandName, type CommandSpec, FULL_HELP, HELP_FLAG, PROVIDER_COMMANDS, SESSION } from "../command-table";
import { SETTING_SAMPLES } from "../install/install-settings";
import { type HelpPage, type HelpPart, helpPage } from "./help-page";
import { argumentsOf, buildProgram } from "./program";

function specOf(command: Command): CommandSpec | undefined {
  return COMMANDS.find((spec) => spec.name === command.name());
}

function flagRows(flags: CommandSpec["flags"]): [string, string][] {
  return flags.map((flag) => [flag.value === undefined ? flag.name : `${flag.name} ${flag.value}`, flag.about]);
}

/** The help of `poplin` itself: every command under its group, the flags every command takes, and a short session. */
function overview(program: Command): HelpPage {
  const [first, ...others]: readonly CommandSpec[] = COMMANDS;
  const everywhere = (first?.flags ?? []).filter((flag) => others.every((spec) => spec.flags.some((other) => other.name === flag.name)));
  const term = (command: Command): string => `${command.name()} ${argumentsOf(specOf(command) ?? PROVIDER_COMMANDS[0])}`.trimEnd();
  const groups = program.createHelp().groupItems([...program.commands], [...program.commands], (command) => command.helpGroup());
  const listing: HelpPart[] = [...groups].map(([title, commands]) => ({ title, rows: commands.map((command) => [term(command), command.description()]) }));

  return {
    usage: [`${program.name()} <path> [options]`, `${program.name()} <command> [options]`],
    parts: [...listing, { title: "Options:", rows: flagRows([...everywhere.filter((flag) => flag.name === HELP_FLAG), FULL_HELP, ...everywhere.filter((flag) => flag.name !== HELP_FLAG)]) }, { title: "Examples:", commands: SESSION }],
  };
}

/** The help of one command: what it takes, and the command lines the table shows for it. */
function commandHelp(program: Command, command: Command, spec: CommandSpec): HelpPage {
  const usage = `${program.name()} ${command.name()} ${command.usage()}`;
  const alone = spec.flags.filter((flag) => flag.with === undefined);
  const under = [...new Set(spec.flags.flatMap((flag) => (flag.with === undefined ? [] : [flag.with])))];

  return {
    usage: spec.name === BARE_COMMAND ? [usage.replace(` ${spec.name} `, " "), usage] : [usage],
    about: command.description(),
    parts: [
      { title: "Arguments:", rows: spec.arguments.map((argument) => [`<${argument.name}>`, argument.about]) },
      { title: "Options:", rows: flagRows(alone) },
      ...under.map((flag) => ({ title: `With ${flag}:`, rows: flagRows(spec.flags.filter((other) => other.with === flag)) })),
      spec.name === "config" ? { title: "Keys:", text: Object.keys(SETTING_SAMPLES).join(", ") } : { title: "Keys:" },
      { title: "Examples:", commands: spec.examples },
    ],
  };
}

/**
 * Print the help of one command, or of `poplin` itself.
 *
 * @param topic - the command to explain; every command in one list when absent
 * @param look - how wide the stream shows it and whether in colour; plain lines of at most 80 characters when absent
 * @returns the lines with no trailing newline: ASCII, and with colour sequences only where the look is in colour
 */
export function helpText(topic?: CommandName, look: Look = PLAIN_LOOK): string {
  const program = buildProgram();
  const command = program.commands.find((candidate) => candidate.name() === topic);
  const spec = command === undefined ? undefined : specOf(command);

  return helpPage(command === undefined || spec === undefined ? overview(program) : commandHelp(program, command, spec), look);
}
