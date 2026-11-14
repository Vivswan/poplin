import { describe, expect, test } from "bun:test";
import { readdirSync } from "node:fs";
import { join } from "node:path";

import type { Step } from "../../src/migrations/migrate";
import { SCHEMA_VERSION, STEPS } from "../../src/migrations/registry";

const FOLDER = join(import.meta.dir, "..", "..", "src", "migrations");
const STEP_FILE = /^(\d{4})-[a-z0-9-]+\.ts$/;

describe("STEPS", () => {
  test("drift: a step file left out of the list never runs, and a listed step out of order or with a gap runs against the wrong schema", async () => {
    const files = readdirSync(FOLDER)
      .filter((file) => STEP_FILE.test(file))
      .sort();
    const exported: Step[] = [];

    for (const file of files) {
      const module: Record<string, Step> = await import(join(FOLDER, file));
      exported.push(...Object.values(module));
    }

    expect(files.map((file) => Number(STEP_FILE.exec(file)?.[1]))).toEqual(STEPS.map((_step, at) => at + 1));
    expect(exported).toEqual([...STEPS]);
    expect(STEPS.map((step) => step.number)).toEqual(STEPS.map((_step, at) => at + 1));
    expect(SCHEMA_VERSION).toBe(files.length);
  });
});
