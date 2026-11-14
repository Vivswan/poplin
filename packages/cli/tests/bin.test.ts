import { describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { mkdtempDisposableSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import manifest from "../package.json" with { type: "json" };

const BIN = join(import.meta.dir, "..", "src", "bin.ts");

/** Run the command on a machine with no login: an empty config folder, and neither login variable. */
function run(...args: string[]): { status: number | null; stdout: string; stderr: string } {
  using config = mkdtempDisposableSync(join(tmpdir(), "poplin-bin-"));
  const env = { ...process.env, POPLIN_CONFIG_DIR: config.path, POPLIN_SERVER: "", POPLIN_TOKEN: "" };
  const { status, stdout, stderr } = spawnSync(process.execPath, [BIN, ...args], { encoding: "utf8", env });

  return { status, stdout, stderr };
}

describe("bin", () => {
  test("the command prints to the stream and exits with the code a script reads: a refusal on stdout or a 0 after doing nothing would pass for success", () => {
    const outcomes = [run("--version"), run("help", "list"), run(), run("listt"), run("list")].map(({ status, stdout, stderr }) => ({
      status,
      stdout: stdout.split("\n")[0],
      stderr: stderr.split("\n")[0],
    }));

    expect(outcomes).toEqual([
      { status: 0, stdout: manifest.version, stderr: "" },
      { status: 0, stdout: "usage: poplin list [flags]", stderr: "" },
      { status: 2, stdout: "", stderr: "usage: poplin <path> [flags]       publish a folder, or one HTML file" },
      { status: 2, stdout: "", stderr: 'unknown command "listt"' },
      { status: 3, stdout: "", stderr: "not logged in" },
    ]);
  });
});
