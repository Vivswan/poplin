// The live checks run against a local fake, so their own logic is exercised with no deployed install: a check that passed on anything, or a skip that hid a fault, would otherwise go unseen until a real run.

import { afterEach, describe, expect, spyOn, test } from "bun:test";
import { writeFileSync } from "node:fs";
import { join } from "node:path";

import type { Fetch } from "../../packages/cli/src/client/client";
import { CEILINGS, meterBucket } from "../../packages/cloudflare/scripts/live/budget";
import { meterRows, ROW_CEILINGS } from "../../packages/cloudflare/scripts/live/rows";
import { MemoryStore } from "../../packages/core/src/storage/memory";
import { openBench } from "./bench";
import { probeMissing } from "./capabilities";
import { CHECKS } from "./checks";
import { DRILL_COST } from "./checks/backup";
import type { Bench, Missing, Outcome } from "./records";
import { runCheck } from "./report";
import { FAKE_DOMAIN, type FakeSwitches, openFake } from "./support/fake-install";

/** Every check a person makes. */
const BY_HAND = ["L2", "L3", "L4-in", "L5b", "L6", "L7", "L9"];

/** Every check that needs a token. */
const WITH_TOKEN = [
  "private",
  "unlisted",
  "public",
  "public-name",
  "demo",
  "update-rollback",
  "rename",
  "new-link",
  "set-private",
  "delete-restore",
  "duplicate",
  "mcp",
  "export-import",
  "backup-drill",
  "users-follow",
  "outside-page",
  "L4",
  "L5",
  "L10",
];

/** How many files the fake's publish of many files holds: what the caps of the API's test install take. */
const MANY_FILES = 7;

/** How long one install's run of every check may take, in milliseconds: each publishes, reads and removes sites in this process with no wait in it, all of it work of the processor, which on a busy machine passes the five seconds a test gets. */
const RUN_MS = 30_000;

/** The rows a run of every check counts on an install behind a login, which skips none but a person's and the many-files publish: what the README states of a usual run. */
const CHECKS_ROWS = 861;

/** The benches a test opened, closed after it. */
const OPENED: (() => void)[] = [];

/** The checks skipped on an install with no login in front. */
const NO_LOGIN = { L1: "skipped", "dashboard-login": "skipped" } as const;

/** One fake install, what the run knows of it, and the checks that do not pass on it, by id. `L1` and `dashboard-login` are skipped unless the login is in front, and `demo` unless the install holds the demo's site: whole, or without its worker. */
type Case = readonly [
  what: string,
  switches: FakeSwitches & { readonly noToken?: boolean; readonly demoSite?: "whole" | "no-worker" },
  known: Missing,
  notPassed: Readonly<Record<string, "skipped" | "failed">>,
];

/** Every fake install the whole suite runs on. */
const CASES: readonly Case[] = [
  ["an install with no login in front passes every check but the login's and a person's", {}, {}, NO_LOGIN],
  ["an install behind a login passes the login's checks too", { access: true }, {}, {}],
  ["an install whose login stands in front of the login path alone fails the check of the whole dashboard", { access: true, loginPathOnly: true }, {}, { "dashboard-login": "failed" }],
  ["an install whose login stands in front of its setup page too fails the check of that open path", { access: true, setupBehindLogin: true }, {}, { "setup-open": "failed" }],
  ["an install that holds the demo's site passes the demo's check", { demoSite: "whole" }, {}, NO_LOGIN],
  ["a demo's site that lost its worker fails the demo's check", { demoSite: "no-worker" }, {}, { ...NO_LOGIN, demo: "failed" }],
  ["an install whose routes miss the public word skips the public name's address", { noPublicRoute: true }, {}, { ...NO_LOGIN, "public-name": "skipped" }],
  [
    "a run told what the zone lacks skips the checks of each lacking rule, and the many-files publish it was not asked for",
    { noGuards: true },
    { "bot-block": "bots", "rate-rule": "rate", "guard-rules": "guards", "https-redirect": "redirect", "many-files": "asked" },
    {
      ...NO_LOGIN,
      crawler: "skipped",
      "burst-rate-rule": "skipped",
      "L8-method": "skipped",
      "L8-scanner": "skipped",
      "L8-http": "skipped",
      L10: "skipped",
    },
  ],
  [
    "a run with no token skips every check that publishes and still makes the stranger's",
    { noToken: true },
    {},
    { ...NO_LOGIN, ...Object.fromEntries(WITH_TOKEN.map((id): [string, "skipped"] => [id, "skipped"])) },
  ],
  [
    "an install that opens a letter p address with no login behind the request fails the checks of a private site",
    { leaksPrivate: true },
    {},
    { ...NO_LOGIN, private: "failed", duplicate: "failed", L5: "failed" },
  ],
  ["an install that holds no key of its provider fails the check of the users: the login list never takes the one it added", { noKey: true }, {}, { ...NO_LOGIN, "users-follow": "failed" }],
  ["a run with no key to read the provider's login list skips the check of the users", {}, { "login-list": "a key of the provider" }, { ...NO_LOGIN, "users-follow": "skipped" }],
  ["an install whose own count of a visitor lags behind a burst still shows its own limit", { lateCount: true }, {}, NO_LOGIN],
  ["a rate rule that starts to block seconds after the burst passed its limit still shows its block", { lateRule: true }, {}, NO_LOGIN],
  ["a zone with no rate rule, on a run not told so, fails the check of that rule", { noRateRule: true }, {}, { ...NO_LOGIN, "burst-rate-rule": "failed" }],
  ["an install with no limit of its own fails the check of that limit", { noOwnLimit: true }, {}, { ...NO_LOGIN, "own-limit": "failed" }],
  [
    "a zone whose rules are gone, on a run not told so, fails the checks of those rules",
    { noGuards: true },
    {},
    { ...NO_LOGIN, "L8-method": "failed", "L8-scanner": "failed", "L8-http": "failed" },
  ],
];

/** How a line ends on the fake, whose edge sees one address: once in each lane of the burst and once at the end. */
const ONE_SEEN = "the edge saw addresses x1 (IPv4) in samples x21";

/** One request a fake refuses in the install's place: the so-manieth of a method to a path. */
interface Refusal {
  readonly method: string;
  readonly path: RegExp;
  readonly nth: number;
}

/** How the reason starts of a check of the rate rule skipped for no data center past the limit, before its line. */
const NOT_PROVEN = "one data center that takes more than 300 of the runner's requests in ten seconds";

/** How the reason starts of a check of the rate rule skipped for a runner at several addresses, before its line. */
const ONE_ADDRESS = "a runner whose requests leave from one address";

/** One fake install, what the check of the rate rule comes to on it, and the parts of the one line it says: printed on a pass, the failure's own words, or a skip's reason. */
type BurstCase = readonly [what: string, switches: FakeSwitches, result: Outcome["result"], line: readonly string[]];

/** The check of the rate rule on a fake whose rule blocks, on one with no rule, and on ones where the rule was never due: no data center past its limit, or a visitor at several addresses. */
const BURST_CASES: readonly BurstCase[] = [
  ["a burst the rate rule blocks says through which data center it went", {}, "passed",
    ["320 requests in 0 ms were answered: 302 x120, 429 of the install x180, 429 of the rate rule x20", "through AAA x320 (most in ten seconds x320)", ONE_SEEN],
  ],
  ["requests spread over two data centers are blocked once one of them has seen more than the limit", { spread: 2 }, "passed",
    ["603 requests in 3156 ms were answered: 302 x120, 429 of the install x480, 429 of the rate rule x3", "through AAA x302 (most in ten seconds x302), BBB x301 (most in ten seconds x301)", ONE_SEEN],
  ],
  ["one data center past the limit for five seconds, with no rule to block, fails", { noRateRule: true }, "failed",
    ["757 requests in 5004 ms were answered: 302 x120, 429 of the install x637", "through AAA x757 (most in ten seconds x757)", ONE_SEEN],
  ],
  ["two data centers past the limit for five seconds, with no rule to block, fail before the requests end", { noRateRule: true, spread: 2 }, "failed",
    ["1020 requests in 8160 ms were answered: 302 x120, 429 of the install x900", "through AAA x510 (most in ten seconds x510), BBB x510 (most in ten seconds x510)", ONE_SEEN],
  ],
  ["requests spread over four data centers, none past the limit, prove nothing and are skipped", { spread: 4 }, "skipped",
    [
      `${NOT_PROVEN}: 1140 requests in 9600 ms were answered: 302 x120, 429 of the install x1020`,
      "through AAA x285 (most in ten seconds x285), BBB x285 (most in ten seconds x285), CCC x285 (most in ten seconds x285), DDD x285 (most in ten seconds x285)",
      ONE_SEEN,
    ],
  ],
  ["requests from four addresses, none past the limit though their data center is, prove nothing and are skipped", { manyAddresses: true }, "skipped",
    [`${ONE_ADDRESS}: 757 requests in 5004 ms were answered: 302 x120, 429 of the install x637`, "through AAA x757 (most in ten seconds x757)", "the edge saw addresses x4 (IPv4) in samples x21"],
  ],
];

/** Publish the demo's site as the reset of the test install does: a first page, and beside it the worker, unless the case leaves it out. */
async function publishDemoSite(bench: Bench, kind: "whole" | "no-worker"): Promise<void> {
  const folder = bench.folder("<title>a demo</title>");
  if (kind === "whole") writeFileSync(join(folder, "sw.js"), "self.addEventListener('fetch', () => undefined);");

  expect((await bench.cli("publish", folder, "--name", "demo", "--public", "--public-name", "demo")).code).toBe(0);
}

/**
 * Run the backup drill alone on a fake install.
 *
 * @param refusal - the one request the fake refuses in the install's place; `undefined` for a fake that answers every one
 * @returns what the drill came to and said, the failure it reported, every request it sent, how many of them the bucket's meter counted, and how many sites it left
 */
async function drillOn(refusal: Refusal | undefined): Promise<{ readonly result: Outcome["result"]; readonly said: string[]; readonly failure: string; readonly requests: number; readonly bucket: number; readonly left: number }> {
  const fake = await openFake();
  const meter = meterBucket(fake.fetch, CEILINGS.checks);
  const said: string[] = [];
  const sent = { all: 0, matching: 0 };
  const counted: Fetch = async (input, init) => {
    sent.all += 1;
    const named = refusal !== undefined && (init.method ?? "GET") === refusal.method && refusal.path.test(new URL(input).pathname);
    if (named) sent.matching += 1;

    if (named && sent.matching === refusal.nth) return Response.json({ error: { code: "forbidden", message: "Refused by the test." } }, { status: 403 });

    return meter.fetch(input, init);
  };
  const parts = { domain: FAKE_DOMAIN, token: fake.token, run: "selftest", missing: {}, fetch: counted, pause: fake.pause, now: fake.now, manyFiles: MANY_FILES };
  const { bench, close } = openBench({ ...parts, say: (text) => said.push(text) });
  OPENED.push(close);

  const drill = CHECKS.find((check) => check.id === "backup-drill");
  if (drill === undefined) throw new Error("the checks hold no backup drill");

  let failure = "";
  const outcome = await runCheck(bench, drill, (error) => {
    failure = String(error);
  });
  const requests = sent.all;
  const left = [...((await bench.cli("list")).value.sites as unknown[]), ...((await bench.cli("list", "--trash")).value.sites as unknown[])].length;

  return { result: outcome.result, said, failure, requests, bucket: meter.spent(), left };
}

afterEach(() => {
  for (const close of OPENED.splice(0)) close();
});

describe("the live checks, against a local fake", () => {
  test.each(CASES)("%s", async (_what, switches, known, notPassed) => {
    const fake = await openFake(switches);
    const meter = meterBucket(fake.fetch, CEILINGS.checks);
    using writes = spyOn(MemoryStore.prototype, "write");
    using lists = spyOn(MemoryStore.prototype, "list");
    const uncounted: string[] = [];

    // A request the store wrote or listed for, which the meter let through as free.
    const watched: Fetch = async (input, init) => {
      const before = { store: writes.mock.calls.length + lists.mock.calls.length, spent: meter.spent() };
      const response = await meter.fetch(input, init);
      const free = meter.spent() === before.spent && writes.mock.calls.length + lists.mock.calls.length > before.store;
      if (free) uncounted.push(`${init.method ?? "GET"} ${new URL(input).pathname}`);

      return response;
    };
    const rows = meterRows(watched, ROW_CEILINGS.checks);
    const missing: Missing = {};
    const { bench, settle, sweep, close } = openBench({
      domain: FAKE_DOMAIN,
      token: switches.noToken === true ? undefined : fake.token,
      run: "selftest",
      missing,
      fetch: rows.fetch,
      pause: fake.pause,
      now: fake.now,
      say: () => undefined,
      manyFiles: MANY_FILES,
      loginList: fake.loginList,
    });
    OPENED.push(close);
    await settle();
    Object.assign(missing, await probeMissing(bench, { ...known, ...(switches.noToken === true ? { token: "a token" } : {}) }));

    if (switches.demoSite !== undefined) await publishDemoSite(bench, switches.demoSite);

    const outcomes = [];
    for (const check of CHECKS) outcomes.push(await runCheck(bench, check));

    const unmet: Case[3] = switches.demoSite === undefined ? { demo: "skipped", ...notPassed } : notPassed;
    const expected = Object.fromEntries(CHECKS.map((check): [string, Outcome["result"]] => [check.id, BY_HAND.includes(check.id) ? "skipped" : (unmet[check.id] ?? "passed")]));
    expect(Object.fromEntries(outcomes.map((outcome) => [outcome.id, outcome.result]))).toEqual(expected);

    await sweep();
    if (switches.demoSite !== undefined) expect((await bench.cli("delete", "demo")).code).toBe(0);

    const left = await bench.cli("list");
    expect(switches.noToken === true ? [] : left.value.sites).toEqual([]);
    // A check that grew into a loop of publishes would be held back on the real install alone, and a route the meter does not know would be billed uncounted. A request that writes rows on a route with no price would stop the real run.
    expect({ stopped: meter.stopped(), uncounted, rows: rows.stopped() }).toEqual({ stopped: undefined, uncounted: [], rows: undefined });
  }, RUN_MS);

  // The README states what a usual run of the checks makes the database write; a check that grew a publish would spend more of the test account's day than a reader was told, and come nearer the ceiling.
  test("a run of every check counts the rows the README states, the suite's settings and its sweep among them", async () => {
    const fake = await openFake({ access: true });
    const rows = meterRows(fake.fetch, ROW_CEILINGS.checks);
    const missing: Missing = {};
    const { bench, settle, sweep, close } = openBench({ domain: FAKE_DOMAIN, token: fake.token, run: "selftest", missing, fetch: rows.fetch, pause: fake.pause, now: fake.now, say: () => undefined, manyFiles: MANY_FILES, loginList: fake.loginList });
    OPENED.push(close);
    await settle();
    Object.assign(missing, await probeMissing(bench, { "many-files": "asked" }));

    for (const check of CHECKS) await runCheck(bench, check);
    await sweep();

    expect({ rows: rows.written(), stopped: rows.stopped() }).toEqual({ rows: CHECKS_ROWS, stopped: undefined });
  }, RUN_MS);

  // The README and the check state what one drill costs the install; a drill that grew would spend more of the plan's day than a reader was told.
  test("the backup drill sends the requests it states, says one line that holds no address, and leaves no site", async () => {
    expect(await drillOn(undefined)).toEqual({
      said: ["backup-drill: 3 sites, 5 files, 119 bytes put back and exported the same; passed over made_at of manifest.json; 0 ms"],
      result: "passed",
      failure: "",
      left: 0,
      ...DRILL_COST,
    });
  }, RUN_MS);

  // A drill that fails half way has made sites on an install that keeps them; one whose own removal fails has left one there and must not pass.
  test.each<[string, Refusal, RegExp, number]>([
    ["a drill that fails at its second export still removes every site it made", { method: "GET", path: /^\/api\/export\/sites\/[^/]+$/, nth: 4 }, /Expected: 0\s+Received: 1/, 0],
    ["a drill whose first import is refused reports that, not the removals of sites that are gone", { method: "POST", path: /^\/api\/import\/sites$/, nth: 1 }, /"imported": 1/, 0],
    ["a drill whose removal at the end is refused fails, and says no line", { method: "DELETE", path: /^\/api\/sites\/[^/]+$/, nth: 4 }, /could not remove 1 of its 3 sites/, 1],
  ])("%s", async (_what, refusal, failure, left) => {
    expect(await drillOn(refusal)).toMatchObject({ said: [], result: "failed", failure: expect.stringMatching(failure), left });
  }, RUN_MS);

  // A failure that said only the answers left it open whether the rule was gone or the requests never met in one count; a line that held the address the edge saw would put it in a public log.
  test.each(BURST_CASES)("%s", async (_what, switches, result, line) => {
    const fake = await openFake(switches);
    const said: string[] = [];
    const { bench, close } = openBench({
      domain: FAKE_DOMAIN,
      token: fake.token,
      run: "selftest",
      missing: {},
      fetch: fake.fetch,
      pause: fake.pause,
      now: fake.now,
      say: (text) => said.push(text),
      manyFiles: MANY_FILES,
    });
    OPENED.push(close);

    const burst = CHECKS.find((check) => check.id === "burst-rate-rule");
    if (burst === undefined) throw new Error("the checks hold no check of the rate rule");

    // A failure's words are the line and then what was expected of it.
    const outcome = await runCheck(bench, burst, (error) => said.push(...String(error).replace(/^Error: /, "").split("\n").slice(0, 1)));

    const heard = outcome.result === "skipped" ? [outcome.reason] : said;

    expect({ result: outcome.result, heard }).toEqual({ result, heard: [line.join("; ")] });
    expect(heard.join()).not.toMatch(/\d+\.\d+\.\d+|[0-9a-f]*:[0-9a-f]*:/);
  }, RUN_MS);
});
