// A duplicate makes a new site from another's files over one or more calls: at no point may a copy share its source's id, folder, public name, or access, or be a site while a file of it is missing.

import { expect } from "bun:test";
import fc from "fast-check";

import { duplicateSite } from "../../packages/core/src/actions/duplicate";
import { publishSite } from "../../packages/core/src/actions/publish";
import { ADMIN, file, makeWorld, OWNER, type World } from "../../packages/core/tests/actions/support/actions-fixture";
import { fuzzTarget } from "./config";

const property = fuzzTarget(import.meta.file);

const sources = fc.record({
  access: fc.constantFrom("private", "unlisted", "public"),
  expires: fc.constantFrom("never", "1s", "7d"),
  pages: fc.integer({ min: 0, max: 7 }),
  copies: fc.integer({ min: 1, max: 4 }),
  calls: fc.integer({ min: 1, max: 12 }),
});

/** The files the store holds under each folder. */
async function filesByFolder(world: World): Promise<Map<string, number>> {
  const counts = new Map<string, number>();

  for (const key of await world.keys()) {
    const [folder = ""] = key.split("/");
    counts.set(folder, (counts.get(folder) ?? 0) + 1);
  }

  return counts;
}

property(
  "a copy is private under its own id and folder, and is a site only once it holds every file of its source",
  fc.asyncProperty(sources, async ({ access, expires, pages, copies, calls }) => {
    const world = await makeWorld();
    const files = [file("index.html", "<p>home</p>"), ...Array.from({ length: pages }, (_page, at) => file(`pages/${at}.html`, `<p>${at}</p>`))];
    const made = await publishSite(world.install, OWNER, { name: "report", access, expires, files });
    if (!made.ok) throw new Error(`the source was refused: ${made.code}`);

    const source = await world.install.database.getSite(made.site.id);
    let upload: string | undefined;

    for (let call = 0; call < calls; call += 1) {
      const step = await duplicateSite(world.install, ADMIN, upload === undefined ? { site: made.site.id } : { site: made.site.id, upload }, copies);
      if (!step.ok) throw new Error(`a step was refused: ${step.code}`);

      upload = step.copy.upload;
      const all = await world.install.database.listSites({ trash: false, limit: 100 });
      const others = all.sites.filter((site) => site.id !== made.site.id);
      const held = await filesByFolder(world);

      expect(others.length).toBe(step.site === null ? 0 : 1);
      for (const copy of others) {
        expect({ access: copy.access, expires: copy.expires, owner: copy.owner, live: copy.live_version }).toEqual({ access: "private", expires: "never", owner: ADMIN.holder, live: 1 });
        expect([copy.folder === source?.folder, held.get(copy.folder)]).toEqual([false, files.length]);
      }
    }

    expect(await world.install.database.getSite(made.site.id)).toEqual(source);
  }),
);
