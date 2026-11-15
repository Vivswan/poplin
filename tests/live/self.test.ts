// The live checks run against a local fake, so their own logic is exercised with no deployed install: a check that passed on anything, or a skip that hid a fault, would otherwise go unseen until a real run.

import { afterEach, describe, expect, spyOn, test } from "bun:test";
import { writeFileSync } from "node:fs";
import { join } from "node:path";

import type { Fetch } from "../../packages/cli/src/client/client";
import { CEILINGS, meterBucket } from "../../packages/cloudflare/scripts/live/budget";
import { MemoryStore } from "../../packages/core/src/storage/memory";
import { openBench } from "./bench";
import { probeMissing } from "./capabilities";
import { CHECKS } from "./checks";
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
  "mcp",
  "export-import",
  "outside-page",
  "L4",
  "L5",
  "L10",
];

/** How many files the fake's publish of many files holds: what the caps of the API's test install take. */
const MANY_FILES = 7;

/** How long one install's run of every check may take, in milliseconds: each publishes, reads and removes sites in this process with no wait in it, all of it work of the processor, which on a busy machine passes the five seconds a test gets. */
const RUN_MS = 30_000;

/** The benches a test opened, closed after it. */
const OPENED: (() => void)[] = [];

/** One fake install, what the run knows of it, and the checks that do not pass on it, by id. `L1` is skipped unless the login is in front, and `demo` unless the install holds the demo's site: whole, or without its worker. */
type Case = readonly [
  what: string,
  switches: FakeSwitches & { readonly noToken?: boolean; readonly demoSite?: "whole" | "no-worker" },
  known: Missing,
  notPassed: Readonly<Record<string, "skipped" | "failed">>,
];

/** Every fake install the whole suite runs on. */
const CASES: readonly Case[] = [
  ["an install with no login in front passes every check but the login's and a person's", {}, {}, { L1: "skipped" }],
  ["an install behind a login passes the login's check too", { access: true }, {}, {}],
  ["an install that holds the demo's site passes the demo's check", { demoSite: "whole" }, {}, { L1: "skipped" }],
  ["a demo's site that lost its worker fails the demo's check", { demoSite: "no-worker" }, {}, { L1: "skipped", demo: "failed" }],
  ["an install whose routes miss the public word skips the public name's address", { noPublicRoute: true }, {}, { L1: "skipped", "public-name": "skipped" }],
  [
    "a run told what the zone lacks skips the checks of each lacking rule, and the many-files publish it was not asked for",
    { noGuards: true },
    { "bot-block": "bots", "rate-rule": "rate", "guard-rules": "guards", "https-redirect": "redirect", "many-files": "asked" },
    {
      L1: "skipped",
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
    { L1: "skipped", ...Object.fromEntries(WITH_TOKEN.map((id): [string, "skipped"] => [id, "skipped"])) },
  ],
  [
    "an install that opens a letter p address with no login behind the request fails the checks of a private site",
    { leaksPrivate: true },
    {},
    { L1: "skipped", private: "failed", L5: "failed" },
  ],
  ["an install whose own count of a visitor lags behind a burst still shows its own limit", { lateCount: true }, {}, { L1: "skipped" }],
  ["a rate rule that starts to block seconds after the burst passed its limit still shows its block", { lateRule: true }, {}, { L1: "skipped" }],
  ["a zone with no rate rule, on a run not told so, fails the check of that rule", { noRateRule: true }, {}, { L1: "skipped", "burst-rate-rule": "failed" }],
  ["an install with no limit of its own fails the check of that limit", { noOwnLimit: true }, {}, { L1: "skipped", "own-limit": "failed" }],
  [
    "a zone whose rules are gone, on a run not told so, fails the checks of those rules",
    { noGuards: true },
    {},
    { L1: "skipped", "L8-method": "failed", "L8-scanner": "failed", "L8-http": "failed" },
  ],
];

/** How a line ends on the fake, whose edge sees one address: once in each lane of the burst and once at the end. */
const ONE_ADDRESS = "the edge saw addresses x1 (IPv4) in samples x21";

/** One fake install, what the check of the rate rule comes to on it, and the one line it says of the runner's path: printed on a pass, and the failure's own words otherwise. */
type BurstCase = readonly [what: string, switches: FakeSwitches, result: Outcome["result"], answers: string, through: string];

/** The check of the rate rule on a fake whose rule blocks, and on one whose visitor no data center counts past the rule's limit. */
const BURST_CASES: readonly BurstCase[] = [
  ["a burst the rate rule blocks says through which data center it went", {}, "passed", "320 requests in 0 ms were answered: 302 x120, 429 of the install x180, 429 of the rate rule x20", "AAA x320 (most in ten seconds x320)"],
  ["a burst the rate rule does not block, spread over four data centers, says how few each one held", { spread: true }, "failed",
    "1140 requests in 20000 ms were answered: 302 x120, 429 of the install x1020",
    "AAA x285 (most in ten seconds x185), BBB x285 (most in ten seconds x184), CCC x285 (most in ten seconds x184), DDD x285 (most in ten seconds x184)",
  ],
];

/** Publish the demo's site as the reset of the test install does: a first page, and beside it the worker, unless the case leaves it out. */
async function publishDemoSite(bench: Bench, kind: "whole" | "no-worker"): Promise<void> {
  const folder = bench.folder("<title>a demo</title>");
  if (kind === "whole") writeFileSync(join(folder, "sw.js"), "self.addEventListener('fetch', () => undefined);");

  expect((await bench.cli("publish", folder, "--name", "demo", "--public", "--public-name", "demo")).code).toBe(0);
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
    const missing: Missing = {};
    const { bench, settle, sweep, close } = openBench({
      domain: FAKE_DOMAIN,
      token: switches.noToken === true ? undefined : fake.token,
      run: "selftest",
      missing,
      fetch: watched,
      pause: fake.pause,
      now: fake.now,
      say: () => undefined,
      manyFiles: MANY_FILES,
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
    // A check that grew into a loop of publishes would be held back on the real install alone, and a route the meter does not know would be billed uncounted.
    expect({ stopped: meter.stopped(), uncounted }).toEqual({ stopped: undefined, uncounted: [] });
  }, RUN_MS);

  // A failure that said only the answers left it open whether the rule was gone or the requests never met in one count; a line that held the address the edge saw would put it in a public log.
  test.each(BURST_CASES)("%s", async (_what, switches, result, answers, through) => {
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

    expect({ result: outcome.result, said }).toEqual({ result, said: [`${answers}; through ${through}; ${ONE_ADDRESS}`] });
    expect(said.join()).not.toMatch(/\d+\.\d+\.\d+|[0-9a-f]*:[0-9a-f]*:/);
  }, RUN_MS);
});
