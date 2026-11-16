// The next step of an answer as an agent reads it. A command's hint names the command a person types next; where a tool does the same, the agent is told the tool, since it may hold no shell.

/** Each command a line names, with what an agent calls in its place. A longer form stands before a shorter one that starts the same. */
const TOOL_WORDS: readonly (readonly [RegExp, string])[] = [
  [/poplin set <site> --public --public-name <public name>/g, "update_site with access public and another public_name"],
  [/--public-name <public name>/g, "another public_name"],
  [/poplin list --trash/g, "list_sites with trash true"],
  [/poplin list/g, "list_sites"],
  [/poplin show <site>/g, "get_site"],
  [/poplin restore <site>/g, "restore_site"],
  [/poplin restore (\S+)/g, "restore_site with site $1"],
  [/poplin duplicate <site>/g, "duplicate_site"],
];

/**
 * Word a hint, a step, or a note of a command's answer for an agent. It is not for a line of the result: a site's title may hold a command's words.
 *
 * @returns the line with each command a tool stands for replaced by that tool; a command no tool stands for, such as `poplin login`, stays, and is for the person at the computer
 */
export function toolWords(line: string): string {
  return TOOL_WORDS.reduce((said, [command, tool]) => said.replace(command, tool), line);
}
