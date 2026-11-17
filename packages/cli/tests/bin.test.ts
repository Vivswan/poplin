import { afterEach, describe, expect, test } from "bun:test";
import { spawn, spawnSync } from "node:child_process";
import { once } from "node:events";
import { mkdtempDisposableSync, readdirSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createInterface } from "node:readline";

import manifest from "../package.json" with { type: "json" };
import { cleanUp, folderOf } from "./commands/support/harness";
import { installInProcess } from "./mcp/support/in-process-install";

/** The folder of the package's source, as a path. */
const SOURCE = join(import.meta.dir, "..", "src");

/** The command's entry, as a path. */
const BIN = join(SOURCE, "bin.ts");

/** The module that puts an install into the child, as a path. */
const SUPPORT = join(import.meta.dir, "mcp", "support", "in-process-install.ts");

/** What says, on the child's stderr, that a file is on its way and that the upload is being given up. */
const SAID = { sending: "a file is on its way", givingUp: "the upload is being given up" };

/** What the child runs: the real API behind a `fetch` that holds every file, and with `HOLD_GIVE_UP` the giving up of the upload, until the request's signal aborts; then the command, publishing `FOLDER`. With `SPINNER` its stderr counts as a terminal. */
const CHILD = [
  "if (process.env.SPINNER === '1') process.stderr.isTTY = true;",
  `import { ${installInProcess.name} } from ${JSON.stringify(SUPPORT)};`,
  `await ${installInProcess.name}();`,
  "const answer = globalThis.fetch;",
  "const held = (signal) => new Promise((_resolve, reject) => signal.addEventListener('abort', () => reject(signal.reason)));",
  "globalThis.fetch = Object.assign((input, init) => {",
  `  if (init.method === 'PUT') console.error(${JSON.stringify(SAID.sending)});`,
  `  if (init.method === 'DELETE') console.error(${JSON.stringify(SAID.givingUp)});`,
  "  return init.method === 'PUT' || (init.method === 'DELETE' && process.env.HOLD_GIVE_UP === '1') ? held(init.signal) : answer(input, init);",
  "}, { preconnect: answer.preconnect });",
  `process.argv = [process.argv[0], ${JSON.stringify(BIN)}, process.env.FOLDER];`,
  `await import(${JSON.stringify(BIN)});`,
].join("\n");

/** Run the command on a machine with no login: an empty config folder, and neither login variable. */
function run(...args: string[]): { status: number | null; stdout: string; stderr: string } {
  using config = mkdtempDisposableSync(join(tmpdir(), "poplin-bin-"));
  const env = { ...process.env, POPLIN_CONFIG_DIR: config.path, POPLIN_SERVER: "", POPLIN_TOKEN: "" };
  const { status, stdout, stderr } = spawnSync(process.execPath, [BIN, ...args], { encoding: "utf8", env });

  return { status, stdout, stderr };
}

/** Every TypeScript file under a folder, as a path. */
function sourcesUnder(folder: string): string[] {
  return readdirSync(folder, { recursive: true, encoding: "utf8" })
    .filter((path) => path.endsWith(".ts"))
    .map((path) => join(folder, path));
}

afterEach(cleanUp);

describe("bin", () => {
  test("the command prints to the stream and exits with the code a script reads: a refusal on stdout or a 0 after doing nothing would pass for success", () => {
    const outcomes = [run("--version"), run("help", "list"), run(), run("listt"), run("list")].map(({ status, stdout, stderr }) => ({
      status,
      stdout: stdout.split("\n")[0],
      stderr: stderr.split("\n")[0],
    }));

    expect(outcomes).toEqual([
      { status: 0, stdout: manifest.version, stderr: "" },
      { status: 0, stdout: "Usage: poplin list [options]", stderr: "" },
      { status: 2, stdout: "", stderr: "Usage: poplin <path> [options]" },
      { status: 2, stdout: "", stderr: 'unknown command "listt"' },
      { status: 3, stdout: "", stderr: "not logged in" },
    ]);
  });

  // Drift: Ctrl-C outside a wait ended the process at once, and the upload of the publish held its place under the limits for a day. A signal sent to a child on Windows ends it without the handler, so the wiring is seen where a signal is one.
  test.skipIf(process.platform === "win32").each<[string, Record<string, string>, number, { code: number | null; signal: string | null }, string[]]>([
    ["the first Ctrl-C gives the upload up, says so in one line, and exits 1", {}, 1, { code: 1, signal: null }, [SAID.sending, SAID.givingUp, "the command was stopped: the upload was given up and no site changed"]],
    ["a second Ctrl-C ends a command that is still giving its upload up, at once", { HOLD_GIVE_UP: "1" }, 2, { code: null, signal: "SIGINT" }, [SAID.sending, SAID.givingUp]],
  ])("%s", async (_name, env, interrupts, exit, said) => {
    const folder = folderOf("notes", { "index.html": "<h1>notes</h1>" });
    const child = spawn(process.execPath, ["-e", CHILD], { env: { ...process.env, ...env, FOLDER: folder, POPLIN_CONFIG_DIR: join(folder, "..", "config") }, stdio: ["ignore", "pipe", "pipe"] });
    const stderr: string[] = [];
    const marks = [SAID.sending, SAID.givingUp].slice(0, interrupts);

    for await (const line of createInterface({ input: child.stderr })) {
      stderr.push(line);
      if (marks.includes(line)) child.kill("SIGINT");
    }

    const [code, signal] = child.exitCode === null && child.signalCode === null ? await once(child, "exit") : [child.exitCode, child.signalCode];

    expect([{ code, signal }, stderr]).toEqual([exit, said]);
  });

  // Drift: a stop key the spinner took stopped the command and left the signal's listener standing, so the Ctrl-C after it was swallowed and the command hung on until its last words ran out.
  test.skipIf(process.platform === "win32")("a Ctrl-C after a stop key the spinner took ends a command that is still giving its upload up, at once", async () => {
    const folder = folderOf("notes", { "index.html": "<h1>notes</h1>" });
    const env = { ...process.env, HOLD_GIVE_UP: "1", SPINNER: "1", CI: "", NO_COLOR: "", TERM: "xterm", FOLDER: folder, POPLIN_CONFIG_DIR: join(folder, "..", "config") };
    const child = spawn(process.execPath, ["-e", CHILD], { env, stdio: ["pipe", "ignore", "pipe"] });
    const steps = [
      { mark: SAID.sending, act: (): void => void child.stdin.write("\u0003") },
      { mark: SAID.givingUp, act: (): void => void child.kill("SIGINT") },
    ];
    let said = "";
    child.stderr.on("data", (chunk: Buffer) => {
      said += chunk.toString();
      if (steps[0] !== undefined && said.includes(steps[0].mark)) steps.shift()?.act();
    });

    const [code, signal] = await once(child, "exit");

    expect([{ code, signal }, steps.length]).toEqual([{ code: null, signal: "SIGINT" }, 0]);
  });

  // Drift: the npm package exports the commands' modules to other programs; a signal handler in one of them would take Ctrl-C away from a program that only imported it.
  test("no module but the command's entry listens for a signal", () => {
    const listening = sourcesUnder(SOURCE).filter((path) => /process\s*\.\s*(on|once|addListener)\s*\(/.test(readFileSync(path, "utf8")));

    expect(listening).toEqual([BIN]);
  });
});
