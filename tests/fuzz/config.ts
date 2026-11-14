// The one place the fuzz targets take their budget, their seed, and their failure reports from.
//
//   FUZZ_RUNS     runs of each property; 5000 by default, unlimited once FUZZ_SECONDS is set
//   FUZZ_SECONDS  wall-clock budget of the whole directory, shared equally by its files and then by a file's properties; 15 by default
//   FUZZ_SEED     replays the seed a failure printed
//   FUZZ_PATH     with FUZZ_SEED, jumps straight to the counterexample path a failure printed
//   FUZZ_REPORTS  a directory that receives one `<target>-<n>/report.md` per failing property
//
// An async run that has not settled after five seconds fails its property. One still running when the property's budget ends is dropped as interrupted.

import { test } from "bun:test";
import { mkdirSync, writeFileSync } from "node:fs";
import { basename, join } from "node:path";
import fc from "fast-check";

const TARGET_SUFFIX = ".fuzz.test.ts";
const TARGET_COUNT = Array.from(new Bun.Glob(`*${TARGET_SUFFIX}`).scanSync({ cwd: import.meta.dir })).length;
const DEFAULT_RUNS = 5000;
const DEFAULT_SECONDS = 15;
const SECONDS = numberSetting("FUZZ_SECONDS", (seconds) => Number.isFinite(seconds) && seconds > 0, "a positive number");
const RUNS = numberSetting("FUZZ_RUNS", (runs) => Number.isSafeInteger(runs) && runs > 0, "a positive whole number") ?? (SECONDS === undefined ? DEFAULT_RUNS : Number.MAX_SAFE_INTEGER);
const SEED = numberSetting("FUZZ_SEED", Number.isInteger, "a whole number");
const REPLAY_PATH = setting("FUZZ_PATH");
const REPORTS = setting("FUZZ_REPORTS");
const TARGET_BUDGET_MS = ((SECONDS ?? DEFAULT_SECONDS) * 1000) / TARGET_COUNT;
const REPLAYABLE_NAME = /^[\w ,.-]+$/;
const HUNG_RUN_MS = 5000;
const TEST_TIMEOUT_SLACK_MS = 30_000;

/** Registers one property of a target as a test. The name goes into a shell replay command, so it holds only letters, digits, spaces, and `_ , . -`. */
type RegisterProperty = <Ts>(name: string, property: fc.IRawProperty<Ts>) => void;

function setting(variable: string): string | undefined {
  const value = process.env[variable];
  if (value === undefined || value === "") return undefined;

  return value;
}

function numberSetting(variable: string, accepts: (value: number) => boolean, wanted: string): number | undefined {
  const value = setting(variable);
  if (value === undefined) return undefined;

  const parsed = Number(value);
  if (!accepts(parsed)) throw new Error(`${variable} must be ${wanted}, got ${JSON.stringify(value)}`);

  return parsed;
}

function replay(): { seed?: number; path?: string } {
  if (SEED === undefined) return {};

  if (REPLAY_PATH === undefined) return { seed: SEED };

  return { seed: SEED, path: REPLAY_PATH };
}

function writeReport(folder: string, title: string, command: string, failure: string): void {
  if (REPORTS === undefined) return;

  const directory = join(REPORTS, folder);
  const report = [`# ${title}`, "", "```sh", command, "```", "", "```text", failure, "```", "", "Pin the counterexample as a case in the unit tests of the code that gets fixed.", ""];

  mkdirSync(directory, { recursive: true });
  writeFileSync(join(directory, "report.md"), report.join("\n"));
}

/**
 * Open a fuzz target: the properties of one test file, run under that file's share of the budget.
 *
 * @param file - the target's file name, `import.meta.file` of a `*.fuzz.test.ts`
 * @returns the function that registers one property; a failure throws fast-check's report, which carries the seed, the path, and the shrunk counterexample
 */
export function fuzzTarget(file: string): RegisterProperty {
  const target = basename(file, TARGET_SUFFIX);
  let registered = 0;

  return <Ts>(name: string, property: fc.IRawProperty<Ts>): void => {
    if (!REPLAYABLE_NAME.test(name)) throw new Error(`the property name cannot go into a replay command: ${name}`);

    registered += 1;
    const folder = `${target}-${registered}`;

    const report = (details: fc.RunDetails<Ts>): void => {
      if (details.interrupted) console.log(`${target}: ${name}: ${details.numRuns} runs in the time budget`);

      const failure = fc.defaultReportMessage(details);
      if (failure === undefined) return;

      const command = `FUZZ_SEED=${details.seed} FUZZ_PATH=${details.counterexamplePath ?? ""} bun test tests/fuzz/${target}${TARGET_SUFFIX} -t '${name}'`;

      try {
        writeReport(folder, `${target}: ${name}`, command, failure);
      } catch (cause) {
        console.error(`${target}: ${name}: the report was not written: ${cause}`);
      }

      throw new Error(`${failure}\n\nReplay: ${command}`);
    };

    const check = async (): Promise<void> => {
      const share = TARGET_BUDGET_MS / registered;

      await fc.assert(property, { numRuns: RUNS, interruptAfterTimeLimit: share, timeout: HUNG_RUN_MS, includeErrorInReport: true, reporter: report, ...replay() });
    };

    test(name, check, TARGET_BUDGET_MS + TEST_TIMEOUT_SLACK_MS);
  };
}
