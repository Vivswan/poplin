#!/usr/bin/env node
// The `poplin` command.

import { hostname } from "node:os";
import { createInterface } from "node:readline/promises";

import type { Io } from "./commands/records";
import { run } from "./commands/run";
import { openBrowser } from "./local/browser";
import { thisMachine } from "./local/login-file";

/** Moves to the start of the line, writes, and clears what the line held beyond it: the one updating progress line. No color is ever written. */
const REWRITE = { start: "\r", clearToEnd: "\u001b[K" } as const;

/** The value of `TERM` on a terminal that takes no control sequence. */
const PLAIN_TERMINAL = "dumb";

/** Ask one question on the terminal: the question goes to stderr, so stdout holds the result alone. */
async function ask(question: string): Promise<string> {
  const terminal = createInterface({ input: process.stdin, output: process.stderr });

  try {
    return await terminal.question(question);
  } finally {
    terminal.close();
  }
}

/** Wait, unless the person presses Ctrl-C meanwhile. The interrupt is taken during a wait alone, so at any other moment it ends the process as ever. */
function pause(ms: number): Promise<"over" | "interrupted"> {
  return new Promise((resolve) => {
    const interrupted = (): void => {
      clearTimeout(timer);
      resolve("interrupted");
    };
    const timer = setTimeout(() => {
      process.off("SIGINT", interrupted);
      resolve("over");
    }, ms);

    process.once("SIGINT", interrupted);
  });
}

/** This process as a command sees it. A person can be asked when stdin and stderr are both a terminal, and the progress line shows when stderr is one that takes control sequences. */
function thisProcess(): Io {
  const watched = process.stderr.isTTY === true;
  const machine = thisMachine();

  return {
    out: (line) => console.log(line),
    err: (line) => console.error(line),
    status: (text) => process.stderr.write(`${REWRITE.start}${text}${REWRITE.clearToEnd}`),
    fetch: (input, init) => fetch(input, init),
    machine,
    terminal: { asks: watched && process.stdin.isTTY === true, progress: watched && process.env.TERM !== PLAIN_TERMINAL },
    ask,
    computer: hostname(),
    open: (address) => {
      openBrowser(address, machine);
    },
    pause,
  };
}

process.exitCode = await run(process.argv.slice(2), thisProcess());
