// Runs the deploy for `bun run deploy`: the real bun, wrangler, and network behind the deploy's ways out.

import { tmpdir } from "node:os";
import { join } from "node:path";

import { version } from "../../../cli/package.json";
import { deployWorker, type RunCommand } from "../src/shared/release/deploy/deploy";
import { projectReleases } from "../src/shared/release/deploy/release-source";

/** The root of the tree this script sits in. */
const ROOT = join(import.meta.dir, "..", "..", "..", "..");

/** The exit code of a command that could not be started. */
const NOT_STARTED = 127;

/** Runs a command with the build's own output and input. */
const run: RunCommand = async (command, options) => {
  try {
    return await Bun.spawn([...command], { cwd: options.cwd, env: options.env, stdin: "inherit", stdout: "inherit", stderr: "inherit" }).exited;
  } catch {
    console.error(`${command[0]}: the command could not be started`);
    return NOT_STARTED;
  }
};

process.exitCode = await deployWorker({
  root: ROOT,
  version,
  scratch: tmpdir(),
  env: process.env,
  args: process.argv.slice(2),
  source: projectReleases({ fetch }),
  run,
  say: (line) => console.log(line),
});
