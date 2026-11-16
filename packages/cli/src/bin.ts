#!/usr/bin/env node
// The `poplin` command.

import { hostname } from "node:os";
import { setTimeout as wait } from "node:timers/promises";

import { exitCode } from "./commands/exit-codes";
import { problem, problemLines } from "./commands/problems";
import type { Io } from "./commands/records";
import { AFTER_STOP_TIMEOUT_MS, run } from "./commands/run";
import { openBrowser } from "./local/browser";
import { thisMachine } from "./local/login-file";
import { askLine } from "./local/question";

/** Moves to the start of the line, writes, and clears what the line held beyond it: the one updating progress line. No color is ever written. */
const REWRITE = { start: "\r", clearToEnd: "\u001b[K" } as const;

/** The value of `TERM` on a terminal that takes no control sequence. */
const PLAIN_TERMINAL = "dumb";

/** What the first Ctrl-C aborts: the one way a command hears that the person stopped it. */
const STOP = new AbortController();

/** How long a stopped command has to end by itself, in milliseconds: the two calls that give an upload up, and two seconds. */
const LAST_WORDS_MS = 2 * AFTER_STOP_TIMEOUT_MS + 2000;

/** Wait, unless the person stopped the command, or stops it meanwhile. */
async function pause(ms: number): Promise<"over" | "interrupted"> {
  try {
    await wait(ms, undefined, { signal: STOP.signal });

    return "over";
  } catch {
    return "interrupted";
  }
}

/** Take the first Ctrl-C as a stop, and end a command here that has not ended by itself after its last words. The listener is gone once it ran, so a second Ctrl-C ends the process at once. */
function listenForStop(): void {
  process.once("SIGINT", () => {
    STOP.abort();

    setTimeout(() => {
      for (const line of problemLines(problem("stopped"))) console.error(line);

      process.exit(exitCode({ kind: "failed" }));
    }, LAST_WORDS_MS).unref();
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
    // The question goes to stderr, so stdout holds the result alone.
    ask: (question) => askLine(question, { input: process.stdin, output: process.stderr, stopped: STOP.signal }),
    computer: hostname(),
    open: (address) => void openBrowser(address, machine),
    pause,
    stopped: STOP.signal,
  };
}

listenForStop();
process.exitCode = await run(process.argv.slice(2), thisProcess());
