// The checks a stranger alone can make: what the install refuses without a token, what answers outside its hostnames, and what the rules in front of it stop.

import { expect } from "bun:test";

import { type Bench, type Check, Skip } from "../records";
import { GHOST_ID, labelAddress } from "../util";

/** The most requests the burst sends: past the rate rule's 300 in ten seconds. */
const BURST = 340;

/** How many requests of the burst are in flight together. */
const BURST_LANES = 20;

/** How long the rate rule counts a request, and keeps its block, with a margin, in milliseconds. */
const RULE_LAPSE_MS = 12_000;

/** The most requests the paced run sends: past the 600 a minute an install with its first settings gives one visitor. */
const PACED = 700;

/** The time from one paced request to the next, in milliseconds: 200 in ten seconds, under the rate rule's 300, and 1,200 in a minute. */
const PACE_MS = 50;

/** How the install's own refusal of a visitor past the minute's limit starts. */
const OWN_LIMIT_TEXT = "Too many requests.";

/** A user agent of an AI crawler the bot block stops. */
const CRAWLER = "Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko; compatible; GPTBot/1.2; +https://openai.com/gptbot)";

/** What a browser sends with an image a page of another domain loads. */
const OUTSIDE_PAGE = { "Sec-Fetch-Site": "cross-site", "Sec-Fetch-Mode": "no-cors", "Sec-Fetch-Dest": "image" };

/** The window the rate rule counts in, in milliseconds. */
const RULE_WINDOW_MS = 10_000;

/** What a run of requests for one address has met so far. */
interface Run {
  /** The install's own limit answered: a 429 in its words, with `Retry-After`. */
  own: boolean;

  /** The rate rule in front of the install answered: any other 429. */
  rule: boolean;

  /** How many requests were sent. */
  sent: number;

  /** How many times each answer came, by its status and, for a 429, by which side sent it. */
  readonly answers: Map<string, number>;

  /** When the run began, in milliseconds since the epoch. */
  readonly started: number;
}

/** What a finished run met. `saw` is what a failure says of it: the requests, the time, and each answer's count, with nothing an install wrote. */
interface Met extends Pick<Run, "own" | "rule"> {
  readonly ms: number;
  readonly saw: string;
}

/** Whether a hostname answers a stranger with a success; one that does not answer at all does not. */
async function answersOk(bench: Bench, address: string): Promise<boolean> {
  const response = await bench.visit(address).catch(() => undefined);

  return response?.ok === true;
}

function openRun(): Run {
  return { own: false, rule: false, sent: 0, answers: new Map(), started: Date.now() };
}

/** Ask once for a site that is not there, and keep which side answered. */
async function ask(bench: Bench, run: Run): Promise<void> {
  run.sent += 1;
  const response = await bench.visit(labelAddress(bench.domain, GHOST_ID, "u"));
  const body = await response.text();
  const limited = response.status === 429;
  const own = limited && body.startsWith(OWN_LIMIT_TEXT) && response.headers.has("Retry-After");
  run.own ||= own;
  run.rule ||= limited && !own;

  const answer = limited ? `429 of ${own ? "the install" : "the rate rule"}` : String(response.status);
  run.answers.set(answer, (run.answers.get(answer) ?? 0) + 1);
}

async function closeRun(bench: Bench, run: Run): Promise<Met> {
  const ms = Date.now() - run.started;
  // The rule's block covers every hostname it counts, so nothing is sent until it has lapsed.
  if (run.rule) await bench.pause(RULE_LAPSE_MS);

  const counts = [...run.answers].map(([answer, count]) => `${answer} x${count}`).join(", ");

  return { own: run.own, rule: run.rule, ms, saw: `${run.sent} requests in ${ms} ms were answered: ${counts}` };
}

/**
 * One request every `PACE_MS`, however long an answer takes, until the install's own limit or the rate rule answers.
 *
 * A burst does not reliably show the install's own limit: its count is kept per location and catches up in the background, and an instance holds the settings of up to a minute ago.
 */
async function sendPaced(bench: Bench): Promise<Met> {
  // The rule may count every request of the zone, so what the checks before sent leaves its window first.
  await bench.pause(RULE_LAPSE_MS);
  const run = openRun();
  const asked: Promise<void>[] = [];
  const failures: unknown[] = [];

  while (run.sent < PACED && !run.own && !run.rule && failures.length === 0) {
    asked.push(ask(bench, run).catch((error: unknown) => void failures.push(error)));
    await bench.pause(PACE_MS);
  }

  await Promise.all(asked);
  if (failures.length > 0) throw failures[0];

  return closeRun(bench, run);
}

/** Many requests at once, until the rate rule answers. */
async function sendBurst(bench: Bench): Promise<Met> {
  const run = openRun();

  const lane = async (): Promise<void> => {
    while (run.sent < BURST && !run.rule) await ask(bench, run);
  };
  await Promise.all(Array.from({ length: BURST_LANES }, lane));

  return closeRun(bench, run);
}

/** Every check a stranger makes alone. The two checks of the limits come last: they use up the visitor's minute. */
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
    id: "own-limit",
    name: "one visitor's requests, fewer than the rate rule blocks, meet the install's own limit, with Retry-After",
    needs: [],
    run: async (bench) => {
      const paced = await sendPaced(bench);
      expect(paced.own, paced.saw).toBe(true);
    },
  },
  {
    id: "burst-rate-rule",
    name: "a burst past 300 requests in ten seconds is blocked by the rate rule",
    needs: ["rate-rule"],
    run: async (bench) => {
      const burst = await sendBurst(bench);
      if (!burst.rule && burst.ms >= RULE_WINDOW_MS) throw new Skip("a runner that sends 300 requests inside ten seconds");

      expect(burst.rule, burst.saw).toBe(true);
    },
  },
];
