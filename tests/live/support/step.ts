// What a live script writes while a test runs it: its plain lines and the runner's commands in the order written, and the outputs of the step.

import { spyOn } from "bun:test";
import { readFileSync, writeFileSync } from "node:fs";
import { EOL } from "node:os";

/** One output in the file the toolkit writes: the name, a delimiter the toolkit makes up, the value on lines of its own, and the delimiter again, with the line ends of the platform. */
const OUTPUT = /^(.+)<<(ghadelimiter_\S+)\r?\n([\s\S]*?)\r?\n\2\r?$/gm;

/** What a script wrote, caught until this leaves its scope. */
interface Caught extends Disposable {
  /** Every line written, the runner's commands among them. */
  readonly lines: string[];

  /** The outputs of the step by name. None when no file was given for them. */
  readonly outputs: () => Record<string, string>;
}

/**
 * Catch what a script writes, in place of the terminal and the runner.
 *
 * @param outputFile - where the step's outputs go. The toolkit writes to the file the process's own `GITHUB_OUTPUT` names and wants it made already, as the runner makes it.
 */
export function catchStep(outputFile?: string): Caught {
  const lines: string[] = [];
  const before = process.env.GITHUB_OUTPUT;
  const log = spyOn(console, "log").mockImplementation((line: unknown) => {
    lines.push(String(line));
  });
  const write = spyOn(process.stdout, "write").mockImplementation((chunk: unknown) => {
    lines.push(String(chunk).replace(new RegExp(`${EOL}$`), ""));

    return true;
  });
  if (outputFile !== undefined) {
    writeFileSync(outputFile, "");
    process.env.GITHUB_OUTPUT = outputFile;
  }

  return {
    lines,
    outputs: () => {
      if (outputFile === undefined) return {};

      return Object.fromEntries([...readFileSync(outputFile, "utf8").matchAll(OUTPUT)].map(([, name, , value]) => [name, value]));
    },
    [Symbol.dispose]: () => {
      log.mockRestore();
      write.mockRestore();
      if (outputFile === undefined) return;

      if (before === undefined) delete process.env.GITHUB_OUTPUT;
      else process.env.GITHUB_OUTPUT = before;
    },
  };
}
