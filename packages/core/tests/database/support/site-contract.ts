// The part of the database contract about sites: the sites themselves, their versions and what each holds, their sizes, and export and import.

import { describe, expect, test } from "bun:test";

import type { Database, NewSite, Signed, SitesPage, SitesQuery } from "../../../src/database/database";
import type { PublicName, SiteName } from "../../../src/names/names";
import { mintSiteFolder, type Site } from "../../../src/records/site";
import type { SiteId } from "../../../src/sites/ids";
import {
  ADA,
  BO,
  BY_ADA,
  DOCS,
  type DatabaseFactory,
  NOTHING,
  NOW,
  NO_SITE,
  REPORT,
  auditActions,
  auditDetails,
  auditTrail,
  begunSite,
  begunVersion,
  draft,
  everySite,
  everything,
  made,
  mintFrom,
  opened,
  pagedNames,
  publish,
  SIZE,
  sizeOf,
  storedBack,
} from "./database-fixtures";

export function sites(label: string, makeDatabase: DatabaseFactory): void {
  describe(`${label}: sites`, () => {
    // Drift: a name is a label and the id is the key; a unique name would refuse the second "report" anyone publishes.
    test("two sites with one name coexist under different ids, each found by its own id alone", async () => {
      const database = await opened(makeDatabase);
      const first = await made(database, draft(REPORT));
      const second = await made(database, draft(REPORT));

      expect([first.name, second.name, first.id === second.id]).toEqual([REPORT, REPORT, false]);
      expect([await database.getSite(first.id), await database.getSite(second.id)]).toEqual([first, second]);
      expect(first).toEqual({
        id: first.id,
        name: REPORT,
        folder: first.folder,
        title: null,
        page_title: null,
        search_engines: false,
        embeddable: true,
        expires: "never",
        live_version: 1,
        versions: [{ number: 1, published_at: NOW, published_by: ADA, ...SIZE }],
        owner: ADA,
        created_at: NOW,
        updated_at: NOW,
        access: "private",
        state: "live",
      });
    });

    // Drift: a draft the types forbid still arrives from a request body; stored, it would be a site no read could turn back into a site.
    test.each([
      ["public access and no public name", (site: NewSite): unknown => ({ ...site, access: "public" })],
      ["an access that is none of the three", (site: NewSite): unknown => ({ ...site, access: "secret" })],
      ["a name that is no site name", (site: NewSite): unknown => ({ ...site, name: "No Such Name" })],
      ["a folder that is no folder key", (site: NewSite): unknown => ({ ...site, folder: "elsewhere" })],
      ["an empty title", (site: NewSite): unknown => ({ ...site, title: "" })],
      ["an expiry that is no moment", (site: NewSite): unknown => ({ ...site, expires: -1 })],
    ] as const)("a draft with %s is refused by a throw, and nothing is stored", async (_case, change) => {
      const database = await opened(makeDatabase);

      await expect(database.createSite(change(draft(REPORT)) as NewSite, BY_ADA)).rejects.toThrow();
      expect(await everything(database)).toEqual([[], [], NOTHING]);
    });

    // Drift: a folder holds one site's files; a second site in it would serve the first one's files and take them along when it is deleted.
    test("a folder that is a site's is refused to a new site by a throw and to an import with folder_taken, whatever became of that site, until it is deleted", async () => {
      const database = await opened(makeDatabase);
      const holder = await made(database, draft(REPORT));
      await made(database, draft(DOCS, "public"));
      const squatter = { ...draft(REPORT), folder: holder.folder };
      const refused = async (): Promise<void> => {
        const before = await everything(database);

        await expect(database.createSite(squatter, BY_ADA)).rejects.toThrow();
        expect(await storedBack(database, { ...holder, id: NO_SITE })).toEqual({ kind: "folder_taken" });
        expect(await everything(database)).toEqual(before);
      };

      await refused();
      const moved = await database.giveNewId(holder.id, BY_ADA);
      const id = moved.kind === "done" ? moved.site.id : holder.id;
      await refused();
      await database.trashSite(id, BY_ADA);
      await refused();

      expect([id === holder.id, (await database.getSite(id))?.folder]).toEqual([false, holder.folder]);
      expect(await database.createSite({ ...squatter, access: "public", public_name: DOCS }, BY_ADA)).toEqual({ kind: "name_taken" });
      await database.deleteSite(id, BY_ADA);
      expect((await database.createSite(squatter, BY_ADA)).kind).toBe("done");
    });

    // Drift: an id that is taken, as an id or as a public name, must cost a second draw and never a failed publish or a shadowed address.
    test("a candidate id that is a site's id or a site's public name is drawn again, for a new site and for a new id", async () => {
      const database = await opened(
        makeDatabase,
        mintFrom("aaaaaaaaaaaa", "aaaaaaaaaaaa", "cccccccccccc", "bbbbbbbbbbbb", "cccccccccccc", "dddddddddddd", "aaaaaaaaaaaa", "cccccccccccc", "dddddddddddd", "eeeeeeeeeeee"),
      );
      const first = await made(database, draft(REPORT));
      const second = await made(database, draft(REPORT, "public", "cccccccccccc" as PublicName));
      const third = await made(database, draft(DOCS));
      const moved = await database.giveNewId(third.id, BY_ADA);

      expect<unknown>([first.id, second.id, third.id, moved.kind === "done" ? moved.site.id : moved.kind]).toEqual([
        "aaaaaaaaaaaa",
        "bbbbbbbbbbbb",
        "dddddddddddd",
        "eeeeeeeeeeee",
      ]);
      expect(await auditActions(database)).toEqual(["create", "create", "create", "new_id"]);
      expect(await database.getSite("aaaaaaaaaaaa" as SiteId)).toEqual(first);
    });

    // Drift: a page that names many sites asks for all of them at once, and one invocation has a fixed count of queries; a lookup that dropped the trash, kept an old name, or made up a deleted site would mislabel the log.
    test("the names of many sites are read at once: the name each has now and the title it is listed under, the typed one before its page's own, the trash included, and nothing for an id that is no site's", async () => {
      const database = await opened(makeDatabase);
      const kept = await made(database, { ...draft(REPORT), page_title: "The page's own" });
      const renamed = await made(database, draft(REPORT));
      const trashed = await made(database, { ...draft(REPORT), title: "Typed", page_title: "The page's own" });
      const deleted = await made(database, draft(REPORT));
      await database.changeDetails(renamed.id, { name: "notes" as SiteName }, BY_ADA);
      await database.trashSite(trashed.id, BY_ADA);
      await database.deleteSite(deleted.id, BY_ADA);

      const names = await database.getSiteNames([kept.id, renamed.id, trashed.id, deleted.id, NO_SITE, kept.id]);

      expect<unknown>([[...names].sort(), [...(await database.getSiteNames([]))]]).toEqual([
        [
          [kept.id, { name: REPORT, title: "The page's own" }],
          [renamed.id, { name: "notes", title: null }],
          [trashed.id, { name: REPORT, title: "Typed" }],
        ].sort(),
        [],
      ]);
    });

    // Drift: each id asked is a value bound to the statement, and a database binds only so many to one: the provider's takes 100. A read that let more through would fail there as an error of the engine, on a page of the log.
    test("the names of 100 ids are read at once, the sites among them named, and one id more is refused by a throw", async () => {
      const database = await opened(makeDatabase);
      const first = await made(database, draft(REPORT));
      const last = await made(database, draft(REPORT));
      const none = Array.from({ length: 99 }, (_none, index) => String(index).padStart(12, "0") as SiteId);
      const named = await database.getSiteNames([first.id, ...none.slice(1), last.id, first.id]);

      expect<unknown>([...named].sort()).toEqual(
        [
          [first.id, { name: REPORT, title: null }],
          [last.id, { name: REPORT, title: null }],
        ].sort(),
      );
      await expect(database.getSiteNames([first.id, ...none, last.id])).rejects.toThrow(RangeError);
    });

    // Drift: an entry of the log names the id its site had then; a lookup that lost an id at the second new link, or kept one of a deleted site, would show a site that still exists as gone, or a gone one as there.
    test("an id a site gave up names the site as it is now, through every new link since and in the trash, and names none once the site is deleted for good", async () => {
      const database = await opened(makeDatabase);
      const site = await made(database, { ...draft(REPORT), title: "Typed" });
      const other = await made(database, draft(DOCS));
      const ids = [site.id];
      for (let link = 0; link < 6; link += 1) {
        const moved = await database.giveNewId(ids.at(-1) ?? site.id, BY_ADA);
        if (moved.kind !== "done") throw new Error("no new id was given");

        ids.push(moved.site.id);
      }
      const [now, ...earlier] = [...ids].reverse() as [SiteId, ...SiteId[]];
      await database.changeDetails(now, { name: "notes" as SiteName }, BY_ADA);
      const named = { id: now, name: "notes", title: "Typed" };

      const later = await database.getLaterSites([...earlier, now, other.id, NO_SITE, site.id]);
      await database.trashSite(now, BY_ADA);
      const trashed = await database.getLaterSites([site.id]);
      await database.deleteSite(now, BY_ADA);

      expect<unknown>([[...later].sort(), [...trashed], [...(await database.getLaterSites(earlier))], [...(await database.getLaterSites([]))]]).toEqual([
        earlier.map((id) => [id, named]).sort(),
        [[site.id, named]],
        [],
        [],
      ]);
    });

    // Drift: a drawn id is free once no site holds it, so a site can be given one another site gave up; a second keeping of that id that failed would refuse the new link, and one that kept the first would name the wrong site.
    test("an id two sites gave up, one after the other, names the one that held it last", async () => {
      const database = await opened(makeDatabase, mintFrom("aaaaaaaaaaaa", "bbbbbbbbbbbb", "aaaaaaaaaaaa", "cccccccccccc"));
      const first = await made(database, draft(REPORT));
      await database.giveNewId(first.id, BY_ADA);
      const second = await made(database, draft(DOCS));
      const moved = await database.giveNewId(second.id, BY_ADA);

      expect<unknown>([first.id, second.id, moved.kind, [...(await database.getLaterSites([first.id]))]]).toEqual([
        "aaaaaaaaaaaa",
        "aaaaaaaaaaaa",
        "done",
        [["aaaaaaaaaaaa", { id: "cccccccccccc", name: DOCS, title: null }]],
      ]);
    });

    // Drift: each id asked is a value bound to the statement, as the names of many sites are: one id more than a database binds would fail as an error of the engine, on a page of the log.
    test("100 earlier ids are looked up at once, and one id more is refused by a throw", async () => {
      const database = await opened(makeDatabase);
      const site = await made(database, draft(REPORT));
      await database.giveNewId(site.id, BY_ADA);
      const none = Array.from({ length: 100 }, (_none, index) => String(index).padStart(12, "0") as SiteId);

      expect([...(await database.getLaterSites([site.id, ...none.slice(1), site.id])).keys()]).toEqual([site.id]);
      await expect(database.getLaterSites([site.id, ...none])).rejects.toThrow(RangeError);
    });

    // Drift: the folder is where the files are and the owner is whose site it is; a change that rewrote either would strand the files or hand the site over.
    test("a site keeps its name, folder, owner, and creation time through every change another person makes", async () => {
      const database = await opened(makeDatabase);
      const site = await made(database, draft(REPORT));
      const later: Signed = { by: BO, at: NOW + 5 };
      const steps = [
        await database.changeAccess(site.id, { access: "public", public_name: DOCS }, later),
        await database.changeDetails(site.id, { title: "T" }, later),
        await database.reserveVersion(site.id).then(() => database.addVersion(site.id, publish(2, 3), later)),
        await database.setLiveVersion(site.id, "previous", later),
        await database.trashSite(site.id, later),
        await database.restoreSite(site.id, later),
        await database.giveNewId(site.id, later),
      ];
      const lasting = [site.name, site.folder, site.owner, site.created_at];

      const last = steps.at(-1);

      expect<unknown>(steps.map((step) => ("site" in step ? [step.site.name, step.site.folder, step.site.owner, step.site.created_at] : step.kind))).toEqual(
        steps.map(() => lasting),
      );
      expect(last !== undefined && "site" in last ? await database.reserveVersion(last.site.id) : last).toEqual({ kind: "reserved", number: 3 });
    });

    // Drift: a caller tells "there is no such site" from "it is in the trash" by these answers alone, and offers a restore only for the second.
    test.each([
      ["access changed", (database: Database, id: SiteId): Promise<{ kind: string }> => database.changeAccess(id, { access: "unlisted" }, BY_ADA)],
      ["details changed", (database: Database, id: SiteId): Promise<{ kind: string }> => database.changeDetails(id, { title: "T" }, BY_ADA)],
      ["a new id given", (database: Database, id: SiteId): Promise<{ kind: string }> => database.giveNewId(id, BY_ADA)],
      ["the site trashed", (database: Database, id: SiteId): Promise<{ kind: string }> => database.trashSite(id, BY_ADA)],
      ["a version reserved", (database: Database, id: SiteId): Promise<{ kind: string }> => database.reserveVersion(id)],
      ["a version published", (database: Database, id: SiteId): Promise<{ kind: string }> => database.addVersion(id, publish(2, 3), BY_ADA)],
      ["the live version moved", (database: Database, id: SiteId): Promise<{ kind: string }> => database.setLiveVersion(id, "previous", BY_ADA)],
    ] as const)("%s is refused with in_trash for a trashed site and with not_found for no site, and nothing is stored", async (_case, change) => {
      const database = await opened(makeDatabase);
      const trashed = await made(database, draft(REPORT));
      await database.trashSite(trashed.id, BY_ADA);

      const before = await everything(database);

      expect([(await change(database, trashed.id)).kind, (await change(database, NO_SITE)).kind]).toEqual(["in_trash", "not_found"]);
      expect(await everything(database)).toEqual(before);
    });

    test("restoring a site that is not in the trash is refused with not_in_trash, and restoring or deleting no site with not_found", async () => {
      const database = await opened(makeDatabase);
      const site = await made(database, draft(REPORT));
      const refusals = [await database.restoreSite(site.id, BY_ADA), await database.restoreSite(NO_SITE, BY_ADA), await database.deleteSite(NO_SITE, BY_ADA)];

      expect(refusals.map((refusal) => refusal.kind)).toEqual(["not_in_trash", "not_found", "not_found"]);
    });

    // Drift: a public name is an address; two holders, or a name that reads as some site's id, would send a visitor to the wrong site.
    test.each([
      [
        "a new public site, the name held by another site",
        async (database: Database): Promise<unknown> => database.createSite(draft(REPORT, "public", DOCS), BY_ADA),
      ],
      [
        "a new public site, the name being another site's id",
        async (database: Database, holder: Site): Promise<unknown> => database.createSite(draft(REPORT, "public", holder.id as string as PublicName), BY_ADA),
      ],
      [
        "a site going public, the name held by another site",
        async (database: Database): Promise<unknown> =>
          database.changeAccess((await made(database, draft(REPORT))).id, { access: "public", public_name: DOCS }, BY_ADA),
      ],
      [
        "a site going public, the name being another site's id",
        async (database: Database, holder: Site): Promise<unknown> =>
          database.changeAccess((await made(database, draft(REPORT))).id, { access: "public", public_name: holder.id as string as PublicName }, BY_ADA),
      ],
      [
        "a site going public under its own id",
        async (database: Database): Promise<unknown> => {
          const site = await made(database, draft(REPORT));

          return database.changeAccess(site.id, { access: "public", public_name: site.id as string as PublicName }, BY_ADA);
        },
      ],
      [
        "a public site changing its name to one that is held",
        async (database: Database): Promise<unknown> =>
          database.changeAccess((await made(database, draft(REPORT, "public"))).id, { access: "public", public_name: DOCS }, BY_ADA),
      ],
    ] as const)("refuses %s with name_taken and writes no audit entry", async (_case, claim) => {
      const database = await opened(makeDatabase);
      const holder = await made(database, draft(DOCS, "public"));
      const refused = await claim(database, holder);
      const actions = await auditActions(database);

      expect(refused).toEqual({ kind: "name_taken" });
      expect(actions.filter((action) => action !== "create")).toEqual([]);
      expect(await database.getSiteByPublicName(DOCS)).toEqual(holder);
    });

    // Drift: read-then-write would let both callers see the name free; the check and the claim are one step, so the database decides.
    test("two claims of one public name at the same moment leave exactly one holder, and the loser gets name_taken", async () => {
      const database = await opened(makeDatabase);
      const [first, second] = [await made(database, draft(REPORT)), await made(database, draft(REPORT))];
      const claims = await Promise.all([first, second].map((site) => database.changeAccess(site.id, { access: "public", public_name: DOCS }, BY_ADA)));
      const holders = (await everySite(database)).filter((site) => site.access === "public" && site.public_name === DOCS);

      expect(claims.map((claim) => claim.kind).sort()).toEqual(["done", "name_taken"]);
      expect(holders).toHaveLength(1);
      expect((await auditActions(database)).filter((action) => action === "access")).toHaveLength(1);
      expect(
        [...claims, ...(await Promise.all([database.createSite(draft(DOCS, "public"), BY_ADA), database.createSite(draft(DOCS, "public"), BY_ADA)]))]
          .map((claim) => claim.kind)
          .sort(),
      ).toEqual(["done", "name_taken", "name_taken", "name_taken"]);
    });

    test("access moves between the three, a public name is claimed, changed, and freed, and asking for what already is writes nothing", async () => {
      const database = await opened(makeDatabase);
      const site = await made(database, draft(REPORT));
      const later: Signed = { by: BO, at: NOW + 5 };
      const steps = [
        await database.changeAccess(site.id, { access: "unlisted" }, later),
        await database.changeAccess(site.id, { access: "unlisted" }, later),
        await database.changeAccess(site.id, { access: "public", public_name: REPORT as PublicName }, later),
        await database.changeAccess(site.id, { access: "public", public_name: DOCS }, later),
        await database.changeAccess(site.id, { access: "public", public_name: DOCS }, later),
        await database.changeAccess(site.id, { access: "private" }, later),
      ];

      expect<unknown>(
        steps.map((step) =>
          "site" in step ? [step.kind, step.site.access, "public_name" in step.site ? step.site.public_name : null, step.site.updated_at] : step.kind,
        ),
      ).toEqual([
        ["done", "unlisted", null, NOW],
        ["unchanged", "unlisted", null, NOW],
        ["done", "public", REPORT, NOW],
        ["done", "public", DOCS, NOW],
        ["unchanged", "public", DOCS, NOW],
        ["done", "private", null, NOW],
      ]);
      const named = { id: site.id, name: REPORT };
      expect<unknown>((await auditTrail(database)).filter((entry) => entry.action === "access")).toEqual([
        { seq: 2, at: NOW + 5, by: BO, action: "access", site: named, detail: { access: "unlisted", public_name: null } },
        { seq: 3, at: NOW + 5, by: BO, action: "access", site: named, detail: { access: "public", public_name: "report" } },
        { seq: 4, at: NOW + 5, by: BO, action: "access", site: named, detail: { access: "public", public_name: "docs" } },
        { seq: 5, at: NOW + 5, by: BO, action: "access", site: named, detail: { access: "private", public_name: null } },
      ]);
      expect([await database.getSiteByPublicName(DOCS), await database.getSiteByPublicName(REPORT as PublicName)]).toEqual([undefined, undefined]);
    });

    // Drift: "new link" exists to cut off everyone who holds the old address; an old id that still resolved would defeat it.
    test("after a new id the old id names no site, the public name leads to the new id, and the folder and versions are the same", async () => {
      const database = await opened(makeDatabase);
      const site = await made(database, draft(REPORT, "public", DOCS));
      const moved = await database.giveNewId(site.id, { by: ADA, at: NOW + 9 });
      if (moved.kind !== "done") throw new Error(`the new id was refused: ${moved.kind}`);

      expect(moved.site).toEqual({ ...site, id: moved.site.id });
      expect(moved.site.id).not.toBe(site.id);
      expect((await auditTrail(database)).at(-1)).toMatchObject({ action: "new_id", site: { id: moved.site.id, name: REPORT }, detail: { from: site.id } });
      expect([await database.getSite(site.id), await database.findServed({ id: site.id }, NOW)]).toEqual([undefined, undefined]);
      expect([await database.getSiteByPublicName(DOCS), (await database.findServed({ public_name: DOCS }, NOW))?.site, await database.getSite(moved.site.id)]).toEqual([
        moved.site,
        moved.site,
        moved.site,
      ]);
    });

    // Drift: the trash is an undo, so the site must come back whole, name included; and a trashed site must look exactly like no site to a visitor.
    test("a trashed site keeps its public name, is served at neither address, and comes back whole when restored", async () => {
      const database = await opened(makeDatabase);
      const site = await made(database, draft(REPORT, "public", DOCS));
      const trashed = await database.trashSite(site.id, { by: ADA, at: NOW + 1 });
      const inTrash = { ...site, state: "trash", trashed_at: NOW + 1 };

      expect(trashed).toEqual({ kind: "done", site: inTrash } as typeof trashed);
      expect([await database.findServed({ id: site.id }, NOW), await database.findServed({ public_name: DOCS }, NOW)]).toEqual([undefined, undefined]);
      expect<unknown>([await database.getSite(site.id), await database.getSiteByPublicName(DOCS)]).toEqual([inTrash, inTrash]);
      expect(await database.createSite(draft(DOCS, "public"), BY_ADA)).toEqual({ kind: "name_taken" });
      expect(await database.restoreSite(site.id, { by: ADA, at: NOW + 2 })).toEqual({ kind: "done", site });
      expect((await database.findServed({ public_name: DOCS }, NOW))?.site).toEqual(site);
    });

    // Drift: a site restored with an expiry already behind it would be live in the answer and served to nobody, and the sweep would trash it again.
    test.each([
      ["an expiry before the restore", NOW + 1, "never"],
      ["an expiry at the moment of the restore", NOW + 5, "never"],
      ["an expiry after the restore", NOW + 6, NOW + 6],
    ] as const)("a restore clears %s, and keeps one still ahead", async (_which, expires, kept) => {
      const database = await opened(makeDatabase);
      const site = await made(database, { ...draft(REPORT), expires });
      await database.trashSite(site.id, BY_ADA);
      const restored = { ...site, expires: kept };

      expect(await database.restoreSite(site.id, { by: ADA, at: NOW + 5 })).toEqual({ kind: "done", site: restored });
      expect([await database.getSite(site.id), (await database.findServed({ id: site.id }, NOW + 5))?.site]).toEqual([restored, restored]);
    });

    // Drift: a name held by a site that no longer exists could never be claimed again, and versions left behind would count against the install for good.
    test("deleting a site for good frees its public name and removes its versions with it", async () => {
      const database = await opened(makeDatabase);
      const site = await made(database, draft(REPORT, "public", DOCS));
      await database.trashSite(site.id, BY_ADA);
      const trashed = await database.getSite(site.id);
      const deleted = await database.deleteSite(site.id, BY_ADA);

      expect(deleted).toEqual({ kind: "done", site: trashed } as typeof deleted);
      expect([await database.getSite(site.id), await database.getSiteByPublicName(DOCS)]).toEqual([undefined, undefined]);
      expect([await sizeOf(database, site.id), await database.readTotals()]).toEqual([undefined, NOTHING]);
      expect((await database.createSite(draft(DOCS, "public"), BY_ADA)).kind).toBe("done");
    });

    // Drift: the folder of a removed site is all that says files may still sit in the bucket; one that was not remembered would leave them there for good.
    test("every site removed for good leaves its folder as a leftover until it is forgotten, and a site stored back into its folder takes it out", async () => {
      const database = await opened(makeDatabase);
      const sites = [await made(database, draft(REPORT)), await made(database, draft(REPORT)), await made(database, draft(DOCS))];
      const folders = sites.map((site) => site.folder).sort();
      const [first, second, third] = folders;
      const before = await database.listLeftovers({ limit: 10 });
      for (const site of sites) await database.deleteSite(site.id, BY_ADA);

      const pages = [await database.listLeftovers({ limit: 2 }), await database.listLeftovers({ limit: 2, after: second })];
      const back = sites.find((site) => site.folder === first);
      if (back === undefined || second === undefined) throw new Error("the fixture sites are not there");

      await storedBack(database, back);
      await database.forgetLeftover(second);
      await database.forgetLeftover(second);

      expect([before, pages]).toEqual([{ folders: [] }, [{ folders: [first, second], next: second }, { folders: [third] }]] as never);
      expect(await database.listLeftovers({ limit: 10 })).toEqual({ folders: [third] } as never);
      await expect(database.listLeftovers({ limit: 0 })).rejects.toThrow(RangeError);
    });

    test.each([
      ["never", NOW, true],
      [NOW + 1, NOW, true],
      [NOW, NOW, false],
      [NOW - 1, NOW, false],
    ] as const)("a site expiring at %j is served at %j, by its id and by its public name: %j", async (expires, now, served) => {
      const database = await opened(makeDatabase);
      const site = await made(database, { ...draft(REPORT, "public", DOCS), expires });
      const found = [await database.findServed({ id: site.id }, now), await database.findServed({ public_name: DOCS }, now)];

      expect(found.map((answer) => answer !== undefined)).toEqual([served, served]);
      expect((await database.getSite(site.id))?.expires).toBe(expires);
    });

    test("details change only where a given value differs, and a trashed or missing site is refused", async () => {
      const database = await opened(makeDatabase);
      const site = await made(database, draft(REPORT));
      const later: Signed = { by: ADA, at: NOW + 3 };
      const changed = { ...site, name: DOCS, title: "Q3 report", search_engines: true, expires: NOW + 100 };

      expect(await database.changeDetails(site.id, { name: DOCS, title: "Q3 report", search_engines: true, expires: NOW + 100 }, later)).toEqual({
        kind: "done",
        site: changed,
      });
      expect(await database.changeDetails(site.id, { title: "Q3 report" }, { by: ADA, at: NOW + 4 })).toEqual({ kind: "unchanged", site: changed });
      expect(await database.changeDetails(site.id, {}, { by: ADA, at: NOW + 4 })).toEqual({ kind: "unchanged", site: changed });
      expect(await database.changeDetails(site.id, { title: null, expires: "never" }, later)).toEqual({
        kind: "done",
        site: { ...changed, title: null, expires: "never" },
      });
      expect(await database.changeDetails(NO_SITE, { title: "x" }, later)).toEqual({ kind: "not_found" });
      await expect(database.changeDetails(site.id, { title: "" }, later)).rejects.toThrow();
      expect((await auditActions(database)).filter((action) => action === "details")).toHaveLength(2);
    });

    // Drift: the serving code forbids framing from this flag alone; a site made without it, or a change that did not stick, would open or seal the wrong site.
    test("a site is embeddable unless made otherwise, and the flag is set to false and back with one audit entry each", async () => {
      const database = await opened(makeDatabase);
      const site = await made(database, draft(REPORT));
      const sealed = await made(database, { ...draft(REPORT), embeddable: false });
      const flags = [
        await database.changeDetails(site.id, { embeddable: false }, BY_ADA),
        await database.changeDetails(site.id, { embeddable: false }, BY_ADA),
        await database.changeDetails(site.id, { embeddable: true }, BY_ADA),
      ];

      expect([site.embeddable, sealed.embeddable]).toEqual([true, false]);
      expect(flags.map((flag) => ("site" in flag ? [flag.kind, flag.site.embeddable] : flag.kind))).toEqual([
        ["done", false],
        ["unchanged", false],
        ["done", true],
      ]);
      expect(await auditDetails(database, "details")).toEqual([{ embeddable: false }, { embeddable: true }]);
      expect((await database.getSite(site.id))?.embeddable).toBe(true);
    });

    // Drift: the dashboard pages through this; a page that skipped or repeated a site, or mixed the trash in, would hide or double sites.
    test("a listing pages through the sites newest change first, apart from the trash, and by owner when asked", async () => {
      const database = await opened(makeDatabase, mintFrom("aaaaaaaaaaaa", "bbbbbbbbbbbb", "cccccccccccc", "dddddddddddd", "eeeeeeeeeeee"));
      const ids: SiteId[] = [];
      for (const [by, at] of [
        [ADA, NOW],
        [BO, NOW],
        [ADA, NOW + 1],
        [BO, NOW + 2],
        [ADA, NOW + 3],
      ] as const)
        ids.push((await made(database, draft(REPORT), { by, at })).id);
      await database.trashSite("dddddddddddd" as SiteId, { by: ADA, at: NOW + 9 });

      const first = await database.listSites({ trash: false, limit: 3 });
      const second = await database.listSites({ trash: false, limit: 3, ...(first.next === undefined ? {} : { after: first.next }) });
      const page = (listed: { readonly sites: readonly Site[] }): string[] => listed.sites.map((site) => site.id);

      expect<unknown>([page(first), first.next, page(second), second.next]).toEqual([
        ["eeeeeeeeeeee", "cccccccccccc", "bbbbbbbbbbbb"],
        { updated_at: NOW, id: "bbbbbbbbbbbb" },
        ["aaaaaaaaaaaa"],
        undefined,
      ]);
      expect(page(await database.listSites({ trash: true, limit: 100 }))).toEqual(["dddddddddddd"]);
      expect(page(await database.listSites({ trash: false, owner: BO, limit: 100 }))).toEqual(["bbbbbbbbbbbb"]);

      // Drift: a page's cursor holds what the listing goes by; one that held the change time alone would start the next page of a listing by name at the wrong site, or at none.
      const byName = await database.listSites({ trash: false, limit: 3, sort: "name" });
      const rest = await database.listSites({ trash: false, limit: 3, sort: "name", ...(byName.next === undefined ? {} : { after: byName.next }) });
      const live = ["aaaaaaaaaaaa", "bbbbbbbbbbbb", "cccccccccccc", "eeeeeeeeeeee"];

      expect<unknown>([page(byName), byName.next, page(rest), rest.next]).toEqual([live.slice(0, 3), { updated_at: NOW + 1, id: "cccccccccccc", name: REPORT }, live.slice(3), undefined]);
      expect(page(await database.listSites({ trash: false, limit: 100, sort: "updated", dir: "asc" }))).toEqual(live);
      expect(page(await database.listSites({ trash: false, limit: 100, sort: "access", dir: "desc" }))).toEqual([...live].reverse());
      expect([page(await database.listSites({ trash: false, limit: 100, expires: "never" })), page(await database.listSites({ trash: false, limit: 100, expires: "set" }))]).toEqual([[...live].reverse(), []]);

      // Drift: a name is looked for as plain text; read as a pattern, `%` and `_` would list every site, and a text cut at a NUL would too.
      const found = async (named: string): Promise<string[]> => page(await database.listSites({ trash: false, limit: 100, sort: "name", named }));

      expect([await found(REPORT.slice(1, 4)), await found(REPORT.toUpperCase()), await found("%"), await found("_"), await found("\u0000"), await found(`${REPORT}\u0000`)]).toEqual([live, live, [], [], [], []]);

      // The trash shows what was deleted last first, whenever its content changed: the oldest site, deleted last, leads.
      await database.trashSite("aaaaaaaaaaaa" as SiteId, { by: ADA, at: NOW + 10 });
      const trash = await database.listSites({ trash: true, limit: 1 });

      expect<unknown>([page(trash), trash.next]).toEqual([["aaaaaaaaaaaa"], { updated_at: NOW + 10, id: "aaaaaaaaaaaa" }]);
      expect(page(await database.listSites({ trash: true, limit: 1, ...(trash.next === undefined ? {} : { after: trash.next }) }))).toEqual(["dddddddddddd"]);
      expect(page(await database.listSites({ trash: true, owner: ADA, limit: 100 }))).toEqual(["aaaaaaaaaaaa"]);
      expect(ids).toHaveLength(5);
      await expect(database.listSites({ trash: false, limit: 0 })).rejects.toThrow(RangeError);
      await expect(database.listSites({ trash: false, limit: 101 })).rejects.toThrow(RangeError);
      // Drift: a cursor that lacks what its order goes by has no place in that order; started from the top instead, the page would repeat its sites.
      await expect(database.listSites({ trash: false, limit: 1, sort: "name", after: { updated_at: NOW, id: "aaaaaaaaaaaa" as SiteId } })).rejects.toThrow(RangeError);
      await expect(database.listSites({ trash: false, limit: 1, sort: "access", after: { updated_at: NOW, id: "aaaaaaaaaaaa" as SiteId, name: REPORT } })).rejects.toThrow(RangeError);
    });

    // Drift: a listed site shows its title above its name. A search of the name alone would miss the site a person reads, and one of a title the listing hides would list a site with no hit to see.
    describe("a text finds a site by its name or by the title it is listed with", () => {
      const stocked = async (): Promise<Database> => {
        const database = await opened(makeDatabase, mintFrom("aaaaaaaaaaaa", "bbbbbbbbbbbb", "cccccccccccc", "dddddddddddd", "eeeeeeeeeeee", "ffffffffffff"));
        const drafts: readonly (readonly [name: string, title: string | null, pageTitle?: string])[] = [
          ["report", null],
          ["notes", "Quarterly Report"],
          ["draft", null, `Report 50%_done's "final"`],
          ["plans", "Budget \u03a9", "Report"],
          ["misc", null],
          ["old", "Report archive"],
        ];
        for (const [index, [name, title, pageTitle]] of drafts.entries()) {
          const site = { ...draft(name as SiteName), title, ...(pageTitle === undefined ? {} : { page_title: pageTitle }) };
          await made(database, site, { by: ADA, at: NOW + index });
        }
        await database.trashSite("ffffffffffff" as SiteId, { by: ADA, at: NOW + 9 });

        return database;
      };
      const walked = (database: Database, query: Partial<SitesQuery>): Promise<string[][]> => pagedNames(database, { sort: "name", ...query });

      test.each([
        ["a name and two titles, paged in the order of the names", { named: "report" }, [["draft", "notes"], ["report"]]],
        ["the same, paged from the oldest change", { named: "report", sort: "updated", dir: "asc" }, [["report", "notes"], ["draft"]]],
        ["capitals typed, for a name and for a title", { named: "REPORT" }, [["draft", "notes"], ["report"]]],
        ["a typed title", { named: "quarterly" }, [["notes"]]],
        ["a typed title, which hides the page's own", { named: "budget" }, [["plans"]]],
        ["a letter outside ASCII, as it is typed", { named: "\u03a9" }, [["plans"]]],
        ["a page's title, with a percent sign and an underscore", { named: "50%_D" }, [["draft"]]],
        ["a percent sign, which stands for itself", { named: "%" }, [["draft"]]],
        ["an underscore, which stands for itself", { named: "_" }, [["draft"]]],
        ["signs that only a pattern would match", { named: "5_%" }, [[]]],
        ["a single quote", { named: "done's" }, [["draft"]]],
        ["double quotes", { named: '"final"' }, [["draft"]]],
        ["a site with neither title, by its name", { named: "misc" }, [["misc"]]],
        ["a text in no name and no title", { named: "ledger" }, [[]]],
        ["a title of the trash, looked for outside it", { named: "archive" }, [[]]],
        ["a title of the trash", { named: "archive", trash: true }, [["old"]]],
        ["the trash, which holds one site the text is in", { named: "report", trash: true }, [["old"]]],
      ] as const)("%s", async (_what, query, pages) => {
        expect<unknown>(await walked(await stocked(), query)).toEqual(pages);
      });
    });

    // Drift: a listed site shows its title, or its name when it has none, and a table's first heading sorts by that. An order by the name alone would sort by a line nobody sees, and a cursor without its place in this order would repeat or skip sites.
    describe("a listing by title goes by what each site is listed with: its typed title, else its page's, else its name", () => {
      const LONG = "m".repeat(40);
      const stocked = async (): Promise<Database> => {
        const database = await opened(makeDatabase, mintFrom("aaaaaaaaaaaa", "bbbbbbbbbbbb", "cccccccccccc", "dddddddddddd", "eeeeeeeeeeee", "ffffffffffff", "gggggggggggg", "hhhhhhhhhhhh", "iiiiiiiiiiii"));
        const drafts: readonly (readonly [name: string, title: string | null, pageTitle?: string])[] = [
          ["zeta", "apple"],
          ["banana", null],
          ["yak", null, "Cherry"],
          ["xray", "Apple"],
          ["wolf", "date", "Aardvark"],
          ["cherry", null],
          ["vole", `${LONG} b`],
          ["tern", `${LONG} a`],
          ["old", "Banana"],
        ];
        for (const [index, [name, title, pageTitle]] of drafts.entries()) {
          const site = { ...draft(name as SiteName, index === 1 ? "unlisted" : "private"), title, ...(pageTitle === undefined ? {} : { page_title: pageTitle }) };
          await made(database, site, { by: ADA, at: NOW + index });
        }
        await database.trashSite("iiiiiiiiiiii" as SiteId, { by: ADA, at: NOW + 9 });

        return database;
      };

      test.each([
        ["from the start: capitals count for nothing, sites alike follow their ids, and a typed title hides the page's", {}, [["zeta", "xray"], ["banana", "yak"], ["cherry", "wolf"], ["vole", "tern"]]],
        ["from the end", { dir: "desc" }, [["tern", "vole"], ["wolf", "cherry"], ["yak", "banana"], ["xray", "zeta"]]],
        ["narrowed by a text", { named: "e" }, [["zeta", "xray"], ["yak", "cherry"], ["wolf", "vole"], ["tern"]]],
        ["narrowed by an access", { access: "private", dir: "desc" }, [["tern", "vole"], ["wolf", "cherry"], ["yak", "xray"], ["zeta"]]],
        ["the trash", { trash: true }, [["old"]]],
      ] as const)("%s", async (_what, query, pages) => {
        expect<unknown>(await pagedNames(await stocked(), { sort: "title", ...query })).toEqual(pages);
      });

      test("a page's `next` holds the place of its last site in this order, at most 40 characters of it, and a cursor without one is refused by a throw", async () => {
        const database = await stocked();
        const first = await database.listSites({ trash: false, limit: 2, sort: "title" });
        const last = await database.listSites({ trash: false, limit: 7, sort: "title" });

        expect<unknown>([first.next, last.next]).toEqual([
          { updated_at: NOW + 3, id: "dddddddddddd", title: "apple" },
          { updated_at: NOW + 6, id: "gggggggggggg", title: LONG },
        ]);
        await expect(database.listSites({ trash: false, limit: 1, sort: "title", after: { updated_at: NOW, id: "aaaaaaaaaaaa" as SiteId, name: REPORT } })).rejects.toThrow(RangeError);
      });

      // Drift: the engine cuts a text at a NUL, so a title that begins with one is ordered by nothing. A cursor that could not say so would end the listing at that site.
      test("a title that begins with a NUL leads the listing, and the page after it goes on from an empty place", async () => {
        const database = await opened(makeDatabase, mintFrom("aaaaaaaaaaaa", "bbbbbbbbbbbb", "cccccccccccc"));
        await made(database, { ...draft("delta" as SiteName), title: "\u0000x" });
        await made(database, draft("alpha" as SiteName));
        await made(database, draft("bravo" as SiteName));

        const first = await database.listSites({ trash: false, limit: 1, sort: "title" });
        const rest = await database.listSites({ trash: false, limit: 2, sort: "title", ...(first.next === undefined ? {} : { after: first.next }) });

        expect<unknown>([first.sites.map((site) => site.name), first.next?.title, rest.sites.map((site) => site.name)]).toEqual([["delta"], "", ["alpha", "bravo"]]);
      });
    });

    // Drift: the place of an access is held by the schema, which orders the listing, and by the cursor, which starts the next page. Were the two to differ, or the order to follow the spelling, a page would repeat or skip sites.
    test.each([
      ["asc", ["bbbbbbbbbbbb", "eeeeeeeeeeee", "cccccccccccc", "aaaaaaaaaaaa", "dddddddddddd"]],
      ["desc", ["dddddddddddd", "aaaaaaaaaaaa", "cccccccccccc", "eeeeeeeeeeee", "bbbbbbbbbbbb"]],
    ] as const)("a listing by access, %s, pages through the sites by how open each is and not by how its access is spelled, each site once", async (dir, order) => {
      const database = await opened(makeDatabase, mintFrom("aaaaaaaaaaaa", "bbbbbbbbbbbb", "cccccccccccc", "dddddddddddd", "eeeeeeeeeeee"));
      const accesses = ["public", "private", "unlisted", "public", "private"] as const;
      for (const [index, access] of accesses.entries()) await made(database, draft(`site-${index}` as SiteName, access));

      const listed: string[] = [];
      let after: SitesPage["next"];

      do {
        const page = await database.listSites({ trash: false, limit: 2, sort: "access", dir, ...(after === undefined ? {} : { after }) });
        listed.push(...page.sites.map((site) => site.id));
        after = page.next;
      } while (after !== undefined);

      expect(listed).toEqual([...order]);
    });
  });
}

export function versions(label: string, makeDatabase: DatabaseFactory): void {
  describe(`${label}: versions`, () => {
    // Drift: a site without a version has nothing to serve; the database itself makes version 1 with the site, of the size and by the maker the call states.
    test("a new site holds version 1 alone, live, as its maker published it, and the next number set aside is 2", async () => {
      const database = await opened(makeDatabase);
      const site = await made(database, { ...draft(REPORT), bytes: 100, files: 2 }, { by: BO, at: NOW + 1 });
      const first = { number: 1, published_at: NOW + 1, published_by: BO, bytes: 100, files: 2 };

      expect([site.live_version, site.versions, (await database.getSite(site.id))?.versions]).toEqual([1, [first], [first]]);
      expect<unknown>([await sizeOf(database, site.id), await database.readTotals()]).toEqual([
        { bytes: 100, files: 2 },
        { sites: 1, trashed_sites: 0, bytes: 100, files: 2 },
      ]);
      expect(await database.setLiveVersion(site.id, "previous", BY_ADA)).toEqual({ kind: "no_such_version" });
      expect(await database.reserveVersion(site.id)).toEqual({ kind: "reserved", number: 2 });
    });

    // Drift: two publishes to one site upload into the folder of their version number; one number handed out twice would mix their files.
    test("version numbers reserved at the same moment are all different, and a publish goes live under its number while old versions are dropped", async () => {
      const database = await opened(makeDatabase);
      const site = await made(database, draft(REPORT));
      const reserved = await Promise.all([1, 2, 3].map(() => database.reserveVersion(site.id)));
      const numbers = reserved.map((answer) => (answer.kind === "reserved" ? answer.number : 0)).sort();
      const second = await database.addVersion(site.id, publish(2, 3), { by: BO, at: NOW + 2 });
      const fourth = await database.addVersion(site.id, publish(4, 2), { by: BO, at: NOW + 4 });

      expect(numbers).toEqual([2, 3, 4]);
      expect(second).toMatchObject({
        kind: "done",
        dropped: [],
        site: { live_version: 2, updated_at: NOW + 2, versions: [{ number: 1 }, { number: 2, published_at: NOW + 2, published_by: BO }] },
      });
      expect(fourth).toMatchObject({ kind: "done", dropped: [1], site: { live_version: 4, versions: [{ number: 2 }, { number: 4 }] } });
      expect(await database.addVersion(site.id, publish(3, 2), BY_ADA)).toEqual({ kind: "stale_number" });
      expect(await database.addVersion(site.id, publish(5, 2), BY_ADA)).toEqual({ kind: "stale_number" });
      expect(await database.addVersion(NO_SITE, publish(2, 2), BY_ADA)).toEqual({ kind: "not_found" });
      await expect(database.addVersion(site.id, publish(5, 0), BY_ADA)).rejects.toThrow(RangeError);
      expect(await auditActions(database)).toEqual(["create", "publish", "publish"]);
      expect<unknown>((await auditTrail(database)).slice(1).map((entry) => [entry.by, entry.at, entry.site, entry.detail])).toEqual([
        [BO, NOW + 2, { id: site.id, name: REPORT }, { version: 2 }],
        [BO, NOW + 4, { id: site.id, name: REPORT }, { version: 4 }],
      ]);
      expect(await database.setLiveVersion(site.id, "previous", BY_ADA)).toMatchObject({ kind: "done", site: { live_version: 2 } });
    });

    // Drift: "go back one" decided from an earlier read would send two rollbacks to the same version; here each one moves from where the site is.
    test("the live version moves to a kept number or to the one before, and never to a version that is not kept", async () => {
      const database = await opened(makeDatabase);
      const site = await made(database, draft(REPORT));
      for (const number of [2, 3]) {
        await database.reserveVersion(site.id);
        await database.addVersion(site.id, publish(number, 3), BY_ADA);
      }

      const moves = [
        await database.setLiveVersion(site.id, "previous", BY_ADA),
        await database.setLiveVersion(site.id, "previous", BY_ADA),
        await database.setLiveVersion(site.id, "previous", BY_ADA),
        await database.setLiveVersion(site.id, 3, BY_ADA),
        await database.setLiveVersion(site.id, 3, BY_ADA),
        await database.setLiveVersion(site.id, 7, BY_ADA),
        await database.setLiveVersion(NO_SITE, 1, BY_ADA),
      ];

      expect(moves.map((move) => ("site" in move ? [move.kind, move.site.live_version] : move.kind))).toEqual([
        ["done", 2],
        ["done", 1],
        "no_such_version",
        ["done", 3],
        ["unchanged", 3],
        "no_such_version",
        "not_found",
      ]);
      expect(await auditDetails(database, "live_version")).toEqual([{ version: 2 }, { version: 1 }, { version: 3 }]);
    });
  });
}

export function sizes(label: string, makeDatabase: DatabaseFactory): void {
  describe(`${label}: sizes`, () => {
    // Drift: a publish is refused from these numbers alone; a total that missed a dropped version or a deleted site would refuse an install with room left.
    test("the totals and a site's size follow every version kept, dropped, and deleted, and count the trash", async () => {
      const database = await opened(makeDatabase);
      const big = await made(database, { ...draft(REPORT), bytes: 100, files: 2 });
      const small = await made(database, { ...draft(DOCS, "public"), bytes: 7, files: 1 });
      const seen: unknown[] = [];
      const after = async (change: unknown): Promise<void> => {
        await change;
        seen.push([await database.readTotals(), await sizeOf(database, big.id), await sizeOf(database, small.id)]);
      };

      await after(undefined);
      await after(database.reserveVersion(big.id));
      await after(database.addVersion(big.id, { number: 2, keep: 2, bytes: 250, files: 5 }, BY_ADA));
      await after(database.reserveVersion(big.id).then(() => database.addVersion(big.id, { number: 3, keep: 2, bytes: 40, files: 1 }, BY_ADA)));
      await after(database.addVersion(big.id, { number: 2, keep: 2, bytes: 9000, files: 9 }, BY_ADA));
      await after(database.createSite({ ...draft(REPORT, "public", DOCS), bytes: 9000, files: 9 }, BY_ADA));
      await after(database.setLiveVersion(big.id, "previous", BY_ADA));
      await after(database.trashSite(small.id, BY_ADA));
      await after(database.restoreSite(small.id, BY_ADA));
      await after(database.trashSite(small.id, BY_ADA).then(() => database.deleteSite(small.id, BY_ADA)));
      await after(database.deleteSite(big.id, BY_ADA));

      const totals = (sites: number, trashed: number, bytes: number, files: number): unknown => ({ sites, trashed_sites: trashed, bytes, files });
      expect(seen).toEqual([
        [totals(2, 0, 107, 3), { bytes: 100, files: 2 }, { bytes: 7, files: 1 }],
        [totals(2, 0, 107, 3), { bytes: 100, files: 2 }, { bytes: 7, files: 1 }],
        [totals(2, 0, 357, 8), { bytes: 350, files: 7 }, { bytes: 7, files: 1 }],
        [totals(2, 0, 297, 7), { bytes: 290, files: 6 }, { bytes: 7, files: 1 }],
        [totals(2, 0, 297, 7), { bytes: 290, files: 6 }, { bytes: 7, files: 1 }],
        [totals(2, 0, 297, 7), { bytes: 290, files: 6 }, { bytes: 7, files: 1 }],
        [totals(2, 0, 297, 7), { bytes: 290, files: 6 }, { bytes: 7, files: 1 }],
        [totals(2, 1, 297, 7), { bytes: 290, files: 6 }, { bytes: 7, files: 1 }],
        [totals(2, 0, 297, 7), { bytes: 290, files: 6 }, { bytes: 7, files: 1 }],
        [totals(1, 0, 290, 6), { bytes: 290, files: 6 }, undefined],
        [totals(0, 0, 0, 0), undefined, undefined],
      ]);
    });

    test.each([
      ["bytes below zero", { bytes: -1, files: 1 }],
      ["a fraction of a file", { bytes: 1, files: 1.5 }],
      ["bytes past what a number holds exactly", { bytes: 2 ** 53, files: 1 }],
    ] as const)("a size with %s is refused for a new site and for a new version, and nothing is stored", async (_case, size) => {
      const database = await opened(makeDatabase);
      const site = await made(database, draft(REPORT));
      await database.reserveVersion(site.id);

      await expect(database.createSite({ ...draft(DOCS), ...size }, BY_ADA)).rejects.toThrow();
      await expect(database.addVersion(site.id, { number: 2, keep: 3, ...size }, BY_ADA)).rejects.toThrow(RangeError);
      expect(await database.readTotals()).toEqual({ sites: 1, trashed_sites: 0, ...SIZE });
    });
  });
}

export function backups(label: string, makeDatabase: DatabaseFactory): void {
  describe(`${label}: export and import`, () => {
    // Drift: a backup that skipped a site, or put one back under another id or without a version, would break an address or lose a rollback.
    test("every site is exported a page at a time in id order, the trash included, and reads back the same once deleted and imported", async () => {
      const database = await opened(makeDatabase, mintFrom("cccccccccccc", "aaaaaaaaaaaa", "eeeeeeeeeeee", "bbbbbbbbbbbb", "dddddddddddd"));
      const [rolledBack, trashed] = [await made(database, draft(REPORT, "public", DOCS)), await made(database, { ...draft(REPORT), title: "Old" })];
      for (const name of [REPORT, DOCS, REPORT]) await made(database, draft(name, "unlisted"), { by: BO, at: NOW + 1 });
      for (const number of [2, 3]) {
        await database.reserveVersion(rolledBack.id);
        await database.addVersion(rolledBack.id, { number, keep: 3, bytes: number * 11, files: number }, { by: BO, at: NOW + number });
      }
      await database.reserveVersion(rolledBack.id);
      await database.setLiveVersion(rolledBack.id, 2, BY_ADA);
      await database.trashSite(trashed.id, { by: BO, at: NOW + 7 });

      const pages = [await database.exportSites({ limit: 2 })];
      while (pages.at(-1)?.next !== undefined) pages.push(await database.exportSites({ limit: 2, after: pages.at(-1)?.next as SiteId }));
      const exported = pages.flatMap((page) => page.sites);
      const before = await database.readTotals();
      for (const site of exported) await database.deleteSite(site.id, BY_ADA);
      const emptied = await database.readTotals();
      const imported = [];
      for (const site of exported) imported.push(await storedBack(database, site, { by: BO, at: NOW + 99 }));
      const readBack = await Promise.all(exported.map((site) => database.getSite(site.id)));

      expect<unknown>(pages.map((page) => [page.sites.map((site) => site.id), page.next])).toEqual([
        [["aaaaaaaaaaaa", "bbbbbbbbbbbb"], "bbbbbbbbbbbb"],
        [["cccccccccccc", "dddddddddddd"], "dddddddddddd"],
        [["eeeeeeeeeeee"], undefined],
      ]);
      expect(exported.map((site) => [site.state, site.live_version, site.versions.map((version) => version.number)])).toEqual([
        ["trash", 1, [1]],
        ["live", 1, [1]],
        ["live", 2, [1, 2, 3]],
        ["live", 1, [1]],
        ["live", 1, [1]],
      ]);
      expect(imported).toEqual(exported.map((site) => ({ kind: "done", site })));
      expect(readBack).toEqual(exported);
      expect([emptied, await database.readTotals()]).toEqual([{ sites: 0, trashed_sites: 0, bytes: 0, files: 0 }, before]);
      expect(await database.reserveVersion(rolledBack.id)).toEqual({ kind: "reserved", number: 4 });
      const imports = (await auditTrail(database)).filter((entry) => entry.action === "imported");
      expect<unknown>(imports.map((entry) => [entry.by, entry.at, entry.site, entry.detail])).toEqual(
        exported.map((site) => [BO, NOW + 99, { id: site.id, name: site.name }, { versions: site.versions.length }]),
      );
      await expect(database.exportSites({ limit: 0 })).rejects.toThrow(RangeError);
      await expect(database.exportSites({ limit: 101 })).rejects.toThrow(RangeError);
    });

    // Drift: an import that overwrote a site, or left a row behind when it was refused, would corrupt the install it was meant to restore.
    test.each([
      ["id_taken", "its id is a site's id", (site: Site): Site => ({ ...site, folder: mintSiteFolder() })],
      ["id_taken", "its id is a site's public name", (site: Site): Site => ({ ...site, id: "cccccccccccc" as SiteId, folder: mintSiteFolder() })],
      ["folder_taken", "its folder is a site's folder", (site: Site): Site => ({ ...site, id: "ffffffffffff" as SiteId })],
      [
        "name_taken",
        "its public name is a site's public name",
        (site: Site): Site => ({ ...site, id: "ffffffffffff" as SiteId, folder: mintSiteFolder(), access: "public", public_name: "cccccccccccc" as PublicName }),
      ],
      [
        "name_taken",
        "its public name is a site's id",
        (site: Site): Site => ({ ...site, id: "ffffffffffff" as SiteId, folder: mintSiteFolder(), access: "public", public_name: "aaaaaaaaaaaa" as PublicName }),
      ],
      [
        "name_taken",
        "its public name is its own id",
        (site: Site): Site => ({ ...site, id: "ffffffffffff" as SiteId, folder: mintSiteFolder(), access: "public", public_name: "ffffffffffff" as PublicName }),
      ],
      ["id_taken", "its id and its folder are both a site's", (site: Site): Site => site],
      [
        "folder_taken",
        "its folder and its public name are both a site's",
        (site: Site): Site => ({ ...site, id: "ffffffffffff" as SiteId, access: "public", public_name: "cccccccccccc" as PublicName }),
      ],
    ] as const)("an import is refused with %s when %s, and nothing of it is stored", async (kind, _case, change) => {
      const database = await opened(makeDatabase, mintFrom("aaaaaaaaaaaa", "bbbbbbbbbbbb"));
      await made(database, draft(REPORT));
      await made(database, draft(REPORT, "public", "cccccccccccc" as PublicName));
      await database.reserveVersion("aaaaaaaaaaaa" as SiteId);
      const published = await database.addVersion("aaaaaaaaaaaa" as SiteId, publish(2, 3), BY_ADA);
      if (published.kind !== "done") throw new Error(`the fixture publish was refused: ${published.kind}`);

      const before = await everything(database);

      expect(await storedBack(database, change(published.site))).toEqual({ kind });
      expect(await everything(database)).toEqual(before);
      expect(await database.reserveVersion("aaaaaaaaaaaa" as SiteId)).toEqual({ kind: "reserved", number: 3 });
    });

    // Drift: these values could only come from a damaged or hand-edited backup; stored, they would be a site no read could turn back into a site.
    test.each([
      ["a live version that is not among its versions", (site: Site): unknown => ({ ...site, live_version: 9 })],
      ["one version number twice", (site: Site): unknown => ({ ...site, versions: [...site.versions, ...site.versions] })],
      ["no version", (site: Site): unknown => ({ ...site, versions: [] })],
      ["a version numbered 0", (site: Site): unknown => ({ ...site, live_version: 0, versions: [{ ...site.versions[0], number: 0 }] })],
      ["a version without a size", (site: Site): unknown => ({ ...site, versions: [{ number: 1, published_at: NOW, published_by: ADA }] })],
      ["public access and no public name", (site: Site): unknown => ({ ...site, access: "public" })],
      ["an id that is no site id", (site: Site): unknown => ({ ...site, id: "NOT-AN-ID" })],
      ["a place in the trash since no moment", (site: Site): unknown => ({ ...site, state: "trash", trashed_at: null })],
    ] as const)("an import of a site with %s throws, and nothing is stored", async (_case, change) => {
      const database = await opened(makeDatabase);
      const site = await made(database, draft(REPORT));
      await database.deleteSite(site.id, BY_ADA);

      await expect(storedBack(database, change(site) as Site)).rejects.toThrow();
      expect(await database.readTotals()).toEqual({ sites: 0, trashed_sites: 0, bytes: 0, files: 0 });
    });
  });
}

export function versionContents(label: string, makeDatabase: DatabaseFactory): void {
  describe(`${label}: what a version is known to hold`, () => {
    // Drift: serving reads the store for a `404.html` and for a file without an extension only when the live version is known to hold one. A record kept with the site, not the version, would send a rolled-back site's visitor to files that are not there.
    test("a served site carries what its live version holds: the first one's, a publish's, and after a rollback the older one's again", async () => {
      const database = await opened(makeDatabase);
      const first = { missing_page: true, bare_files: "\nLICENSE\n" };
      const second = { missing_page: false, bare_files: "" };
      const upload = await begunSite(database, draft(REPORT));
      const site = await database.publishUploadAsSite(upload.id, upload.site, BY_ADA, first);
      if (site.kind !== "done") throw new Error(`the fixture site was refused: ${site.kind}`);

      const contents = [(await database.findServed({ id: site.site.id }, NOW))?.contents];
      await database.publishUploadAsVersion(await begunVersion(database, site.site), { keep: 2, details: {}, contents: second }, BY_ADA);
      contents.push((await database.findServed({ id: site.site.id }, NOW))?.contents);
      await database.setLiveVersion(site.site.id, 1, BY_ADA);
      contents.push((await database.findServed({ id: site.site.id }, NOW))?.contents);

      expect(contents).toEqual([first, second, first]);
    });

    // Drift: a version made from no list of files, as a test's or one stored without it, must be served as one nothing is known of, never as one known to hold nothing.
    test("a version stored without it is one nothing is known of, and a site from a backup carries what is given for each of its versions", async () => {
      const database = await opened(makeDatabase);
      const plain = await made(database, draft(REPORT));
      const gone = await made(database, draft("notes" as SiteName));
      await database.deleteSite(gone.id, BY_ADA);
      const held = { missing_page: true, bare_files: null };
      await storedBack(database, { ...gone, folder: mintSiteFolder() }, BY_ADA, new Map([[1, held]]));

      expect([(await database.findServed({ id: plain.id }, NOW))?.contents, (await database.findServed({ id: gone.id }, NOW))?.contents]).toEqual([{ missing_page: false, bare_files: null }, held]);
    });
  });
}
