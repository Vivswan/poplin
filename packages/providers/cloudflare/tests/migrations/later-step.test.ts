// The later step is written into a checkout as a step of the product is: a file of its own beside the others, listed in the registry, numbered one above the last.
// Without it a step the registry does not list, or lists in another form, first shows as an upgrade that applied no step on a test account.

import { describe, expect, test } from "bun:test";
import { cpSync, mkdtempDisposableSync, readdirSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { Step } from "../../../../core/src/migrations/migrate";
import { STEPS } from "../../../../core/src/migrations/registry";
import { addLaterStep, isLaterStep, laterStep } from "../../migrations/later-step";

/** The folder of the product's steps, from the root of a tree. */
const STEPS_FOLDER = join("packages", "core", "src", "migrations");

/** This repository's own steps. */
const OWN_STEPS = join(import.meta.dir, "..", "..", "..", "..", "..", STEPS_FOLDER);

/** The file of a step, as the guard of the frozen steps and core's own registry test name it. */
const STEP_FILE = /^(\d{4})-[a-z0-9-]+\.ts$/;

/** Reads the imports of a file that load a module; an import of types alone loads none. */
const SCANNER = new Bun.Transpiler({ loader: "ts" });

/** A tree that holds this repository's own steps, removed when it leaves its scope. */
function checkout(): ReturnType<typeof mkdtempDisposableSync> {
  const tree = mkdtempDisposableSync(join(tmpdir(), "poplin-later-step-"));
  cpSync(OWN_STEPS, join(tree.path, STEPS_FOLDER), { recursive: true });

  return tree;
}

describe("the later step of a live upgrade", () => {
  // Drift: a step the registry of the checkout does not list is never applied, and one that borrows a value or is misnumbered is no step as the product writes them.
  test("a checkout is given it as the next step of the product: one file that holds its statements itself, listed last in the registry", async () => {
    using tree = checkout();
    const step = addLaterStep(tree.path);
    const folder = join(tree.path, STEPS_FOLDER);
    const added = readdirSync(folder).filter((file) => STEP_FILE.test(file) && !readdirSync(OWN_STEPS).includes(file));
    const registry: { readonly STEPS: readonly Step[] } = await import(join(folder, "registry.ts"));

    expect(added).toEqual([`${String(STEPS.length + 1).padStart(4, "0")}-add-the-upgrade-proof.ts`]);
    expect(SCANNER.scan(readFileSync(join(folder, added[0] ?? ""), "utf8")).imports).toEqual([]);
    expect([registry.STEPS, step, isLaterStep(registry.STEPS.at(-1))]).toEqual([[...STEPS, laterStep(STEPS.length + 1)], laterStep(STEPS.length + 1), true]);
  });

  // Drift: a second step of the same statements would fail on the table the first one made, as the Worker of the upgrade starts.
  test("a checkout that holds it already is refused, and is left as it was", () => {
    using tree = checkout();
    addLaterStep(tree.path);
    const held = readdirSync(join(tree.path, STEPS_FOLDER));

    expect(() => addLaterStep(tree.path)).toThrow("holds the later step already");
    expect(readdirSync(join(tree.path, STEPS_FOLDER))).toEqual(held);
  });

  // Drift: the step is for the checkout of an upgrade alone. One a commit holds would run on every install of the next release.
  test("no step of this repository is the later step", () => {
    expect([STEPS.filter((step) => isLaterStep(step)), readdirSync(OWN_STEPS).filter((file) => file.includes("upgrade-proof"))]).toEqual([[], []]);
  });
});
