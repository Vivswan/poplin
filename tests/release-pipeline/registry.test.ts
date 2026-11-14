/** Reading the registry's record: a malformed answer taken for an empty registry, or a wait that ends early, publishes blind. */

import { describe, expect, test } from "bun:test";
import { awaitVersion } from "../../.github/scripts/release-pipeline/await-version.js";
import type { Packument } from "../../.github/scripts/release-pipeline/records.js";
import { parsePackument } from "../../.github/scripts/release-pipeline/registry.js";
import { record } from "./fixture.js";

const VERSION = "2.1.1-main.2.20260913.gb2b2b2b";
const LAGGING = record(["2.1.0"], { latest: "2.1.0" });
const SHOWN = record(["2.1.0", VERSION], { latest: "2.1.0", next: VERSION });

/** A read that plays the steps in order, the last one repeated; an Error step is a read the registry failed. */
function scripted(steps: (Packument | null | Error)[]): { read: () => Promise<Packument | null>; count: () => number } {
  let reads = 0;

  return {
    count: () => reads,
    read: async () => {
      const step = steps[Math.min(reads, steps.length - 1)] ?? null;
      reads += 1;
      if (step instanceof Error) throw step;
      return step;
    },
  };
}

describe("parsePackument", () => {
  test.each<[string, unknown, string]>([
    ["an empty object", {}, "the registry's record of poplin is not a packument (an object with versions and dist-tags records)"],
    ["an array", [], "is not a packument"],
    ["versions as a list", { versions: ["2.1.0"], "dist-tags": {} }, "is not a packument"],
    ["no dist-tags", { versions: {} }, "is not a packument"],
    ["a dist-tag naming a non-string", { versions: {}, "dist-tags": { latest: 210 } }, "names dist-tag latest as 210, not a version"],
  ])("a 200 body that is %s is refused, not read as an empty registry", (_name, body, error) => {
    expect(() => parsePackument(body, "poplin")).toThrow(error);
  });
});

describe("awaitVersion", () => {
  test.each<[string, (Packument | null | Error)[], { reads: number } | null, number]>([
    ["shows on the first read", [SHOWN], { reads: 1 }, 1],
    ["lags two reads, then shows", [LAGGING, LAGGING, SHOWN], { reads: 3 }, 3],
    ["is 404, then shows", [null, SHOWN], { reads: 2 }, 2],
    ["fails twice, then shows: a failed read is one that did not show the version", [new Error("503"), new Error("503"), SHOWN], { reads: 3 }, 3],
    ["never shows within the bound", [LAGGING], null, 4],
    ["stays 404 within the bound", [null], null, 4],
    ["fails once, then lags to the bound", [new Error("503"), LAGGING], null, 4],
  ])("a record that %s", async (_name, steps, expected, reads) => {
    const registry = scripted(steps);
    const shown = await awaitVersion({ read: registry.read, version: VERSION, attempts: 4, delayMs: 0 });

    expect(shown === null ? null : { reads: shown.reads }).toEqual(expected);
    expect(registry.count()).toBe(reads);
  });

  test("a registry that fails every read stops the wait with the last failure, after the whole budget", async () => {
    const registry = scripted([new Error("the registry answered 503")]);

    await expect(awaitVersion({ read: registry.read, version: VERSION, attempts: 3, delayMs: 0 })).rejects.toThrow("the registry answered 503");
    expect(registry.count()).toBe(3);
  });
});
