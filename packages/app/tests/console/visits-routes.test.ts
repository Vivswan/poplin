// The Usage screen's graph route: the page opens of each day, all sites together and the sites picked.

import { expect, test } from "bun:test";

import { deleteSite } from "@poplin/core/src/actions/delete";
import { dayOf } from "@poplin/core/src/records/views";

import { openConsole } from "./support/console";

/** A day in milliseconds. */
const DAY_MS = 86_400_000;

// Drift: a day would be dropped or put out of order, a site's count would be added to another's, the total would not be the sum of the days drawn, or a site that is gone would draw a line.
test("answers a count for every day of the range, the earliest first: all sites together and each site asked for, with its name and its sum", async () => {
  const opened = await openConsole();
  const { install, owner, publish, clock } = opened.base;
  const notes = await publish("field-notes");
  const draft = await publish("old-draft");
  const gone = await publish("gone-site");
  const days = [0, 1, 2, 29, 30].map((back) => dayOf(clock.now - back * DAY_MS));
  await install.database.addRequests({ day: days[4] ?? "", site: notes.id, requests: 900, views: 900 });
  await install.database.addRequests({ day: days[3] ?? "", site: notes.id, requests: 9, views: 7 });
  await install.database.addRequests({ day: days[2] ?? "", site: draft.id, requests: 30, views: 20 });
  await install.database.addRequests({ day: days[0] ?? "", site: notes.id, requests: 50, views: 40 });
  await install.database.addRequests({ day: days[0] ?? "", site: draft.id, requests: 5, views: 5 });
  await deleteSite(install, { scope: "admin", holder: owner }, { site: gone.id });
  await deleteSite(install, { scope: "admin", holder: owner }, { site: gone.id, no_trash: true });
  const empty = Array.from({ length: 26 }, () => 0);

  const answer = (await (await opened.get(`/data/usage/visits?range=30&sites=${draft.id},${gone.id},${notes.id},${draft.id}`)).json()) as {
    readonly days: readonly string[];
  };

  expect([answer.days.length, answer.days[0], answer.days.at(-1)]).toEqual([30, days[3], days[0]]);
  expect(answer).toMatchObject({
    ok: true,
    all: { total: 72, counts: [7, ...empty, 20, 0, 45] },
    sites: [
      { id: draft.id, name: "old-draft", total: 25, counts: [0, ...empty, 20, 0, 5] },
      { id: notes.id, name: "field-notes", total: 47, counts: [7, ...empty, 0, 0, 40] },
    ],
  });
});

// Drift: a week would end on another day than today, hold six or eight days, or the days before the first whole week would be drawn nowhere while the heading's sum counts them.
test.each([
  ["90", "day", 90, 0, [5, 3]],
  ["180", "week", 26, 6, [8]],
  ["365", "week", 53, 6, [8]],
])("a stretch of %s days answers a count a %s: %d of them, the last from %d days ago on, the oldest day in the first, and the sum of every day read", async (range, by, steps, lastFrom, lastCounts) => {
  const opened = await openConsole();
  const { install, publish, clock } = opened.base;
  const notes = await publish("field-notes");
  const dayAgo = (back: number): string => dayOf(clock.now - back * DAY_MS);
  // The oldest day of the stretch, which no whole week of 180 or 365 days holds, then yesterday and today.
  for (const [back, views] of [[Number(range) - 1, 100], [1, 5], [0, 3]] as const) await install.database.addRequests({ day: dayAgo(back), site: notes.id, requests: views, views });

  const answer = (await (await opened.get(`/data/usage/visits?range=${range}`)).json()) as { readonly days: readonly string[]; readonly all: { readonly total: number; readonly counts: readonly number[] } };

  expect([answer, answer.days.length, answer.days[0], answer.days.at(-1), answer.all.counts.length, answer.all.counts[0], answer.all.counts.slice(-lastCounts.length), answer.all.total]).toMatchObject([
    { by, range: Number(range) },
    steps,
    dayAgo(Number(range) - 1),
    dayAgo(lastFrom),
    steps,
    100,
    lastCounts,
    108,
  ]);
  // Once the scheduled run summed the days that are over, the stretch reads the same.
  await install.database.sweepRunOut(clock.now);

  expect(await (await opened.get(`/data/usage/visits?range=${range}`)).json()).toEqual(answer);
});

// Drift: a read costs a database row for every day of every site; a range or a list the route let through unchecked would spend a day's rows on one page.
test.each([
  ["no range", "sites=", "range"],
  ["a range the graph does not offer", "range=31", "range"],
  ["a range longer than a year", "range=366", "range"],
  ["fifty-one sites", `range=30&sites=${Array.from({ length: 51 }, (_site, at) => `aaaaaaaaaa${String(at).padStart(2, "0")}`).join(",")}`, "sites"],
  ["a text that is no site id", "range=30&sites=field-notes", "sites"],
  ["a key it does not know", "range=30&days=30", "days"],
])("refuses %s", async (_what, query, about) => {
  const opened = await openConsole();
  const response = await opened.get(`/data/usage/visits?${query}`);

  expect([response.status, await response.json()]).toMatchObject([400, { ok: false, code: "bad_argument", about }]);
});

// Drift: the counts of every site would be read without a login.
test("answers 401 in JSON without a login", async () => {
  const opened = await openConsole();
  const response = await opened.getLoggedOut("/data/usage/visits?range=30");

  expect([response.status, await response.json()]).toMatchObject([401, { ok: false, code: "no_login" }]);
});
