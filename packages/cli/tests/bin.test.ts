import { describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { join } from "node:path";

import manifest from "../package.json" with { type: "json" };

const BIN = join(import.meta.dir, "..", "src", "bin.ts");

function run(...args: string[]): { status: number | null; stdout: string; stderr: string } {
  const { status, stdout, stderr } = spawnSync(process.execPath, [BIN, ...args], { encoding: "utf8" });

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
      { status: 3, stdout: "", stderr: "poplin list: this build reads the command and has no connection to an install, so nothing was done." },
    ]);
  });
});
