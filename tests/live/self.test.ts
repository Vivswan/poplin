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

/** The benches a test opened, closed after it. */
const OPENED: (() => void)[] = [];

/** One fake install, what the run knows of it, and the checks that do not pass on it, by id. `L1` is skipped unless the login is in front, and `demo` unless the install holds the demo's site: whole, or without its worker. */
type Case = readonly [
  what: string,
  switches: FakeSwitches & { readonly noToken?: boolean; readonly demoSite?: "whole" | "no-worker" },
  known: Missing,
  notPassed: Readonly<Record<string, "skipped" | "failed">>,
];

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
  ["an install with no limit of its own fails the check of that limit", { noOwnLimit: true }, {}, { L1: "skipped", "own-limit": "failed" }],
  [
    "a zone whose rules are gone, on a run not told so, fails the checks of those rules",
    { noGuards: true },
    {},
    { L1: "skipped", "L8-method": "failed", "L8-scanner": "failed", "L8-http": "failed" },
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
  });
});
