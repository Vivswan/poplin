// The contract every `Database` keeps, as test cases that take a database factory. Every check reads back through the interface. Importing this file registers nothing.

import { describe, expect, test } from "bun:test";

import type { SiteName } from "../../../src/names/names";
import type { Login } from "../../../src/auth/logins";
import { mintToken, type TokenRecord } from "../../../src/auth/tokens";
import type { DomainCheck } from "../../../src/records/domain-check";
import type { SiteId } from "../../../src/sites/ids";
import { auditLog, everLoggedIn } from "./audit-contract";
import {
  ADA,
  ADMIN,
  BO,
  BY_ADA,
  BY_BO_LATER,
  DOCS,
  type DatabaseFactory,
  NOTHING,
  NOW,
  NO_SITE,
  OTHER_SITE,
  REPORT,
  SETTINGS,
  TODAY,
  TOMORROW,
  auditTrail,
  draft,
  made,
  opened,
} from "./database-fixtures";
import { computerLogins, loginRoom, signingKey, tokensAndSettings } from "./login-contract";
import { backups, sites, sizes, versionContents, versions } from "./site-contract";
import { declaredFiles, storageWrites, uploadFiles, uploads } from "./upload-contract";

function emptyInstall(label: string, makeDatabase: DatabaseFactory): void {
  describe(`${label}: an empty install`, () => {
    // Drift: every read is asked before the first write; one that threw or made something up on an install with nothing in it would break setup.
    test("a new database holds no site, token, settings, signing key, or audit entry, and its totals are zero", async () => {
      const database = await opened(makeDatabase);

      expect<unknown>([
        await database.listSites({ trash: false, limit: 100 }),
        await database.listSites({ trash: true, limit: 100 }),
        await database.exportSites({ limit: 100 }),
        await database.getSite(NO_SITE),
        await database.getSiteByPublicName(DOCS),
        await database.findServed({ id: NO_SITE }, NOW),
        await database.readTotals(),
        await database.listTokens(),
        await database.getToken(ADA),
        await database.readSettings(),
        await database.readSigningKey(),
        await database.listAudit({ limit: 100 }),
      ]).toEqual([{ sites: [] }, { sites: [] }, { sites: [] }, undefined, undefined, undefined, NOTHING, [], undefined, undefined, undefined, []]);
    });
  });
}

function updateAddress(label: string, makeDatabase: DatabaseFactory): void {
  describe(`${label}: the address that starts a rebuild`, () => {
    // Drift: the address is a credential kept beside the signing key. A listing, an export, or an audit entry that carried it would hand whoever reads a backup the power to start builds.
    test("one address is kept, replaced, and removed, each audited once, and nothing but its own read holds it", async () => {
      const database = await opened(makeDatabase);
      await database.initSettings(SETTINGS, BY_ADA);
      await made(database, draft(REPORT));
      const none = await database.readUpdateAddress();
      await database.keepUpdateAddress("https://builds.provider.example/hooks/first-3f9c", BY_ADA);
      await database.keepUpdateAddress("https://builds.provider.example/hooks/second-7a1e", BY_BO_LATER);
      const kept = await database.readUpdateAddress();
      const shown = JSON.stringify([
        await database.exportSites({ limit: 100 }),
        await database.listSites({ trash: false, limit: 100 }),
        await database.readSettings(),
        await database.listTokens(),
        await database.listAudit({ limit: 100 }),
      ]);
      const removals = [await database.forgetUpdateAddress(BY_ADA), await database.forgetUpdateAddress(BY_ADA)];

      expect([none, kept, await database.readUpdateAddress(), removals]).toEqual([
        undefined,
        { address: "https://builds.provider.example/hooks/second-7a1e", since: BY_BO_LATER.at },
        undefined,
        [{ kind: "done" }, { kind: "unchanged" }],
      ]);
      expect(["builds.provider", "first-3f9c", "second-7a1e"].filter((needle) => shown.includes(needle))).toEqual([]);
      expect((await auditTrail(database)).map((entry) => [entry.by, entry.action, entry.detail]).slice(-3)).toEqual([
        [ADA, "update_address_set", {}],
        [BO, "update_address_set", {}],
        [ADA, "update_address_removed", {}],
      ]);
      expect(await database.readSigningKey()).toBeUndefined();
    });
  });
}

function sweepPlace(label: string, makeDatabase: DatabaseFactory): void {
  describe(`${label}: the place of the scheduled sweep`, () => {
    // Drift: a new instance may make every scheduled run, so the kept place is all that carries a walk from one run to the next. One that read back changed would skip sites, and one never forgotten would keep a new walk from starting.
    test("the place reads back as it was kept, the last one kept is the one read, and a forgotten one is gone", async () => {
      const database = await opened(makeDatabase);
      const inTrash = { trash: true, after: { updated_at: NOW, id: OTHER_SITE } } as const;
      const before = await database.readSweepPlace();

      await database.keepSweepPlace(inTrash);
      const first = await database.readSweepPlace();
      await database.keepSweepPlace({ leftovers: true });
      const second = await database.readSweepPlace();
      await database.keepSweepPlace(undefined);

      expect([before, first, second, await database.readSweepPlace()]).toEqual([undefined, inTrash, { leftovers: true }, undefined]);
    });
  });
}

function updateCheck(label: string, makeDatabase: DatabaseFactory): void {
  describe(`${label}: the newest release the install knows of`, () => {
    // Drift: the day's one question about a newer version is asked again only when the kept moment is of another day. A moment or a release that read back changed would ask on every scheduled run, or show a release nobody published.
    test("what was kept reads back as it was, with a release and with none, and the last kept is the one read", async () => {
      const database = await opened(makeDatabase);
      const release = { version: "0.2.0", released: "2026-12-01", notes: "https://example.com/changelog/#v0-2-0", database: true };
      const before = await database.readUpdateCheck();

      await database.keepUpdateCheck({ checked_at: NOW, news: null });
      const none = await database.readUpdateCheck();
      await database.keepUpdateCheck({ checked_at: NOW + 1, news: release });

      expect([before, none, await database.readUpdateCheck()]).toEqual([
        undefined,
        { checked_at: NOW, news: null, seen_at: null, auto: null },
        { checked_at: NOW + 1, news: release, seen_at: NOW + 1, auto: null },
      ]);
    });

    // Drift: the install starts a release by itself only some days after it first learned of its version. A moment that moved with every asking would never let the wait end, and one that stayed over a new version would start that one at once.
    test("the moment a version was first learned of stays while later askings name it, moves when they name another, and goes when they name none", async () => {
      const database = await opened(makeDatabase);
      const release = { version: "0.2.0", released: "2026-12-01", notes: "https://example.com/changelog/#v0-2-0", database: false };
      const kept = [];

      for (const news of [release, { ...release, notes: "https://example.com/changelog/" }, { ...release, version: "0.3.0" }, null, release]) {
        const written = await database.keepUpdateCheck({ checked_at: NOW + kept.length, news });
        kept.push([written.seen_at, (await database.readUpdateCheck())?.seen_at]);
      }

      expect(kept).toEqual([[NOW, NOW], [NOW, NOW], [NOW + 2, NOW + 2], [null, null], [NOW + 4, NOW + 4]]);
    });

    // Drift: one version is started by the install once. A try that an asking wiped, or one kept with no row to hold it, would be made again.
    test("a try to start by itself reads back, stays over the askings after it, and is not kept before the first asking", async () => {
      const database = await opened(makeDatabase);
      const start = { version: "0.2.0", at: NOW, taken: null };

      await database.keepAutoStart(start);
      const before = await database.readUpdateCheck();
      await database.keepUpdateCheck({ checked_at: NOW, news: null });
      await database.keepAutoStart(start);
      await database.keepAutoStart({ ...start, taken: "0.2.0" });
      const written = await database.keepUpdateCheck({ checked_at: NOW + 1, news: null });

      expect([before, written, await database.readUpdateCheck()]).toEqual([undefined, { checked_at: NOW + 1, news: null, seen_at: null, auto: { ...start, taken: "0.2.0" } }, written]);
    });

    // Drift: the frame of every screen is drawn from one read of four records. One that gave a record differently from its own read would show a release, a start, or an alarm that the screen behind it denies.
    test("the frame's one read gives the settings, the saved address, the kept run, and the last asking, each as its own read gives it: nothing on an empty install, then each once it is kept", async () => {
      const database = await opened(makeDatabase);
      const empty = await database.readFrame();
      await database.initSettings(SETTINGS, BY_ADA);
      await database.keepUpdateAddress("https://builds.provider.example/hooks/first-3f9c", BY_ADA);
      await database.keepDomainCheck({ ran_at: NOW, by: ADA, run: "check", pieces: [{ piece: "Record", detail: "every site", part: "reach", state: "ok" }] }, { run: "check" });
      await database.keepUpdateCheck({ checked_at: NOW, news: null });
      const each = { settings: await database.readSettings(), updateAddress: await database.readUpdateAddress(), domainCheck: await database.readDomainCheck(), updateCheck: await database.readUpdateCheck() };

      expect([empty, Object.values(each).includes(undefined), await database.readFrame()]).toEqual([{ settings: undefined, updateAddress: undefined, domainCheck: undefined, updateCheck: undefined }, false, each]);
    });
  });
}

function domainCheck(label: string, makeDatabase: DatabaseFactory): void {
  describe(`${label}: the last check of the domain`, () => {
    // Drift: the note that says what needs fixing is derived from this one record. A piece that read back in another state, or a run that left the one before it beside it, would show a healthy install as broken or a broken one as healthy.
    test("a kept run reads back as it was, the next one replaces it, and each writes one audit entry signed by whoever ran it", async () => {
      const database = await opened(makeDatabase);
      const first: DomainCheck = {
        ran_at: NOW,
        by: ADA,
        run: "check",
        pieces: [
          { piece: "Record", detail: "every site", part: "reach", state: "needs_repair" },
          { piece: "Login", detail: "the dashboard's login", part: "login", state: "unread", reason: "missing_right", right: "Login: Edit" },
          { piece: "Rule", detail: "left out: the plan has none", part: "rest", state: "not_set_up" },
          { piece: "Database", detail: "", part: "rest", state: "unread", reason: "not_run" },
        ],
      };
      const second: DomainCheck = { ran_at: NOW + 5, by: ADA, run: "repair", pieces: [{ piece: "Record", detail: "every site", part: "reach", state: "ok" }] };
      const before = await database.readDomainCheck();

      await database.keepDomainCheck(first, { run: "check", from: "dashboard" });
      const kept = await database.readDomainCheck();
      await database.keepDomainCheck(second, { run: "repair", from: "setup" });

      expect([before, kept, await database.readDomainCheck()]).toEqual([undefined, { ...first, users_changed_at: null }, { ...second, users_changed_at: null }]);
      expect(await database.readFrame()).toEqual({ settings: undefined, updateAddress: undefined, domainCheck: { ...second, users_changed_at: null }, updateCheck: undefined });
      expect((await auditTrail(database)).map(({ action, by, at, detail }) => ({ action, by, at, detail }))).toEqual([
        { action: "domain_synced", by: ADA, at: NOW, detail: { run: "check", from: "dashboard" } },
        { action: "domain_synced", by: ADA, at: NOW + 5, detail: { run: "repair", from: "setup" } },
      ]);
    });

    // Drift: the domain's login lets in the users of the last repair. A change that no row remembered, or that a check or an earlier repair cleared, would leave Domain saying nothing is left to do while a new user cannot log in.
    test("a user added or removed waits until a repair that began no earlier settles it, and a login left as it was changes nothing", async () => {
      const database = await opened(makeDatabase);
      const [bo, cy] = ["bo@example.com" as Login, "cy@example.com" as Login];
      const run = (kind: DomainCheck["run"]): DomainCheck => ({ ran_at: NOW + 9, by: ADMIN, run: kind, pieces: [] });
      const waits = async (): Promise<number | null | undefined> => (await database.readDomainCheck())?.users_changed_at;
      await database.initSettings(SETTINGS, BY_ADA);

      await database.addLogin(bo, BY_ADA);
      const beforeAnyRun = await waits();
      await database.keepDomainCheck(run("check"), {});
      const afterFirstRun = await waits();
      await database.addLogin(cy, { by: ADMIN, at: NOW + 1 });
      await database.addLogin(cy, { by: ADMIN, at: NOW + 2 });
      const afterAdd = await waits();
      await database.keepDomainCheck(run("check"), {});
      await database.keepDomainCheck(run("repair"), {});
      await database.keepDomainCheck(run("repair"), {}, NOW);
      const afterRunsThatSettleNothing = await waits();
      await database.keepDomainCheck(run("repair"), {}, NOW + 1);
      const afterRepair = await waits();
      await database.removeLogin(cy, { by: ADMIN, at: NOW + 3 });
      await database.removeLogin(cy, { by: ADMIN, at: NOW + 4 });
      await database.removeLogin(ADMIN, { by: ADMIN, at: NOW + 5 });

      expect([beforeAnyRun, afterFirstRun, afterAdd, afterRunsThatSettleNothing, afterRepair, await waits()]).toEqual([undefined, null, NOW + 1, NOW + 1, null, NOW + 3]);
    });

    // Drift: the logins are also replaced as a setting, by `poplin config logins` and by an import with its users. A list that marked nothing would let Domain say all is well while the user it added cannot log in.
    test("the logins replaced as a setting wait for a repair when the list adds or drops a user, and not when it holds the same users or names no logins", async () => {
      const database = await opened(makeDatabase);
      const [bo, cy] = ["bo@example.com" as Login, "cy@example.com" as Login];
      const waits = async (): Promise<number | null | undefined> => (await database.readDomainCheck())?.users_changed_at;
      const replaced = async (logins: Login[], at: number): Promise<number | null | undefined> => {
        await database.changeSettings({ logins, trash_days: at }, { by: ADMIN, at: NOW + at });

        return waits();
      };
      await database.initSettings({ ...SETTINGS, logins: [ADMIN, bo] }, BY_ADA);

      const beforeAnyRun = await replaced([ADMIN], 1);
      await database.keepDomainCheck({ ran_at: NOW + 1, by: ADMIN, run: "repair", pieces: [] }, {});
      await database.changeSettings({ trash_days: 30 }, { by: ADMIN, at: NOW + 2 });
      const otherSetting = await waits();
      const sameUser = await replaced([ADMIN], 3);
      const added = await replaced([ADMIN, bo], 4);
      const otherOrder = await replaced([bo, ADMIN], 5);
      const dropped = await replaced([bo], 6);
      const swapped = await replaced([cy], 7);

      expect([beforeAnyRun, otherSetting, sameUser, added, otherOrder, dropped, swapped]).toEqual([undefined, null, null, NOW + 4, NOW + 4, NOW + 6, NOW + 7]);
      expect((await database.readSettings())?.logins).toEqual([cy]);
    });
  });
}

function requestCounts(label: string, makeDatabase: DatabaseFactory): void {
  describe(`${label}: the day's request counts`, () => {
    // Drift: the limits on a day's requests read these two numbers; a site's requests left out of the total, or yesterday's carried over, would refuse the wrong site.
    test("two sites add to their own counts and to one total, a read changes nothing, and a new day starts from nothing", async () => {
      const database = await opened(makeDatabase);

      expect(await database.readRequests(TODAY, NO_SITE)).toEqual({ site: 0, all: 0 });
      expect(await database.addRequests({ day: TODAY, site: NO_SITE, requests: 50 })).toEqual({ site: 50, all: 50 });
      expect(await database.addRequests({ day: TODAY, site: OTHER_SITE, requests: 1 })).toEqual({ site: 1, all: 51 });
      expect(await database.addRequests({ day: TODAY, site: NO_SITE, requests: 50 })).toEqual({ site: 100, all: 101 });
      expect(await database.readRequests(TODAY, NO_SITE)).toEqual({ site: 100, all: 101 });
      expect([await database.readRequests(TODAY), await database.readRequests(TOMORROW)]).toEqual([
        { site: 0, all: 101 },
        { site: 0, all: 0 },
      ]);
      expect([await database.readRequests(TOMORROW, NO_SITE), await database.readRequests(TODAY, NO_SITE)]).toEqual([
        { site: 0, all: 0 },
        { site: 100, all: 101 },
      ]);
      expect(await database.addRequests({ day: TOMORROW, site: OTHER_SITE, requests: 2 })).toEqual({ site: 2, all: 2 });
      expect([await database.readRequests(TODAY, NO_SITE), await database.readRequests(TODAY, OTHER_SITE)]).toEqual([
        { site: 100, all: 101 },
        { site: 1, all: 101 },
      ]);
      await expect(database.readRequests("today", NO_SITE)).rejects.toThrow(RangeError);
      expect(await auditTrail(database)).toEqual([]);
    });

    // Drift: a site's views are a sum over seven UTC days read by day and site; a day too many, a day of another month sorted wrongly, or another site's rows would show opens that never were.
    test("views add up per site over the day and the six before it, across a month's end, apart from the requests, and a count is dropped with the first addition a year after its day", async () => {
      const database = await opened(makeDatabase);
      const counted = [
        { day: "2026-10-25", site: NO_SITE, requests: 9, views: 9 },
        { day: "2026-10-26", site: NO_SITE, requests: 50, views: 50 },
        { day: "2026-10-31", site: NO_SITE, requests: 4, views: 3 },
        { day: "2026-11-01", site: NO_SITE, requests: 10, views: 2 },
        { day: "2026-11-01", site: NO_SITE, requests: 5 },
        { day: "2026-11-01", site: OTHER_SITE, requests: 7, views: 7 },
      ];
      for (const one of counted) await database.addRequests(one);

      expect([...(await database.readViews([NO_SITE, OTHER_SITE, "bbbbbbbbbbbb" as SiteId], "2026-11-01"))]).toEqual([
        [NO_SITE, { today: 2, week: 55 }],
        [OTHER_SITE, { today: 7, week: 7 }],
        ["bbbbbbbbbbbb" as SiteId, { today: 0, week: 0 }],
      ]);
      expect([...(await database.readViews([NO_SITE], "2026-10-31"))]).toEqual([[NO_SITE, { today: 3, week: 62 }]]);
      expect([await database.readViews([], "2026-11-01"), await database.readRequests("2026-11-01", NO_SITE)]).toEqual([new Map(), { site: 15, all: 22 }]);

      await database.addRequests({ day: "2027-10-25", site: OTHER_SITE, requests: 1 });
      const kept = await database.readViews([NO_SITE], "2026-11-01");
      await database.addRequests({ day: "2027-10-26", site: OTHER_SITE, requests: 1 });

      expect([[...kept], [...(await database.readViews([NO_SITE], "2026-11-01"))]]).toEqual([[[NO_SITE, { today: 2, week: 55 }]], [[NO_SITE, { today: 2, week: 5 }]]]);
      await expect(database.readViews([NO_SITE], "tomorrow")).rejects.toThrow(RangeError);
    });

    // Drift: a graph draws one point a day; a day with no row left out, a count put on its neighbour, or all sites summed from the sites asked for would draw a trend that never was.
    test("views are read day by day, the earliest day first: all sites together and each site asked for, 0 where nothing was counted, across a month's end", async () => {
      const database = await opened(makeDatabase);
      const counted = [
        { day: "2026-10-29", site: NO_SITE, requests: 9, views: 9 },
        { day: "2026-10-31", site: NO_SITE, requests: 4, views: 3 },
        { day: "2026-10-31", site: OTHER_SITE, requests: 6, views: 6 },
        { day: "2026-11-01", site: OTHER_SITE, requests: 7, views: 7 },
        { day: "2026-11-01", site: NO_SITE, requests: 5 },
        { day: "2026-11-02", site: NO_SITE, requests: 8, views: 8 },
      ];
      for (const one of counted) await database.addRequests(one);
      const unseen = "bbbbbbbbbbbb" as SiteId;

      const read = await database.readDailyViews([OTHER_SITE, unseen], "2026-11-01", 4);
      const alone = await database.readDailyViews([], "2026-11-02", 1);

      expect([read.days, read.all, [...read.sites], alone]).toEqual([
        ["2026-10-29", "2026-10-30", "2026-10-31", "2026-11-01"],
        [9, 0, 9, 7],
        [
          [OTHER_SITE, [0, 0, 6, 7]],
          [unseen, [0, 0, 0, 0]],
        ],
        { days: ["2026-11-02"], all: [8], sites: new Map() },
      ]);
    });

    // Drift: a read day by day costs a row for every day of every site; one that took any number of either would spend the database's rows of a day on a single page.
    test.each([
      ["a day that is no date", [], "tomorrow", 30],
      ["no days", [], "2026-11-01", 0],
      ["half a day", [], "2026-11-01", 1.5],
      ["a day more than a year", [], "2026-11-01", 366],
      ["fifty-one sites", Array.from({ length: 51 }, (_site, at) => `site-${at}`), "2026-11-01", 30],
    ])("a read day by day of %s is refused", async (_what, sites, day, count) => {
      const database = await opened(makeDatabase);

      await expect(database.readDailyViews(sites as SiteId[], day, count)).rejects.toThrow(RangeError);
    });

    // Drift: the counts are kept under a site's id, and a new link changes the id; counts left under the old one would show a site nobody ever opened, and free its share of the day.
    test("a site that gets a new id keeps its views and its day's requests under it, a site named twice is read once, and no other site's counts move", async () => {
      const database = await opened(makeDatabase);
      const site = await made(database, draft("report" as SiteName));
      const other = await made(database, draft("notes" as SiteName));
      const day = new Date(NOW).toISOString().slice(0, 10);
      const old = new Date(NOW - 365 * 86_400_000).toISOString().slice(0, 10);
      await database.addRequests({ day, site: site.id, requests: 15, views: 12 });
      await database.addRequests({ day, site: other.id, requests: 4, views: 3 });
      // Counted last, so no later count drops it: only the move could take it along.
      await database.addRequests({ day: old, site: site.id, requests: 9, views: 9 });

      const moved = await database.giveNewId(site.id, BY_ADA);
      if (moved.kind !== "done") throw new Error("no new id was given");

      expect([...(await database.readViews([moved.site.id, moved.site.id, site.id, other.id], day))]).toEqual([
        [moved.site.id, { today: 12, week: 12 }],
        [site.id, { today: 0, week: 0 }],
        [other.id, { today: 3, week: 3 }],
      ]);
      expect([await database.readRequests(day, moved.site.id), await database.readRequests(day, site.id), await database.readRequests(old, moved.site.id)]).toEqual([
        { site: 15, all: 19 },
        { site: 0, all: 19 },
        { site: 0, all: 9 },
      ]);
    });

    // Drift: a page view's one query reads beside the site what its instance holds no longer. A count or a setting that came out of it other than its own read gives would let a day's limit pass, or check a visitor against settings nobody stored.
    test("a lookup for serving gives the site as the plain lookup does and, only when asked, the day's counts and the settings with the key, each as its own read gives it", async () => {
      const database = await opened(makeDatabase);
      await database.initSettings(SETTINGS, BY_ADA);
      await database.ensureSigningKey(new Uint8Array(32).fill(7), NOW);
      const site = await made(database, draft("report" as SiteName, "public", DOCS));
      const day = new Date(NOW).toISOString().slice(0, 10);
      await database.addRequests({ day, site: site.id, requests: 5, views: 2 });
      await database.addRequests({ day, site: OTHER_SITE, requests: 3 });
      const served = await database.findServed({ id: site.id }, NOW);
      const all = { counts: { day, site: site.id }, settingsAndKey: true } as const;

      expect<unknown>([
        await database.findServedWith({ id: site.id }, NOW, {}),
        await database.findServedWith({ public_name: DOCS }, NOW, all),
        await database.findServedWith({ id: NO_SITE }, NOW, all),
        await database.findServedWith({ id: site.id }, NOW, { counts: { day: TOMORROW, site: site.id }, settingsAndKey: false }),
      ]).toEqual([
        { served },
        { served, counts: await database.readRequests(day, site.id), settingsAndKey: await database.readSettingsAndKey() },
        { served: undefined, counts: { site: 5, all: 8 }, settingsAndKey: await database.readSettingsAndKey() },
        { served, counts: { site: 0, all: 0 } },
      ]);
      expect(served?.site.id).toBe(site.id);
      await expect(database.findServedWith({ id: site.id }, NOW, { counts: { day: "today", site: site.id } })).rejects.toThrow(RangeError);
    });

    // Drift: a screen's page is one read that stands for four. One that gave a site other views than its own read, or lost the note of whoever published it, would show a table that its own panels deny.
    test("the page a screen lists is the plain page and, beside it, the settings, each site's views, and the note of each token that published one: what the four reads give apart", async () => {
      const database = await opened(makeDatabase);
      await database.initSettings(SETTINGS, BY_ADA);
      const minted = (note: string): Promise<TokenRecord> => mintToken({ scope: "publisher", note, now: NOW }).then((token) => token.record);
      const [named, removed, unnamed] = [await minted("ci"), await minted("agent"), await minted("")];
      for (const token of [named, removed, unnamed]) await database.addToken(token, BY_ADA);
      await database.revokeToken(removed.id, BY_ADA);
      const day = new Date(NOW).toISOString().slice(0, 10);
      const before = new Date(NOW - 6 * 86_400_000).toISOString().slice(0, 10);
      const sites = [];
      for (const [at, by] of [named.id, removed.id, unnamed.id, ADA].entries()) sites.push(await made(database, draft(`site-${at}` as SiteName), { by, at: NOW + at }));
      const [first, second] = sites.map((site) => site.id) as [SiteId, SiteId];
      await database.addRequests({ day, site: first, requests: 9, views: 7 });
      await database.addRequests({ day: before, site: first, requests: 5, views: 4 });
      await database.addRequests({ day, site: second, requests: 2, views: 0 });
      // Counted seven days back: the first day that a week ending today does not hold.
      await database.addRequests({ day: new Date(NOW - 7 * 86_400_000).toISOString().slice(0, 10), site: second, requests: 3, views: 3 });
      const query = { trash: false, limit: 3, sort: "name" } as const;
      const plain = await database.listSites(query);
      const ids = plain.sites.map((site) => site.id);

      const shown = await database.listShownSites(query, { day, publishers: true });
      const bare = await database.listShownSites({ ...query, ...(plain.next === undefined ? {} : { after: plain.next }) }, { day, publishers: false });

      expect<unknown>([plain.sites.length, plain.next === undefined, { sites: shown.sites, next: shown.next }]).toEqual([3, false, plain]);
      expect([shown.settings, [...shown.views], [...shown.publishers].sort()]).toEqual([SETTINGS, [...(await database.readViews(ids, day))], [...(await database.getTokenNames([named.id, removed.id, unnamed.id, ADA]))].sort()]);
      expect([...shown.views.values()]).toEqual([
        { today: 7, week: 11 },
        { today: 0, week: 0 },
        { today: 0, week: 0 },
      ]);
      const [listedFirst] = plain.sites;
      const one = listedFirst === undefined ? undefined : await database.getShownSite(listedFirst.id, { day, publishers: true });
      expect<unknown>([one, await database.getShownSite(NO_SITE, { day, publishers: true })]).toEqual([
        { settings: SETTINGS, site: listedFirst, views: { today: 7, week: 11 }, publishers: new Map([[named.id, "ci"]]) },
        { settings: SETTINGS, site: undefined, views: { today: 0, week: 0 }, publishers: new Map() },
      ]);
      expect<unknown>([bare.sites.map((site) => site.name), [...bare.views.values()], [...bare.publishers]]).toEqual([["site-3"], [{ today: 0, week: 0 }], []]);
      await expect(database.listShownSites(query, { day: "tomorrow", publishers: true })).rejects.toThrow(RangeError);
    });

    // Drift: additions from several Worker instances land at once; one read back and written again would lose the others.
    test("additions made at the same moment are all kept", async () => {
      const database = await opened(makeDatabase);
      await Promise.all(Array.from({ length: 20 }, () => database.addRequests({ day: TODAY, site: NO_SITE, requests: 5 })));

      expect(await database.readRequests(TODAY, NO_SITE)).toEqual({ site: 100, all: 100 });
    });

    // Drift: days are compared as text, so a day in another form would sort wrongly and be dropped or kept forever.
    test.each([
      { day: "2026-11-13T00:00", requests: 1 },
      { day: "today", requests: 1 },
      { day: TODAY, requests: 0 },
      { day: TODAY, requests: 1.5 },
      { day: TODAY, requests: 2, views: 3 },
      { day: TODAY, requests: 2, views: -1 },
      { day: TODAY, requests: 2, views: 0.5 },
    ])("day $day with $requests requests and $views views is refused and nothing is counted", async ({ day, requests, views }) => {
      const database = await opened(makeDatabase);

      await expect(database.addRequests({ day, site: NO_SITE, requests, views })).rejects.toThrow(RangeError);
      expect(await database.readRequests(TODAY, NO_SITE)).toEqual({ site: 0, all: 0 });
    });
  });
}

/**
 * Register the contract every `Database` keeps, whatever it stores its records in.
 *
 * @param makeDatabase - gives a new, empty database on every call; it draws its site ids from the function a case passes, and at random when none is passed
 */
export function describeDatabase(label: string, makeDatabase: DatabaseFactory): void {
  emptyInstall(label, makeDatabase);
  sites(label, makeDatabase);
  versions(label, makeDatabase);
  sizes(label, makeDatabase);
  backups(label, makeDatabase);
  signingKey(label, makeDatabase);
  updateAddress(label, makeDatabase);
  auditLog(label, makeDatabase);
  everLoggedIn(label, makeDatabase);
  tokensAndSettings(label, makeDatabase);
  computerLogins(label, makeDatabase);
  loginRoom(label, makeDatabase);
  sweepPlace(label, makeDatabase);
  updateCheck(label, makeDatabase);
  domainCheck(label, makeDatabase);
  requestCounts(label, makeDatabase);
  uploads(label, makeDatabase);
  uploadFiles(label, makeDatabase);
  declaredFiles(label, makeDatabase);
  storageWrites(label, makeDatabase);
  versionContents(label, makeDatabase);
}
