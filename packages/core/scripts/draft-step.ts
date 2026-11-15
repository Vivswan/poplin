// Drafts the next step: the statements that take the schema as the last commit declares it to the schema as `database/schema.ts` declares it now.
//
//   bun run --cwd packages/core draft-step "add a pinned flag to sites"     writes src/migrations/0002-add-a-pinned-flag-to-sites.ts
//
// A draft is read before it is kept, then listed in `registry.ts`. What a declaration cannot say is added by hand: STRICT, WITHOUT ROWID, and every trigger.

import { execFileSync } from "node:child_process";
import { rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { generateSQLiteDrizzleJson, generateSQLiteMigration } from "drizzle-kit/api";

import * as declared from "../src/database/schema";
import { STEPS } from "../src/migrations/registry";

/** The folder of the steps, where a draft is written. */
const STEPS_FOLDER = join(import.meta.dir, "../src/migrations");

/** The folder of the declared schema, where the last commit's copy is put for as long as it is read: its imports resolve from there. */
const SCHEMA_FOLDER = join(import.meta.dir, "../src/database");

/** The declared schema, as git names it from the root of the repository. */
const SCHEMA_IN_GIT = "packages/core/src/database/schema.ts";

/** How a rebuilt table shows in a draft: its copy under a new name. */
const REBUILT = "__new_";

/** The schema the last commit declares, which the steps of that commit build. */
async function declaredAtLastCommit(): Promise<Record<string, unknown>> {
  const copy = join(SCHEMA_FOLDER, `schema.last-commit.${process.pid}.ts`);
  writeFileSync(copy, execFileSync("git", ["show", `HEAD:${SCHEMA_IN_GIT}`], { cwd: import.meta.dir }));

  try {
    return await import(copy);
  } finally {
    rmSync(copy);
  }
}

/** The file of a step, as text. */
function stepFile(number: number, description: string, statements: readonly string[]): string {
  const lines = statements.map((statement) => `    ${JSON.stringify(statement.replace(/;\s*$/, ""))},`);
  const warning = statements.some((statement) => statement.includes(REBUILT))
    ? ["// This draft rebuilds a table. A rebuilt table loses its triggers, STRICT, and WITHOUT ROWID, and dropping it removes the rows that refer to it: write this step by hand."]
    : [];

  return [
    `// Step ${number}: ${description}.`,
    ...warning,
    "",
    'import type { Step } from "./migrate";',
    "",
    `/** ${description[0]?.toUpperCase()}${description.slice(1)}. */`,
    `export const STEP_${number}: Step = {`,
    `  number: ${number},`,
    `  description: ${JSON.stringify(description)},`,
    "  statements: [",
    ...lines,
    "  ],",
    "};",
    "",
  ].join("\n");
}

const description = process.argv[2];
if (description === undefined) throw new Error("say what the step changes, in a few words");

const statements = await generateSQLiteMigration(await generateSQLiteDrizzleJson(await declaredAtLastCommit()), await generateSQLiteDrizzleJson(declared));
if (statements.length === 0) throw new Error("the schema is declared as the last commit declares it: there is nothing to draft");

const number = STEPS.length + 1;
const name = `${String(number).padStart(4, "0")}-${description.toLowerCase().replace(/[^a-z0-9]+/g, "-")}.ts`;
writeFileSync(join(STEPS_FOLDER, name), stepFile(number, description, statements), { flag: "wx" });
console.log(`drafted ${name}: ${statements.length} statement(s). Read it, then list it in registry.ts`);
