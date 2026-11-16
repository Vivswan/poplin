import { describe, expect, spyOn, test } from "bun:test";

import { removeFiles } from "../../src/actions/files";
import { listProblems, meterNoted, noteProblem } from "../../src/actions/problems";
import { AllowanceSpent } from "../../src/database/driver";
import { dayOf } from "../../src/records/views";
import { ADMIN, DAY, makeWorld, OWNER } from "./support/actions-fixture";

/** The milliseconds of one hour. */
const HOUR = 3_600_000;

/** A midnight UTC, where an hour of the clock and a day both begin. */
const DAY_START = 1_699_920_000_000;

/** A world whose clock stands at the midnight, with what its database was asked to note. */
async function worldAtMidnight(): Promise<Awaited<ReturnType<typeof makeWorld>> & { readonly asked: () => number }> {
  const world = await makeWorld();
  world.clock.now = DAY_START;
  const spy = spyOn(world.install.database, "noteProblem");

  return { ...world, asked: () => spy.mock.calls.length };
}

describe("noteProblem", () => {
  // Drift: a failure can repeat on every request. Were each one a statement, a storm would spend the day's allowance of the database; were the skipped ones forgotten, twelve failures would read as two.
  test("a storm asks the database once an hour for a kind, and the next hour's row says how many tries there were and that the count is a floor", async () => {
    const world = await worldAtMidnight();
    for (let tries = 0; tries < 5; tries += 1) await noteProblem(world.install, "request_failed", new TypeError("the first hour"));
    const first = [world.asked(), await world.install.database.listProblems(dayOf(DAY_START))];

    world.clock.now = DAY_START + HOUR + 7;
    await noteProblem(world.install, "request_failed", new RangeError("the second hour"));

    expect(first).toEqual([1, [{ day: dayOf(DAY_START), kind: "request_failed", count: 1, more: false, first_at: DAY_START, last_at: DAY_START, name: "TypeError", message: "the first hour" }]]);
    expect([world.asked(), await world.install.database.listProblems(dayOf(DAY_START))]).toEqual([
      2,
      [{ day: dayOf(DAY_START), kind: "request_failed", count: 6, more: true, first_at: DAY_START, last_at: DAY_START + HOUR + 7, name: "RangeError", message: "the second hour" }],
    ]);
  });

  // Drift: two instances share one database and no memory. The hour's rule must hold between them, and the one that came second must not lose what it saw.
  test("an instance that notes a kind another instance wrote in the same hour writes nothing, asks once, and adds its tries in the next hour", async () => {
    const world = await worldAtMidnight();
    await world.install.database.noteProblem({ kind: "api_failed", at: DAY_START, count: 1, more: false, name: null, message: "another instance" });

    await noteProblem(world.install, "api_failed");
    await noteProblem(world.install, "api_failed");
    const sameHour = [world.asked(), (await world.install.database.listProblems(dayOf(DAY_START))).map((problem) => problem.count)];
    world.clock.now = DAY_START + 2 * HOUR;
    await noteProblem(world.install, "api_failed");

    expect(sameHour).toEqual([2, [1]]);
    expect((await world.install.database.listProblems(dayOf(DAY_START))).map(({ count, more, message }) => ({ count, more, message }))).toEqual([{ count: 4, more: true, message: null }]);
  });

  // Drift: a try counted late on one day would otherwise be added to the first row of the next, which would then say more went wrong that day than did.
  test("tries counted on one day are not added to the next day's row", async () => {
    const world = await worldAtMidnight();
    world.clock.now = DAY_START + DAY - 5;
    for (let tries = 0; tries < 3; tries += 1) await noteProblem(world.install, "sweep_failed");
    world.clock.now = DAY_START + DAY + 5;
    await noteProblem(world.install, "sweep_failed");

    expect((await world.install.database.listProblems(dayOf(DAY_START))).map(({ day, count, more }) => [day, count, more])).toEqual([
      [dayOf(DAY_START + DAY), 1, false],
      [dayOf(DAY_START), 1, false],
    ]);
  });

  // Drift: a database whose day is used up refuses the note too, so asking it would be one more failing statement for every failing request.
  test("a failure that is the database's spent day is not noted, and the database is not asked", async () => {
    const world = await worldAtMidnight();
    await noteProblem(world.install, "api_failed", new AllowanceSpent("writing"));

    expect([world.asked(), await world.install.database.listProblems(dayOf(DAY_START))]).toEqual([0, []]);
  });

  // Drift: a note is written while something else is already failing. A note that threw would turn a request that was about to be answered into one that is not.
  test("a database that refuses the note is not heard of, and is not asked again in that hour", async () => {
    const world = await worldAtMidnight();
    spyOn(world.install.database, "noteProblem").mockRejectedValue(new Error("the database is down"));
    const hostile = Object.defineProperty(new Error("x"), "message", { get: () => { throw new Error("no message"); } });

    const outcomes = await Promise.allSettled([noteProblem(world.install, "request_failed"), noteProblem(world.install, "request_failed"), noteProblem(world.install, "login_unchecked", hostile)]);

    expect([outcomes.map((outcome) => outcome.status), world.asked()]).toEqual([["fulfilled", "fulfilled", "fulfilled"], 1]);
  });

  // Drift: a limit that was reached is refused to every publish until midnight, and each refusal notes it. It is one fact of the day, never a count.
  test("a limit of a day is one row with a count of 1, however often and in however many hours it is noted", async () => {
    const world = await worldAtMidnight();
    for (const hour of [0, 0, 1, 5, 23]) {
      world.clock.now = DAY_START + hour * HOUR;
      await noteProblem(world.install, "files_limit_reached");
    }

    expect((await world.install.database.listProblems(dayOf(DAY_START))).map(({ kind, count, more, last_at }) => ({ kind, count, more, last_at }))).toEqual([{ kind: "files_limit_reached", count: 1, more: false, last_at: DAY_START }]);
  });

  // Drift: a note the database refused is counted in memory and added by the next write. Added to a limit's row, it would make the one fact of the day read as two.
  test("a limit of a day first noted while the database refused, and written an hour later, still counts 1", async () => {
    const world = await worldAtMidnight();
    const refusing = spyOn(world.install.database, "noteProblem").mockRejectedValueOnce(new Error("the database is down"));
    await noteProblem(world.install, "writes_limit_reached");
    world.clock.now = DAY_START + HOUR;
    await noteProblem(world.install, "writes_limit_reached");

    expect([refusing.mock.calls.length, (await world.install.database.listProblems(dayOf(DAY_START))).map(({ count, more }) => ({ count, more }))]).toEqual([2, [{ count: 1, more: false }]]);
  });
});

describe("meterNoted", () => {
  // Drift: the removal of files takes a listing refused at the day's bound as files left for later, so nothing above it ever learns that the day's limit was reached. Only the meter knows, and it must say so.
  test("a listing the day has no room for is noted as the day's limit reached, also where the removal of files swallows the refusal", async () => {
    const world = await makeWorld({ max_storage_writes_per_day: 1 });
    await meterNoted(world.install).store.list({ prefix: "none/" });

    const left = await removeFiles(meterNoted(world.install).store, ["none/"]);

    expect(left).toEqual(["none/"]);
    expect((await world.install.database.listProblems(dayOf(world.clock.now))).map(({ kind, count }) => [kind, count])).toEqual([["writes_limit_reached", 1]]);
  });
});

describe("listProblems", () => {
  // Drift: the list is what an admin reads on the dashboard and what `doctor` counts. The days asked for are whole UTC days that end today, and nobody but an admin reads it.
  test("an admin reads the days asked for, today included, and anyone else or any other count of days is refused", async () => {
    const world = await worldAtMidnight();
    for (const [ago, kind] of [[0, "request_failed"], [6, "sweep_failed"], [7, "api_failed"]] as const) {
      await world.install.database.noteProblem({ kind, at: DAY_START - ago * DAY, count: 1, more: false, name: null, message: null });
    }
    world.clock.now = DAY_START + DAY - 1;
    const kinds = async (days: number): Promise<unknown> => {
      const listed = await listProblems(world.install, ADMIN, days);

      return listed.ok ? listed.problems.map((problem) => problem.kind) : listed;
    };

    expect([await kinds(1), await kinds(7), await kinds(8), await kinds(30)]).toEqual([["request_failed"], ["request_failed", "sweep_failed"], ["request_failed", "sweep_failed", "api_failed"], ["request_failed", "sweep_failed", "api_failed"]]);
    expect([await kinds(0), await kinds(31), await kinds(1.5), await listProblems(world.install, OWNER, 7)]).toEqual([
      { ok: false, code: "bad_argument", about: "days" },
      { ok: false, code: "bad_argument", about: "days" },
      { ok: false, code: "bad_argument", about: "days" },
      { ok: false, code: "not_allowed" },
    ]);
  });
});
