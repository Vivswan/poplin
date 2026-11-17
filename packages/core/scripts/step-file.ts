// The file of a schema step, as every step of `src/migrations/` is written: its name, and its text.
//
//   0002-add-a-pinned-flag-to-sites.ts     the number, then what the step changes
//   export const STEP_2: Step = { ... }    the step, which holds its statements itself

import type { Step } from "../src/migrations/migrate";

/**
 * Name the file of a step.
 *
 * @returns the step's number in four digits, then its description in lower case with a hyphen for whatever is no letter and no digit
 */
export function stepFileName(step: Pick<Step, "number" | "description">): string {
  return `${String(step.number).padStart(4, "0")}-${step.description.toLowerCase().replace(/[^a-z0-9]+/g, "-")}.ts`;
}

/**
 * Write the file of a step, as text.
 *
 * @param notes - comment lines for whoever reads the file, under its first line
 */
export function stepFile(step: Step, notes: readonly string[] = []): string {
  return [
    `// Step ${step.number}: ${step.description}.`,
    ...notes,
    "",
    'import type { Step } from "./migrate";',
    "",
    `/** ${step.description[0]?.toUpperCase()}${step.description.slice(1)}. */`,
    `export const STEP_${step.number}: Step = {`,
    `  number: ${step.number},`,
    `  description: ${JSON.stringify(step.description)},`,
    "  statements: [",
    ...step.statements.map((statement) => `    ${JSON.stringify(statement)},`),
    "  ],",
    "};",
    "",
  ].join("\n");
}
