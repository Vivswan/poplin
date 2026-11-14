// A caller chooses any run of changes, updates, and removals: a setting they leave out stays as it was, and a removed site leaves no file behind.

import { expect, spyOn } from "bun:test";
import fc from "fast-check";

import { deleteSite } from "../../packages/core/src/actions/delete";
import { publishSite } from "../../packages/core/src/actions/publish";
import { updateSite } from "../../packages/core/src/actions/set";
import { sweepExpired } from "../../packages/core/src/actions/sweep";
import { ADMIN, file, made, makeWorld, OWNER, pages } from "../../packages/core/tests/actions/support/actions-fixture";
import { fuzzTarget } from "./config";

/** The walks of the leftovers that empty the folder of a site of 40 files, of which one removal takes 15. */
const WALKS = 3;

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

/** Walk the leftovers from the first to the last, two a step. */
async function walkLeftovers(world: Awaited<ReturnType<typeof makeWorld>>): Promise<void> {
  let from: Parameters<typeof sweepExpired>[2]["from"] = { leftovers: true };

  while (from !== undefined) {
    const step = await sweepExpired(world.install, ADMIN, { limit: 2, from });
    from = step.ok ? step.next : undefined;
  }
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

property(
  "every file of a site removed for good is gone after enough walks of the sweep, whatever the store refused on the way, the answer says so only once it is true, and no file of a kept site goes",
  fc.asyncProperty(fc.array(fc.record({ files: fc.integer({ min: 1, max: 40 }), removed: fc.boolean(), storeDown: fc.boolean() }), { minLength: 1, maxLength: 4 }), async (sites) => {
    const world = await makeWorld();
    const list = world.install.store.list.bind(world.install.store);
    const ids: string[] = [];
    const kept: string[] = [];
    for (const [index, site] of sites.entries()) {
      const before = new Set(await world.keys());
      ids.push(await made(world, OWNER, `site-${index}`, { files: Array.from({ length: site.files }, (_, at) => file(at === 0 ? "index.html" : `page-${at}.html`, "page")) }));
      if (!site.removed) kept.push(...(await world.keys()).filter((key) => !before.has(key)));
    }

    // A list page of one object makes one removal reach 15 files, so a site of more needs the sweep.
    spyOn(world.install.store, "list").mockImplementation((options) => list({ ...options, limit: 1 }));

    for (const [index, site] of sites.entries()) {
      if (!site.removed) continue;

      const before = (await world.keys()).length;
      world.faults.failRemoval = site.storeDown;
      const removed = await deleteSite(world.install, OWNER, { site: ids[index] ?? "", forever: true });
      world.faults.failRemoval = false;

      expect(removed.ok && removed.left.length === 0).toBe(before - (await world.keys()).length === site.files);
    }

    for (let walks = 0; walks < WALKS; walks += 1) await walkLeftovers(world);

    expect([await world.keys(), await world.install.database.listLeftovers({ limit: 10 })]).toEqual([kept.sort(), { folders: [] }]);
  }),
);
