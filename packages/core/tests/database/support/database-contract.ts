// The contract every `Database` keeps, as test cases that take a database factory. Every check reads back through the interface. Importing this file registers nothing.

import { describe, expect, test } from "bun:test";

import type { SiteName } from "../../../src/names/names";
import type { Login } from "../../../src/auth/logins";
import { mintToken, type TokenRecord } from "../../../src/auth/tokens";
import type { ProblemNote } from "../../../src/database/problems";
import type { DomainCheck } from "../../../src/records/domain-check";
import type { SettingValues } from "../../../src/records/settings";
import { dayOf } from "../../../src/records/views";
import { mintSiteFolder } from "../../../src/records/site";
import type { SiteId } from "../../../src/sites/ids";
import { auditLog, auditTrim, everLoggedIn } from "./audit-contract";
import {
  ADA,
  ADMIN,
  BY_ADA,
  DOCS,
  type DatabaseFactory,
  NOTHING,
  NOW,
  NO_SITE,
  OTHER_SITE,
  SETTINGS,
  TODAY,
  TOMORROW,
  auditTrail,
  draft,
  made,
  opened,
} from "./database-fixtures";
import { computerLogins, loginRoom, visitorKey, tokensAndSettings } from "./login-contract";
import { backups, sites, sizes, versionContents, versions } from "./site-contract";
import { declaredFiles, storageWrites, uploadFiles, uploads } from "./upload-contract";

/** The marks of a kept run with no change waiting. */
const NOTHING_WAITS = { users_changed_at: null, rules_changed_at: null };

/** The milliseconds of one hour and of one day. */
const [HOUR_MS, DAY_MS] = [3_600_000, 86_400_000];

/** A midnight UTC, where an hour of the clock and a day both begin. */
const DAY_START = 1_699_920_000_000;

function emptyInstall(label: string, makeDatabase: DatabaseFactory): void {
  describe(`${label}: an empty install`, () => {
    // Drift: every read is asked before the first write; one that threw or made something up on an install with nothing in it would break setup.
    test("a new database holds no site, token, settings, visitor key, or audit entry, and its totals are zero", async () => {
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
        await database.readVisitorKey(),
        await database.listAudit({ limit: 100 }),
      ]).toEqual([{ sites: [] }, { sites: [] }, { sites: [] }, undefined, undefined, undefined, NOTHING, [], undefined, undefined, undefined, []]);
    });
  });
}

function sweepPlace(label: string, makeDatabase: DatabaseFactory): void {
  describe(`${label}: the place of the scheduled sweep`, () => {
    // Drift: a new instance may make every scheduled run, so the kept place is all that carries a walk from one run to the next. One that read back changed would skip sites, and one never forgotten would keep a new walk from starting.
    test("the place reads back as it was kept, the last one kept is the one read, and a forgotten one is gone", async () => {
      const database = await opened(makeDatabase);
      const inTrash = { trash: true } as const;
      const inLeftovers = { leftovers: true, after: mintSiteFolder() } as const;
      const before = await database.readSweepPlace();

      await database.keepSweepPlace(inTrash);
      const first = await database.readSweepPlace();
      await database.keepSweepPlace(inLeftovers);
      const second = await database.readSweepPlace();
      await database.keepSweepPlace(undefined);

      expect([before, first, second, await database.readSweepPlace()]).toEqual([undefined, inTrash, inLeftovers, undefined]);
    });

    // Drift: a scheduled run starts from one read of three records. One that gave the place, the settings, or the last asking differently from its own read would start a walk anew every run, or ask the website 96 times a day.
    test("a run's start reads the last asking, the settings, and the walk's place together, each as its own read gives it: nothing on an empty install, then each once it is kept", async () => {
      const database = await opened(makeDatabase);
      const empty = await database.readSweepStart();
      await database.initSettings(SETTINGS, BY_ADA);
      await database.keepUpdateCheck({ checked_at: NOW, news: null });
      await database.keepSweepPlace({ uploads: true });
      const each = { updateCheck: await database.readUpdateCheck(), settings: await database.readSettings(), place: await database.readSweepPlace() };

      expect([empty, Object.values(each).includes(undefined), await database.readSweepStart()]).toEqual([{ updateCheck: undefined, settings: undefined, place: undefined }, false, each]);
    });
  });
}

function updateCheck(label: string, makeDatabase: DatabaseFactory): void {
  describe(`${label}: the newest release the install knows of`, () => {
    // Drift: the day's one question about a newer version is asked again only when the kept moment is of another day. A moment or a release that read back changed would ask on every scheduled run, or show a release nobody published.
    test("what was kept reads back as it was, with a release and with none, and the last kept is the one read", async () => {
      const database = await opened(makeDatabase);
      const release = { version: "0.2.0", released: "2026-12-01", notes: "https://example.com/changelog/#v0-2-0", schema: 2 };
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
      const release = { version: "0.2.0", released: "2026-12-01", notes: "https://example.com/changelog/#v0-2-0", schema: 1 };
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
    test("the frame's one read gives the settings, the kept run, the last asking, and the problems of today and the day before, each as its own read gives it: nothing on an empty install, then each once it is kept", async () => {
      const database = await opened(makeDatabase);
      const empty = await database.readFrame(NOW);
      await database.initSettings(SETTINGS, BY_ADA);
      await database.keepDomainCheck({ ran_at: NOW, by: ADA, run: "check", pieces: [{ piece: "Record", detail: "every site", part: "reach", state: "ok" }] }, { run: "check" });
      await database.keepUpdateCheck({ checked_at: NOW, news: null });
      for (const ago of [0, 1, 2]) await database.noteProblem({ kind: "api_failed", at: NOW - ago * DAY_MS, count: 1, more: false, name: null, message: null });
      const each = {
        settings: await database.readSettings(),
        domainCheck: await database.readDomainCheck(),
        updateCheck: await database.readUpdateCheck(),
        problems: await database.listProblems(dayOf(NOW - DAY_MS)),
      };

      expect([empty, Object.values(each).includes(undefined), each.problems.length, await database.readFrame(NOW)]).toEqual([{ settings: undefined, domainCheck: undefined, updateCheck: undefined, problems: [] }, false, 2, each]);
    });

    // Drift: the notice of a newer release is made from one read of two records. One that gave either differently from its own read would tell a token of a release the dashboard denies, or of one while the asking is switched off.
    test("the notice's one read gives the settings and the last asking, each as its own read gives it: nothing on an empty install, then each once it is kept", async () => {
      const database = await opened(makeDatabase);
      const empty = await database.readSettingsAndUpdateCheck();
      await database.initSettings(SETTINGS, BY_ADA);
      await database.keepUpdateCheck({ checked_at: NOW, news: null });
      const each = { settings: await database.readSettings(), updateCheck: await database.readUpdateCheck() };

      expect([empty, Object.values(each).includes(undefined), await database.readSettingsAndUpdateCheck()]).toEqual([{ settings: undefined, updateCheck: undefined }, false, each]);
    });
  });
}

function problems(label: string, makeDatabase: DatabaseFactory): void {
  describe(`${label}: what went wrong`, () => {
    // Drift: the once-an-hour rule is the statement's own. A store that added to the row on every note would let a storm of failures spend the day's written rows, and one that never added would show a kind that fails all day as one failure.
    test("a kind is written once per hour of the clock and UTC day: a note in the same hour changes nothing, a later hour adds to the row, and the next day starts a row", async () => {
      const database = await opened(makeDatabase);
      const note = (at: number, more: Partial<ProblemNote> = {}): ProblemNote => ({ kind: "request_failed", at, count: 1, more: false, name: "TypeError", message: "the first", ...more });
      const written = [
        await database.noteProblem(note(DAY_START)),
        await database.noteProblem(note(DAY_START + HOUR_MS - 1, { message: "never kept" })),
        await database.noteProblem(note(DAY_START + HOUR_MS, { count: 4, more: true, name: null, message: "the latest" })),
        await database.noteProblem(note(DAY_START + HOUR_MS + 1, { kind: "sweep_failed", name: null, message: null })),
        await database.noteProblem(note(DAY_START + DAY_MS)),
      ];

      expect(written).toEqual([true, false, true, true, true]);
      expect(await database.listProblems(dayOf(DAY_START))).toEqual([
        { day: dayOf(DAY_START + DAY_MS), kind: "request_failed", count: 1, more: false, first_at: DAY_START + DAY_MS, last_at: DAY_START + DAY_MS, name: "TypeError", message: "the first" },
        { day: dayOf(DAY_START), kind: "sweep_failed", count: 1, more: false, first_at: DAY_START + HOUR_MS + 1, last_at: DAY_START + HOUR_MS + 1, name: null, message: null },
        { day: dayOf(DAY_START), kind: "request_failed", count: 5, more: true, first_at: DAY_START, last_at: DAY_START + HOUR_MS, name: null, message: "the latest" },
      ]);
      expect((await database.listProblems(dayOf(DAY_START + DAY_MS))).map((problem) => problem.day)).toEqual([dayOf(DAY_START + DAY_MS)]);
    });

    // Drift: a limit of a day stays reached until midnight, and every refusal after the first would otherwise write a row an hour to say so again.
    test("a kind noted once has one row a day whose count stays 1, however many hours it is noted in", async () => {
      const database = await opened(makeDatabase);
      const note = (at: number): ProblemNote => ({ kind: "files_limit_reached", at, count: 1, more: false, name: null, message: null });
      const written = [await database.noteProblem(note(DAY_START)), await database.noteProblem(note(DAY_START + 5 * HOUR_MS)), await database.noteProblem(note(DAY_START + DAY_MS))];

      expect(written).toEqual([true, false, true]);
      expect((await database.listProblems(dayOf(DAY_START))).map(({ day, count, last_at }) => [day, count, last_at])).toEqual([
        [dayOf(DAY_START + DAY_MS), 1, DAY_START + DAY_MS],
        [dayOf(DAY_START), 1, DAY_START],
      ]);
    });

    // Drift: nothing else forgets a problem by its age. A sweep that kept every day would grow the table for ever, and one that took a day too many would empty the list a person reads.
    test("the sweep forgets the problems of the days before the 30 kept, and keeps the thirtieth", async () => {
      const database = await opened(makeDatabase);
      const note = (at: number): ProblemNote => ({ kind: "api_failed", at, count: 1, more: false, name: null, message: null });
      for (const at of [DAY_START, DAY_START + DAY_MS, DAY_START + 30 * DAY_MS]) await database.noteProblem(note(at));

      await database.sweepRunOut(DAY_START + 30 * DAY_MS + HOUR_MS);

      expect((await database.listProblems(dayOf(DAY_START))).map((problem) => problem.day)).toEqual([dayOf(DAY_START + 30 * DAY_MS), dayOf(DAY_START + DAY_MS)]);
    });
  });
}

function mendedProblems(label: string, makeDatabase: DatabaseFactory): void {
  describe(`${label}: a problem that was mended`, () => {
    // Drift: a problem that was mended would stay marked for a day, with advice that was taken already; or a mend would end a kind it does not mend, or a row of a day no screen marks from, which is the list's memory.
    test.each([
      ["a run that showed nothing ends nothing", [], []],
      ["a login that stands ends what the login alone mends", ["login_stands"], ["login_not_repaired", "login_unchecked"]],
      ["a repair that left nothing to repair ends what a repair mends", ["repaired"], ["direct_upload_refused", "rules_not_carried", "users_not_carried"]],
      ["both end both", ["login_stands", "repaired"], ["direct_upload_refused", "login_not_repaired", "login_unchecked", "rules_not_carried", "users_not_carried"]],
    ] as const)("kept with a run, %s, of today and the day before alone", async (_what, mends, ended) => {
      const database = await opened(makeDatabase);
      const kinds = ["api_failed", "direct_upload_refused", "login_not_repaired", "login_unchecked", "rules_not_carried", "users_not_carried"] as const;
      for (const ago of [0, 1, 2]) for (const kind of kinds) await database.noteProblem({ kind, at: NOW - ago * DAY_MS, count: 1, more: false, name: null, message: null });

      await database.keepDomainCheck({ ran_at: NOW, by: ADA, run: "repair", pieces: [] }, null, undefined, mends);
      const left = (await database.listProblems(dayOf(NOW - 2 * DAY_MS))).map((problem) => `${problem.day} ${problem.kind}`).sort();

      const every = [0, 1, 2].flatMap((ago) => kinds.map((kind) => ({ ago, kind })));
      const kept = every.filter(({ ago, kind }) => ago === 2 || !(ended as readonly string[]).includes(kind));
      expect(left).toEqual(kept.map(({ ago, kind }) => `${dayOf(NOW - ago * DAY_MS)} ${kind}`).sort());
    });

    // Drift: the install's own repair of its login keeps no run, so a problem it mended would stay; or its word that the login stands would end what only a person's repair mends.
    test("the word that the login stands, with no run kept, ends what the login alone mends", async () => {
      const database = await opened(makeDatabase);
      for (const kind of ["login_not_repaired", "login_unchecked", "users_not_carried"] as const) await database.noteProblem({ kind, at: NOW, count: 1, more: false, name: null, message: null });

      await database.endProblems(["login_stands"], NOW);

      expect((await database.listProblems(dayOf(NOW))).map((problem) => problem.kind)).toEqual(["users_not_carried"]);
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

      expect([before, kept, await database.readDomainCheck()]).toEqual([undefined, { ...first, ...NOTHING_WAITS }, { ...second, ...NOTHING_WAITS }]);
      expect(await database.readFrame(NOW)).toEqual({ settings: undefined, domainCheck: { ...second, ...NOTHING_WAITS }, updateCheck: undefined, problems: [] });
      expect((await auditTrail(database)).map(({ action, by, at, detail }) => ({ action, by, at, detail }))).toEqual([
        { action: "domain_synced", by: ADA, at: NOW, detail: { run: "check", from: "dashboard" } },
        { action: "domain_synced", by: ADA, at: NOW + 5, detail: { run: "repair", from: "setup" } },
      ]);
    });

    // Drift: a check nobody pressed only renews what the install remembers. One that wrote its line would fill Activity each time a screen opened, and one that kept nothing would leave the screen on an old run.
    test("a check kept with no detail replaces the run kept before and writes no audit entry", async () => {
      const database = await opened(makeDatabase);
      const pieces: DomainCheck["pieces"] = [{ piece: "Record", detail: "every site", part: "reach", state: "ok" }];

      await database.keepDomainCheck({ ran_at: NOW, by: ADA, run: "check", pieces: [] }, { run: "check" });
      await database.keepDomainCheck({ ran_at: NOW + 5, by: ADA, run: "check", pieces }, null);

      expect([(await database.readDomainCheck())?.ran_at, (await database.readDomainCheck())?.pieces, (await auditTrail(database)).map(({ action, at }) => ({ action, at }))]).toEqual([NOW + 5, pieces, [{ action: "domain_synced", at: NOW }]]);
    });

    // Drift: the domain's login lets in the users of the last repair. A change that no row remembered, or that a check or a repair of other users cleared, would leave Domain saying nothing is left to do while a new user cannot log in.
    test("a user added or removed waits until a repair that carried the stored logins, and began no earlier than the change, settles it; a login left as it was changes nothing", async () => {
      const database = await opened(makeDatabase);
      const [bo, cy] = ["bo@example.com" as Login, "cy@example.com" as Login];
      const run = (kind: DomainCheck["run"]): DomainCheck => ({ ran_at: NOW + 9, by: ADMIN, run: kind, pieces: [] });
      const waits = async (): Promise<number | null | undefined> => (await database.readDomainCheck())?.users_changed_at;
      await database.initSettings(SETTINGS, BY_ADA);

      await database.addLogin(bo, BY_ADA);
      const beforeAnyRun = await waits();
      await database.keepDomainCheck(run("check"), {});
      const afterFirstRun = await waits();
      await database.addLogin(cy, { as: "person", by: ADMIN, at: NOW + 1 });
      await database.addLogin(cy, { as: "person", by: ADMIN, at: NOW + 2 });
      const afterAdd = await waits();
      await database.keepDomainCheck(run("check"), {});
      await database.keepDomainCheck(run("repair"), {});
      await database.keepDomainCheck(run("repair"), {}, { logins: [ADMIN, bo], since: NOW + 9 });
      const afterRepairOfOtherUsers = await waits();
      await database.keepDomainCheck(run("repair"), {}, { logins: [ADMIN, bo, cy], since: NOW });
      const afterRepairBegunBeforeTheChange = await waits();
      await database.keepDomainCheck(run("repair"), {}, { logins: [ADMIN, bo, cy], since: NOW + 10 });
      const afterRepair = await waits();
      await database.keepDomainCheck(run("repair"), {}, { logins: null, since: NOW + 10 });
      const afterRepairThatStoppedShort = await waits();
      await database.keepDomainCheck(run("repair"), {}, { logins: [ADMIN, bo, cy], since: NOW + 9 });
      await database.removeLogin(cy, { as: "person", by: ADMIN, at: NOW + 3 });
      await database.removeLogin(cy, { as: "person", by: ADMIN, at: NOW + 4 });
      await database.removeLogin(ADMIN, { as: "person", by: ADMIN, at: NOW + 5 });

      // Each run that settles nothing sets a mark later than the one before, so a try that began under an earlier one can tell.
      expect([beforeAnyRun, afterFirstRun, afterAdd, afterRepairOfOtherUsers, afterRepairBegunBeforeTheChange]).toEqual([undefined, null, NOW + 1, NOW + 9, NOW + 10]);
      // A settled mark is remembered: the marks after it are later than it, though the clock of what sets them is behind.
      expect([afterRepair, afterRepairThatStoppedShort, await waits()]).toEqual([null, NOW + 11, NOW + 13]);
    });

    // Drift: the logins are also replaced as a setting, by `poplin config logins` and by an import with its users. A list that marked nothing would let Domain say all is well while the user it added cannot log in.
    // The first login is the one a domain may treat apart, so a list that only puts another user first waits too.
    test("the logins replaced as a setting wait for a repair when the list adds or drops a user or puts another one first, and not when it holds the same users behind the same first one or names no logins", async () => {
      const database = await opened(makeDatabase);
      const [bo, cy] = ["bo@example.com" as Login, "cy@example.com" as Login];
      const waits = async (): Promise<number | null | undefined> => (await database.readDomainCheck())?.users_changed_at;
      const replaced = async (logins: Login[], at: number, by = ADMIN): Promise<number | null | undefined> => {
        await database.changeSettings({ logins, trash_days: at }, { as: "person", by, at: NOW + at });

        return waits();
      };
      await database.initSettings({ ...SETTINGS, logins: [ADMIN, bo] }, BY_ADA);

      const beforeAnyRun = await replaced([ADMIN], 1);
      await database.keepDomainCheck({ ran_at: NOW + 1, by: ADMIN, run: "repair", pieces: [] }, {});
      await database.changeSettings({ trash_days: 30 }, { as: "person", by: ADMIN, at: NOW + 2 });
      const otherSetting = await waits();
      const sameUser = await replaced([ADMIN], 3);
      const added = await replaced([ADMIN, bo, cy], 4);
      const otherOrderBehind = await replaced([ADMIN, cy, bo], 5);
      const otherFirst = await replaced([bo, ADMIN, cy], 6);
      const dropped = await replaced([bo], 7);
      // The first user left with the list before: a person signs only while their email is a login.
      const swapped = await replaced([cy], 8, bo);

      expect([beforeAnyRun, otherSetting, sameUser, added, otherOrderBehind, otherFirst, dropped, swapped]).toEqual([undefined, null, null, NOW + 4, NOW + 4, NOW + 6, NOW + 7, NOW + 8]);
      expect((await database.readSettings())?.logins).toEqual([cy]);
    });

    // Drift: three tries inside one moment of the clock. The second settles the change; the first, whose older list landed after it, is refused and sets the mark anew; the third, under way all along, then settles.
    // A mark that began again from the clock once it was settled would be no later than the third try's own, which would take it for untouched and end the waiting over a domain that holds the older list.
    test("a mark set after a settled one is later than every try that began before it, so such a try settles nothing", async () => {
      const database = await opened(makeDatabase);
      await database.initSettings(SETTINGS, BY_ADA);
      await database.keepDomainCheck({ ran_at: NOW, by: ADMIN, run: "repair", pieces: [] }, {});
      const logins = [...SETTINGS.logins];

      const first = await database.claimUsers(NOW);
      const third = await database.claimUsers(NOW);
      const second = await database.claimUsers(NOW);
      const settledBySecond = await database.settleUsers({ logins, since: second.mark ?? 0 }, NOW);
      await database.settleUsers({ logins: null, since: first.mark ?? 0 }, NOW);
      const settledByThird = await database.settleUsers({ logins, since: third.mark ?? 0 }, NOW);

      expect([first.mark, third.mark, second.mark]).toEqual([NOW, NOW + 1, NOW + 2]);
      expect([settledBySecond.waits, settledByThird.waits, (await database.readDomainCheck())?.users_changed_at]).toEqual([false, true, NOW + 4]);
    });

    // Drift: a list is carried to the domain while the users may change again, and while another try may write the domain.
    // Settled on the stored logins alone, a try that an older list overtook at the domain would end the waiting, and the domain would keep users the install no longer has.
    test("a change of the users is settled only by the very list that is stored and only while no mark was set since the try began; every other try leaves a later mark", async () => {
      const database = await opened(makeDatabase);
      const [bo, cy] = ["bo@example.com" as Login, "cy@example.com" as Login];
      const stored = [ADMIN, bo, cy];
      await database.initSettings(SETTINGS, BY_ADA);
      const beforeAnyRun = await database.claimUsers(NOW);
      await database.keepDomainCheck({ ran_at: NOW, by: ADMIN, run: "repair", pieces: [] }, {});
      await database.addLogin(bo, { as: "person", by: ADMIN, at: NOW + 1 });
      await database.addLogin(cy, { as: "person", by: ADMIN, at: NOW + 2 });
      const settled = async (logins: Login[] | null, since: number, at: number): Promise<unknown> => {
        const { waits } = await database.settleUsers({ logins, since }, at);

        return [waits, (await database.readDomainCheck())?.users_changed_at];
      };

      const claimed = await database.claimUsers(NOW + 3);
      const stale = await settled([ADMIN, bo], NOW + 3, NOW + 4);
      const otherOrder = await settled([ADMIN, cy, bo], NOW + 4, NOW + 4);
      const overtaken = await settled(stored, NOW + 4, NOW + 4);
      const exact = await settled(stored, NOW + 6, NOW + 7);
      const again = await settled(stored, NOW + 6, NOW + 7);
      const unknown = await settled(null, NOW + 6, NOW + 8);
      const clockBehind = await database.claimUsers(NOW);

      // Before any run is kept nothing holds a mark, which the answer says, so whoever carries the users can say that nothing remembers them.
      expect([beforeAnyRun, claimed, clockBehind]).toEqual([{ logins: SETTINGS.logins, mark: undefined }, { logins: stored, mark: NOW + 3 }, { logins: stored, mark: NOW + 9 }]);
      expect([stale, otherOrder, overtaken]).toEqual([[true, NOW + 4], [true, NOW + 5], [true, NOW + 6]]);
      expect([exact, again, unknown]).toEqual([[false, null], [false, null], [true, NOW + 8]]);
    });

    // Drift: the same three tries inside one moment of the clock, for the settings of the domain's rules. The second settles the change; the first, whose older values landed after it, sets the mark anew; the third, under way all along, then settles.
    // A mark that began again from the clock once it was settled would be no later than the third try's own, which would end the waiting over rules written from the older values.
    test("a mark of the rules set after a settled one is later than every try that began before it, so such a try settles nothing", async () => {
      const database = await opened(makeDatabase);
      await database.initSettings(SETTINGS, BY_ADA);
      await database.keepDomainCheck({ ran_at: NOW, by: ADMIN, run: "repair", pieces: [] }, {});
      await database.changeSettings({ outside_pages: "allowed" }, { as: "person", by: ADMIN, at: NOW });
      const rules = { outside_pages: "allowed", search_engines_allowed: SETTINGS.search_engines_allowed } as const;

      const first = await database.claimRules(NOW);
      const third = await database.claimRules(NOW);
      const second = await database.claimRules(NOW);
      const settledBySecond = await database.settleRules({ rules, since: second.mark ?? 0 }, NOW);
      await database.settleRules({ rules: { ...rules, outside_pages: "blocked" }, since: first.mark ?? 0 }, NOW);
      const settledByThird = await database.settleRules({ rules, since: third.mark ?? 0 }, NOW);

      expect([first.mark, third.mark, second.mark]).toEqual([NOW + 1, NOW + 2, NOW + 3]);
      expect([settledBySecond.waits, settledByThird.waits, (await database.readDomainCheck())?.rules_changed_at]).toEqual([false, true, NOW + 5]);
    });

    // Drift: the domain's rules stand as they were last written. A change of a setting they are written from that no row remembered would never reach them.
    // One settled by other values, or by a try a later change overtook, would leave rules the settings no longer ask for.
    test("a changed setting of the domain's rules waits until a try that carried the stored values, under no later mark, settles it; any other setting, and a value left as it was, marks nothing", async () => {
      const database = await opened(makeDatabase);
      const waits = async (): Promise<number | null | undefined> => (await database.readDomainCheck())?.rules_changed_at;
      const changed = async (changes: Partial<SettingValues>, at: number): Promise<number | null | undefined> => {
        await database.changeSettings(changes, { as: "person", by: ADMIN, at: NOW + at });

        return waits();
      };
      await database.initSettings(SETTINGS, BY_ADA);

      const beforeAnyRun = [await changed({ outside_pages: "allowed" }, 1), (await database.claimRules(NOW + 1)).mark];
      await database.keepDomainCheck({ ran_at: NOW + 1, by: ADMIN, run: "repair", pieces: [] }, {});
      const otherSetting = await changed({ trash_days: 30, block_bots: "on" }, 2);
      const sameValue = await changed({ outside_pages: "allowed", search_engines_allowed: SETTINGS.search_engines_allowed }, 3);
      const nothingWaits = [(await database.claimRules(NOW + 3)).mark, await waits()];
      const oneDiffers = await changed({ outside_pages: "allowed", search_engines_allowed: !SETTINGS.search_engines_allowed }, 4);
      const claimed = await database.claimRules(NOW + 5);
      const rules = { outside_pages: "allowed", search_engines_allowed: !SETTINGS.search_engines_allowed } as const;
      const stale = [(await database.settleRules({ rules: { ...rules, outside_pages: "blocked" }, since: NOW + 5 }, NOW + 6)).waits, await waits()];
      const overtaken = [(await database.settleRules({ rules, since: NOW + 5 }, NOW + 6)).waits, await waits()];
      const exact = [(await database.settleRules({ rules, since: NOW + 7 }, NOW + 8)).waits, await waits()];
      // An older try whose write landed after a newer one settled: the rules hold its values, so the change waits again.
      const landedLate = [(await database.settleRules({ rules: { ...rules, outside_pages: "blocked" }, since: NOW + 5 }, NOW + 9)).waits, await waits()];

      expect([beforeAnyRun, otherSetting, sameValue, oneDiffers]).toEqual([[undefined, undefined], null, null, NOW + 4]);
      // A try begun while nothing waits sets no mark, so one the domain refuses leaves nothing waiting.
      expect(nothingWaits).toEqual([null, null]);
      expect([claimed.settings?.outside_pages, claimed.settings?.search_engines_allowed, claimed.mark]).toEqual(["allowed", rules.search_engines_allowed, NOW + 5]);
      expect([stale, overtaken, exact, landedLate]).toEqual([[true, NOW + 6], [true, NOW + 7], [false, null], [true, NOW + 9]]);
      // The mark of the users is another one, and is left alone.
      expect((await database.readDomainCheck())?.users_changed_at).toBeNull();
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

    // Drift: the rows the database used ride in the write of the day's requests; a write that set them where it must add, or a day that kept yesterday's, would show an allowance that is not the day's.
    test("the rows the writes of a day name add up in that day, whichever site a write is for, a write that names none adds none, and a new day starts from nothing", async () => {
      const database = await opened(makeDatabase);
      const before = await database.readDayUse(TODAY);
      await database.addRequests({ day: TODAY, site: NO_SITE, requests: 50, rows: { read: 400, written: 6 } });
      await database.addRequests({ day: TODAY, site: OTHER_SITE, requests: 1 });
      await database.addRequests({ day: TODAY, site: OTHER_SITE, requests: 2, rows: { read: 30, written: 0 } });

      expect([before, await database.readDayUse(TODAY), await database.readDayUse(TOMORROW)]).toEqual([
        { requests: 0, rows: { read: 0, written: 0 } },
        { requests: 53, rows: { read: 430, written: 6 } },
        { requests: 0, rows: { read: 0, written: 0 } },
      ]);
      expect(await database.readRequests(TODAY, OTHER_SITE)).toEqual({ site: 3, all: 53 });
      await expect(database.addRequests({ day: TODAY, site: NO_SITE, requests: 1, rows: { read: -1, written: 0 } })).rejects.toThrow(RangeError);
      await expect(database.addRequests({ day: TODAY, site: NO_SITE, requests: 1, rows: { read: 0, written: 0.5 } })).rejects.toThrow(RangeError);
      await expect(database.readDayUse("today")).rejects.toThrow(RangeError);
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

      // A count written a year on drops nothing: the days over a year old go with the sweep that runs after them.
      await database.addRequests({ day: "2027-10-26", site: OTHER_SITE, requests: 1 });
      await database.sweepRunOut(Date.parse("2027-10-25T12:00:00Z"));
      const kept = await database.readViews([NO_SITE], "2026-11-01");
      await database.sweepRunOut(Date.parse("2027-10-26T12:00:00Z"));

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
      await database.ensureVisitorKey(new Uint8Array(32).fill(7), NOW);
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
      for (const [at, by] of [named.id, removed.id, unnamed.id, ADA].entries()) sites.push(await made(database, draft(`site-${at}` as SiteName), { as: "token", by, at: NOW + at }));
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
  visitorKey(label, makeDatabase);
  auditLog(label, makeDatabase);
  auditTrim(label, makeDatabase);
  everLoggedIn(label, makeDatabase);
  tokensAndSettings(label, makeDatabase);
  computerLogins(label, makeDatabase);
  loginRoom(label, makeDatabase);
  sweepPlace(label, makeDatabase);
  updateCheck(label, makeDatabase);
  domainCheck(label, makeDatabase);
  problems(label, makeDatabase);
  mendedProblems(label, makeDatabase);
  requestCounts(label, makeDatabase);
  uploads(label, makeDatabase);
  uploadFiles(label, makeDatabase);
  declaredFiles(label, makeDatabase);
  storageWrites(label, makeDatabase);
  versionContents(label, makeDatabase);
}
