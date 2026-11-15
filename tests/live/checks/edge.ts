// The checks a stranger alone can make: what the install refuses without a token, what answers outside its hostnames, and what the rules in front of it stop.

import { expect } from "bun:test";

import { type Bench, type Check, Skip } from "../records";
import { GHOST_ID, labelAddress } from "../util";

/** The most requests the burst sends before the paced ones: past the rate rule's 300 in ten seconds. */
const BURST = 340;

/** The time from one request to the next after the burst, in milliseconds: 400 in ten seconds, so every ten seconds stay past the rule's 300. */
const TAIL_PACE_MS = 25;

/** The most requests sent after the burst: twenty seconds of them. The rule's count runs up to a few seconds behind the requests. */
const TAIL = 800;

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

/** The path on which the edge itself says which address it saw a request come from. */
const TRACE_PATH = "cdn-cgi/trace";

/** What stands for the data center of an answer whose `cf-ray` names none. */
const UNNAMED = "no data center named";

/** What the edge said of where the runner's requests come from. */
interface Seen {
  /** The addresses the edge saw. A line says how many they are and of which family, never one of them. */
  readonly sources: Set<string>;

  /** How many times the edge said which address it saw. */
  sampled: number;
}

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

  /** When each answer came, by the code of the data center its `cf-ray` ends in. */
  readonly centers: Map<string, number[]>;

  /** What the edge said of where the requests come from; nothing, for a run that did not ask. */
  readonly seen: Seen;

  /** When the run began, on the bench's time. */
  readonly started: number;
}

/** What a finished run met. `saw` is the one line said of it: the requests, the time, each answer's count, and the runner's path, with nothing an install wrote and no address. */
interface Met extends Pick<Run, "own" | "rule"> {
  readonly saw: string;
}

/** Whether a hostname answers a stranger with a success; one that does not answer at all does not. */
async function answersOk(bench: Bench, address: string): Promise<boolean> {
  const response = await bench.visit(address).catch(() => undefined);

  return response?.ok === true;
}

function openRun(bench: Bench, seen: Seen = { sources: new Set(), sampled: 0 }): Run {
  return { own: false, rule: false, sent: 0, answers: new Map(), centers: new Map(), seen, started: bench.now() };
}

/** Ask the edge once which address it sees the runner at, and keep it for the count alone. An edge that does not say, or a request that fails, is no sample. */
async function sample(bench: Bench, seen: Seen): Promise<void> {
  const text = await bench
    .visit(`${labelAddress(bench.domain, GHOST_ID, "u")}${TRACE_PATH}`)
    .then((response) => (response.status === 200 ? response.text() : ""))
    .catch(() => "");
  const source = /^ip=(\S+)$/m.exec(text)?.[1];
  if (source === undefined) return;

  seen.sampled += 1;
  seen.sources.add(source);
}

/** The most answers any ten seconds held, of answers in the order they came. */
function busiest(times: readonly number[]): number {
  let most = 0;
  let first = 0;

  times.forEach((at, last) => {
    while (at - (times[first] ?? at) >= RULE_WINDOW_MS) first += 1;

    most = Math.max(most, last - first + 1);
  });

  return most;
}

/** What a line says of the runner's path: each data center's answers and its fullest ten seconds, then how many addresses the edge saw and of which family. */
function path({ centers: through, seen }: Run): string {
  const centers = [...through]
    .sort(([one], [other]) => one.localeCompare(other))
    .map(([center, times]) => `${center} x${times.length} (most in ten seconds x${busiest(times)})`)
    .join(", ");
  if (seen.sampled === 0) return `through ${centers}`;

  const families = [...new Set([...seen.sources].map((source) => (source.includes(":") ? "IPv6" : "IPv4")))].sort().join(" and ");

  return `through ${centers}; the edge saw addresses x${seen.sources.size} (${families}) in samples x${seen.sampled}`;
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

  const center = /-([A-Z]{3})$/.exec(response.headers.get("cf-ray") ?? "")?.[1] ?? UNNAMED;
  run.centers.set(center, [...(run.centers.get(center) ?? []), bench.now()]);
}

/** End a run whose last answer came at `ended`, and write the line of what it met. */
async function closeRun(bench: Bench, run: Run, ended: number = bench.now()): Promise<Met> {
  const ms = ended - run.started;
  // The rule's block covers every hostname it counts, so nothing is sent until it has lapsed.
  if (run.rule) await bench.pause(RULE_LAPSE_MS);

  const counts = [...run.answers].map(([answer, count]) => `${answer} x${count}`).join(", ");

  return { own: run.own, rule: run.rule, saw: `${run.sent} requests in ${ms} ms were answered: ${counts}; ${path(run)}` };
}

/** One request every `paceMs`, however long an answer takes, until the run has sent `most` or `met` says it is over. */
async function pace(bench: Bench, run: Run, pacing: { readonly most: number; readonly paceMs: number; readonly met: () => boolean }): Promise<void> {
  const asked: Promise<void>[] = [];
  const failures: unknown[] = [];

  while (run.sent < pacing.most && !pacing.met() && failures.length === 0) {
    asked.push(ask(bench, run).catch((error: unknown) => void failures.push(error)));
    await bench.pause(pacing.paceMs);
  }

  await Promise.all(asked);
  if (failures.length > 0) throw failures[0];
}

/**
 * Paced requests, until the install's own limit or the rate rule answers.
 *
 * A burst does not reliably show the install's own limit: its count is kept per location and catches up in the background, and an instance holds the settings of up to a minute ago.
 */
async function sendPaced(bench: Bench): Promise<Met> {
  // The rule may count every request of the zone, so what the checks before sent leaves its window first.
  await bench.pause(RULE_LAPSE_MS);
  const run = openRun(bench);
  await pace(bench, run, { most: PACED, paceMs: PACE_MS, met: () => run.own || run.rule });

  return closeRun(bench, run);
}

/**
 * Many requests at once, then paced ones that keep every ten seconds past the rule's limit, until the rate rule answers.
 *
 * The rule's count runs behind the requests, so a burst that is over in a second or two may end before the rule's first block.
 * The rule counts in each data center for itself and by the address, so the run keeps which data center each answer came through, and asks the edge which address it sees.
 *
 * @throws {Skip} the burst alone took the rule's whole window and met no block: the runner never passed the rule's limit
 */
async function sendBurst(bench: Bench): Promise<Met> {
  // The samples come first, one a lane, so the time they take is none of the burst's.
  const seen: Seen = { sources: new Set(), sampled: 0 };
  await Promise.all(Array.from({ length: BURST_LANES }, () => sample(bench, seen)));
  const run = openRun(bench, seen);

  const lane = async (): Promise<void> => {
    while (run.sent < BURST && !run.rule) await ask(bench, run);
  };
  await Promise.all(Array.from({ length: BURST_LANES }, lane));
  if (!run.rule && bench.now() - run.started >= RULE_WINDOW_MS) throw new Skip("a runner that sends 300 requests inside ten seconds");

  await pace(bench, run, { most: BURST + TAIL, paceMs: TAIL_PACE_MS, met: () => run.rule });
  const ended = bench.now();
  await sample(bench, seen);

  return closeRun(bench, run, ended);
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
    name: "a burst past 300 requests in ten seconds, kept up, is blocked by the rate rule",
    needs: ["rate-rule"],
    run: async (bench) => {
      const burst = await sendBurst(bench);
      expect(burst.rule, burst.saw).toBe(true);
      bench.say(burst.saw);
    },
  },
];
