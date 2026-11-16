import { describe, expect, test } from "bun:test";

import { defaultSettings, type SettingValues } from "@poplin/core/src/records/settings";
import type { SiteId } from "@poplin/core/src/sites/ids";

import { type Counters, checkSiteLimits, countRequest, isPageView, takeVisitorMinute } from "../../src/limits/limits";
import { MemoryCounters } from "../../src/limits/memory-counters";
import type { VisitorKey } from "../../src/limits/visitor-key";

const SETTINGS = { visitor_requests_per_minute: 3, site_requests_per_minute: 5, requests_per_day: 8, site_share_of_day: 50 };
const ROOMY = { visitor_requests_per_minute: 1000, site_requests_per_minute: 1000, requests_per_day: 1000, site_share_of_day: 100 };
const REPORT = "aaaaaaaaaaaa" as SiteId;
const DOCS = "bbbbbbbbbbbb" as SiteId;
const NOON = Date.UTC(2026, 10, 13, 12);
const SECOND = 1000;
const MINUTE = 60 * SECOND;
const HALF_DAY_SECONDS = 43_200;

type Settings = typeof SETTINGS;

/** One request: a letter per visitor, and how long after noon it arrives. */
interface Arrival {
  readonly site: SiteId;
  readonly visitor: string;
  readonly after: number;
}

/** Counters that pass every call on and keep its name, so a test can say which counters a request touched. */
class Watched implements Counters {
  readonly calls: string[] = [];
  readonly #inner = new MemoryCounters();

  takeMinute: Counters["takeMinute"] = (window, now) => {
    this.calls.push(`takeMinute ${window.scope}`);

    return this.#inner.takeMinute(window, now);
  };

  readDay: Counters["readDay"] = (window) => {
    this.calls.push("readDay");

    return this.#inner.readDay(window);
  };

  sampleDay: Counters["sampleDay"] = (window, room) => {
    this.calls.push("sampleDay");

    return this.#inner.sampleDay(window, room);
  };

  countDay: Counters["countDay"] = (counted) => {
    this.calls.push(`countDay ${counted.requests}${counted.page ? " page" : ""}`);

    return this.#inner.countDay();
  };
}

function arrivals(count: number, from: Omit<Arrival, "visitor"> & { readonly visitor?: string }): Arrival[] {
  return Array.from({ length: count }, (_unused, at) => ({ ...from, visitor: from.visitor ?? `visitor-${at}` }));
}

/** A request against every limit in the Worker's order: the visitor's minute first, then the site's minute and the day. */
async function checkLimits(asked: Parameters<typeof takeVisitorMinute>[0] & Parameters<typeof checkSiteLimits>[0], counters: Counters): ReturnType<typeof checkSiteLimits> {
  const visitor = await takeVisitorMinute(asked, counters);

  return visitor.ok ? checkSiteLimits(asked, counters) : visitor;
}

/** A request as the Worker takes it: checked against the limits, and counted against its day once they let it through. */
async function takeRequest(asked: Parameters<typeof checkLimits>[0], counters: Parameters<typeof checkLimits>[1]): ReturnType<typeof checkLimits> {
  const verdict = await checkLimits(asked, counters);
  if (verdict.ok) await countRequest({ site: asked.site, now: asked.now, requests: verdict.requests, page: false }, counters);

  return verdict;
}

/** Send the arrivals in order and write each answer as `ok` or `<which>:<retryAfterSeconds>`. */
async function answers(counters: Counters, settings: Settings, requests: readonly Arrival[]): Promise<string[]> {
  const written: string[] = [];

  for (const request of requests) {
    const verdict = await takeRequest({ settings, site: request.site, visitor: request.visitor as VisitorKey, now: NOON + request.after }, counters);
    written.push(verdict.ok ? "ok" : `${verdict.which}:${verdict.retryAfterSeconds}`);
  }

  return written;
}

function repeated(answer: string, count: number): string[] {
  return new Array<string>(count).fill(answer);
}

describe("the limits of a request", () => {
  // Drift: a browser asks for every file of a page within seconds, so the per-minute defaults of a new install bound how large a page can be. Defaults sized for one request per view answer the 31st file of a page 429.
  test.each([
    { name: "one visitor opening a page of 100 files", visitors: 1, files: 100 },
    { name: "two visitors opening a page of 40 files each", visitors: 2, files: 40 },
  ])("under the settings of a new install no file is refused: $name", async ({ visitors, files }) => {
    const settings = defaultSettings({ installer: "owner@example.com" as SettingValues["logins"][number] });
    const requests = Array.from({ length: visitors }, (_unused, at) => arrivals(files, { site: REPORT, visitor: `visitor-${at}`, after: at * SECOND })).flat();

    expect(await answers(new MemoryCounters(), settings, requests)).toEqual(repeated("ok", visitors * files));
  });

  const cases: readonly { readonly name: string; readonly settings: Settings; readonly requests: readonly Arrival[]; readonly expected: readonly string[] }[] =
    [
      {
        name: "a visitor below and at the visitor limit passes, and the next request of that minute waits for the minute to end",
        settings: { ...ROOMY, visitor_requests_per_minute: 3 },
        requests: [
          ...arrivals(3, { site: REPORT, visitor: "ada", after: 0 }),
          { site: REPORT, visitor: "ada", after: 20 * SECOND },
          { site: REPORT, visitor: "bo", after: 20 * SECOND },
        ],
        expected: ["ok", "ok", "ok", "visitor:40", "ok"],
      },
      {
        name: "a visitor's count is one count over every site",
        settings: { ...ROOMY, visitor_requests_per_minute: 3 },
        requests: [...arrivals(2, { site: REPORT, visitor: "ada", after: 0 }), ...arrivals(2, { site: DOCS, visitor: "ada", after: 0 })],
        expected: ["ok", "ok", "ok", "visitor:60"],
      },
      {
        name: "a site at its limit passes, the next visitor waits, and another site is not held back",
        settings: { ...ROOMY, site_requests_per_minute: 5 },
        requests: [...arrivals(6, { site: REPORT, after: 59 * SECOND + 1 }), { site: DOCS, visitor: "ada", after: 59 * SECOND + 1 }],
        expected: [...repeated("ok", 5), "site:1", "ok"],
      },
      {
        name: "a minute that rolls over takes requests again, for the visitor and for the site",
        settings: { ...ROOMY, visitor_requests_per_minute: 1, site_requests_per_minute: 2 },
        requests: [
          { site: REPORT, visitor: "ada", after: 0 },
          { site: REPORT, visitor: "ada", after: MINUTE - 1 },
          { site: REPORT, visitor: "bo", after: MINUTE - 1 },
          { site: REPORT, visitor: "cy", after: MINUTE - 1 },
          { site: REPORT, visitor: "ada", after: MINUTE },
          { site: REPORT, visitor: "cy", after: MINUTE },
        ],
        expected: ["ok", "visitor:1", "ok", "site:1", "ok", "ok"],
      },
      {
        name: "the day at its limit passes, the next request waits until midnight UTC, on any site",
        settings: { ...ROOMY, requests_per_day: 8 },
        requests: [...arrivals(8, { site: REPORT, after: 0 }), { site: REPORT, visitor: "ada", after: 0 }, { site: DOCS, visitor: "ada", after: SECOND }],
        expected: [...repeated("ok", 8), `day:${HALF_DAY_SECONDS}`, `day:${HALF_DAY_SECONDS - 1}`],
      },
      {
        name: "a site at its share of the day waits until midnight while another site still passes",
        settings: { ...ROOMY, requests_per_day: 8, site_share_of_day: 50 },
        requests: [...arrivals(5, { site: REPORT, after: 0 }), ...arrivals(4, { site: DOCS, after: 0 })],
        expected: [...repeated("ok", 4), `site-share:${HALF_DAY_SECONDS}`, ...repeated("ok", 4)],
      },
      {
        name: "two sites share the day: once both have used it up, each is told the day is full, not its share",
        settings: { ...ROOMY, requests_per_day: 8, site_share_of_day: 75 },
        requests: [...arrivals(6, { site: REPORT, after: 0 }), ...arrivals(3, { site: DOCS, after: 0 }), { site: REPORT, visitor: "ada", after: 0 }],
        expected: [...repeated("ok", 6), "ok", "ok", `day:${HALF_DAY_SECONDS}`, `day:${HALF_DAY_SECONDS}`],
      },
      {
        name: "a new UTC day takes requests again, for the day and for the site's share",
        settings: { ...ROOMY, requests_per_day: 2, site_share_of_day: 50 },
        requests: [
          { site: REPORT, visitor: "ada", after: 0 },
          { site: REPORT, visitor: "ada", after: 0 },
          { site: DOCS, visitor: "ada", after: 12 * 60 * MINUTE - 1 },
          { site: DOCS, visitor: "ada", after: 12 * 60 * MINUTE - 1 },
          { site: REPORT, visitor: "ada", after: 12 * 60 * MINUTE },
        ],
        expected: ["ok", `site-share:${HALF_DAY_SECONDS}`, "ok", "day:1", "ok"],
      },
      {
        name: "a share that rounds to nothing still lets a site answer one request a day",
        settings: { ...ROOMY, requests_per_day: 10, site_share_of_day: 1 },
        requests: arrivals(2, { site: REPORT, after: 0 }),
        expected: ["ok", `site-share:${HALF_DAY_SECONDS}`],
      },
    ];

  // Drift: the four settings are promises to the owner; a limit off by one, or a window that never reopens, breaks one silently.
  test.each(cases)("$name", async ({ settings, requests, expected }) => {
    expect(await answers(new MemoryCounters(), settings, requests)).toEqual([...expected]);
  });

  const touched: readonly { readonly name: string; readonly before: readonly Arrival[]; readonly calls: readonly string[]; readonly answer: string }[] = [
    { name: "an allowed request", before: [], calls: ["takeMinute visitor", "takeMinute site", "readDay", "sampleDay", "countDay 1"], answer: "ok" },
    {
      name: "a request the visitor limit refuses",
      before: arrivals(3, { site: DOCS, visitor: "ada", after: 0 }),
      calls: ["takeMinute visitor"],
      answer: "visitor:60",
    },
    {
      name: "a request the site limit refuses",
      before: arrivals(5, { site: REPORT, after: 0 }),
      calls: ["takeMinute visitor", "takeMinute site"],
      answer: "site:60",
    },
    {
      name: "a request the site's share refuses",
      before: arrivals(4, { site: REPORT, after: 0 }),
      calls: ["takeMinute visitor", "takeMinute site", "readDay", "sampleDay"],
      answer: `site-share:${HALF_DAY_SECONDS}`,
    },
    {
      name: "a request the day refuses",
      before: [...arrivals(4, { site: REPORT, after: 0 }), ...arrivals(4, { site: DOCS, after: 0 })],
      calls: ["takeMinute visitor", "takeMinute site", "readDay", "sampleDay"],
      answer: `day:${HALF_DAY_SECONDS}`,
    },
  ];

  // Drift: a refused request that still counted further down would let one noisy visitor use up a site's minute, or a busy site the whole day.
  test.each(touched)("$name touches exactly the counters down to its own check", async ({ before, calls, answer }) => {
    const counters = new Watched();
    await answers(counters, SETTINGS, before);
    counters.calls.length = 0;

    expect(await answers(counters, SETTINGS, [{ site: REPORT, visitor: "ada", after: 0 }])).toEqual([answer]);
    expect(counters.calls).toEqual([...calls]);
  });

  // Drift: the same rule seen from the counts: requests a visitor was refused must leave the site's minute and the day as they were.
  test("a visitor refused a hundred times uses up nothing of the site's minute or of the day", async () => {
    const counters = new MemoryCounters();
    const settings = { ...ROOMY, visitor_requests_per_minute: 1, site_requests_per_minute: 3, requests_per_day: 3 };
    const flood = await answers(counters, settings, arrivals(101, { site: REPORT, visitor: "ada", after: 0 }));
    const others = await answers(counters, settings, arrivals(3, { site: REPORT, after: 0 }));

    expect([flood.filter((answer) => answer === "ok").length, others]).toEqual([1, ["ok", "ok", "site:60"]]);
    expect(await counters.readDay({ day: "2026-11-13", site: REPORT })).toEqual({ site: 3, all: 3 });
  });

  const broken = ["takeMinute", "readDay", "countDay"] as const;

  // Drift: a database at its own daily limit, or a binding that fails, must not take every site down with it.
  test.each(broken)("a counter whose %s fails lets requests through, and the counters that work still refuse", async (method) => {
    const counters = new Watched();
    Object.assign(counters, { [method]: () => Promise.reject(new Error("the counter is unavailable")) });
    const sent = await answers(
      counters,
      { ...ROOMY, visitor_requests_per_minute: 2, requests_per_day: 3 },
      arrivals(4, { site: REPORT, visitor: "ada", after: 0 }),
    );

    expect(sent).toEqual(
      {
        takeMinute: ["ok", "ok", "ok", `day:${HALF_DAY_SECONDS}`],
        readDay: ["ok", "ok", "visitor:60", "visitor:60"],
        countDay: ["ok", "ok", "visitor:60", "visitor:60"],
      }[method],
    );
  });

  // Drift: a site's views are whatever this says a page is; a file, a refusal, or the redirect to the login counted as one would show opens nobody made.
  test.each([
    ["a page", "GET", 200, '"v3-lq1x2k00"', true],
    ["a page the visitor already holds", "GET", 304, '"v3-lq1x2k00"', true],
    ["a page a cache in between tagged weak", "GET", 304, 'W/"v3-lq1x2k00"', true],
    ["a page asked for by its headers alone", "HEAD", 200, '"v3-lq1x2k00"', false],
    ["a stylesheet", "GET", 200, '"0f343b0931126a20f133d67c2b018a3b"', false],
    ["a stylesheet the visitor already holds", "GET", 304, '"0f343b0931126a20f133d67c2b018a3b"', false],
    ["a part of a page", "GET", 206, '"v3-lq1x2k00"', false],
    ["a redirect", "GET", 302, null, false],
    ["a refusal", "GET", 404, null, false],
  ] as const)("%s is a view or not, as the answer says", (_name, method, status, tag, expected) => {
    const response = new Response(null, { status, headers: tag === null ? {} : { ETag: tag } });

    expect(isPageView(new Request("https://report--k3f9x2ab71qz-u-poplin.example.com/", { method }), response)).toBe(expected);
  });

  // Drift: the Worker counts after it answers; a count that lost the page flag, or that threw when the counter is down, would lose every view or fail a page that was already served.
  test("an answered request is written for its site on its UTC day with what it stands for and whether it opened a page; one the sample left out is not written, and a counter that fails is not heard of", async () => {
    const counters = new Watched();
    const sampled = [counters.sampleDay({ day: "2026-11-13", site: REPORT }, { all: 9, site: 9 }, NOON)];
    await countRequest({ site: REPORT, now: NOON, requests: 50, page: true }, counters);
    await countRequest({ site: REPORT, now: NOON, requests: 1, page: false }, counters);
    await countRequest({ site: REPORT, now: NOON, requests: 0, page: true }, counters);
    await countRequest({ site: REPORT, now: NOON, requests: 1, page: true }, { countDay: () => Promise.reject(new Error("the counter is unavailable")) });

    expect([sampled, counters.calls, await counters.readDay({ day: "2026-11-13", site: REPORT }, NOON)]).toEqual([
      [1],
      ["sampleDay", "countDay 50 page", "countDay 1", "readDay"],
      { site: 1, all: 1 },
    ]);
  });

  // Drift: the day's check and its count must be one step; with a wait between them, every request that arrives during it passes a day that has room for one.
  test("of requests that arrive together only as many pass as the day has room for, and the rest are refused without being counted", async () => {
    const counters = new MemoryCounters();
    const settings = { ...ROOMY, requests_per_day: 2 };
    const together = await Promise.all(Array.from({ length: 5 }, (_request, at) => checkLimits({ settings, site: REPORT, visitor: `visitor-${at}` as VisitorKey, now: NOON }, counters)));

    expect([together.map((verdict) => (verdict.ok ? "ok" : verdict.which)).sort(), await counters.readDay({ day: "2026-11-13", site: REPORT })]).toEqual([
      ["day", "day", "day", "ok", "ok"],
      { site: 2, all: 2 },
    ]);
  });

  test("with every counter failing, every request is allowed", async () => {
    const failing = (): Promise<never> => Promise.reject(new Error("the counter is unavailable"));
    const counters: Counters = {
      takeMinute: failing,
      readDay: failing,
      sampleDay: () => {
        throw new Error("the counter is unavailable");
      },
      countDay: failing,
    };

    expect(await answers(counters, SETTINGS, arrivals(20, { site: REPORT, visitor: "ada", after: 0 }))).toEqual(repeated("ok", 20));
  });
});
