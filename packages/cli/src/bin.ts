#!/usr/bin/env node
// The `poplin` command.

import { exitCode } from "./commands/exit-codes";
import { helpText } from "./commands/help";
import { parseCommand } from "./commands/parse-command";
import { VERSION } from "./poplin";

/** The exit status, after printing the version, a help text, or why nothing was done. */
function run(args: readonly string[]): number {
  const parsed = parseCommand(args);

  if (parsed.kind === "version") {
    console.log(VERSION);

    return exitCode(parsed);
  }

  if (parsed.kind === "help" && parsed.asked) {
    console.log(helpText(parsed.topic));

    return exitCode(parsed);
  }

  if (parsed.kind === "help") {
    console.error(helpText(parsed.topic));

    return exitCode(parsed);
  }

  if (parsed.kind === "usage-error") {
    console.error(parsed.message);
    if (parsed.hint !== undefined) console.error(parsed.hint);

    return exitCode(parsed);
  }

  console.error(`poplin ${parsed.kind}: this build reads the command and has no connection to an install, so nothing was done.`);

  return exitCode({ kind: "no-install" });
}

process.exitCode = run(process.argv.slice(2));
