// How a line names a command a person may paste, whoever worded it: the CLI, the install, or a provider.
//
//   run through npx     npx poplin login --server <address>
//   installed           poplin login --server <address>
//
// A text of the install or of a provider may name a button of the dashboard, which a terminal does not have: the command that does the same stands in its place.
// The one JSON value of a command is never rewritten, so a program reads the same value however the command was started.

import { COMMANDS, PROVIDER_COMMANDS } from "../commands/command-table";
import type { Screen } from "./screen";

/** The value npm gives `npm_command` while it runs a package's command, as `npx` does. */
const NPM_EXEC = "exec";

/** The words a command line starts with after `poplin`: every command and `help`, each as a whole word, and a path, a placeholder, or a flag. */
const AFTER = [...[...COMMANDS, ...PROVIDER_COMMANDS].map((spec) => `${spec.name}(?![\\w-])`), "help(?![\\w-])", "\\.{1,2}(?:/|\\s|$)", "~", "<", "\\[", "--"].join("|");

/** The colour sequences a painted text may hold between two of its words. */
const PAINT = "(?:\\x1b\\[[\\d;]*m)*";

/** A command as a text names it, with `npx` before it or without, painted or not. `poplin@latest` is not one: it names a version on purpose. */
const NAMED = new RegExp(`(?<=^|\\W|\\x1b\\[[\\d;]*m)(?:npx )?poplin(${PAINT}) (?=${PAINT}(?:${AFTER}))`, "g");

/** The buttons of the dashboard a text may name, each with the command that does the same. The longer wording stands first. */
const BUTTONS: readonly (readonly [said: RegExp, command: string])[] = [
  [/Open Domain(?: on the dashboard)? and press Repair/g, "Run npx poplin doctor --repair"],
  [/open Domain(?: on the dashboard)? and press Repair/g, "run npx poplin doctor --repair"],
  [/on the dashboard's Domain screen, paste an account token and press Repair/g, "run npx poplin doctor --repair"],
  [/press Repair/g, "run npx poplin doctor --repair"],
  [/Open Domain(?: on the dashboard)? and press Check/g, "Run npx poplin doctor --repair --dry-run"],
];

/** How the command a person pastes starts. */
export type Runner = "npx poplin" | "poplin";

/**
 * How this process was started, read from its environment.
 *
 * @returns `npx poplin` under `npx` or `npm exec`, which need not have left a `poplin` on the path, and `poplin` for every other start
 */
export function runnerOf(env: Readonly<Record<string, string | undefined>>): Runner {
  return env.npm_command === NPM_EXEC ? "npx poplin" : "poplin";
}

/**
 * Word a text for the person at this terminal.
 *
 * @returns the text with each command it names started as this process was, and each button of the dashboard named as the command that does the same
 */
export function pasted(text: string, runner: Runner): string {
  const commands = BUTTONS.reduce((said, [button, command]) => said.replace(button, command), text);

  return commands.replace(NAMED, `${runner}$1 `);
}

/** The same screen, with every line, question, and choice worded for the person at this terminal. */
export function pastedScreen(screen: Screen, runner: Runner): Screen {
  const worded = (text: string): string => pasted(text, runner);

  return {
    line: (tone, text, hang) => screen.line(tone, worded(text), hang),
    aside: (tone, text, hang) => screen.aside(tone, worded(text), hang),
    ask: (question, secret) => screen.ask(worded(question), secret),
    confirm: (question, initial) => screen.confirm(worded(question), initial),
    choose: (question, picks) =>
      screen.choose(
        worded(question),
        picks.map((pick) => ({ ...pick, hint: worded(pick.hint) })),
      ),
    working: (text) => screen.working(worded(text)),
    rest: (left) => screen.rest(left === undefined ? undefined : worded(left)),
  };
}
