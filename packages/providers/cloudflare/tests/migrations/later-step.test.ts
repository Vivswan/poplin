// The later step is added to a checkout as a step of the product is: the last step of the file of the older build's version, which is made and listed where the checkout has none.
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

/** The version of this repository's last file of steps, and one above every file it holds. */
const [HELD, ABOVE] = [STEPS.at(-1)?.version ?? "", "999.0.0"] as const;

/** Reads the imports of a file that load a module; an import of types alone loads none. */
const SCANNER = new Bun.Transpiler({ loader: "ts" });

/** A tree that holds this repository's own steps, removed when it leaves its scope. */
function checkout(): ReturnType<typeof mkdtempDisposableSync> {
  const tree = mkdtempDisposableSync(join(tmpdir(), "poplin-later-step-"));
  cpSync(OWN_STEPS, join(tree.path, STEPS_FOLDER), { recursive: true });

  return tree;
}

describe("the later step of a live upgrade", () => {
  // Drift: a step the registry of the checkout does not list is never applied, and one that borrows a value or stands before a step of the product is no step as the product writes them.
  test.each([
    ["a version the checkout has a file of", HELD, []],
    ["a version the checkout has no file of", ABOVE, [`${ABOVE}.ts`]],
  ] as const)("a checkout is given it as the last step of %s: a step that holds its statements itself, in a file the registry lists", async (_name, version, made) => {
    using tree = checkout();
    const step = addLaterStep(tree.path, version);
    const folder = join(tree.path, STEPS_FOLDER);
    const registry: { readonly STEPS: readonly Step[] } = await import(join(folder, "registry.ts"));

    expect(readdirSync(folder).filter((file) => !readdirSync(OWN_STEPS).includes(file))).toEqual([...made]);
    expect(SCANNER.scan(readFileSync(join(folder, `${version}.ts`), "utf8")).imports).toEqual([]);
    expect([registry.STEPS, step, isLaterStep(registry.STEPS.at(-1))]).toEqual([[...STEPS, laterStep(version)], laterStep(version), true]);
  });

  // Drift: a second step of the same statements would fail on the table the first one made, as the Worker of the upgrade starts.
  test("a checkout that holds it already is refused, and is left as it was", () => {
    using tree = checkout();
    addLaterStep(tree.path, HELD);
    const file = join(tree.path, STEPS_FOLDER, `${HELD}.ts`);
    const held = readFileSync(file, "utf8");

    expect(() => addLaterStep(tree.path, HELD)).toThrow("holds a step named upgrade-proof already");
    expect(readFileSync(file, "utf8")).toBe(held);
  });

  // Drift: the step is for the checkout of an upgrade alone. One a commit holds would run on every install of the next release.
  test("no step of this repository is the later step", () => {
    expect(STEPS.filter((step) => isLaterStep(step) || step.name === laterStep(HELD).name)).toEqual([]);
  });
});
