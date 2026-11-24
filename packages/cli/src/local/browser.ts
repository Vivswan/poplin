// Opening an address in the person's browser, where a person sits at this machine. The browser is never waited for.

import open from "open";

import { TOKEN_VARIABLES } from "./current-login";
import type { Machine } from "./login-file";

/** The variables that say the person sits at another machine, or at none: a browser opened here would be seen by nobody, and a text copied here would reach no clipboard of theirs. */
const NOBODY_HERE = ["SSH_CONNECTION", "SSH_TTY", "CI"];

/** The scheme of the one kind of address that is opened. */
const SECURE = "https:";

/** What hands an address to the default browser, and fails when it cannot be started. */
type Start = (address: string) => Promise<unknown>;

/** Run a start with every token taken out of this process's environment, and put each back after it: what is started inherits the environment, and a browser, like what holds a clipboard, lives long after the command. */
async function withoutTokens(start: () => Promise<unknown>): Promise<void> {
  const held = Object.values(TOKEN_VARIABLES).flatMap((name) => {
    const value = process.env[name];

    return value === undefined ? [] : [[name, value] as const];
  });
  for (const [name] of held) delete process.env[name];

  try {
    await start();
  } finally {
    for (const [name, value] of held) process.env[name] = value;
  }
}

/**
 * Start something for the person who sits at this machine: their browser, or what holds their clipboard.
 *
 * @param start - what starts it, with none of this process's tokens to inherit; it fails when it cannot be started
 * @returns whether it was started, which it never is where the person sits at another machine, or at none. One that cannot be started is not an error
 */
export async function startHere(machine: Machine, start: () => Promise<unknown>): Promise<boolean> {
  if (NOBODY_HERE.some((name) => (machine.env[name] ?? "") !== "")) return false;

  try {
    await withoutTokens(start);
  } catch {
    return false;
  }

  return true;
}

/**
 * Hand an `https://` address to the person's browser, when this machine looks like one a person sits at.
 *
 * @param start - what starts the browser; the `open` library when absent
 * @returns whether the command that opens the browser was started, which does not say a page came up. One that cannot be started is not an error: the address is printed either way
 */
export async function openBrowser(address: string, machine: Machine, start: Start = open): Promise<boolean> {
  if (URL.parse(address)?.protocol !== SECURE) return false;

  return startHere(machine, () => start(address));
}
