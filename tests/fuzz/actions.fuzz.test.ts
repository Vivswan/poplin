// A caller chooses any run of changes and updates to a site: a setting they leave out stays as it was.

import { expect } from "bun:test";
import fc from "fast-check";

import { publishSite } from "../../packages/core/src/actions/publish";
import { updateSite } from "../../packages/core/src/actions/set";
import { made, makeWorld, OWNER, pages } from "../../packages/core/tests/actions/support/actions-fixture";
import { fuzzTarget } from "./config";

/** A change that names no public name. */
type Change = Omit<Parameters<typeof updateSite>[2], "site" | "public_name">;

/** One step of a site's life as its title sees it: a publish onto the site with the title its page has, or a change of settings when `page` is absent. `typed` is the title asked with either. */
interface TitleStep {
  readonly page?: string;
  readonly typed?: string | null;
}

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

const titleSteps: fc.Arbitrary<TitleStep> = fc.oneof(
  fc.record({ typed: fc.constantFrom("Q3 sales", "Q4 sales", "", null) }),
  fc.record({ page: fc.constantFrom("Field notes", "Second page", ""), typed: fc.constantFrom("Q3 sales", "Q4 sales", "", null) }, { requiredKeys: ["page"] }),
);

/** Take one step and answer the title the site then shows, with whether it is the typed one. */
async function titleAfter(world: Awaited<ReturnType<typeof makeWorld>>, id: string, step: TitleStep): Promise<unknown> {
  const title = step.typed === undefined ? {} : { title: step.typed };
  const done =
    step.page === undefined
      ? await updateSite(world.install, OWNER, { site: id, ...title })
      : await publishSite(world.install, OWNER, { files: pages("next"), site: id, page_title: step.page, ...title });
  if (!done.ok) throw new Error(`a step was refused: ${done.code}`);

  return [done.site.title, done.site.title_typed];
}

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

property(
  "a site shows the title typed last until it is taken away, and the title of its page otherwise, whatever run of updates and changes it went through",
  fc.asyncProperty(fc.array(titleSteps, { minLength: 1, maxLength: 8 }), async (run) => {
    const world = await makeWorld();
    const id = await made(world, OWNER, "report", { page_title: "First page" });
    let typed: string | null = null;
    let page: string | null = "First page";

    for (const step of run) {
      if (step.typed !== undefined) typed = step.typed === "" ? null : step.typed;

      if (step.page !== undefined) page = step.page === "" ? null : step.page;

      expect(await titleAfter(world, id, step)).toEqual([typed ?? page, typed !== null]);
    }
  }),
);
