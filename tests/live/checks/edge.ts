// The checks a stranger alone can make: what the install refuses without a token, what answers outside its hostnames, and what the rules in front of it stop.

import { expect } from "bun:test";

import { type Bench, type Check, Skip } from "../records";
import { GHOST_ID, labelAddress } from "../util";

/** The most requests the burst sends: past the rate rule's 300 in ten seconds. */
const BURST = 340;

/** How many requests of the burst are in flight together. */
const BURST_LANES = 20;

/** How long the rate rule keeps its block after the burst, with a margin, in milliseconds. */
const BLOCK_MS = 12_000;

/** How the install's own refusal of a visitor past the minute's limit starts. */
const OWN_LIMIT_TEXT = "Too many requests.";

/** A user agent of an AI crawler the bot block stops. */
const CRAWLER = "Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko; compatible; GPTBot/1.2; +https://openai.com/gptbot)";

/** What a browser sends with an image a page of another domain loads. */
const OUTSIDE_PAGE = { "Sec-Fetch-Site": "cross-site", "Sec-Fetch-Mode": "no-cors", "Sec-Fetch-Dest": "image" };

/** The window the rate rule counts in, in milliseconds. */
const RULE_WINDOW_MS = 10_000;

/** The two refusals a burst can meet: the install's own limit, and the rate rule in front of it. `inWindow` says whether the whole burst fitted the rule's window. */
interface Burst {
  readonly own: boolean;
  readonly rule: boolean;
  readonly inWindow: boolean;
}

/** The burst of each bench, sent once: its two checks read the same one. */
const BURSTS = new WeakMap<Bench, Promise<Burst>>();

/** Whether a hostname answers a stranger with a success; one that does not answer at all does not. */
async function answersOk(bench: Bench, address: string): Promise<boolean> {
  const response = await bench.visit(address).catch(() => undefined);

  return response?.ok === true;
}

async function sendBurst(bench: Bench): Promise<Burst> {
  const address = labelAddress(bench.domain, GHOST_ID, "u");
  const seen = { own: false, rule: false };
  const started = Date.now();
  let sent = 0;

  const lane = async (): Promise<void> => {
    while (sent < BURST && !(seen.own && seen.rule)) {
      sent += 1;
      const response = await bench.visit(address);
      const body = await response.text();
      if (response.status !== 429) continue;

      const own = body.startsWith(OWN_LIMIT_TEXT) && response.headers.has("Retry-After");
      seen.own ||= own;
      seen.rule ||= !own;
    }
  };

  await Promise.all(Array.from({ length: BURST_LANES }, lane));
  const inWindow = Date.now() - started < RULE_WINDOW_MS;
  // The rule's block covers every hostname it counts, so nothing is sent until it has lapsed.
  if (seen.rule) await bench.pause(BLOCK_MS);

  return { ...seen, inWindow };
}

function burstOf(bench: Bench): Promise<Burst> {
  const burst = BURSTS.get(bench) ?? sendBurst(bench);
  BURSTS.set(bench, burst);

  return burst;
}

/** Every check a stranger makes alone. The two burst checks come last: they use up the visitor's minute. */
export const EDGE_CHECKS: readonly Check[] = [
  {
    id: "api-token",
    name: "the API refuses a request with no token, and says nothing of the install",
    needs: [],
    run: async (bench) => {
      const response = await bench.visit(`${bench.admin}/api/sites`);
      expect(response.status).toBe(401);
      expect(response.headers.get("Cache-Control")).toBe("no-store");
      expect(await response.json()).toMatchObject({ error: { code: "not_logged_in" } });
    },
  },
  {
    id: "dashboard-login",
    name: "the dashboard sends a stranger to the login and sets no cookie",
    needs: [],
    run: async (bench) => {
      const response = await bench.visit(`${bench.admin}/`);
      expect(response.status).toBe(302);
      expect(response.headers.get("Location")).toStartWith(`${bench.admin}/login`);
      expect(response.headers.get("Set-Cookie")).toBeNull();
      expect(response.headers.get("Cache-Control")).toBe("no-store");
    },
  },
  {
    id: "login-path",
    name: "the login path gives a stranger no session",
    needs: [],
    run: async (bench) => {
      const response = await bench.visit(`${bench.admin}/login`);
      expect(response.status).toBeGreaterThanOrEqual(300);
      expect(response.status).toBeLessThan(500);
      expect(response.headers.get("Set-Cookie") ?? "").not.toContain("poplin");
    },
  },
  {
    id: "no-site",
    name: "a hostname that is no site's address answers the one 404, never cached",
    needs: [],
    run: async (bench) => {
      const response = await bench.visit(`https://x-poplin.${bench.domain}/`);
      expect(response.status).toBe(404);
      expect(response.headers.get("Cache-Control")).toBe("no-store");
      expect(response.headers.get("X-Robots-Tag")).toBe("noindex");
      expect(await response.text()).toBe("Not found\n");
    },
  },
  {
    id: "method",
    name: "a site hostname refuses a method that changes something, before the install or in it",
    needs: [],
    run: async (bench) => {
      const response = await bench.visit(`https://x-poplin.${bench.domain}/`, { method: "POST", body: "x" });
      expect(response.status).toBeOneOf([403, 405]);
      if (response.status === 405) expect(response.headers.get("Allow")).toBe("GET, HEAD");
    },
  },
  {
    id: "outside-hostnames",
    name: "a hostname beside the install's own, and one below its admin hostname, answer with no success",
    needs: [],
    run: async (bench) => {
      expect(await answersOk(bench, `https://${bench.prefix}.${bench.domain}/`)).toBe(false);
      expect(await answersOk(bench, `https://${bench.prefix}.poplin.${bench.domain}/`)).toBe(false);
    },
  },
  {
    id: "outside-page",
    name: "a file loaded by a page of another domain is refused, and the same file opened directly is not",
    needs: ["token"],
    run: async (bench) => {
      const site = await bench.publish({ access: "unlisted", text: "<p>outside page</p>" });
      expect((await bench.visit(site.url)).status).toBe(200);
      expect((await bench.visit(site.url, { headers: OUTSIDE_PAGE })).status).toBe(403);
    },
  },
  {
    id: "crawler",
    name: "an AI crawler's user agent is stopped before the install",
    needs: ["bot-block"],
    run: async (bench) => {
      const response = await bench.visit(labelAddress(bench.domain, GHOST_ID, "u"), { headers: { "User-Agent": CRAWLER } });
      expect(response.status).toBe(403);
    },
  },
  {
    id: "burst-own-limit",
    name: "a burst from one visitor meets the install's own limit, with Retry-After",
    needs: [],
    run: async (bench) => {
      expect((await burstOf(bench)).own).toBe(true);
    },
  },
  {
    id: "burst-rate-rule",
    name: "a burst past 300 requests in ten seconds is blocked by the rate rule",
    needs: ["rate-rule"],
    run: async (bench) => {
      const burst = await burstOf(bench);
      if (!burst.rule && !burst.inWindow) throw new Skip("a runner that sends 300 requests inside ten seconds");

      expect(burst.rule).toBe(true);
    },
  },
];
