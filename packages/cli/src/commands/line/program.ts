// The command table as a commander program: one command per table entry, with its arguments.

import { Command } from "commander";

import { COMMANDS, type CommandSpec, PROVIDER_COMMANDS } from "../command-table";

/** The word of the program. */
const PROGRAM = "poplin";

/**
 * Write the arguments of a command as its usage shows them.
 *
 * @returns `<site>` for one that must be given and `[<key>]` for one that may be left out, joined by spaces
 */
export function argumentsOf(spec: Pick<CommandSpec, "arguments">): string {
  return spec.arguments.map((argument) => (argument.required ? `<${argument.name}>` : `[<${argument.name}>]`)).join(" ");
}

/**
 * Build the program anew: commander keeps what it parsed, so one program reads one command line.
 *
 * It prints nothing and never ends the process: a line a command refuses is thrown as a `CommanderError`. It has no flag and no help command of its own: the flags are the table's, and are read apart from it.
 *
 * @returns the program, whose commands are those of the table in its order, with the command that makes an install before the others about one
 */
export function buildProgram(): Command {
  const program = new Command(PROGRAM)
    .exitOverride()
    .configureOutput({ writeOut: () => undefined, writeErr: () => undefined })
    .helpOption(false)
    .helpCommand(false)
    .showSuggestionAfterError(false)
    .argument("[words...]");

  const specs: readonly CommandSpec[] = COMMANDS;
  const [install, uninstall] = PROVIDER_COMMANDS;
  const first = specs.findIndex((spec) => spec.group === install.group);
  const after = first + specs.filter((spec) => spec.group === install.group).length;

  // The command that makes an install leads the group of the commands about one, and the one that removes it ends the group.
  const ordered: readonly CommandSpec[] = [
    ...specs.slice(0, first),
    { ...install, flags: [], examples: [] },
    ...specs.slice(first, after),
    { ...uninstall, flags: [], examples: [] },
    ...specs.slice(after),
  ];

  for (const spec of ordered) {
    const command = program.command(spec.name).description(spec.about).helpGroup(spec.group).usage(`${argumentsOf(spec)} [options]`.trimStart());

    for (const argument of spec.arguments) command.argument(argument.required ? `<${argument.name}>` : `[${argument.name}]`, argument.about);
  }

  return program;
}
