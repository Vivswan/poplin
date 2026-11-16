// The part of the database contract about the audit log: what is written to it, how it is read, and whether anybody has logged in.

import { describe, expect, test } from "bun:test";

import type { Login } from "../../../src/auth/logins";
import { mintToken } from "../../../src/auth/tokens";
import type { Database, Signed, SiteNow } from "../../../src/database/database";
import type { SiteName } from "../../../src/names/names";
import type { AuditEntry } from "../../../src/records/audit";
import type { Site } from "../../../src/records/site";
import {
  ADA,
  ADMIN,
  BO,
  BY_ADA,
  DOCS,
  type DatabaseFactory,
  FIRST_KEY,
  NOW,
  NO_SITE,
  REPORT,
  SETTINGS,
  auditTrail,
  draft,
  made,
  mintFrom,
  opened,
  publish,
  publishedSite,
  publishedVersion,
  storedBack,
} from "./database-fixtures";

/** One day, in milliseconds. */
const DAY_MS = 86_400_000;

export function auditLog(label: string, makeDatabase: DatabaseFactory): void {
  describe(`${label}: the audit log`, () => {
    const signed: Signed = { as: "token", by: BO, at: NOW + 1 };

    // Drift: the Activity tab is only as true as this; a change with no entry, or an entry for a change that was refused, makes it lie.
    test.each([
      ["a site made", async (database: Database): Promise<unknown> => publishedSite(database, draft(DOCS), signed), ["create"]],
      [
        "access changed",
        async (database: Database, site: Site): Promise<unknown> => database.changeAccess(site.id, { access: "unlisted" }, signed),
        ["access"],
      ],
      ["details changed", async (database: Database, site: Site): Promise<unknown> => database.changeDetails(site.id, { title: "T" }, signed), ["details"]],
      ["a new id given", async (database: Database, site: Site): Promise<unknown> => database.giveNewId(site.id, signed), ["new_id"]],
      ["a site trashed", async (database: Database, site: Site): Promise<unknown> => database.trashSite(site.id, signed), ["trash"]],
      ["a site restored", async (database: Database, _site: Site, trashed: Site): Promise<unknown> => database.restoreSite(trashed.id, signed), ["restore"]],
      ["a site deleted", async (database: Database, site: Site): Promise<unknown> => database.deleteSite(site.id, signed), ["delete"]],
      [
        "a version reserved and published",
        async (database: Database, site: Site): Promise<unknown> => [
          await database.reserveVersion(site.id),
          await publishedVersion(database, site.id, publish(2, 3), signed),
        ],
        ["publish"],
      ],
      [
        "a token added",
        async (database: Database): Promise<unknown> => database.addToken((await mintToken({ scope: "publisher", note: "ci", now: NOW })).record, signed),
        ["token_added"],
      ],
      [
        "the live version moved back",
        async (database: Database, site: Site): Promise<unknown> => [
          await database.reserveVersion(site.id),
          await publishedVersion(database, site.id, publish(2, 3), signed),
          await database.setLiveVersion(site.id, "previous", signed),
        ],
        ["publish", "live_version"],
      ],
      ["settings changed", async (database: Database): Promise<unknown> => database.changeSettings({ trash_days: 30 }, signed), ["settings_changed"]],
      [
        "a deleted site imported",
        async (database: Database, site: Site): Promise<unknown> => [await database.deleteSite(site.id, signed), await storedBack(database, site, signed)],
        ["delete", "imported"],
      ],
      ["a visitor key stored where none was", async (database: Database): Promise<unknown> => database.ensureVisitorKey(FIRST_KEY, NOW), []],
      ["a site imported that is already there", async (database: Database, site: Site): Promise<unknown> => storedBack(database, site, signed), []],
      ["a note appended", async (database: Database): Promise<unknown> => database.appendAudit({ action: "login", detail: {} }, signed), ["login"]],
      [
        "access set to what it is",
        async (database: Database, site: Site): Promise<unknown> => database.changeAccess(site.id, { access: "private" }, signed),
        [],
      ],
      [
        "access changed on a trashed site",
        async (database: Database, _site: Site, trashed: Site): Promise<unknown> => database.changeAccess(trashed.id, { access: "unlisted" }, signed),
        [],
      ],
      [
        "details changed on a trashed site",
        async (database: Database, _site: Site, trashed: Site): Promise<unknown> => database.changeDetails(trashed.id, { title: "T" }, signed),
        [],
      ],
      ["a new id for a trashed site", async (database: Database, _site: Site, trashed: Site): Promise<unknown> => database.giveNewId(trashed.id, signed), []],
      ["a new id for no site", async (database: Database): Promise<unknown> => database.giveNewId(NO_SITE, signed), []],
      ["a trashed site trashed again", async (database: Database, _site: Site, trashed: Site): Promise<unknown> => database.trashSite(trashed.id, signed), []],
      ["a live site restored", async (database: Database, site: Site): Promise<unknown> => database.restoreSite(site.id, signed), []],
      ["no site deleted", async (database: Database): Promise<unknown> => database.deleteSite(NO_SITE, signed), []],
      [
        "a version reserved for a trashed site",
        async (database: Database, _site: Site, trashed: Site): Promise<unknown> => database.reserveVersion(trashed.id),
        [],
      ],
      [
        "a version published to a trashed site",
        async (database: Database, _site: Site, trashed: Site): Promise<unknown> => publishedVersion(database, trashed.id, publish(1, 3), signed),
        [],
      ],
      [
        "an unreserved version published",
        async (database: Database, site: Site): Promise<unknown> => publishedVersion(database, site.id, publish(2, 3), signed),
        [],
      ],
      ["the live version set to what it is", async (database: Database, site: Site): Promise<unknown> => database.setLiveVersion(site.id, 1, signed), []],
      [
        "the live version moved on a trashed site",
        async (database: Database, _site: Site, trashed: Site): Promise<unknown> => database.setLiveVersion(trashed.id, "previous", signed),
        [],
      ],
      ["no token revoked", async (database: Database): Promise<unknown> => database.revokeToken(BO, signed), []],
      ["settings stored a second time", async (database: Database): Promise<unknown> => database.initSettings(SETTINGS, signed), []],
      ["no setting changed", async (database: Database): Promise<unknown> => database.changeSettings({}, signed), []],
      [
        "a setting set to what it is",
        async (database: Database): Promise<unknown> =>
          database.changeSettings({ trash_days: 7, default_expires: "never", logins: SETTINGS.logins }, signed),
        [],
      ],
    ] as const)("%s writes exactly these entries: %#", async (_case, change, entries) => {
      const database = await opened(makeDatabase);
      const site = await made(database, draft(REPORT));
      const trashed = await made(database, draft(REPORT));
      await database.trashSite(trashed.id, BY_ADA);
      await database.initSettings(SETTINGS, BY_ADA);
      const before = (await auditTrail(database)).length;
      await change(database, site, trashed);

      const written = (await auditTrail(database)).slice(before);

      expect<unknown>(written.map((entry) => [entry.action, entry.by, entry.at])).toEqual(entries.map((action) => [action, BO, NOW + 1]));
    });

    test("entries read back newest first, a page at a time, each with who, when, and the site as it was named then", async () => {
      const database = await opened(makeDatabase);
      const site = await made(database, draft(REPORT));
      await database.trashSite(site.id, { as: "token", by: BO, at: NOW + 1 });
      await database.deleteSite(site.id, { as: "token", by: BO, at: NOW + 2 });
      await database.appendAudit({ action: "login", detail: { from: "dashboard" } }, { as: "person", by: "ada@example.com" as Login, at: NOW + 3 });
      const named = { id: site.id, name: REPORT };
      const newest = await database.listAudit({ limit: 2 });

      expect(newest).toEqual([
        { seq: 4, at: NOW + 3, by: "ada@example.com" as Login, action: "login", site: null, detail: { from: "dashboard" } },
        { seq: 3, at: NOW + 2, by: BO, action: "delete", site: named, detail: {} },
      ]);
      expect(await database.listAudit({ limit: 100, after: 3 })).toEqual([
        { seq: 2, at: NOW + 1, by: BO, action: "trash", site: named, detail: {} },
        { seq: 1, at: NOW, by: ADA, action: "create", site: named, detail: { access: "private", public_name: null } },
      ]);
      await expect(database.listAudit({ limit: 0 })).rejects.toThrow(RangeError);
    });

    // Drift: the Activity screen and a file of the log show each entry's site and login by what the page's own statement joined. A join that named another site, lost a moved or a trashed one, or dropped a removed token's note would show a wrong name.
    test("a named page holds a plain page's entries, each with the site and the token note the lookups by id answer: a site renamed, trashed or behind a new link, none once it is gone, and the holder of an id another site gave up", async () => {
      const database = await opened(makeDatabase, mintFrom("aaaaaaaaaaaa", "bbbbbbbbbbbb", "aaaaaaaaaaaa", "cccccccccccc", "dddddddddddd", "eeeeeeeeeeee"));
      const [laptop, agent, unnamed] = await Promise.all([{ note: "laptop" }, { note: "agent" }, { note: "" }].map(async ({ note }) => (await mintToken({ scope: "publisher", note, now: NOW })).record));
      if (laptop === undefined || agent === undefined || unnamed === undefined) throw new Error("no token was minted");

      for (const token of [laptop, agent, unnamed]) await database.addToken(token, BY_ADA);
      const first = await made(database, { ...draft(REPORT), title: "Typed" }, { as: "token", by: laptop.id, at: NOW });
      await database.giveNewId(first.id, { as: "token", by: agent.id, at: NOW });
      const holder = await made(database, draft(DOCS), { as: "token", by: unnamed.id, at: NOW });
      await database.changeDetails(holder.id, { name: "figures" as SiteName }, BY_ADA);
      const binned = await made(database, draft("binned" as SiteName));
      await database.trashSite(binned.id, BY_ADA);
      const gone = await made(database, draft("gone" as SiteName));
      await database.deleteSite(gone.id, BY_ADA);
      await database.revokeToken(agent.id, BY_ADA);
      await database.appendAudit({ action: "login", detail: {} }, BY_ADA);

      const named = await database.listNamedAudit({ limit: 100, dir: "asc" });
      const plain = await database.listAudit({ limit: 100, dir: "asc" });
      const ids = plain.flatMap((entry) => (entry.site === null ? [] : [entry.site.id]));
      const [names, later, notes] = await Promise.all([database.getSiteNames(ids), database.getLaterSites(ids), database.getTokenNames([laptop.id, agent.id, unnamed.id])]);
      const lookedUp = (id: SiteNow["id"]): SiteNow | null => {
        const now = names.get(id);

        return now === undefined ? (later.get(id) ?? null) : { id, ...now };
      };
      const searched = await database.searchNamedAudit({ limit: 100, dir: "asc", actions: ["create", "delete"] });

      expect(named).toEqual(plain.map((entry) => ({ entry, site: entry.site === null ? null : lookedUp(entry.site.id), tokenNote: notes.get(entry.by as never) ?? null })));
      expect(searched).toEqual({ entries: named.filter(({ entry }) => entry.action === "create" || entry.action === "delete"), stoppedAt: undefined });
      expect(named.filter(({ entry }) => entry.site !== null).map(({ entry, site, tokenNote }) => [entry.action, entry.site?.name, site?.id ?? null, site?.name ?? null, site?.title ?? null, tokenNote])).toEqual([
        ["create", REPORT, "aaaaaaaaaaaa", "figures", null, "laptop"],
        ["new_id", REPORT, "bbbbbbbbbbbb", REPORT, "Typed", "agent"],
        ["create", DOCS, "aaaaaaaaaaaa", "figures", null, null],
        ["details", "figures", "aaaaaaaaaaaa", "figures", null, null],
        ["create", "binned", "cccccccccccc", "binned", null, null],
        ["trash", "binned", "cccccccccccc", "binned", null, null],
        ["create", "gone", null, null, null, null],
        ["delete", "gone", null, null, null, null],
      ]);
      await expect(database.listNamedAudit({ limit: 1001 })).rejects.toThrow(RangeError);
      await expect(database.searchNamedAudit({ limit: 0, actions: ["create"] })).rejects.toThrow(RangeError);
    });

    // Drift: a file of the log is read 1,000 entries a reading; a reading cut at a listing's 100 would end the file early, and one with no bound would hold a whole long log in memory.
    test("one reading holds up to 1,000 entries, and no more is asked of it", async () => {
      const database = await opened(makeDatabase);
      for (let count = 0; count < 120; count += 1) await database.appendAudit({ action: "login", detail: {} }, { as: "token", by: BO, at: NOW + count });
      const read = await database.listAudit({ limit: 1000 });

      expect([read.length, read.at(0)?.seq, read.at(-1)?.seq]).toEqual([120, 120, 1]);
      await expect(database.listAudit({ limit: 1001 })).rejects.toThrow(RangeError);
    });

    // Drift: the Activity page's filters are these conditions; one that matched a name's LIKE signs, or was dropped on the second page, would show entries the filter says are left out.
    test("a page is narrowed to some actions and to the sites whose name then held a text, and the next page stays narrowed", async () => {
      const database = await opened(makeDatabase);
      await made(database, draft("abc" as SiteName));
      const report = await made(database, draft(REPORT));
      await database.appendAudit({ action: "login", detail: {} }, { as: "token", by: BO, at: NOW });
      const docs = await made(database, draft(DOCS));
      await database.trashSite(report.id, { as: "token", by: BO, at: NOW + 1 });
      await database.appendAudit({ action: "login", detail: {} }, { as: "token", by: BO, at: NOW + 2 });
      await database.trashSite(docs.id, { as: "token", by: BO, at: NOW + 3 });
      const told = (entries: readonly AuditEntry[]): unknown[] => entries.map((entry) => [entry.action, entry.site?.name ?? null]);
      const narrowed = { actions: ["trash", "create"], site: "o" } as const;
      const found = async (query: Parameters<Database["searchAudit"]>[0]): Promise<unknown[]> => told((await database.searchAudit(query)).entries);
      const first = await database.searchAudit({ limit: 2, ...narrowed });

      expect([
        await found({ limit: 100, actions: ["trash", "login"] }),
        await found({ limit: 100, site: REPORT }),
        told(first.entries),
        await found({ limit: 3, ...narrowed, after: first.entries.at(-1)?.seq }),
        await found({ limit: 100, site: "%" }),
        await found({ limit: 100, site: "\0" }),
        await found({ limit: 100, actions: [] }),
      ]).toEqual([
        [
          ["trash", DOCS],
          ["login", null],
          ["trash", REPORT],
          ["login", null],
        ],
        [
          ["trash", REPORT],
          ["create", REPORT],
        ],
        [
          ["trash", DOCS],
          ["trash", REPORT],
        ],
        [
          ["create", DOCS],
          ["create", REPORT],
        ],
        [],
        [],
        [],
      ]);
    });

    // Drift: the Activity screen shows a site by the title it has now, which no entry holds: a search by what the screen shows would find nothing, or miss the entries from before a new link, or the count would tell another number than the page holds.
    test("a text finds the entries of a site by the title and the name it has now, whatever the case of its letters, those from before a new link among them, and the count agrees", async () => {
      const database = await opened(makeDatabase);
      const report = await made(database, { ...draft(REPORT), title: "Q3 sales" });
      await made(database, { ...draft(DOCS), page_title: "Handbook" });
      const moved = await database.giveNewId(report.id, BY_ADA);
      if (moved.kind !== "done") throw new Error("no new id was given");

      await database.changeDetails(moved.site.id, { name: "figures" as SiteName }, BY_ADA);
      const texts = ["q3 SALES", "figures", "REPORT", "handbook", "sales handbook"];
      const pages = await Promise.all(texts.map(async (site) => (await database.searchAudit({ limit: 100, dir: "asc", site })).entries.map((entry) => entry.action)));
      const counts = await Promise.all(texts.map(async (site) => (await database.countAudit({ most: 100, site })).count));

      expect([pages, counts]).toEqual([[["create", "new_id", "details"], ["create", "new_id", "details"], ["create", "new_id"], ["create"], []], [3, 3, 2, 1, 0]]);
    });

    // Drift: "Only this site" on the Activity screen is this condition. Narrowed by the name then, it would show another site of that name and lose the entries from before a rename; by the id alone, those from before a new link.
    test("an id finds the entries of the one site that has it or had it, through a rename and two new links; a site of the same name stays out, a site gone for good keeps the entries that hold the id, and the count agrees", async () => {
      const database = await opened(makeDatabase);
      const report = await made(database, draft(REPORT));
      const twin = await made(database, draft(REPORT));
      const moved = await database.giveNewId(report.id, BY_ADA);
      if (moved.kind !== "done") throw new Error("no new id was given");

      await database.changeDetails(moved.site.id, { name: "figures" as SiteName }, BY_ADA);
      const again = await database.giveNewId(moved.site.id, BY_ADA);
      const docs = await made(database, draft(DOCS));
      const gone = await database.giveNewId(docs.id, BY_ADA);
      if (again.kind !== "done" || gone.kind !== "done") throw new Error("no new id was given");

      await database.deleteSite(gone.site.id, BY_ADA);
      const asked = [
        { of: report.id },
        { of: moved.site.id },
        { of: again.site.id },
        { of: again.site.id, actions: ["new_id", "delete"] },
        { of: twin.id },
        { of: docs.id },
        { of: gone.site.id },
        { of: NO_SITE },
      ] as const;
      const pages = await Promise.all(asked.map(async (query) => (await database.searchAudit({ limit: 100, dir: "asc", ...query })).entries.map((entry) => entry.action)));
      const counts = await Promise.all(asked.map(async (query) => (await database.countAudit({ most: 100, ...query })).count));
      const whole = ["create", "new_id", "details", "new_id"];

      expect<unknown>([pages, counts]).toEqual([[whole, whole, whole, ["new_id", "new_id"], ["create"], ["create"], ["new_id", "delete"], []], [4, 4, 4, 2, 1, 1, 2, 0]]);
    });

    // Drift: the total the Activity screen shows is this count; one that counted past its bound would read a long log whole, and one that called a cut count exact would show a wrong total.
    // A log of exactly as many entries as the count reads was said to go on: the screen wrote its exact total with a plus.
    test("a count keeps the narrowing of a page and reads no further back than it is told, saying that the log goes on only when it does", async () => {
      const database = await opened(makeDatabase);
      const report = await made(database, draft(REPORT));
      await database.appendAudit({ action: "login", detail: {} }, { as: "token", by: BO, at: NOW });
      await made(database, draft(DOCS));
      await database.trashSite(report.id, { as: "token", by: BO, at: NOW + 1 });

      const whole = [{ most: 5 }, { most: 4 }, { most: 100, actions: ["create"] }, { most: 100, site: "o" }, { most: 4, site: "o" }, { most: 100, actions: ["login"], site: "o" }, { most: 100, actions: [] }] as const;
      const cut = [{ most: 3 }, { most: 3, site: "o" }, { most: 2, actions: ["create"] }, { most: 1, actions: ["create"] }] as const;
      const counted = await Promise.all([...whole, ...cut].map(async (query) => Object.values(await database.countAudit(query))));

      expect(counted).toEqual([[4, true], [4, true], [2, true], [3, true], [3, true], [0, true], [0, true], [3, false], [2, false], [1, false], [0, false]]);
      await expect(database.countAudit({ most: 0 })).rejects.toThrow(RangeError);
    });

    // Drift: the next file of the log goes on after this place; one entry too early repeats an entry in two files, one too late drops one, and a place where the log has ended offers an empty file.
    test("a part of the log ends on its last entry when an entry lies behind it, and nowhere when the log ends with it", async () => {
      const database = await opened(makeDatabase);
      const report = await made(database, draft(REPORT));
      await database.appendAudit({ action: "login", detail: {} }, { as: "token", by: BO, at: NOW });
      await made(database, draft(DOCS));
      await database.trashSite(report.id, { as: "token", by: BO, at: NOW + 1 });

      const parts = [{ entries: 1 }, { entries: 3 }, { entries: 4 }, { entries: 2, after: 3 }, { entries: 1, after: 3 }] as const;

      expect(await Promise.all(parts.map((query) => database.endOfAuditPart(query)))).toEqual([4, 2, undefined, undefined, 2]);
      await expect(database.endOfAuditPart({ entries: 0 })).rejects.toThrow(RangeError);
    });

    // Drift: a listing oldest first pages by the same cursor as one newest first; a cursor read the wrong way round, or a filter dropped in one direction, would repeat a page or skip the entries between two pages.
    test.each([
      ["every entry", {}, "desc", [["trash docs", "login"], ["trash report", "create docs"], ["login", "create report"], ["create abc"]]],
      ["every entry", {}, "asc", [["create abc", "create report"], ["login", "create docs"], ["trash report", "login"], ["trash docs"]]],
      ["some actions", { actions: ["trash", "create"] }, "desc", [["trash docs", "trash report"], ["create docs", "create report"], ["create abc"]]],
      ["some actions", { actions: ["trash", "create"] }, "asc", [["create abc", "create report"], ["create docs", "trash report"], ["trash docs"]]],
      ["the sites named with a text", { site: "o" }, "desc", [["trash docs", "trash report"], ["create docs", "create report"], []]],
      ["the sites named with a text", { site: "o" }, "asc", [["create report", "create docs"], ["trash report", "trash docs"], []]],
      ["one action of the sites named with a text", { actions: ["trash"], site: "o" }, "desc", [["trash docs", "trash report"], []]],
      ["one action of the sites named with a text", { actions: ["trash"], site: "o" }, "asc", [["trash report", "trash docs"], []]],
    ] as const)("%s, %s: each page of two starts behind the last entry of the page before, to the end of the log", async (_name, narrowed, dir, pages) => {
      const database = await opened(makeDatabase);
      await made(database, draft("abc" as SiteName));
      const report = await made(database, draft(REPORT));
      await database.appendAudit({ action: "login", detail: {} }, { as: "token", by: BO, at: NOW });
      const docs = await made(database, draft(DOCS));
      await database.trashSite(report.id, { as: "token", by: BO, at: NOW + 1 });
      await database.appendAudit({ action: "login", detail: {} }, { as: "token", by: BO, at: NOW + 2 });
      await database.trashSite(docs.id, { as: "token", by: BO, at: NOW + 3 });
      const read: string[][] = [];
      let after: number | undefined;

      do {
        const asked = { limit: 2, dir, ...narrowed, after };
        // A short log lies inside one window, so a narrowed reading never stops short of its end here.
        const page = "actions" in narrowed || "site" in narrowed ? (await database.searchAudit(asked)).entries : await database.listAudit(asked);
        read.push(page.map((entry) => (entry.site === null ? entry.action : `${entry.action} ${entry.site.name}`)));
        after = page.at(-1)?.seq;
      } while (read.at(-1)?.length === 2);

      expect<unknown>(read).toEqual(pages);
    });
  });
}

export function auditTrim(label: string, makeDatabase: DatabaseFactory): void {
  describe(`${label}: the sweep's trim of the audit log`, () => {
    const at = (daysAgo: number): Signed => ({ as: "person", by: ADMIN, at: NOW - daysAgo * DAY_MS });
    const held = async (database: Database): Promise<unknown> => [(await auditTrail(database)).map((entry) => entry.seq), await database.countAudit({ most: 1000 })];

    // Drift: the Activity screen counts the log from its two ends. A trim that took an old entry from behind a kept one would leave a gap and a count one too many, and one that took the newest entry would let the next entry take its number.
    test("it removes the entries of over 90 days ago from the oldest end up to the first one kept, never the newest, and the count from the two ends stays the count of the rows", async () => {
      const database = await opened(makeDatabase);
      for (const daysAgo of [100, 91, 90, 95, 1]) await database.appendAudit({ action: "login", detail: {} }, at(daysAgo));

      await database.sweepRunOut(NOW);
      const once = await held(database);
      await database.sweepRunOut(NOW + 200 * DAY_MS);
      const allOld = await held(database);
      await database.appendAudit({ action: "login", detail: {} }, at(-200));

      expect([once, allOld, await held(database)]).toEqual([
        [[3, 4, 5], { count: 3, whole: true }],
        [[5], { count: 1, whole: true }],
        [[5, 6], { count: 2, whole: true }],
      ]);
    });

    // Drift: the provider counts every entry a sweep removes against the day's writes, so one run takes a bounded number and the next goes on where it stopped.
    test("one sweep removes no more than 100 entries, and the next one goes on", async () => {
      const database = await opened(makeDatabase);
      for (let entry = 0; entry < 105; entry += 1) await database.appendAudit({ action: "login", detail: {} }, at(100));
      await database.appendAudit({ action: "login", detail: {} }, at(1));

      await database.sweepRunOut(NOW);
      const once = await held(database);
      await database.sweepRunOut(NOW);

      expect([once, await held(database)]).toEqual([
        [[101, 102, 103, 104, 105, 106], { count: 6, whole: true }],
        [[106], { count: 1, whole: true }],
      ]);
    });

    // Drift: the setup page is shut by the first login for good. A trim that took the only login entry and left no sign would open the page again to anyone, and with it the change of who may log in.
    test("a log nobody logged in to loses nothing, and one that lost its login entries still says that somebody logged in", async () => {
      const database = await opened(makeDatabase);
      for (const daysAgo of [100, 100, 1]) await database.appendAudit({ action: "domain_synced", detail: {} }, at(daysAgo));
      await database.sweepRunOut(NOW);
      const unused = [await held(database), await database.hasLoggedIn()];
      await database.appendAudit({ action: "login", detail: {} }, at(1));
      await database.appendAudit({ action: "domain_synced", detail: {} }, at(0));
      await database.sweepRunOut(NOW + 200 * DAY_MS);

      expect([unused, [await held(database), await database.hasLoggedIn()]]).toEqual([
        [[[1, 2, 3], { count: 3, whole: true }], false],
        [[[5], { count: 1, whole: true }], true],
      ]);
    });
  });
}

export function everLoggedIn(label: string, makeDatabase: DatabaseFactory): void {
  describe(`${label}: whether anybody has logged in`, () => {
    // Drift: the setup page is open to anyone until the first login and shut for good after it; an answer that counted another entry as a login would shut it on the person setting up, and one that missed a login under later entries would open it again.
    test("it is no before any login, whatever else the log holds, and yes from the first login on, however much is written after it", async () => {
      const database = await opened(makeDatabase);
      const by: Signed = { as: "token", by: ADA, at: NOW };
      const before = await database.hasLoggedIn();
      await database.initSettings(SETTINGS, by);
      for (const action of ["domain_synced", "login_allowed", "login_denied", "signed_everyone_out"] as const) await database.appendAudit({ action, detail: { from: "login" } }, by);

      const without = await database.hasLoggedIn();
      await database.appendAudit({ action: "login", detail: {} }, by);
      const first = await database.hasLoggedIn();
      for (let entry = 0; entry < 150; entry += 1) await database.appendAudit({ action: "domain_synced", detail: { from: "setup" } }, by);

      expect([before, without, first, await database.hasLoggedIn()]).toEqual([false, false, true, true]);
    });

    // Drift: one login at the provider would leave a line for every instance that met it, or a later login of the same person, or a login of another, would leave none.
    test("a login is noted once: again only when it began after the last entry of its email, and each email by its own entries", async () => {
      const database = await opened(makeDatabase);
      await database.initSettings(SETTINGS, { as: "first_login", by: ADMIN, at: NOW });
      const eve = "eve@example.com" as Login;
      const noted: string[] = [];
      for (const [login, since, at] of [
        [ADMIN, NOW, NOW + 10],
        [ADMIN, NOW, NOW + 20],
        [ADMIN, NOW + 10, NOW + 30],
        [eve, NOW, NOW + 40],
        [ADMIN, NOW + 11, NOW + 50],
        [eve, NOW + 41, NOW + 41],
        [eve, NOW + 41, NOW + 60],
      ] as const) {
        noted.push((await database.noteLogin(login, { since, at })).kind);
      }
      const entries = (await database.listAudit({ limit: 10 })).filter((entry) => entry.action === "login").map((entry) => [entry.by, entry.at, entry.detail, entry.site]);

      expect([noted, entries, await database.hasLoggedIn()]).toEqual([
        ["written", "known", "known", "written", "written", "written", "known"],
        [
          [eve, NOW + 41, {}, null],
          [ADMIN, NOW + 50, {}, null],
          [eve, NOW + 40, {}, null],
          [ADMIN, NOW + 10, {}, null],
        ],
        true,
      ]);
    });
  });
}
