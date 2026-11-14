import { reset } from "cloudflare:test";
import { env } from "cloudflare:workers";
import type { CountedRequests, RequestCounts } from "@poplin/core/src/database/database";
import { openDatabase } from "@poplin/core/src/database/open";
import type { SiteId } from "@poplin/core/src/sites/ids";
import fc from "fast-check";
import { describe, expect, test } from "vitest";

import { checkLimits, countRequest } from "@poplin/app/src/limits/limits";
import { type VisitorKey, visitorKey } from "@poplin/app/src/limits/visitor-key";
import type { Bindings } from "../../src/worker/bindings";
import { clientAddress } from "../../src/limits/client-address";
import { CloudflareCounters } from "../../src/limits/counters";
import { D1Driver } from "../../src/database/d1";

const BINDINGS: Bindings = env;
const REPORT = "aaaaaaaaaaaa" as SiteId;
const DOCS = "bbbbbbbbbbbb" as SiteId;
const TODAY = "2026-11-13";
const TOMORROW = "2026-11-14";
const NOON = Date.UTC(2026, 10, 13, 12);
const MINUTE = 60_000;
const ROOMY = { visitor_requests_per_minute: 1000, site_requests_per_minute: 1000, requests_per_day: 1000, site_share_of_day: 100 };
const FULL_DAY = { visitor_requests_per_minute: 1_000_000, site_requests_per_minute: 1_000_000, requests_per_day: 100_000, site_share_of_day: 100 };
const FREE_PLAN_REQUESTS_A_DAY = 100_000;
const FREE_PLAN_ROWS_WRITTEN_A_DAY = 100_000;
const UINT32_VALUES = 4_294_967_296;
const STATED_ERROR = 0.016;
const ALWAYS_ROOM = { limit: async () => ({ success: true }) };
const NO_BOUND = { all: Number.MAX_SAFE_INTEGER, site: Number.MAX_SAFE_INTEGER };

/** A request as the Worker takes it: checked against the limits, and counted against its day once they let it through. */
async function takeRequest(asked: Parameters<typeof checkLimits>[0], counters: Parameters<typeof checkLimits>[1]): ReturnType<typeof checkLimits> {
  const verdict = await checkLimits(asked, counters);
  if (verdict.ok) await countRequest({ site: asked.site, now: asked.now, requests: verdict.requests, page: false }, counters);

  return verdict;
}

/** Take one request into the day's sample and write it, as the Worker does around an answer. */
async function count(counters: CloudflareCounters, window: { readonly day: string; readonly site: SiteId }, page: boolean, at: number): Promise<void> {
  const requests = counters.sampleDay(window, NO_BOUND, at);
  if (typeof requests === "number") await countRequest({ site: window.site, now: at, requests, page }, counters);
}

/** The two database operations, exact and in memory, with every call counted and the page views of every write kept in order. A write is stored once `stored` settles. */
class FakeDatabase {
  reads = 0;
  writes = 0;
  readonly #sites = new Map<string, number>();
  #all = 0;
  readonly views: (number | undefined)[] = [];
  stored: Promise<void> = Promise.resolve();

  async addRequests(counted: CountedRequests): Promise<RequestCounts> {
    await this.stored;
    this.writes += 1;
    this.views.push(counted.views);
    this.#sites.set(counted.site, (this.#sites.get(counted.site) ?? 0) + counted.requests);
    this.#all += counted.requests;

    return { site: this.#sites.get(counted.site) ?? 0, all: this.#all };
  }

  async readRequests(_day: string, site: SiteId): Promise<RequestCounts> {
    this.reads += 1;

    return { site: this.#sites.get(site) ?? 0, all: this.#all };
  }
}

/**
 * A database whose answers come back when a test lets them. A call is stored the moment it is made, as a write or as a read of that moment, and its answer waits in `replies` until `reply` lets it back, with everything that waited on it.
 */
class HeldDatabase {
  readonly replies: (() => void)[] = [];
  readonly #counts = new Map<string, number>();

  addRequests(counted: CountedRequests): Promise<RequestCounts> {
    for (const key of [`${counted.day} ${counted.site}`, counted.day]) this.#counts.set(key, (this.#counts.get(key) ?? 0) + counted.requests);

    return this.readRequests(counted.day, counted.site);
  }

  readRequests(day: string, site: SiteId): Promise<RequestCounts> {
    const counts = { site: this.#counts.get(`${day} ${site}`) ?? 0, all: this.#counts.get(day) ?? 0 };

    return new Promise((resolve) => {
      this.replies.push(() => resolve(counts));
    });
  }

  async reply(index: number): Promise<void> {
    const [answer] = this.replies.splice(index, 1);
    answer?.();
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
}

/** Counters over a held database that sample every request, and the day's counts as the instance holds them, read without a call to the database. */
function held(): { readonly database: HeldDatabase; readonly counters: CloudflareCounters } {
  const database = new HeldDatabase();

  return { database, counters: new CloudflareCounters({ limiter: ALWAYS_ROOM, database, random: () => 0 }) };
}

/** One step of a played run: a request taken, the oldest unwritten one sent to be written, a read of the database, or one waiting answer let back. */
type Step =
  | { readonly kind: "take"; readonly site: SiteId; readonly later: boolean }
  | { readonly kind: "write" }
  | { readonly kind: "read"; readonly site: SiteId }
  | { readonly kind: "reply"; readonly pick: number };

/** One instance over a held database, played a step at a time beside an exact count of what it took. Every take must answer as the exact count would. */
class Play {
  readonly #room: { readonly all: number; readonly site: number };
  readonly #instance = held();
  readonly #taken = new Map<string, number>();
  readonly #unwritten: { day: string; site: SiteId }[] = [];
  #day = TODAY;
  #now = NOON;

  constructor(room: { readonly all: number; readonly site: number }) {
    this.#room = room;
  }

  async step(step: Step): Promise<void> {
    this.#now += 7000;
    if (step.kind === "take") return this.#take(step.site, step.later);

    if (step.kind === "read") return void this.#instance.counters.readDay({ day: this.#day, site: step.site }, this.#now);

    if (step.kind === "write") return this.#write();

    const waiting = this.#instance.database.replies.length;
    if (waiting > 0) await this.#instance.database.reply(step.pick % waiting);
  }

  #take(site: SiteId, later: boolean): void {
    if (later) this.#day = TOMORROW;

    const counted = { all: this.#taken.get(this.#day) ?? 0, site: this.#taken.get(`${this.#day} ${site}`) ?? 0 };
    const expected = roomFor(counted, this.#room);
    expect(this.#instance.counters.sampleDay({ day: this.#day, site }, this.#room, this.#now)).toBe(expected);
    if (expected !== 1) return;

    this.#taken.set(this.#day, counted.all + 1).set(`${this.#day} ${site}`, counted.site + 1);
    this.#unwritten.push({ day: this.#day, site });
  }

  #write(): void {
    const next = this.#unwritten.shift();
    if (next !== undefined) void this.#instance.counters.countDay({ ...next, requests: 1, page: false }, this.#now);
  }
}

/** What an exact count answers a request with: the limit that is full, or 1 for a request it takes. */
function roomFor(counted: RequestCounts, room: { readonly all: number; readonly site: number }): 1 | "day" | "site-share" {
  if (counted.all >= room.all) return "day";

  return counted.site >= room.site ? "site-share" : 1;
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
      const verdict = await takeRequest({ settings, site, visitor: await visitor(request), now: Date.now() }, counters);
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
    { setting: 600, passed: 600 },
    { setting: 999, passed: 999 },
    { setting: 1000, passed: 1000 },
    { setting: 2001, passed: 2000 },
    { setting: 3000, passed: 2995 },
    { setting: 6000, passed: 5989 },
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
    await takeRequest({ settings, site: REPORT, visitor: "ada" as VisitorKey, now: Date.now() }, first);
    await takeRequest({ settings, site: DOCS, visitor: "ada" as VisitorKey, now: Date.now() }, first);

    const opened = await openDatabase(new D1Driver(BINDINGS.DB), Date.now());
    if (opened.kind !== "open") throw new Error(`the database did not open: ${opened.kind}`);
    const second = new CloudflareCounters({ limiter: BINDINGS.MINUTE_LIMITS, database: opened.database });

    expect(await takeRequest({ settings, site: DOCS, visitor: "bo" as VisitorKey, now: Date.now() }, second)).toMatchObject({ ok: false, which: "day" });
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
    await count(counters, window, false, NOON);

    expect(await database.readRequests(TODAY, REPORT)).toEqual({ site: added, all: counted + added });
  });

  // Drift: a view rides in the write of its own sampled request; a view written apart would be a second row a request, and one that added 1 where its sample stands for 50 would undercount fifty times.
  test.each(sampling)("once a day has counted $counted, a page drawn at $draw adds $added views in the one write of its request, and a file adds none", async ({ counted, draw, added }) => {
    const window = { day: TODAY, site: REPORT };
    const written: (number | undefined)[][] = [];

    for (const page of [true, false]) {
      const database = new FakeDatabase();
      const counters = new CloudflareCounters({ limiter: ALWAYS_ROOM, database, random: draws(draw) });
      if (counted > 0) await database.addRequests({ day: TODAY, site: DOCS, requests: counted });
      await counters.readDay(window, NOON);
      await count(counters, window, page, NOON);
      written.push(database.views.slice(counted > 0 ? 1 : 0));
    }

    expect(written).toEqual(added === 0 ? [[], []] : [[added], [0]]);
  });

  // Drift: the write comes after the answer; were the request counted only then, every request that arrives while one is served would be checked against a day without it.
  test("a request taken into the sample is in the next read of its site and of the day at once, before anything is written", async () => {
    const database = new FakeDatabase();
    const counters = new CloudflareCounters({ limiter: ALWAYS_ROOM, database, random: draws(0, 0) });
    const window = { day: TODAY, site: REPORT };
    const before = await counters.readDay(window, NOON);
    const taken = [counters.sampleDay(window, NO_BOUND, NOON), counters.sampleDay(window, NO_BOUND, NOON)];

    expect([before, taken, await counters.readDay(window, NOON + 1), database.writes]).toEqual([{ site: 0, all: 0 }, [1, 1], { site: 2, all: 2 }, 0]);
  });

  // Drift: a write that comes back holds only what is written; were it to replace what the instance counts, every request still being served would give its place in the day back.
  test("a day of 3 takes 3 requests that arrive together and no more, also after one of them is written while the others are still served", async () => {
    const database = new FakeDatabase();
    const counters = new CloudflareCounters({ limiter: ALWAYS_ROOM, database, random: draws(0, 0, 0, 0, 0) });
    const asked = { settings: { visitor_requests_per_minute: 9, site_requests_per_minute: 9, requests_per_day: 3, site_share_of_day: 100 }, site: REPORT, visitor: "ada" as VisitorKey, now: NOON };
    const together = await Promise.all(Array.from({ length: 4 }, () => checkLimits(asked, counters)));
    await countRequest({ site: REPORT, now: NOON, requests: 1, page: false }, counters);
    const later = await checkLimits(asked, counters);

    expect([together.map((verdict) => verdict.ok), later.ok, database.writes, await counters.readDay({ day: TODAY, site: REPORT }, NOON)]).toEqual([[true, true, true, false], false, 1, { site: 3, all: 3 }]);
  });

  // Drift: the database's answers come back in any order; one that lowered the instance's count would hand a taken place in the day out a second time.
  test("an answer of the database that comes back late or out of order never lowers the count: a read sent before a write and answered after it, and two writes answered in the other order", async () => {
    const window = { day: TODAY, site: REPORT };
    const late = held();
    const first = late.counters.readDay(window, NOON);
    await late.database.reply(0);
    const taken = late.counters.sampleDay(window, { all: 1, site: 1 }, NOON);
    const read = late.counters.readDay(window, NOON + 30_000);
    const written = late.counters.countDay({ ...window, requests: 1, page: false }, NOON + 30_000);
    await late.database.reply(1);
    await late.database.reply(0);

    const swapped = held();
    const two = [swapped.counters.sampleDay(window, { all: 2, site: 2 }, NOON), swapped.counters.sampleDay(window, { all: 2, site: 2 }, NOON)];
    const writes = two.map(() => swapped.counters.countDay({ ...window, requests: 1, page: false }, NOON));
    await swapped.database.reply(1);
    await swapped.database.reply(0);
    await Promise.all([first, read, written, ...writes]);

    expect([taken, late.counters.sampleDay(window, { all: 1, site: 9 }, NOON + 30_001), two, swapped.counters.sampleDay(window, { all: 9, site: 2 }, NOON + 1)]).toEqual([1, "day", [1, 1], "site-share"]);
  });

  // Drift: a write is in the database before its answer is back; a read in between that was added to the request still held as unwritten would count it twice and refuse a request the day has room for.
  test("a request whose write is stored but not yet answered is counted once, also by a read of the database made in between", async () => {
    const window = { day: TODAY, site: REPORT };
    const { database, counters } = held();
    const taken = counters.sampleDay(window, { all: 2, site: 2 }, NOON);
    const written = counters.countDay({ ...window, requests: 1, page: false }, NOON);
    const read = counters.readDay(window, NOON + 30_000);
    await database.reply(1);
    const between = await read;
    const next = counters.sampleDay(window, { all: 2, site: 2 }, NOON + 30_001);
    await database.reply(0);
    await written;

    expect([taken, between, next, counters.sampleDay(window, { all: 2, site: 2 }, NOON + 30_002)]).toEqual([1, { site: 1, all: 1 }, 1, "day"]);
  });

  // Drift: a request taken before midnight is written after it; an answer for yesterday that reset the instance would hand out today's taken places again.
  test("a write of yesterday that comes back today leaves today's count alone, and one for a day the instance let go changes nothing", async () => {
    const { database, counters } = held();
    const yesterday = { day: TODAY, site: REPORT };
    const today = { day: TOMORROW, site: REPORT };
    counters.sampleDay(yesterday, NO_BOUND, NOON);
    const taken = counters.sampleDay(today, { all: 1, site: 1 }, NOON + 12 * 60 * MINUTE);
    const written = counters.countDay({ ...yesterday, requests: 1, page: false }, NOON + 12 * 60 * MINUTE);
    await database.reply(0);
    await written;
    const after = counters.sampleDay(today, { all: 1, site: 1 }, NOON + 12 * 60 * MINUTE);

    counters.sampleDay({ day: "2026-11-15", site: REPORT }, NO_BOUND, NOON);
    const gone = counters.countDay({ ...yesterday, requests: 1, page: false }, NOON);
    await database.reply(0);
    await gone;

    expect([taken, after, counters.sampleDay(today, { all: 1, site: 1 }, NOON)]).toEqual([1, "day", "day"]);
  });

  // Drift: an instance holds a thousand sites; one forgotten while a request of it is unwritten, or between its read and its check, would be checked against nothing and pass its share.
  test("a site with a request not yet written, and a site read in the last half minute, keep their counts while a thousand other sites are read", async () => {
    const database = new FakeDatabase();
    const counters = new CloudflareCounters({ limiter: ALWAYS_ROOM, database, random: () => 0 });
    const others = Array.from({ length: 1000 }, (_site, at) => `s${String(at).padStart(11, "0")}` as SiteId);
    await database.addRequests({ day: TODAY, site: REPORT, requests: 19 });
    await database.addRequests({ day: TODAY, site: DOCS, requests: 19 });
    await counters.readDay({ day: TODAY, site: REPORT }, NOON);
    const unwritten = counters.sampleDay({ day: TODAY, site: REPORT }, NO_BOUND, NOON);
    await counters.readDay({ day: TODAY, site: DOCS }, NOON + 30_001);
    for (const site of others) await counters.readDay({ day: TODAY, site }, NOON + 30_001);

    expect([
      unwritten,
      counters.sampleDay({ day: TODAY, site: REPORT }, { all: NO_BOUND.all, site: 20 }, NOON + 30_002),
      counters.sampleDay({ day: TODAY, site: DOCS }, { all: NO_BOUND.all, site: 19 }, NOON + 30_002),
    ]).toEqual([1, "site-share", "site-share"]);
  });

  // Drift: a site forgotten while its write is on its way, or between a request's read and its check, comes back empty; the instance would then take its own requests of that site a second time.
  test("a site the instance took a request of keeps it while a thousand other sites are read: with its write still on its way, and once written, between a later request's read and its check", async () => {
    const others = Array.from({ length: 1001 }, (_site, at) => `s${String(at).padStart(11, "0")}` as SiteId);
    const share = { all: NO_BOUND.all, site: 1 };
    const window = { day: TODAY, site: REPORT };

    const sending = new FakeDatabase();
    const busy = new CloudflareCounters({ limiter: ALWAYS_ROOM, database: sending, random: () => 0 });
    let store = (): void => undefined;
    sending.stored = new Promise((resolve) => {
      store = resolve;
    });
    await busy.readDay(window, NOON);
    const taken = busy.sampleDay(window, share, NOON);
    const written = busy.countDay({ ...window, requests: 1, page: false }, NOON);
    for (const site of others) await busy.readDay({ day: TODAY, site }, NOON + 30_001);
    const whileSent = [await busy.readDay(window, NOON + 30_002), busy.sampleDay(window, share, NOON + 30_002)];
    store();
    await written;

    const idle = new CloudflareCounters({ limiter: ALWAYS_ROOM, database: new FakeDatabase(), random: () => 0 });
    await idle.readDay(window, NOON);
    await count(idle, window, false, NOON);
    for (const site of others.slice(0, 999)) await idle.readDay({ day: TODAY, site }, NOON + 29_999);
    const read = await idle.readDay(window, NOON + 29_999);
    await idle.readDay({ day: TODAY, site: others[1000] ?? DOCS }, NOON + 30_000);

    expect([taken, whileSent, read, idle.sampleDay(window, share, NOON + 29_999)]).toEqual([1, [{ site: 1, all: 1 }, "site-share"], { site: 1, all: 1 }, "site-share"]);
  });

  // Drift: the guarantee is about every order of answers, and a test names only a few; any order that lets an instance take more than its limit by its own traffic, or refuse while it has room, breaks it.
  test("whatever order takes, writes, reads, and the database's answers come in, one instance takes exactly as many requests of a day and of a site as there is room for", async () => {
    const steps = fc.array(
      fc.oneof(
        { arbitrary: fc.record({ kind: fc.constant("take" as const), site: fc.constantFrom(REPORT, DOCS), later: fc.boolean() }), weight: 4 },
        { arbitrary: fc.record({ kind: fc.constant("write" as const) }), weight: 3 },
        { arbitrary: fc.record({ kind: fc.constant("read" as const), site: fc.constantFrom(REPORT, DOCS) }), weight: 2 },
        { arbitrary: fc.record({ kind: fc.constant("reply" as const), pick: fc.nat() }), weight: 4 },
      ),
      { maxLength: 60 },
    );
    const rooms = fc.record({ all: fc.integer({ min: 1, max: 6 }), site: fc.integer({ min: 1, max: 4 }) });

    await fc.assert(
      fc.asyncProperty(steps, rooms, async (run, room) => {
        const play = new Play(room);
        for (const step of run) await play.step(step);
      }),
      { numRuns: 300 },
    );
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
    await count(counters, window, false, NOON + 29_999);
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
      const verdict = await takeRequest({ settings: FULL_DAY, site: REPORT, visitor: "ada" as VisitorKey, now: NOON + request }, counters);
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
    const flood = Array.from({ length: 50_001 }, () => takeRequest({ settings, site: REPORT, visitor: "ada" as VisitorKey, now: NOON }, counters));
    await Promise.all(flood);

    expect(database.writes * 2).toBeLessThan(FREE_PLAN_ROWS_WRITTEN_A_DAY / 4);
  });
});
