// The login file: the one file on the user's machine that holds the install's address and a token.
//
// It is replaced whole and never edited, so a reader sees the old login or the new one and never a part of either.

import { randomUUID } from "node:crypto";
import { constants } from "node:fs";
import { type FileHandle, mkdir, open, rename, rm, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { posix, win32 } from "node:path";

import { type Login, parseLogin } from "./login";

const APP = "poplin";
const FILE_NAME = "login.json";
const DIR_MODE = 0o700;
const FILE_MODE = 0o600;
const GROUP_AND_OTHERS = 0o077;
const WINDOWS = "win32";
const AGAIN = "rerun poplin login";
const READ_WITHOUT_WAITING = constants.O_RDONLY | (constants.O_NONBLOCK ?? 0);

/** The facts about a machine that decide where its login is: the environment, `process.platform`, and the home folder. */
export type Machine = { readonly env: Readonly<Record<string, string | undefined>>; readonly platform: string; readonly home: string };

/** What the login file says. `refused` is a file that exists and cannot be trusted; `fix` is the line that names the fix. */
type SavedLogin = { readonly state: "missing" } | { readonly state: "saved"; readonly login: Login } | { readonly state: "refused"; readonly message: string; readonly fix: string };

function refuse(path: string, problem: string, fix: string = AGAIN): { readonly state: "refused"; readonly message: string; readonly fix: string } {
  return { state: "refused", message: `${path} ${problem}`, fix: `Fix: ${fix}` };
}

function pathsOf(machine: Machine): typeof posix {
  return machine.platform === WINDOWS ? win32 : posix;
}

/** An environment variable that is set to an absolute path; the XDG rules ignore one that is empty or relative. */
function absolute(machine: Machine, name: string): string | undefined {
  const value = machine.env[name];

  if (value === undefined || !pathsOf(machine).isAbsolute(value)) return undefined;

  return value;
}

function configDir(machine: Machine): string {
  const { join } = pathsOf(machine);
  const chosen = machine.env.POPLIN_CONFIG_DIR;

  if (chosen !== undefined && chosen !== "") return chosen;

  if (machine.platform === WINDOWS) return join(absolute(machine, "APPDATA") ?? join(machine.home, "AppData", "Roaming"), APP);

  return join(absolute(machine, "XDG_CONFIG_HOME") ?? join(machine.home, ".config"), APP);
}

async function openIfPresent(path: string): Promise<FileHandle | undefined> {
  // A plain read of a named pipe waits for a writer and never reaches the refusal. Windows has no O_NONBLOCK.
  try {
    return await open(path, READ_WITHOUT_WAITING);
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") return undefined;

    throw error;
  }
}

/** The value a JSON text states, or `undefined` for text that is not JSON, which no JSON text states. */
function readJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

/** This machine, as the running process sees it now: the environment is a copy, so a later change to the process's own does not show in it. */
export function thisMachine(): Machine {
  return { env: { ...process.env }, platform: process.platform, home: homedir() };
}

/**
 * Where the login file is on a machine.
 *
 * @returns `login.json` in `$POPLIN_CONFIG_DIR`, else in `%APPDATA%\poplin` on Windows, else in `$XDG_CONFIG_HOME/poplin` or `~/.config/poplin`
 */
export function loginFilePath(machine: Machine): string {
  return pathsOf(machine).join(configDir(machine), FILE_NAME);
}

/**
 * Read the saved login.
 *
 * @returns `missing` when there is no file, and `refused` for a file that other users can read or that is not exactly a login; such a file is never
 *   repaired and no part of it is used. Only a failure of the disk throws.
 */
export async function readLoginFile(machine: Machine): Promise<SavedLogin> {
  const path = loginFilePath(machine);
  await using handle = await openIfPresent(path);

  if (handle === undefined) return { state: "missing" };

  const facts = await handle.stat();

  if (!facts.isFile()) return refuse(path, "is not a file", `remove it and ${AGAIN}`);

  // Windows has no mode bits: the per-user folder's access list is what keeps other users out.
  if (machine.platform !== WINDOWS && (facts.mode & GROUP_AND_OTHERS) !== 0) {
    return refuse(path, "holds a token and is readable by other users", `chmod 600 the file, or ${AGAIN}`);
  }

  const parsed = parseLogin(readJson(await handle.readFile("utf8")));

  if (!parsed.ok) return refuse(path, `is not a stored login: ${parsed.problem}`);

  return { state: "saved", login: parsed.login };
}

/**
 * Save a login in place of any saved one.
 *
 * The folder is made for its owner alone (0700) and the file likewise (0600). The text goes to a new file beside the login file, which then takes
 * its name, so a crash leaves the old login or the new one. A failure removes the new file and throws.
 */
export async function saveLogin(login: Login, machine: Machine): Promise<void> {
  const { dirname, join } = pathsOf(machine);
  const path = loginFilePath(machine);
  const scratch = join(dirname(path), `.${FILE_NAME}.${randomUUID()}.tmp`);
  const text = `${JSON.stringify({ server: login.server, token: login.token })}\n`;

  await mkdir(dirname(path), { recursive: true, mode: DIR_MODE });

  try {
    // "wx" fails on a path that exists, so the mode given here is the mode the file has.
    await writeFile(scratch, text, { flag: "wx", mode: FILE_MODE, flush: true });
    await rename(scratch, path);
  } catch (error) {
    await rm(scratch, { force: true });

    throw error;
  }
}

/** Remove the saved login; no file is the same as a removed one. */
export async function clearLogin(machine: Machine): Promise<void> {
  await rm(loginFilePath(machine), { force: true });
}
