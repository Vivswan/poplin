// The Usage screen's route: each thing the install has used, beside the limit its setting or its host gives, and the host's own figures where the kept key reads them.

import { expect, test } from "bun:test";

import { changeConfig } from "@poplin/core/src/actions/config";
import { deleteSite } from "@poplin/core/src/actions/delete";
import { dayOf } from "@poplin/core/src/records/views";

import type { Keyed } from "../../src/console/key/records";
import type { HostFigures } from "../../src/console/usage/records";
import { openConsole } from "./support/console";
import { USAGE_HOST } from "./support/install";

/** The pages of the tests' host. */
const { requests: REQUESTS_PAGE, database: DATABASE_PAGE, storage: STORAGE_PAGE } = USAGE_HOST.links;

/** What the route answers, as far as the tests read it. */
interface Answer {
  readonly official: unknown;
  readonly lines: readonly Readonly<Record<string, unknown>>[];
}

/** Open a console whose host answers its own figures as given, and read the Usage route once. */
async function usageWith(official: Keyed<HostFigures>): Promise<Answer> {
  const asked: string[] = [];
  const unwrittenRows = (of: string): { readonly read: number; readonly written: number } => {
    asked.push(of);

    return { read: 7, written: 1 };
  };
  const opened = await openConsole("", undefined, { ...USAGE_HOST, unwrittenRows, official: async () => official });
  const day = dayOf(opened.base.clock.now);
  await opened.base.install.database.addRequests({ day, site: (await opened.base.publish("field-notes")).id, requests: 20, rows: { read: 400, written: 6 } });

  const answer = (await (await opened.get("/data/usage")).json()) as Answer;
  // The rows not yet written are asked for by the day the route counts, never another.
  expect(asked).toEqual([day]);

  return answer;
}

/** The lines of an answer as their kind, their number, whether it is the install's own count, and their limit. */
function numbers(answer: Answer): unknown[] {
  return answer.lines.map((line) => [line.what, line.used, line.about, line.limit]);
}

// Drift: a number would be set against another setting's limit, the trash would be left out of the sites, the requests or the rows of another day would be counted, or a line would lead to the host's page of another thing.
test("counts the stored bytes, the sites, the trash, the files, and today's requests and database rows against their limits, each with the host's page of it", async () => {
  const opened = await openConsole();
  const { install, owner, publish, clock } = opened.base;
  const actor = { scope: "admin", holder: owner } as const;
  const kept = await publish("field-notes");
  const trashed = await publish("old-draft");
  await deleteSite(install, actor, { site: trashed.id });
  await changeConfig(install, actor, { max_sites: 5, max_total_size: { count: 2, unit: "MB" } });
  const today = dayOf(clock.now);
  await install.database.addRequests({ day: today, site: kept.id, requests: 1200, views: 40, rows: { read: 12_400, written: 310 } });
  await install.database.addRequests({ day: dayOf(clock.now - 86_400_000), site: kept.id, requests: 9000, views: 1, rows: { read: 90_000, written: 900 } });
  const totals = await install.database.readTotals();

  expect(await (await opened.get("/data/usage")).json()).toEqual({
    ok: true,
    day: today,
    host: "Provider",
    official: null,
    lines: [
      { what: "stored", used: totals.bytes, limit: 2_000_000, setting: "max_total_size", about: false, link: STORAGE_PAGE },
      { what: "sites", used: 2, limit: 5, setting: "max_sites", about: false, link: null },
      { what: "trashed", used: 1, limit: null, setting: null, about: false, link: null },
      { what: "files", used: totals.files, limit: null, setting: null, about: false, link: null },
      { what: "requests", used: 1200, limit: 100_000, setting: "requests_per_day", about: false, link: REQUESTS_PAGE },
      { what: "rows_read", used: 12_400, limit: 5_000_000, setting: null, about: true, link: DATABASE_PAGE },
      { what: "rows_written", used: 310, limit: 90_000, setting: null, about: true, link: DATABASE_PAGE },
    ],
  });
});

// Drift: an install with no limit on its sites would show a limit of nothing as a number.
test("gives the sites no limit while the setting is none", async () => {
  const opened = await openConsole();
  const answer = (await (await opened.get("/data/usage")).json()) as Answer;

  expect(answer.lines.find((line) => line.what === "sites")).toEqual({ what: "sites", used: 0, limit: null, setting: "max_sites", about: false, link: null });
});

// Drift: the rows an instance has counted and not written are a part of the day; left out, a quiet install would show none of the rows its own dashboard read.
test("adds the rows this instance has counted and not yet written to the day's own count", async () => {
  const answer = await usageWith({ ok: false, refusal: "no_key" });

  expect([answer.official, numbers(answer).slice(-2)]).toEqual([
    null,
    [
      ["rows_read", 407, true, 5_000_000],
      ["rows_written", 7, true, 90_000],
    ],
  ]);
});

// Drift: the host's figure would be shown as the install's own estimate, set against a setting's limit and not the free plan's, or the install's own count would stay beside it under the same name.
test("shows the host's own figures in place of the install's count of rows, and as lines of their own for the account's requests, storage, and storage calls", async () => {
  const answer = await usageWith({ ok: true, value: { at: 1_700_000_000_000, requests: 1318, rowsRead: 13_902, rowsWritten: 342, storedBytes: 5_000_000, storageWrites: 41_200, storageReads: 310_000 } });
  const [stored, hostStored, , , , requests, hostRequests] = answer.lines;

  expect([answer.official, numbers(answer).slice(5), [stored, hostStored, requests, hostRequests].map((line) => line?.link)]).toEqual([
    { at: 1_700_000_000_000 },
    [
      ["requests", 20, false, 100_000],
      ["host_requests", 1318, false, 100_000],
      ["rows_read", 13_902, false, 5_000_000],
      ["rows_written", 342, false, 90_000],
      ["storage_writes", 41_200, false, 1_000_000],
      ["storage_reads", 310_000, false, 10_000_000],
    ],
    [null, STORAGE_PAGE, null, REQUESTS_PAGE],
  ]);
});

// Drift: a figure the host left out would be shown as 0 of its limit, which reads as a quiet account.
test("leaves out the line of a figure the host gave none of, and keeps the install's own count where it has one", async () => {
  const answer = await usageWith({ ok: true, value: { at: 1_700_000_000_000, rowsRead: 13_902, rowsWritten: undefined } });

  expect(numbers(answer).slice(4)).toEqual([
    ["requests", 20, false, 100_000],
    ["rows_read", 13_902, false, 5_000_000],
    ["rows_written", 7, true, 90_000],
  ]);
});

// Drift: a key that stopped working would break the screen, or be passed over in silence while the numbers went back to the install's own.
test.each([
  [{ ok: false, refusal: "key_refused" }, { refusal: "key_refused", right: null }],
  [{ ok: false, refusal: "lacks_right", right: "Figures: Read" }, { refusal: "lacks_right", right: "Figures: Read" }],
  [{ ok: false, refusal: "unreachable" }, { refusal: "unreachable", right: null }],
] as const)("answers the install's own count and says why the kept key gave no figures: %o", async (refused, told) => {
  const answer = await usageWith(refused);

  expect([answer.official, numbers(answer).slice(-2)]).toEqual([
    told,
    [
      ["rows_read", 407, true, 5_000_000],
      ["rows_written", 7, true, 90_000],
    ],
  ]);
});
