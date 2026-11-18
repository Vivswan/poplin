// Drift: a step that needs an account token is one an update leaves undone. A release that ships one with no sentence for its users leaves installs half updated, and nobody is told to press Repair.

import { describe, expect, test } from "bun:test";

import { noticeFaults } from "../../../migrations/steps/notices";
import { type ProviderStep, type ProviderVersionSteps, VERSIONS } from "../../../migrations/steps/registry";

/** A change that is made to no effect. */
const run: ProviderStep["run"] = async () => ({ ok: true, value: undefined });

/** A notice a person can act on. */
const TOLD = "Press Repair on the Domain screen: the install's key needs one more permission, which only an account token can give it.";

/** A step that needs an account token, with a notice. */
function tokenStep(name: string, notice: string): ProviderStep {
  return { name, description: "give the key one more permission", by: "account token", notice, run };
}

/** Two files of steps: an older one with a step the install does by itself, and a newer one with a step of each kind. */
const FILES: readonly ProviderVersionSteps[] = [
  { version: "0.1.0", steps: [{ name: "rename-the-alert", description: "rename the budget alert", by: "install", run }] },
  { version: "0.2.0", steps: [tokenStep("widen-the-key", TOLD), { name: "tidy-a-route", description: "remove a stale route", by: "install", run }] },
];

describe("the notices of the steps that need an account token", () => {
  test("this build's own steps: each that needs an account token carries a sentence that names Repair", () => {
    expect(noticeFaults(VERSIONS)).toEqual([]);
  });

  test.each([
    ["a sentence that names Repair", TOLD, []],
    ["no notice", "", ["0.2.0/widen-the-key: its notice is no single sentence", "0.2.0/widen-the-key: its notice does not name Repair"]],
    ["words that are no sentence", "press Repair", ["0.2.0/widen-the-key: its notice is no single sentence"]],
    ["two lines", "Press Repair.\nIt gives the key a permission.", ["0.2.0/widen-the-key: its notice is no single sentence"]],
    ["two sentences on one line", "Press Repair. It gives the key a permission.", ["0.2.0/widen-the-key: its notice is no single sentence"]],
    ["a question before the sentence", "Need another permission? Press Repair.", ["0.2.0/widen-the-key: its notice is no single sentence"]],
    ["a word that only holds Repair", "The Repairman gives the key a permission.", ["0.2.0/widen-the-key: its notice does not name Repair"]],
    ["a sentence that does not say what to press", "The key needs one more permission.", ["0.2.0/widen-the-key: its notice does not name Repair"]],
  ])("a step that needs an account token with %s", (_what, notice, faults) => {
    expect(noticeFaults([{ version: "0.2.0", steps: [tokenStep("widen-the-key", notice)] }])).toEqual(faults);
  });

  test("a step the install does by itself needs no notice, beside one that needs an account token and carries its sentence", () => {
    expect(noticeFaults(FILES)).toEqual([]);
  });
});
