// The `poplin` command of one tree, run as a person runs it: a process of its own, told its install by the environment, asked for JSON.

import { join } from "node:path";

import type { Tree } from "./trees";

/** The command's entry, from a tree's root. */
const ENTRY = "packages/cli/src/bin.ts";

/** What an answer that asks the person to update says, in the hint of its error. */
const ASKS_FOR_UPDATE = /of another version|update poplin|update the install/i;

/** The machine a command runs on. */
export interface Machine {
  /** The folder that stands for the person's home and holds the saved login; nothing outside it is read. */
  readonly home: string;

  /** The install's address and a token of it; left out, the command reads the login saved under `home`. */
  readonly login?: { readonly server: string; readonly token: string };
}

/** What one command came to. */
export interface Ran {
  /** The words of the command, as they were typed. */
  readonly line: string;

  /** The exit code. */
  readonly exit: number;

  /** The JSON value the command printed; `undefined` when it printed none. */
  readonly answer: unknown;

  /** What it wrote to stderr. */
  readonly said: string;
}

/** The JSON value the last line of a text holds; `undefined` for a text that ends in none. */
function lastJson(text: string): unknown {
  try {
    return JSON.parse(text.trim().split("\n").at(-1) ?? "");
  } catch {
    return undefined;
  }
}

/**
 * Read one key of a JSON value that may be of any form.
 *
 * @returns the value under the key, or `undefined` when the value is no object or holds no such key
 */
export function field(value: unknown, key: string): unknown {
  if (typeof value !== "object" || value === null) return undefined;

  return (value as Readonly<Record<string, unknown>>)[key];
}

/**
 * Run one command of a tree's `poplin` with `--json`.
 *
 * @param argv - the words after `poplin`, without `--json`
 * @returns the exit code, the JSON value printed, and stderr; nothing throws for a command that failed
 */
export async function runCli(tree: Tree, machine: Machine, argv: readonly string[]): Promise<Ran> {
  const login = machine.login === undefined ? {} : { POPLIN_SERVER: machine.login.server, POPLIN_TOKEN: machine.login.token };
  const env = { PATH: process.env.PATH ?? "", HOME: machine.home, POPLIN_CONFIG_DIR: join(machine.home, "config"), ...login };
  const ran = Bun.spawn([process.execPath, join(tree.root, ENTRY), ...argv, "--json"], { env, stdin: "ignore", stdout: "pipe", stderr: "pipe" });
  const [printed, said, exit] = await Promise.all([new Response(ran.stdout).text(), new Response(ran.stderr).text(), ran.exited]);

  return { line: `poplin ${argv.join(" ")}`, exit, answer: lastJson(printed), said: said.trim() };
}

/**
 * Say what is wrong with how a command ended, for a command sent to an install of another version.
 *
 * @returns `undefined` for a command that did its work, and for one refused in the command's own words with a hint to update; else the fault, in one line
 */
export function fault(ran: Ran): string | undefined {
  if (ran.exit === 0) return undefined;

  const error = field(ran.answer, "error");
  const hint = field(error, "hint");
  if (typeof hint === "string" && ASKS_FOR_UPDATE.test(hint)) return undefined;

  if (error === undefined) return `\`${ran.line}\` ended with exit ${ran.exit} and no error object: ${ran.said.split("\n")[0] ?? ""}`;

  const about = field(error, "about");

  return `\`${ran.line}\` was refused with \`${String(field(error, "code"))}\`${typeof about === "string" ? ` about ${about}` : ""}, which tells nobody to update`;
}
