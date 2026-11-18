import { describe, expect, test } from "bun:test";
import { readdirSync } from "node:fs";
import { join } from "node:path";

import type { VersionSteps } from "../../src/migrations/migrate";
import { STEPS, VERSIONS } from "../../src/migrations/registry";

const FOLDER = join(import.meta.dir, "..", "..", "src", "migrations");
const VERSION_FILE = /^(\d+\.\d+\.\d+)\.ts$/;

describe("STEPS", () => {
  test("drift: a version file left out of the list never runs, one listed out of order runs against the wrong schema, and a file that says another version than its name marks its steps under it", async () => {
    const files = readdirSync(FOLDER)
      .flatMap((file) => VERSION_FILE.exec(file)?.[1] ?? [])
      .sort(Bun.semver.order);
    const exported: VersionSteps[] = [];

    for (const version of files) {
      const module: Record<string, VersionSteps> = await import(join(FOLDER, `${version}.ts`));
      exported.push(...Object.values(module));
    }

    expect(exported).toEqual([...VERSIONS]);
    expect(VERSIONS.map((file) => file.version)).toEqual(files);
  });

  test("drift: two steps of one version under one name read as one step in every line that names a step by its version and name", () => {
    const labels = STEPS.map((step) => `${step.version}/${step.name}`);

    expect(labels.filter((label, at) => labels.indexOf(label) !== at)).toEqual([]);
  });
});
