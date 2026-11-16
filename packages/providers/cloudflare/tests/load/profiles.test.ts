// The load run: every scenario measured at each size of the profile the run was started with, on an install filled to that size.
// Drift: a request whose cost should not depend on how much an install holds starts to read a row a site, and no test of one small install sees it: it passes every budget and stops an install of thousands.

import { describe, expect, inject, test } from "vitest";
import { FULL, type Profile, SLICE, SLICE_CEILINGS } from "../../load/profiles";
import type { LoadLine } from "../../load/report";
import { measureAt, type Scenario } from "./support/measure";
import { REFUSAL_SCENARIOS } from "./support/refusals";
import { PUBLISH_SCENARIOS } from "./support/scenarios-publish";
import { SCREEN_SCENARIOS } from "./support/scenarios-screens";
import { SERVE_SCENARIOS } from "./support/scenarios-serve";
import { UPKEEP_SCENARIOS } from "./support/scenarios-upkeep";

/** The profile of this run: the full one where the run was started as `bun run load`, else the slice. */
const PROFILE: Profile = inject("loadProfile") === "full" ? FULL : SLICE;

/** Every scenario, in the order a report lists them. */
const SCENARIOS: readonly Scenario[] = [...SERVE_SCENARIOS, ...SCREEN_SCENARIOS, ...PUBLISH_SCENARIOS, ...UPKEEP_SCENARIOS, ...REFUSAL_SCENARIOS];

/** The counts a ceiling holds. */
const COUNTS = ["queries", "read", "written", "bucket"] as const;

/** What the scenarios measured so far grew by between the run's two largest sizes, by the scenario's name: one entry a count that grew. */
const GROWN = new Map<string, readonly string[]>();

declare module "vitest" {
  interface ProvidedContext {
    /** Which profile the run was started with. */
    loadProfile: "slice" | "full";
  }
}

/** What of a line is over its scenario's ceiling at the slice's largest size, one entry a count. */
function overCeiling(line: LoadLine): string[] {
  const most = SLICE_CEILINGS[line.scenario];
  if (most === undefined) return [`no ceiling: add ${JSON.stringify(line.scenario)}: ${JSON.stringify(Object.fromEntries(COUNTS.map((count) => [count, line.once[count]])))}`];

  return COUNTS.filter((count) => line.once[count] > most[count]).map((count) => `${line.scenario} at ${line.size} ${line.axis}: ${count} ${line.once[count]}, over ${most[count]}`);
}

/** How many requests of a line's row, and then of its burst, its scenario's limit refuses: all but the ones the limit still had room for after the requests before them. */
function refusedOf(scenario: Scenario, line: LoadLine): readonly [row: number, burst: number] {
  if (scenario.refusal === undefined) return [0, 0];

  const inRow = Math.min(line.row.asked, scenario.refusal.after - 1);
  const atOnce = Math.min(line.burst.asked, scenario.refusal.after - 1 - inRow);

  return [line.row.asked - inRow, line.burst.asked - atOnce];
}

/** What grew between two sizes of a scenario, one entry a count. */
function grown(first: LoadLine, last: LoadLine): string[] {
  return COUNTS.filter((count) => last.once[count] > first.once[count]).map((count) => `${last.scenario}: ${count} ${first.once[count]} at ${first.size} ${first.axis}, ${last.once[count]} at ${last.size}`);
}

describe(`load: the ${PROFILE.name} run`, () => {
  test.for(SCENARIOS)("$name", async (scenario, { task }) => {
    const lines: LoadLine[] = [];
    task.meta.load = lines;
    for (const size of PROFILE.sizes[scenario.axis]) lines.push(await measureAt(scenario, PROFILE, size));

    const failed = lines.filter((line) => line.row.failed + line.burst.failed > 0).map((line) => `${line.scenario} at ${line.size} ${line.axis}: ${line.failure}`);
    expect(failed).toEqual([]);
    // A limit that refuses no request it should, or one it should not, is told here: a refusal in other words is a failure above.
    expect(lines.map((line) => [line.row.refused, line.burst.refused])).toEqual(lines.map((line) => refusedOf(scenario, line)));
    // The full run is read as its report; the slice is held to what it costs today.
    if (PROFILE.name === "full") return;

    const [before, last] = [lines.at(-2), lines.at(-1)];
    if (before === undefined || last === undefined) throw new Error("the profile holds fewer than two sizes for the scenario");

    GROWN.set(scenario.name, grown(before, last));
    const unexpected = scenario.flat && scenario.known === undefined ? grown(before, last) : [];
    expect([...unexpected, ...overCeiling(last)]).toEqual([]);
  });

  // Drift: a scenario marked as known to grow stays marked after it was made flat, so the list of what is left to fix lies.
  test.skipIf(PROFILE.name === "full")("a scenario marked as known to grow should be flat, and still grows", () => {
    const known = SCENARIOS.filter((scenario) => scenario.known !== undefined);

    expect(known.filter((scenario) => !scenario.flat || GROWN.get(scenario.name)?.length === 0).map((scenario) => scenario.name)).toEqual([]);
  });

  // Drift: a ceiling whose scenario was renamed or removed holds nothing, and reads as if it did.
  test("every ceiling of the slice is a scenario's", () => {
    expect(Object.keys(SLICE_CEILINGS).sort()).toEqual(SCENARIOS.map((scenario) => scenario.name).sort());
  });
});
