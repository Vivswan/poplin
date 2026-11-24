// The last lines of a finished install and of a login: the two ways to publish from here, by an agent that is given poplin's skill, and by hand.

import manifest from "../../../package.json" with { type: "json" };
import type { Io } from "../records";

/** The project's repository as the skills tool takes it, `owner/repository`, from the address the package itself names. */
const REPOSITORY: string = new URL(manifest.repository.url).pathname.replace(/^\/|\.git$/g, "");

/** The command that finds poplin's skill in the repository and asks which agents of this machine get it. */
export const SKILL_COMMAND = `npx skills add ${REPOSITORY}`;

/**
 * The lines a finished install and a login end with. They are a person's: where nobody can be asked, a program or an agent runs the command, and an agent acts on every line it reads.
 *
 * @param terminal - whether a person can be asked a question, which every question of a command is put by
 * @returns what the skills command is for, that command alone on a line, and the command that publishes with no agent; no line where nobody can be asked
 */
export function publishWays(terminal: Pick<Io["terminal"], "asks">): string[] {
  if (!terminal.asks) return [];

  return ["Next: give your agent poplin", `  ${SKILL_COMMAND}`, "Publish by hand: npx poplin <folder>"];
}
