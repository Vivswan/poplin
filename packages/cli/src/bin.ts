#!/usr/bin/env node
// The `poplin` command.

import { VERSION } from "./poplin";

const USAGE = "usage: poplin --version";

/** The exit status: 0 after printing the version, 2 after printing the usage for any other arguments. */
function run(args: readonly string[]): number {
  if (args.length === 1 && args[0] === "--version") {
    console.log(VERSION);
    return 0;
  }

  console.error(USAGE);

  return 2;
}

process.exitCode = run(process.argv.slice(2));
