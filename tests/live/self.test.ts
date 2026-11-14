// The live checks run against a local fake, so their own logic is exercised with no deployed install: a check that passed on anything, or a skip that hid a fault, would otherwise go unseen until a real run.

import { afterEach, describe, expect, test } from "bun:test";

import { openBench } from "./bench";
import { probeMissing } from "./capabilities";
import { CHECKS } from "./checks";
import type { Missing, Outcome } from "./records";
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

/** One fake install, what the run knows of it, and the checks that do not pass on it: `skipped` or `failed`, by id. `L1` is skipped unless the case says the login is in front. */
type Case = readonly [
  what: string,
  switches: FakeSwitches & { readonly noToken?: boolean },
  known: Missing,
  notPassed: Readonly<Record<string, "skipped" | "failed">>,
];

const CASES: readonly Case[] = [
  ["an install with no login in front passes every check but the login's and a person's", {}, {}, { L1: "skipped" }],
  ["an install behind a login passes the login's check too", { access: true }, {}, {}],
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
  [
    "a zone whose rules are gone, on a run not told so, fails the checks of those rules",
    { noGuards: true },
    {},
    { L1: "skipped", "L8-method": "failed", "L8-scanner": "failed", "L8-http": "failed" },
  ],
];

afterEach(() => {
  for (const close of OPENED.splice(0)) close();
});

describe("the live checks, against a local fake", () => {
  test.each(CASES)("%s", async (_what, switches, known, notPassed) => {
    const fake = await openFake(switches);
    const missing: Missing = {};
    const { bench, settle, sweep, close } = openBench({
      domain: FAKE_DOMAIN,
      token: switches.noToken === true ? undefined : fake.token,
      run: "selftest",
      missing,
      fetch: fake.fetch,
      pause: async () => undefined,
      manyFiles: MANY_FILES,
    });
    OPENED.push(close);
    await settle();
    Object.assign(missing, await probeMissing(bench, { ...known, ...(switches.noToken === true ? { token: "a token" } : {}) }));

    const outcomes = [];
    for (const check of CHECKS) outcomes.push(await runCheck(bench, check));

    const expected = Object.fromEntries(
      CHECKS.map((check): [string, Outcome["result"]] => [check.id, BY_HAND.includes(check.id) ? "skipped" : (notPassed[check.id] ?? "passed")]),
    );
    expect(Object.fromEntries(outcomes.map((outcome) => [outcome.id, outcome.result]))).toEqual(expected);

    await sweep();
    const left = await bench.cli("list");
    expect(switches.noToken === true ? [] : left.value.sites).toEqual([]);
  });
});
