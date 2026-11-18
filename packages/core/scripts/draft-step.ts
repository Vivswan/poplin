// Drafts the next step: the statements that take the schema as the last commit declares it to the schema as `database/schema.ts` declares it now.
//
//   bun run --cwd packages/core draft-step "add a pinned flag to sites"     adds the step `add-a-pinned-flag-to-sites` to src/migrations/<version>.ts
//
// The version is the one of the newest release tag among the ancestors of the checkout, which the step migrates away from; 0.0.0 before the first release.
// A draft is read before it is kept. What a declaration cannot say is added by hand: STRICT, WITHOUT ROWID, and every trigger.

import { execFileSync } from "node:child_process";
import { rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { generateSQLiteDrizzleJson, generateSQLiteMigration } from "drizzle-kit/api";

import * as declared from "../src/database/schema";
import { addStep, stepName } from "./step-file";

/** The folder of the steps, where a draft is written. */
const STEPS_FOLDER = join(import.meta.dir, "../src/migrations");

/** The folder of the declared schema, where the last commit's copy is put for as long as it is read: its imports resolve from there. */
const SCHEMA_FOLDER = join(import.meta.dir, "../src/database");

/** The declared schema, as git names it from the root of the repository. */
const SCHEMA_IN_GIT = "packages/core/src/database/schema.ts";

/** The tag of a release: `v` and a version with nothing after it. */
const RELEASE_TAG = /^v\d+\.\d+\.\d+$/;

/** The version the steps are written against before any release has a tag. */
const FIRST_VERSION = "0.0.0";

/** How a rebuilt table shows in a draft: its copy under a new name. */
const REBUILT = "__new_";

/** What a draft that rebuilds a table says under its first line. */
const REBUILT_NOTE = "// This draft rebuilds a table. A rebuilt table loses its triggers, STRICT, and WITHOUT ROWID, and dropping it removes the rows that refer to it: write this step by hand.";

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

/**
 * The version a new step migrates away from: the highest `vX.Y.Z` tag among the ancestors of the checkout. The tags are asked, never a manifest: on the pull request of a release that already names the version being cut.
 *
 * @throws {Error} the checkout is shallow: its tags are not there to ask
 */
function currentVersion(): string {
  const git = (args: readonly string[]): string => execFileSync("git", [...args], { cwd: import.meta.dir, encoding: "utf8" });
  if (git(["rev-parse", "--is-shallow-repository"]).trim() === "true") throw new Error("this is a shallow checkout, which holds no release tag: fetch the history (`git fetch --unshallow --tags`)");

  const tags = git(["tag", "--merged", "HEAD", "--list", "v*"]).split("\n");
  const [newest] = tags.filter((tag) => RELEASE_TAG.test(tag)).sort((one, other) => Bun.semver.order(other.slice(1), one.slice(1)));

  return newest?.slice(1) ?? FIRST_VERSION;
}

const description = process.argv[2];
if (description === undefined) throw new Error("say what the step changes, in a few words");

const drafted = await generateSQLiteMigration(await generateSQLiteDrizzleJson(await declaredAtLastCommit()), await generateSQLiteDrizzleJson(declared));
if (drafted.length === 0) throw new Error("the schema is declared as the last commit declares it: there is nothing to draft");

const statements = drafted.map((statement) => statement.replace(/;\s*$/, ""));
const step = { name: stepName(description), description, by: "install", statements } as const;
const file = addStep(STEPS_FOLDER, currentVersion(), step, statements.some((statement) => statement.includes(REBUILT)) ? [REBUILT_NOTE] : []);
console.log(`drafted the step ${step.name} in ${file}: ${statements.length} statement(s). Read it before it is kept`);
