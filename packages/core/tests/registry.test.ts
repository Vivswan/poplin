import { describe, expect, test } from "bun:test";

import { REGISTRY } from "../src/migrations/registry";
import { dueSteps } from "../src/migrations/upgrade";
import { SETTINGS } from "../src/records/settings";
import { SITE } from "../src/records/site";
import { TOKEN } from "../src/records/token";

describe("REGISTRY", () => {
  test("drift: a record kind whose shape number goes up without its step would refuse every record already stored", () => {
    const reachable = [SETTINGS, SITE, TOKEN].map((kind) => [kind.name, dueSteps(REGISTRY[kind.name] ?? [], { from: 1, to: kind.shape }).ok]);

    expect(reachable).toEqual([
      ["settings", true],
      ["site", true],
      ["token", true],
    ]);
  });
});
