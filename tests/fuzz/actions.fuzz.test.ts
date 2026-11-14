// A caller chooses any run of changes to a site: a setting the changes leave out stays as it was.

import { expect } from "bun:test";
import fc from "fast-check";

import { updateSite } from "../../packages/core/src/actions/set";
import { made, makeWorld, OWNER } from "../../packages/core/tests/actions/support/actions-fixture";
import { fuzzTarget } from "./config";

/** A change that names no public name. */
type Change = Omit<Parameters<typeof updateSite>[2], "site" | "public_name">;

const property = fuzzTarget(import.meta.file);

const changes: fc.Arbitrary<Change> = fc.record(
  {
    access: fc.constantFrom("private" as const, "unlisted" as const, "public" as const),
    title: fc.constantFrom("Q3 sales", "", null),
    search_engines: fc.boolean(),
    embeddable: fc.boolean(),
    expires: fc.constantFrom("never", "7d", "2031-01-01"),
  },
  { requiredKeys: [] },
);

property(
  "no run of changes that leaves the public name out moves a public site to another public name, and a site that goes public takes its own name",
  fc.asyncProperty(fc.array(changes, { minLength: 1, maxLength: 8 }), async (run) => {
    const world = await makeWorld();
    const id = await made(world, OWNER, "report", { access: "public", public_name: "docs" });
    let held: string | null = "docs";

    for (const change of run) {
      const changed = await updateSite(world.install, OWNER, { site: id, ...change });
      if (!changed.ok) {
        expect<unknown>([Object.keys(change), changed]).toEqual([[], { ok: false, code: "bad_argument", about: "settings" }]);
        continue;
      }

      if (change.access === "public") held ??= "report";

      if (change.access === "private" || change.access === "unlisted") held = null;

      expect(changed.site.public_name).toBe(held as never);
    }
  }),
);
