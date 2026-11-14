// The limits decide for every request from the internet: no order of arrivals may get more requests through than the settings allow, and no address text may break the visitor key.
// The arrivals span twenty minutes around a midnight UTC and bunch at the edges of a minute, so minutes and the day both roll over.

import { expect } from "bun:test";
import fc from "fast-check";

import { checkLimits, countRequest } from "../../packages/app/src/limits/limits";
import { MemoryCounters } from "../../packages/app/src/limits/memory-counters";
import { type VisitorKey, visitorKey } from "../../packages/app/src/limits/visitor-key";
import { parseSiteId, type SiteId } from "../../packages/core/src/sites/ids";
import { fuzzTarget } from "./config";
import { hostile } from "./hostile";

const TEN_TO_MIDNIGHT = Date.UTC(2026, 10, 13, 23, 50);
const MINUTE = 60_000;
const DAY = 86_400_000;
const KEY_SHAPE = /^[0-9a-f]{32}$/;
const SECRET = await crypto.subtle.importKey("raw", new TextEncoder().encode("a fuzz secret, never a real one"), { name: "HMAC", hash: "SHA-256" }, false, [
  "sign",
]);

/** One allowed request, as the bounds below count it. */
interface Allowed {
  readonly site: SiteId;
  readonly visitor: string;
  readonly at: number;
}

const property = fuzzTarget(import.meta.file);

const sites = fc
  .constantFrom("aaaaaaaaaaaa", "bbbbbbbbbbbb", "cccccccccccc")
  .map((raw) => parseSiteId(raw))
  .filter((parsed) => parsed.ok)
  .map((parsed) => parsed.value);

const settings = fc.record({
  visitor_requests_per_minute: fc.integer({ min: 1, max: 6 }),
  site_requests_per_minute: fc.integer({ min: 1, max: 12 }),
  requests_per_day: fc.integer({ min: 1, max: 60 }),
  site_share_of_day: fc.integer({ min: 1, max: 100 }),
});

const gaps = fc.oneof(
  fc.constant(0),
  fc.integer({ min: 1, max: 1000 }),
  fc.integer({ min: MINUTE - 2, max: MINUTE + 2 }),
  fc.integer({ min: 0, max: 3 * MINUTE }),
);
const arrivals = fc.array(fc.record({ site: sites, visitor: fc.constantFrom("ada", "bo", "cy"), gap: gaps }), { maxLength: 200 });
const groups = fc.array(fc.integer({ min: 0, max: 0xffff }), { minLength: 8, maxLength: 8 });
const addresses = hostile(fc.oneof(fc.ipV4(), fc.ipV6(), fc.constantFrom("", "::", "::ffff:192.0.2.7", "2001:db8::1")));

/** A request as the Worker takes it: checked against the limits, and counted against its day once they let it through. */
async function takeRequest(asked: Parameters<typeof checkLimits>[0], counters: Parameters<typeof checkLimits>[1]): ReturnType<typeof checkLimits> {
  const verdict = await checkLimits(asked, counters);
  if (verdict.ok) await countRequest({ site: asked.site, now: asked.now, requests: verdict.requests, page: false }, counters);

  return verdict;
}

function most<Key>(allowed: readonly Allowed[], keyOf: (request: Allowed) => Key): number {
  const counts = new Map<Key, number>();
  for (const request of allowed) counts.set(keyOf(request), (counts.get(keyOf(request)) ?? 0) + 1);

  return Math.max(0, ...counts.values());
}

/** The most allowed requests of one key that any 60 seconds hold, wherever those 60 seconds start. */
function mostInAnyMinute(allowed: readonly Allowed[], keyOf: (request: Allowed) => string): number {
  let most = 0;

  for (const [from, first] of allowed.entries()) {
    const inWindow = allowed.slice(from).filter((request) => keyOf(request) === keyOf(first) && request.at < first.at + MINUTE);
    most = Math.max(most, inWindow.length);
  }

  return most;
}

function written(parts: readonly number[]): string {
  return parts.map((part) => part.toString(16)).join(":");
}

function keyOf(address: string, now: number = TEN_TO_MIDNIGHT): Promise<VisitorKey> {
  return visitorKey(address, SECRET, now);
}

property(
  "no clock minute and no UTC day lets more requests through than its setting, and any 60 seconds hold at most twice a per-minute setting",
  fc.asyncProperty(settings, arrivals, async (limits, requests) => {
    const counters = new MemoryCounters();
    const allowed: Allowed[] = [];
    let at = TEN_TO_MIDNIGHT;

    for (const request of requests) {
      at += request.gap;
      const verdict = await takeRequest({ settings: limits, site: request.site, visitor: request.visitor as VisitorKey, now: at }, counters);
      if (verdict.ok) allowed.push({ site: request.site, visitor: request.visitor, at });

      if (!verdict.ok) expect(verdict.retryAfterSeconds).toBeGreaterThanOrEqual(1);
    }

    const minuteOf = (request: Allowed): number => Math.floor(request.at / MINUTE);
    const dayOf = (request: Allowed): number => Math.floor(request.at / DAY);
    const share = Math.max(1, Math.floor((limits.requests_per_day * limits.site_share_of_day) / 100));

    expect(most(allowed, (request) => `${request.visitor} ${minuteOf(request)}`)).toBeLessThanOrEqual(limits.visitor_requests_per_minute);
    expect(most(allowed, (request) => `${request.site} ${minuteOf(request)}`)).toBeLessThanOrEqual(limits.site_requests_per_minute);
    expect(most(allowed, dayOf)).toBeLessThanOrEqual(limits.requests_per_day);
    expect(most(allowed, (request) => `${request.site} ${dayOf(request)}`)).toBeLessThanOrEqual(share);
    expect(mostInAnyMinute(allowed, (request) => request.visitor)).toBeLessThanOrEqual(2 * limits.visitor_requests_per_minute);
    expect(mostInAnyMinute(allowed, (request) => request.site)).toBeLessThanOrEqual(2 * limits.site_requests_per_minute);
  }),
);

property(
  "with room in all four limits every request passes, so a refusal always means a full limit",
  fc.asyncProperty(arrivals, async (requests) => {
    const counters = new MemoryCounters();
    const roomy = { visitor_requests_per_minute: 200, site_requests_per_minute: 200, requests_per_day: 200, site_share_of_day: 100 };
    let at = TEN_TO_MIDNIGHT;

    for (const request of requests) {
      at += request.gap;
      expect(await takeRequest({ settings: roomy, site: request.site, visitor: request.visitor as VisitorKey, now: at }, counters)).toMatchObject({ ok: true });
    }
  }),
);

property(
  "an IPv6 visitor keeps one key across their 64 bits and gets another when the network changes",
  fc.asyncProperty(groups, groups, fc.integer({ min: 0, max: 63 }), async (address, other, bit) => {
    // An IPv4 address written inside an IPv6 one is keyed whole, as IPv4 is.
    fc.pre(written(address.slice(0, 6)) !== "0:0:0:0:0:ffff");

    const sameNetwork = [...address.slice(0, 4), ...other.slice(4)];
    const otherNetwork = address.map((group, at) => (at === Math.floor(bit / 16) ? group ^ (1 << (bit % 16)) : group));
    fc.pre(written(otherNetwork.slice(0, 6)) !== "0:0:0:0:0:ffff");

    const key = await keyOf(written(address));

    expect(await keyOf(written(sameNetwork))).toBe(key);
    expect(await keyOf(written(otherNetwork))).not.toBe(key);
  }),
);

property(
  "any address text gives a key of 32 hex characters and never throws",
  fc.asyncProperty(addresses, async (address) => {
    expect(await keyOf(address)).toMatch(KEY_SHAPE);
  }),
);
