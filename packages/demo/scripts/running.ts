// Which preview runs on a port: a pid file under the OS temp folder, written at the start and removed at the end.
//
// A pid can pass to another process after a crash. So a preview is stopped only when the port itself answers with the pid the file holds.

import { existsSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseArgs } from "node:util";

/** The one address the preview listens on: this machine alone. */
export const HOST = "127.0.0.1";

/** The port of a preview started without one. */
export const DEFAULT_PORT = 4400;

/** The path a running preview answers its own pid at. */
export const PID_PATH = "/preview-pid";

/** How long a stopped preview is given to end, and a running one to answer, in milliseconds. */
const PATIENCE_MS = 3000;

/** The pause between two looks at a preview that is ending, in milliseconds. */
const PAUSE_MS = 50;

/** What a command line of the preview says. */
interface Flags {
  /** The port to listen on, or to stop. */
  readonly port: number;

  /** Whether to start anew whenever a source file changes. */
  readonly watch: boolean;

  /** Whether `/gallery` answers. */
  readonly gallery: boolean;

  /** Whether the client is served hot by its dev server, in front of a watched preview. */
  readonly dev: boolean;
}

/**
 * Read the flags of a command line: `--port <port>`, `--watch`, `--gallery`, `--dev`.
 *
 * @param args - the arguments after the script's own path
 * @param defaultPort - the port of a command line that names none
 * @returns the flags
 * @throws {TypeError} a flag is not one of the four
 * @throws {RangeError} the port is none
 */
export function readFlags(args: readonly string[], defaultPort: number = DEFAULT_PORT): Flags {
  const { values } = parseArgs({
    args: [...args],
    options: { port: { type: "string" }, watch: { type: "boolean" }, gallery: { type: "boolean" }, dev: { type: "boolean" } },
    strict: true,
  });
  const port = values.port === undefined ? defaultPort : Number(values.port);
  if (!Number.isInteger(port) || port < 1 || port > 65_535) throw new RangeError(`--port takes a port from 1 to 65535, not ${JSON.stringify(values.port)}`);

  return { port, watch: values.watch === true, gallery: values.gallery === true, dev: values.dev === true };
}

/** The pid file of the preview on a port. */
export function pidFile(port: number): string {
  return join(tmpdir(), `poplin-preview-${port}.pid`);
}

/** The pid of the preview that answers on a port, or `undefined` when none does. */
async function answeringPid(port: number): Promise<number | undefined> {
  try {
    const answer = await fetch(`http://${HOST}:${port}${PID_PATH}`, { signal: AbortSignal.timeout(PATIENCE_MS) });

    return answer.ok ? Number(await answer.text()) : undefined;
  } catch {
    return undefined;
  }
}

function isAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);

    return true;
  } catch {
    return false;
  }
}

/**
 * Write the pid file of this process as the preview on a port.
 *
 * @returns the file's path
 */
export function markRunning(port: number): string {
  const file = pidFile(port);
  writeFileSync(file, String(process.pid));

  return file;
}

/** Remove the pid file of a port, only while it still names this process: a newer preview's file is left alone. */
export function unmarkRunning(port: number): void {
  const file = pidFile(port);
  if (existsSync(file) && readFileSync(file, "utf8") === String(process.pid)) rmSync(file, { force: true });
}

/**
 * Stop the preview that runs on a port, when one does, and remove its pid file.
 *
 * @returns the pid that was stopped, or `undefined` when no preview ran there; a file left by a preview that is gone is removed
 * @throws {Error} the preview did not end in time
 */
export async function stopRunning(port: number): Promise<number | undefined> {
  const file = pidFile(port);
  if (!existsSync(file)) return undefined;

  const pid = Number(readFileSync(file, "utf8"));
  const running = pid !== process.pid && (await answeringPid(port)) === pid;
  if (running) process.kill(pid, "SIGTERM");

  for (let waited = 0; running && isAlive(pid); waited += PAUSE_MS) {
    if (waited >= PATIENCE_MS) throw new Error(`the preview on port ${port} (pid ${pid}) did not stop`);

    await Bun.sleep(PAUSE_MS);
  }

  if (pid !== process.pid) rmSync(file, { force: true });

  return running ? pid : undefined;
}
