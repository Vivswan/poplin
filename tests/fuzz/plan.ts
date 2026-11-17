// The plan of one fuzz run on GitHub: every target of this folder, each in a job of its own, all under one seed.
//
//   the targets   every `*.fuzz.test.ts` beside this file, by its name without the ending: the list is read from the folder, never kept by hand
//   the seed      FUZZ_SEED where the caller names one, else a new random one; printed, and the same for every target
//
// Run as a step, it writes `targets` (a JSON list) and `seed` to the file GITHUB_OUTPUT names.

import { appendFileSync } from "node:fs";

/** How the file name of a target ends. */
export const TARGET_SUFFIX = ".fuzz.test.ts";

/** One above the highest seed a run draws. */
const SEEDS = 2 ** 31;

/** The targets of a folder, sorted: the name of each `*.fuzz.test.ts` in it, without that ending. */
export function fuzzTargets(folder: string): readonly string[] {
  return Array.from(new Bun.Glob(`*${TARGET_SUFFIX}`).scanSync({ cwd: folder }), (file) => file.slice(0, -TARGET_SUFFIX.length)).sort();
}

/**
 * Say the seed of a run.
 *
 * @param named - the seed the caller names; blank or absent for a new one
 * @param draw - a number from 0 up to 1, drawn anew by each call
 * @returns the named seed, else a whole number from 0 up to `SEEDS`
 * @throws {Error} the named seed is no whole number
 */
export function seedOf(named: string | undefined, draw: () => number): number {
  if (named === undefined || named.trim() === "") return Math.floor(draw() * SEEDS);

  const seed = Number(named);
  if (!Number.isSafeInteger(seed)) throw new Error(`FUZZ_SEED must be a whole number, got ${JSON.stringify(named)}`);

  return seed;
}

if (import.meta.main) {
  const output = process.env.GITHUB_OUTPUT;
  if (output === undefined || output === "") throw new Error("GITHUB_OUTPUT is not set");

  const targets = fuzzTargets(import.meta.dir);
  const seed = seedOf(process.env.FUZZ_SEED, Math.random);

  appendFileSync(output, `targets=${JSON.stringify(targets)}\nseed=${seed}\n`);
  console.log(`fuzzing ${targets.length} targets with seed ${seed}: ${targets.join(", ")}`);
}
