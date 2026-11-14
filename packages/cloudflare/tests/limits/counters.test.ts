import { reset } from "cloudflare:test";
import { env } from "cloudflare:workers";
import type { CountedRequests, RequestCounts } from "@poplin/core/src/database/database";
import { openDatabase } from "@poplin/core/src/database/open";
import type { SiteId } from "@poplin/core/src/sites/ids";
import fc from "fast-check";
import { describe, expect, test } from "vitest";

import { checkLimits } from "@poplin/app/src/limits/limits";
import { type VisitorKey, visitorKey } from "@poplin/app/src/limits/visitor-key";
import type { Bindings } from "../../src/worker/bindings";
import { clientAddress } from "../../src/limits/client-address";
import { CloudflareCounters } from "../../src/limits/counters";
import { D1Driver } from "../../src/database/d1";

const BINDINGS: Bindings = env;
const REPORT = "aaaaaaaaaaaa" as SiteId;
const DOCS = "bbbbbbbbbbbb" as SiteId;
const TODAY = "2026-11-13";
const NOON = Date.UTC(2026, 10, 13, 12);
const MINUTE = 60_000;
const ROOMY = { visitor_requests_per_minute: 1000, site_requests_per_minute: 1000, requests_per_day: 1000, site_share_of_day: 100 };
const FULL_DAY = { visitor_requests_per_minute: 1_000_000, site_requests_per_minute: 1_000_000, requests_per_day: 100_000, site_share_of_day: 100 };
const FREE_PLAN_REQUESTS_A_DAY = 100_000;
const FREE_PLAN_ROWS_WRITTEN_A_DAY = 100_000;
const UINT32_VALUES = 4_294_967_296;
const STATED_ERROR = 0.016;
const ALWAYS_ROOM = { limit: async () => ({ success: true }) };

/** The two database operations, exact and in memory, with every call counted. */
class FakeDatabase {
  reads = 0;
  writes = 0;
  readonly #sites = new Map<string, number>();
  #all = 0;

  async addRequests(counted: CountedRequests): Promise<RequestCounts> {
    this.writes += 1;
    this.#sites.set(counted.site, (this.#sites.get(counted.site) ?? 0) + counted.requests);
    this.#all += counted.requests;

    return { site: this.#sites.get(counted.site) ?? 0, all: this.#all };
  }

  async readRequests(_day: string, site: SiteId): Promise<RequestCounts> {
    this.reads += 1;

    return { site: this.#sites.get(site) ?? 0, all: this.#all };
  }
}

/** A repeatable list of evenly spread numbers from 0 up to 1. */
function seeded(seed: number, count: number): () => number {
  const drawn = fc.sample(fc.noBias(fc.integer({ min: 0, max: UINT32_VALUES - 1 })), { seed, numRuns: count });

  return () => (drawn.pop() ?? 0) / UINT32_VALUES;
}

function draws(...numbers: number[]): () => number {
  return () => numbers.shift() ?? 0.999;
}

/** The key of a visitor in one of two IPv6 networks; every request comes from another address of its network, in the header Cloudflare sets. */
async function visitor(request: number): Promise<VisitorKey> {
  const secret = await crypto.subtle.importKey("raw", new TextEncoder().encode("a test secret, never a real one"), { name: "HMAC", hash: "SHA-256" }, false, [
    "sign",
  ]);
  const headers = new Headers({ "CF-Connecting-IP": `2001:db8:0:${request % 2}::${request + 1}` });

  return visitorKey(clientAddress(headers), secret, Date.now());
}

async function onBindings(): Promise<CloudflareCounters> {
  await reset();
  const opened = await openDatabase(new D1Driver(BINDINGS.DB), Date.now());
  if (opened.kind !== "open") throw new Error(`the database did not open: ${opened.kind}`);

  return new CloudflareCounters({ limiter: BINDINGS.MINUTE_LIMITS, database: opened.database });
}

/** Run something within one minute of the clock. The binding's minute is the clock's, so a run that crosses one is made again. */
async function withinOneMinute<Result>(run: (counters: CloudflareCounters) => Promise<Result>): Promise<Result> {
  for (;;) {
    const counters = await onBindings();
    const started = Math.floor(Date.now() / MINUTE);
    const result = await run(counters);

    if (Math.floor(Date.now() / MINUTE) === started) return result;
  }
}

/** Send requests one after another, and say which passed. */
function sent(count: number, settings: typeof ROOMY, site: SiteId): Promise<string[]> {
  return withinOneMinute(async (counters) => {
    const answers: string[] = [];

    for (let request = 0; request < count; request += 1) {
      const verdict = await checkLimits({ settings, site, visitor: await visitor(request), now: Date.now() }, counters);
      answers.push(verdict.ok ? "ok" : verdict.which);
    }

    return answers;
  });
}

describe("CloudflareCounters on the bindings of wrangler.jsonc", () => {
  const weights: readonly { readonly setting: number; readonly passed: number }[] = [
    { setting: 1, passed: 1 },
    { setting: 2, passed: 2 },
    { setting: 30, passed: 30 },
    { setting: 60, passed: 60 },
    { setting: 999, passed: 999 },
    { setting: 1000, passed: 1000 },
    { setting: 2001, passed: 2000 },
    { setting: 3000, passed: 2995 },
  ];

  // Drift: the binding's limit is fixed in wrangler.jsonc and the setting is not; a weight computed against another number makes every per-minute setting wrong at once.
  test.each(weights)("on the declared binding, a setting of $setting lets $passed requests into a minute and never more", async ({ setting, passed }) => {
    const taken = await withinOneMinute(async (counters) => {
      const answers: unknown[] = [];
      for (let request = 0; request < setting + 3; request += 1) answers.push(await counters.takeMinute({ scope: "site", key: REPORT, limit: setting }));

      return answers;
    });

    expect([taken.filter((answer) => (answer as { ok: boolean }).ok).length, taken.at(-1)]).toEqual([passed, { ok: false, retryAfterSeconds: 60 }]);
  });

  const cases: readonly { readonly name: string; readonly settings: typeof ROOMY; readonly expected: readonly string[] }[] = [
    {
      name: "a visitor setting of 2 lets two requests from each IPv6 /64 through the rate limiting binding and refuses the third",
      settings: { ...ROOMY, visitor_requests_per_minute: 2 },
      expected: ["ok", "ok", "ok", "ok", "visitor", "visitor"],
    },
    {
      name: "a site setting of 3 refuses the site's fourth request",
      settings: { ...ROOMY, site_requests_per_minute: 3 },
      expected: ["ok", "ok", "ok", "site", "site", "site"],
    },
    {
      name: "a day of 4 requests is counted in D1 and refuses the fifth",
      settings: { ...ROOMY, requests_per_day: 4 },
      expected: ["ok", "ok", "ok", "ok", "day", "day"],
    },
    {
      name: "a site's share of 2 requests is counted in D1 and refuses the third",
      settings: { ...ROOMY, requests_per_day: 4, site_share_of_day: 50 },
      expected: ["ok", "ok", "site-share", "site-share", "site-share", "site-share"],
    },
  ];

  // Drift: the binding's weight rule and D1's upsert are Cloudflare's; a fake that disagrees with them would pass while the deployed limits are off.
  test.each(cases)("$name", async ({ settings, expected }) => {
    expect(await sent(6, settings, REPORT)).toEqual([...expected]);
  });

  test("the day's counts outlive the instance that wrote them: a second instance sees the first one's requests", async () => {
    const first = await onBindings();
    const settings = { ...ROOMY, requests_per_day: 2 };
    await checkLimits({ settings, site: REPORT, visitor: "ada" as VisitorKey, now: Date.now() }, first);
    await checkLimits({ settings, site: DOCS, visitor: "ada" as VisitorKey, now: Date.now() }, first);

    const opened = await openDatabase(new D1Driver(BINDINGS.DB), Date.now());
    if (opened.kind !== "open") throw new Error(`the database did not open: ${opened.kind}`);
    const second = new CloudflareCounters({ limiter: BINDINGS.MINUTE_LIMITS, database: opened.database });

    expect(await checkLimits({ settings, site: DOCS, visitor: "bo" as VisitorKey, now: Date.now() }, second)).toMatchObject({ ok: false, which: "day" });
  });
});

describe("CloudflareCounters, the day's sampling", () => {
  const sampling: readonly { readonly counted: number; readonly draw: number; readonly added: number }[] = [
    { counted: 0, draw: 0.99, added: 1 },
    { counted: 1999, draw: 0.99, added: 1 },
    { counted: 2000, draw: 0.49, added: 2 },
    { counted: 2000, draw: 0.5, added: 0 },
    { counted: 98_000, draw: 0.019, added: 50 },
    { counted: 98_000, draw: 0.02, added: 0 },
    { counted: 5_000_000, draw: 0.019, added: 50 },
  ];

  // Drift: a sample must add as many requests as it stands for, or the estimate runs high or low and the day ends early or never.
  test.each(sampling)("once a day has counted $counted, a draw of $draw adds $added", async ({ counted, draw, added }) => {
    const database = new FakeDatabase();
    const counters = new CloudflareCounters({ limiter: ALWAYS_ROOM, database, random: draws(draw) });
    const window = { day: TODAY, site: REPORT };
    if (counted > 0) await database.addRequests({ day: TODAY, site: DOCS, requests: counted });
    await counters.readDay(window, NOON);
    await counters.countDay(window, NOON);

    expect(await database.readRequests(TODAY, REPORT)).toEqual({ site: added, all: counted + added });
  });

  // Drift: a database row read on every request would put a query in front of every file a page loads.
  test("an instance reads the database once per site in half a minute, sees its own samples at once, and reads again for a new day", async () => {
    const database = new FakeDatabase();
    const counters = new CloudflareCounters({ limiter: ALWAYS_ROOM, database, random: draws(0) });
    const window = { day: TODAY, site: REPORT };
    await database.addRequests({ day: TODAY, site: REPORT, requests: 7 });

    const seen = [await counters.readDay(window, NOON), await counters.readDay(window, NOON + 29_999)];
    await database.addRequests({ day: TODAY, site: DOCS, requests: 5 });
    seen.push(await counters.readDay(window, NOON + 29_999), await counters.readDay({ ...window, site: DOCS }, NOON + 29_999));
    await counters.countDay(window, NOON + 29_999);
    seen.push(await counters.readDay(window, NOON + 29_999), await counters.readDay(window, NOON + 60_000));
    const readsToday = database.reads;
    await counters.readDay({ ...window, day: "2026-11-14" }, NOON + 60_001);

    expect(seen).toEqual([
      { site: 7, all: 7 },
      { site: 7, all: 7 },
      { site: 7, all: 7 },
      { site: 5, all: 12 },
      { site: 8, all: 13 },
      { site: 8, all: 13 },
    ]);
    expect([readsToday, database.reads]).toEqual([3, 4]);
  });

  // Drift: D1's Free plan stops at 100,000 rows written a day; a day of traffic that wrote a row per request would take the whole database down with it.
  test("a day of 150,000 requests against a limit of 100,000 is cut off within three times the stated error, on under a quarter of D1's daily rows", async () => {
    const database = new FakeDatabase();
    const requests = FREE_PLAN_REQUESTS_A_DAY * 1.5;
    const counters = new CloudflareCounters({ limiter: ALWAYS_ROOM, database, random: seeded(20_261_113, requests) });
    let allowed = 0;

    for (let request = 0; request < requests; request += 1) {
      const verdict = await checkLimits({ settings: FULL_DAY, site: REPORT, visitor: "ada" as VisitorKey, now: NOON + request }, counters);
      if (verdict.ok) allowed += 1;
    }

    const rowsWritten = database.writes * 2;
    const rowsRead = database.reads * 2;

    expect(Math.abs(allowed - FULL_DAY.requests_per_day)).toBeLessThan(3 * STATED_ERROR * FULL_DAY.requests_per_day);
    expect([rowsWritten < FREE_PLAN_ROWS_WRITTEN_A_DAY / 4, rowsRead < 20]).toEqual([true, true]);
  });

  // Drift: requests that arrive together all read the day before any of them is counted; if each then wrote its own rows, one burst would use up D1's writes and stop every site's lookups until midnight.
  test("50,001 requests arriving at once under a day limit of 3,999 write under a quarter of D1's daily rows", async () => {
    const database = new FakeDatabase();
    const counters = new CloudflareCounters({ limiter: ALWAYS_ROOM, database, random: seeded(20_261_114, 50_001) });
    const settings = { ...FULL_DAY, requests_per_day: 3999 };
    const flood = Array.from({ length: 50_001 }, () => checkLimits({ settings, site: REPORT, visitor: "ada" as VisitorKey, now: NOON }, counters));
    await Promise.all(flood);

    expect(database.writes * 2).toBeLessThan(FREE_PLAN_ROWS_WRITTEN_A_DAY / 4);
  });
});
