import { describe, expect, test } from "bun:test";

import { dueSteps, upgrade } from "../src/migrations/upgrade";
import { ADD_TAGS, BROKEN_TAGS, RENAME_TEXT } from "./note-kind";

const STEPS = [RENAME_TEXT, ADD_TAGS];

describe("dueSteps", () => {
  // Drift: a step picked out of order, twice, or past the current shape would rewrite records into a shape no schema states.
  test.each([
    [{ from: 1, to: 3 }, { ok: true, steps: [RENAME_TEXT, ADD_TAGS] }],
    [{ from: 2, to: 3 }, { ok: true, steps: [ADD_TAGS] }],
    [{ from: 1, to: 2 }, { ok: true, steps: [RENAME_TEXT] }],
    [{ from: 3, to: 3 }, { ok: true, steps: [] }],
    [{ from: 4, to: 3 }, { ok: true, steps: [] }],
    [{ from: 1, to: 4 }, { ok: false, missing: 3 }],
    [{ from: 0, to: 3 }, { ok: false, missing: 0 }],
  ])("picks exactly the steps of %j", (span, outcome) => {
    expect<unknown>(dueSteps(STEPS, span)).toEqual(outcome);
    expect<unknown>(dueSteps([ADD_TAGS, RENAME_TEXT], span)).toEqual(outcome);
  });
});

describe("upgrade", () => {
  test("drift: the runner, not each step, moves the stamp, so a step that forgets it cannot leave a record claiming its old shape", () => {
    const old = { shape: 1, revision: 4, text: "milk" };

    expect<unknown>(upgrade(old, { from: 1, to: 3 }, STEPS)).toEqual({
      ok: true,
      fields: { shape: 3, revision: 4, title: "milk", tags: [] },
      applied: ["rename text to title", "add an empty tag list"],
    });
    expect(old).toEqual({ shape: 1, revision: 4, text: "milk" });
  });

  test("drift: a step that throws must name itself and hand back nothing, or a half-run record could be stored", () => {
    expect<unknown>(upgrade({ shape: 1, revision: 4, text: "milk" }, { from: 1, to: 3 }, [RENAME_TEXT, BROKEN_TAGS])).toEqual({
      ok: false,
      refusal: { reason: "step-failed", from: 2, description: "add an empty tag list", message: "the tag list is unknown" },
    });
  });
});
