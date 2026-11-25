// The asking for the newest release that a person starts: what a press keeps, what it is refused with, and what it leaves for the day's own asking.

import { describe, expect, test } from "bun:test";

import { type Asking, checkForUpdate, checkNow } from "../../../src/actions/update/check-update";
import type { Updating } from "../../../src/actions/start-update";
import { OWN_SCHEMA } from "../../../src/database/open";
import { ADMIN, DAY, makeWorld, NOW, OWNER } from "../support/actions-fixture";

const MINUTE = 60_000;
const RELEASE = { version: "0.2.0", released: "2026-12-01", notes: "https://github.com/Vivswan/poplin/releases/tag/v0.2.0", schema: OWN_SCHEMA };
const NEXT = { ...RELEASE, version: "0.3.0", notes: "https://github.com/Vivswan/poplin/releases/tag/v0.3.0" };

/** A minute that has room for the asking. */
const ROOM: Updating["counters"] = { takeMinute: async () => ({ ok: true }) };

/** A minute that is full. */
const FULL: Updating["counters"] = { takeMinute: async () => ({ ok: false, retryAfterSeconds: 60 }) };

/** A website that answers every request with one body, and counts the requests. */
function website(body: unknown, status = 200): Asking & { readonly asked: unknown[] } {
  const asked: unknown[] = [];

  return {
    asked,
    fetch: async (address) => {
      asked.push(address);

      return new Response(JSON.stringify(body), { status });
    },
  };
}

describe("checkNow", () => {
  // Drift: a press is a person asking. One that waited for the day's turn, or for `update_check`, would answer nothing right after a release, which is when it is pressed.
  test.each([
    ["on", true],
    ["off", false],
  ])("with update_check %s, a press asks at once and keeps the release with the moment, also on a day the install asked already", async (_setting, update_check) => {
    const world = await makeWorld({ update_check, auto_update: false });
    await world.install.database.keepUpdateCheck({ checked_at: NOW, news: null });
    world.clock.now += MINUTE;
    const asking = website(RELEASE);
    const pressed = await checkNow(world.install, ADMIN, asking, ROOM);
    const row = { checked_at: NOW + MINUTE, news: RELEASE, seen_at: NOW + MINUTE, auto: null };

    expect([pressed, asking.asked.length, await world.install.database.readUpdateCheck()]).toEqual([{ ok: true, news: RELEASE }, 1, row]);
  });

  // Drift: the daily asking counts to the UTC day it starts on. A press that kept the moment of its answer would, across midnight, take the new day's asking with a question put on the old day.
  test("a press keeps the moment it asked, not the moment its answer came", async () => {
    const world = await makeWorld();
    const slow: Asking = {
      fetch: async () => {
        world.clock.now += MINUTE;

        return new Response(JSON.stringify(RELEASE));
      },
    };
    await checkNow(world.install, ADMIN, slow, ROOM);

    expect([(await world.install.database.readUpdateCheck())?.checked_at, world.clock.now]).toEqual([NOW, NOW + MINUTE]);
  });

  // Drift: a write moves the moment the install last asked, and the day's own asking skips a day that was asked. A press that wrote the version it keeps already would take that asking for nothing.
  test("a later press that finds the kept version writes nothing, its date corrected or not, and answers the kept release; one that finds another version keeps it with its own moment", async () => {
    const world = await makeWorld();
    const kept: unknown[] = [];

    for (const release of [RELEASE, RELEASE, { ...RELEASE, released: "2026-12-02" }, NEXT]) {
      const written = await world.written();
      const pressed = await checkNow(world.install, ADMIN, website(release), ROOM);
      const row = await world.install.database.readUpdateCheck();
      kept.push([pressed.ok ? pressed.news : pressed.code, row?.news, (row?.checked_at ?? 0) - NOW, (row?.seen_at ?? 0) - NOW, (await world.written()) - written]);
      world.clock.now += DAY;
    }

    expect(kept).toEqual([
      [RELEASE, RELEASE, 0, 0, 1],
      [RELEASE, RELEASE, 0, 0, 0],
      [RELEASE, RELEASE, 0, 0, 0],
      [NEXT, NEXT, 3 * DAY, 3 * DAY, 1],
    ]);
  });

  // Drift: the button is in every admin's reach. With no bound, a held key would send the project's website a request for every press.
  test("in a minute that is full, a press is refused about the check, and neither asks the website nor writes", async () => {
    const world = await makeWorld();
    const asking = website(RELEASE);
    const written = await world.written();
    const pressed = await checkNow(world.install, ADMIN, asking, FULL);

    expect([pressed, asking.asked, (await world.written()) - written]).toEqual([{ ok: false, code: "too_many_requests", about: "check" }, [], 0]);
  });

  // Drift: a website that is down says nothing of the releases. A press that kept the moment all the same would count the day as asked, and the install would learn of a release a day late.
  test.each([
    ["answers 503", website("down", 503)],
    ["answers a file that is no release", website({ version: "0.2.0" })],
  ])("a website that %s is refused as unreachable and writes nothing: the release known before stays, and the day's own asking is still made", async (_what, down) => {
    const world = await makeWorld();
    await world.install.database.keepUpdateCheck({ checked_at: NOW - DAY, news: RELEASE });
    const before = await world.install.database.readUpdateCheck();
    const written = await world.written();
    const pressed = await checkNow(world.install, ADMIN, down, ROOM);
    const kept = [await world.install.database.readUpdateCheck(), (await world.written()) - written];
    const daily = website(NEXT);
    await checkForUpdate(world.install, daily);

    expect([pressed, kept, daily.asked.length]).toEqual([{ ok: false, code: "website_unreachable" }, [before, 0], 1]);
  });

  // Drift: an install starts an update by itself only on the run that made the day's asking. A press that counted as that asking while it learned of no other version would take the day's update away, every day somebody presses before the run.
  test.each([
    ["the version it keeps", RELEASE, RELEASE],
    ["no release, where it keeps none", null, { version: null }],
  ])("a press that is told %s leaves the day's own asking to be made: the daily asking of the same UTC day still asks, and answers what an update by itself starts from", async (_what, known, named) => {
    const world = await makeWorld({ auto_update: true });
    world.clock.now = Math.ceil(NOW / DAY) * DAY;
    if (known !== null) await world.install.database.keepUpdateCheck({ checked_at: world.clock.now - 3 * DAY, news: known });
    const written = await world.written();
    const pressed = await checkNow(world.install, ADMIN, website(named), ROOM);
    const wrote = (await world.written()) - written;
    const daily = website(named);
    world.clock.now += MINUTE;
    const learned = await checkForUpdate(world.install, daily);

    expect([pressed, wrote, daily.asked.length, learned?.answered]).toEqual([{ ok: true, news: known }, 0, 1, true]);
  });

  // Drift: the header of the daily asking says a UTC day is asked once. A press that learned of another version is that day's asking: a scheduled run later the same day sends no second request.
  test("a press that learns of another version is the day's asking: the daily asking of the same UTC day asks nothing, and the next day's asks", async () => {
    const world = await makeWorld();
    world.clock.now = Math.ceil(NOW / DAY) * DAY;
    await world.install.database.keepUpdateCheck({ checked_at: world.clock.now - DAY, news: RELEASE });
    await checkNow(world.install, ADMIN, website(NEXT), ROOM);
    const daily = website(NEXT);
    world.clock.now += DAY - MINUTE;
    await checkForUpdate(world.install, daily);
    const sameDay = daily.asked.length;
    world.clock.now += MINUTE;
    await checkForUpdate(world.install, daily);

    expect([sameDay, daily.asked.length]).toEqual([0, 1]);
  });

  // Drift: only an admin sees the row the button is in. A token that reached the action another way would spend the minute's one asking, and write to the install.
  test("anyone but an admin is refused, and nothing is counted, asked, or written", async () => {
    const world = await makeWorld();
    const asking = website(RELEASE);
    const counted: unknown[] = [];
    const counters: Updating["counters"] = {
      takeMinute: async (window) => {
        counted.push(window);

        return { ok: true };
      },
    };
    const written = await world.written();
    const pressed = await checkNow(world.install, OWNER, asking, counters);

    expect([pressed, counted, asking.asked, (await world.written()) - written]).toEqual([{ ok: false, code: "not_allowed" }, [], [], 0]);
  });
});
