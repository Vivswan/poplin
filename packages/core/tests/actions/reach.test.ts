import { describe, expect, test } from "bun:test";

import { deleteSite } from "../../src/actions/delete";
import { newLink } from "../../src/actions/new-link";
import { publishSite } from "../../src/actions/publish";
import { restoreSite } from "../../src/actions/restore";
import { rollbackSite } from "../../src/actions/rollback";
import { updateSite } from "../../src/actions/set";
import { getSite } from "../../src/actions/show";
import type { Actor } from "../../src/auth/scopes";
import { openDatabase } from "../../src/database/open";
import { ADMIN, made, makeWorld, NOW, OWNER, pages, STRANGER, type World } from "./support/actions-fixture";
import { BunSqliteDriver } from "../database/support/bun-sqlite-driver";

type Answer = { readonly ok: boolean; readonly code?: string };

/** One action on a site: what must be true of the site first, the action, and the audit entry it writes when it is done. */
type ActionRow = readonly [action: string, prepare: "nothing" | "a second version" | "the trash", run: (world: World, actor: Actor, site: string) => Promise<Answer>, entry: readonly string[]];

const ACTIONS: readonly ActionRow[] = [
  ["publish onto it", "nothing", (world, actor, site) => publishSite(world.install, actor, { files: pages("next"), site }), ["publish"]],
  ["set its title", "nothing", (world, actor, site) => updateSite(world.install, actor, { site, title: "Q3 sales" }), ["details"]],
  ["set its access", "nothing", (world, actor, site) => updateSite(world.install, actor, { site, access: "unlisted" }), ["access"]],
  ["show it", "nothing", (world, actor, site) => getSite(world.install, actor, site), []],
  ["roll it back", "a second version", (world, actor, site) => rollbackSite(world.install, actor, { site }), ["live_version"]],
  ["give it a new link", "nothing", (world, actor, site) => newLink(world.install, actor, site), ["new_id"]],
  ["delete it", "nothing", (world, actor, site) => deleteSite(world.install, actor, { site }), ["trash"]],
  ["delete it for good", "nothing", (world, actor, site) => deleteSite(world.install, actor, { site, no_trash: true }), ["delete"]],
  ["restore it", "the trash", (world, actor, site) => restoreSite(world.install, actor, site), ["restore"]],
];

async function prepared(prepare: ActionRow[1], access: "private" | "public"): Promise<{ world: World; id: string }> {
  const world = await makeWorld();
  const id = await made(world, OWNER, "report", { access });
  if (prepare === "a second version") await publishSite(world.install, OWNER, { files: pages("second"), site: id });
  if (prepare === "the trash") await deleteSite(world.install, OWNER, { site: id });

  return { world, id };
}

describe("reachSite", () => {
  // Drift: this is the whole promise of who may touch a site, on every action at once; an action that skipped the check would let one agent rewrite another's work.
  describe.each(ACTIONS)("to %s", (_action, prepare, run, entry) => {
    test.each([
      ["an admin", ADMIN],
      ["the publisher that made it", OWNER],
    ] as const)("%s may, and the change writes exactly one audit entry", async (_who, actor) => {
      const { world, id } = await prepared(prepare, "private");
      const audit = await world.audit();

      expect(await run(world, actor, id)).toMatchObject({ ok: true });
      expect(await world.audit()).toEqual([...audit, ...entry]);
    });

    // Drift: a label is copied from a publish made before a rename, or typed with the wrong name; an action that compared the name would answer its own site not_found.
    test("the publisher that made it may under a label that carries another name before the site's id", async () => {
      const { world, id } = await prepared(prepare, "private");
      const audit = await world.audit();

      expect(await run(world, OWNER, `draft--${id}`)).toMatchObject({ ok: true });
      expect(await world.audit()).toEqual([...audit, ...entry]);
    });

    test.each([
      ["private", "not_found"],
      ["public", prepare === "the trash" ? "not_found" : "not_allowed"],
    ] as const)("another publisher may not: a %s site answers %s, and nothing of it changes", async (access, code) => {
      const { world, id } = await prepared(prepare, access);
      const before = [await getSite(world.install, ADMIN, id), await world.keys(), await world.audit()];

      expect(await run(world, STRANGER, id)).toEqual({ ok: false, code });
      expect([await getSite(world.install, ADMIN, id), await world.keys(), await world.audit()]).toEqual(before);
    });
  });

  // Drift: a reference is typed by people and agents in three forms; one read loosely would act on the wrong site.
  test("a site answers to its label whatever name the label carries, its bare id, and its public name while public, and to nothing else", async () => {
    const world = await makeWorld();
    const id = await made(world, OWNER, "report");
    const other = await made(world, OWNER, "budget0000000", { access: "public", public_name: "abcdefghijkl" });
    const found = { ok: true, site: { id } };

    const answers = [];
    for (const reference of [`report--${id}`, id, "abcdefghijkl", "report", `budget--${id}`, "zzzzzzzzzzzz", `Report--${id}`, "docs-p", ""]) {
      answers.push(await getSite(world.install, OWNER, reference));
    }

    expect(answers).toMatchObject([
      found,
      found,
      { ok: true, site: { id: other } },
      { ok: false, code: "not_found" },
      found,
      { ok: false, code: "not_found" },
      { ok: false, code: "bad_argument", about: "site" },
      { ok: false, code: "not_found" },
      { ok: false, code: "bad_argument", about: "site" },
    ]);
  });

  // Drift: before setup there are no settings to act under; an action that went on would publish with no limits.
  test("a show and a publish, the ways in with and without a site, are refused before the install is set up", async () => {
    const opened = await openDatabase(new BunSqliteDriver(), NOW);
    if (opened.kind !== "open") throw new Error("the fixture database did not open");

    const install = { ...(await makeWorld()).install, database: opened.database };

    expect(await getSite(install, ADMIN, "zzzzzzzzzzzz")).toEqual({ ok: false, code: "not_set_up" });
    expect(await publishSite(install, ADMIN, { files: pages("x"), name: "report" })).toEqual({ ok: false, code: "not_set_up" });
  });
});
