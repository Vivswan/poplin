#!/usr/bin/env node
// The `poplin` command.

import { hostname } from "node:os";
import { setTimeout as wait } from "node:timers/promises";

import terminalLink from "terminal-link";

import { exitCode } from "./commands/exit-codes";
import { problem, problemLines } from "./commands/problems";
import type { Io } from "./commands/records";
import { AFTER_STOP_TIMEOUT_MS, run } from "./commands/run";
import { openBrowser } from "./local/browser";
import { thisMachine } from "./local/login-file";
import { pastedScreen, runnerOf } from "./local/invoked";
import { lookOf, processScreen } from "./local/screen";

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

/** Stop the command, and end it here when it has not ended by itself after its last words. Whichever way it was stopped, by Ctrl-C or by a key the spinner took, the Ctrl-C after it ends the process at once. */
function stop(): void {
  if (STOP.signal.aborted) return;

  STOP.abort();
  process.off("SIGINT", stop);

  setTimeout(() => {
    for (const line of problemLines(problem("stopped"))) console.error(line);

    process.exit(exitCode({ kind: "failed" }));
  }, LAST_WORDS_MS).unref();
}

/** Take the first Ctrl-C as a stop. The listener is gone once the command is stopped, so a second Ctrl-C ends the process at once. */
function listenForStop(): void {
  process.once("SIGINT", stop);
}

/** This process as a command sees it. A person can be asked when stdin and stderr are both a terminal, and what is being worked on shows when stderr shows colour. */
function thisProcess(): Io {
  const machine = thisMachine();
  const looks = { out: lookOf(process.stdout, machine.env), err: lookOf(process.stderr, machine.env) };
  const colour = { out: looks.out.colour, err: looks.err.colour };
  const link = (text: string, address: string): string | undefined => (terminalLink.stderr.isSupported ? terminalLink.stderr(text, address) : undefined);

  return {
    out: (line) => console.log(line),
    // Every question and the line of what is worked on go to stderr, so stdout holds the result alone.
    screen: pastedScreen(processScreen({ out: process.stdout, err: process.stderr, colour, link, input: process.stdin, stop }), runnerOf(machine.env)),
    fetch: (input, init) => fetch(input, init),
    machine,
    terminal: { asks: process.stderr.isTTY === true && process.stdin.isTTY === true, progress: colour.err },
    looks,
    computer: hostname(),
    open: (address) => openBrowser(address, machine),
    pause,
    stopped: STOP.signal,
  };
}

listenForStop();
process.exitCode = await run(process.argv.slice(2), thisProcess());
