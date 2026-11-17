// The live checks run against a local fake, so their own logic is exercised with no deployed install: a check that passed on anything, or a skip that hid a fault, would otherwise go unseen until a real run.

import { afterEach, describe, expect, spyOn, test } from "bun:test";
import { writeFileSync } from "node:fs";
import { join } from "node:path";

import type { Fetch } from "../../../../cli/src/client/client";
import { CEILINGS, meterBucket, spendsNothing } from "../../scripts/live/budget";
import { meterRows, ROW_CEILINGS } from "../../scripts/live/rows";
import { MemoryStore } from "../../../../core/src/storage/memory";
import { openBench } from "../../live/bench";
import { probeMissing } from "../../live/capabilities";
import { CHECKS } from "../../live/checks";
import { DRILL_COST } from "../../live/checks/backup";
import type { Bench, Missing, Outcome } from "../../live/records";
import { runCheck } from "../../live/report";
import { type FakeSwitches, openFake } from "./support/fake-install";

/** Every check a person makes. */
const BY_HAND = ["L2", "L3", "L4-in", "L5b", "L6", "L7", "L9"];

/** Every check that needs a token. */
const WITH_TOKEN = [
  "direct-upload",
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
  "duplicate-job",
  "mcp",
  "export-import",
  "backup-drill",
  "users-follow",
  "logs-follow",
  "outside-page",
  "relative-file",
  "hosts-apart",
  "L4",
  "L5",
  "L10",
];

/** How many files the fake's publish of many files holds: what the caps of the API's test install take. */
const MANY_FILES = 7;

/** How many files the fake's copy for the install's job holds: one more than a first request copies, as on a real run, and under the caps of the API's test install. */
const LARGE_COPY = 113;

/** Why a run that is not the midnight one leaves out the copy the install's job finishes. */
const NOT_MIDNIGHT = "the midnight run";

/** The rows the midnight run counts beside a usual one: the copy the install's job finishes, with its source, its one round, its site set unlisted and opened three times, and both sites removed. */
const JOB_COPY_ROWS = 103;

/** How long one install's run of every check may take, in milliseconds: each publishes, reads and removes sites in this process with no wait in it, all of it work of the processor, which on a busy machine passes the five seconds a test gets. */
const RUN_MS = 30_000;

/** The rows a run of every check counts on an install behind a login, which skips none but a person's and the many-files publish: what the README states of a usual run. */
const CHECKS_ROWS = 959;

/** What a run says each time it asks a stranger's request again, before the count of its askings so far. */
const ASKED_AGAIN = "a stranger's request got no answer, asked again";

/** The first line of the failure of a connection a test cuts off. */
const CUT = "TypeError: The socket connection was closed unexpectedly";

/** The first line of the failure of a request whose time a test lets run out. */
const TIMED_OUT = "TimeoutError: The operation timed out.";

/** The benches a test opened, closed after it. */
const OPENED: (() => void)[] = [];

/** The checks skipped on an install with no login in front. */
const NO_LOGIN = { L1: "skipped", "dashboard-login": "skipped", "users-follow": "skipped" } as const;

/** The checks a run on an install without a domain skips: each needs a rule or a switch of a zone. */
const ZONE_CHECKS = { crawler: "skipped", "assistant-fetch": "skipped", "burst-rate-rule": "skipped", "L8-method": "skipped", "L8-scanner": "skipped", "L8-http": "skipped" } as const;

/** How the line of the assistants' check ends. */
const UNVERIFIED = "a run is no verified bot, so the bot switches answered, and the bots rule's pass for a verified assistant is held by the test of its expression";

/** One fake install, what the run knows of it, and the checks that do not pass on it, by id. Skipped unless said: `L1` and `dashboard-login` behind no login, `demo` with no whole site of it, and `duplicate-job` off the midnight run. */
type Case = readonly [
  what: string,
  switches: FakeSwitches & { readonly noToken?: boolean; readonly demoSite?: "whole" | "no-worker"; readonly midnight?: boolean },
  known: Missing,
  notPassed: Readonly<Record<string, "skipped" | "failed">>,
];

/** Every fake install the whole suite runs on. */
const CASES: readonly Case[] = [
  ["an install with no login in front passes every check but the login's and a person's", {}, {}, NO_LOGIN],
  ["an install behind a login passes the login's checks too", { access: true }, {}, {}],
  ["an install without a domain, behind a login, passes every check at the addresses of its layout, and skips the checks of a zone's rules", { noDomain: true, access: true }, {}, ZONE_CHECKS],
  ["an install without a domain and with no login in front skips the login's checks too", { noDomain: true }, {}, { ...NO_LOGIN, ...ZONE_CHECKS }],
  ["an install without a domain that holds the demo's site passes the demo's check at the site's path", { noDomain: true, demoSite: "whole" }, {}, { ...NO_LOGIN, ...ZONE_CHECKS }],
  [
    "an install without a domain that opens a private site's address with no login behind the request fails the checks of a private site",
    { noDomain: true, leaksPrivate: true },
    {},
    { ...NO_LOGIN, ...ZONE_CHECKS, private: "failed", duplicate: "failed", L5: "failed" },
  ],
  ["an install whose login stands in front of the login path alone fails the check of the whole dashboard", { access: true, loginPathOnly: true }, {}, { "dashboard-login": "failed" }],
  ["an install whose dashboard lets a site's origin read its answers fails the check of the dashboard's data asked for by a site", { grantsOrigin: true }, {}, { ...NO_LOGIN, "data-cross-origin": "failed" }],
  ["the same install behind a login, whose own answers alone the check judges, fails it on the path the login lets through", { access: true, grantsOrigin: true }, {}, { "data-cross-origin": "failed" }],
  ["an install whose site hostnames answer the API fails the check that keeps the hosts apart, with a domain and without", { apiOnSiteHosts: true }, {}, { ...NO_LOGIN, "hosts-apart": "failed" }],
  ["an install without a domain whose site hosts answer the API fails the same check", { noDomain: true, apiOnSiteHosts: true }, {}, { ...NO_LOGIN, ...ZONE_CHECKS, "hosts-apart": "failed" }],
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
      "assistant-fetch": "skipped",
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
  ["an install with no upload key, on a run told so, sends its files through itself and passes", { noUploadKey: true }, { "upload-key": "the token permission for the Upload key" }, NO_LOGIN],
  ["an install said to hold an upload key the bucket takes fails the check of the way a file goes when it hands out none of the bucket's tickets", { noUploadKey: true }, {}, { ...NO_LOGIN, "direct-upload": "failed" }],
  ["a store that refuses the tickets of a key it should take: every publish goes through the install after all, and the check of the way a file goes fails", { storeRefuses: true }, {}, { ...NO_LOGIN, "direct-upload": "failed" }],
  ["a store that refuses the tickets of a key the run itself made is no fault: a new key is refused for its first minutes", { storeRefuses: true }, { "settled-upload-key": "an upload key older than two and a half minutes" }, NO_LOGIN],
  [
    "an install that holds no key of its provider fails the checks of the users and of the logs: the login list never takes the one it added, and the provider keeps the logs as they were",
    { access: true, noKey: true },
    {},
    { "users-follow": "failed", "logs-follow": "failed" },
  ],
  [
    "a run with no key to read the provider's login list and its logs skips the checks of the users and of the logs",
    { access: true },
    { "login-list": "a key of the provider", "provider-logs": "a key of the provider" },
    { "users-follow": "skipped", "logs-follow": "skipped" },
  ],
  ["an install whose own count of a visitor lags behind a burst still shows its own limit", { lateCount: true }, {}, NO_LOGIN],
  ["a rate rule that starts to block seconds after the burst passed its limit still shows its block", { lateRule: true }, {}, NO_LOGIN],
  ["a zone with no rate rule, on a run not told so, fails the check of that rule", { noRateRule: true }, {}, { ...NO_LOGIN, "burst-rate-rule": "failed" }],
  ["an install with no limit of its own fails the check of that limit", { noOwnLimit: true }, {}, { ...NO_LOGIN, "own-limit": "failed" }],
  ["the midnight run copies a site too large for one request, and the install's job finishes it", { access: true, midnight: true }, {}, {}],
  ["the midnight run on an install without a domain copies such a site too, read at the paths of its layout, and the install's job finishes it", { noDomain: true, access: true, midnight: true }, {}, ZONE_CHECKS],
  ["an install whose provider runs no job, on a midnight run not told so, fails the check of the job: the requests made the copy, and the provider holds no job of it", { access: true, midnight: true, noJobs: true }, {}, { "duplicate-job": "failed" }],
  ["a midnight run told that the install has no Workflow skips the check of the job", { access: true, midnight: true, noJobs: true }, { jobs: "the Worker's Workflow" }, { "duplicate-job": "skipped" }],
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
    ["606 requests in 3192 ms were answered: 302 x120, 429 of the install x480, 429 of the rate rule x6", "through AAA x303 (most in ten seconds x303), BBB x303 (most in ten seconds x303)", ONE_SEEN],
  ],
  ["one data center past the limit for five seconds, with no rule to block, fails", { noRateRule: true }, "failed",
    ["757 requests in 5004 ms were answered: 302 x120, 429 of the install x637", "through AAA x757 (most in ten seconds x757)", ONE_SEEN],
  ],
  ["two data centers past the limit for five seconds, with no rule to block, fail before the requests end", { noRateRule: true, spread: 2 }, "failed",
    ["1023 requests in 8196 ms were answered: 302 x120, 429 of the install x903", "through AAA x512 (most in ten seconds x512), BBB x511 (most in ten seconds x511)", ONE_SEEN],
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
  const parts = { addresses: fake.addresses, token: fake.token, run: "selftest", missing: {}, fetch: counted, pause: fake.pause, now: fake.now, manyFiles: MANY_FILES, largeCopy: LARGE_COPY };
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
    const meter = meterBucket(fake.fetch, switches.midnight === true ? CEILINGS.jobCopy : CEILINGS.checks);
    using writes = spyOn(MemoryStore.prototype, "write");
    using lists = spyOn(MemoryStore.prototype, "list");
    const uncounted: string[] = [];

    // A request the store wrote or listed for, which the meter let through as free. One that makes no call to the store is left out: what the store does while it is on its way is another lane's file.
    const watched: Fetch = async (input, init) => {
      const before = { store: writes.mock.calls.length + lists.mock.calls.length, spent: meter.spent() };
      const response = await meter.fetch(input, init);
      const free = !spendsNothing(input, init) && meter.spent() === before.spent && writes.mock.calls.length + lists.mock.calls.length > before.store;
      if (free) uncounted.push(`${init.method ?? "GET"} ${new URL(input).pathname}`);

      return response;
    };
    const rows = meterRows(watched, ROW_CEILINGS.checks);
    const missing: Missing = {};
    const { bench, settle, sweep, close } = openBench({
      addresses: fake.addresses,
      token: switches.noToken === true ? undefined : fake.token,
      run: "selftest",
      missing,
      fetch: rows.fetch,
      pause: fake.pause,
      now: fake.now,
      say: () => undefined,
      manyFiles: MANY_FILES, largeCopy: LARGE_COPY,
      loginList: fake.loginList,
      logsKept: fake.logsKept,
      jobRun: fake.jobRun,
    });
    OPENED.push(close);
    await settle();
    const unasked: Missing = switches.midnight === true ? {} : { "job-copy": NOT_MIDNIGHT };
    Object.assign(missing, await probeMissing(bench, { ...unasked, ...known, ...(switches.noToken === true ? { token: "a token" } : {}) }));

    if (switches.demoSite !== undefined) await publishDemoSite(bench, switches.demoSite);

    const outcomes = [];
    for (const check of CHECKS) outcomes.push(await runCheck(bench, check));

    const usual: Case[3] = switches.midnight === true ? {} : { "duplicate-job": "skipped" };
    const unmet: Case[3] = switches.demoSite === undefined ? { demo: "skipped", ...usual, ...notPassed } : { ...usual, ...notPassed };
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
  test.each([
    ["a run of every check counts the rows the README states, the suite's settings and its sweep among them", { "job-copy": NOT_MIDNIGHT }, CHECKS_ROWS, []],
    ["the midnight run counts the rows of the copy the install's job finishes beside them, the job's own round among them, and says what the job came to", {}, CHECKS_ROWS + JOB_COPY_ROWS, ["duplicate-job: 113 files, 1595 bytes, 1 steps, 2000 ms"]],
  ] as const)("%s", async (_what, unasked, counted, told) => {
    const fake = await openFake({ access: true });
    const rows = meterRows(fake.fetch, ROW_CEILINGS.checks);
    const missing: Missing = {};
    const said: string[] = [];
    const provider = { loginList: fake.loginList, logsKept: fake.logsKept, jobRun: fake.jobRun };
    const parts = { addresses: fake.addresses, token: fake.token, run: "selftest", missing, fetch: rows.fetch, pause: fake.pause, now: fake.now, manyFiles: MANY_FILES, largeCopy: LARGE_COPY, ...provider };
    const { bench, settle, sweep, close } = openBench({ ...parts, say: (line) => said.push(line) });
    OPENED.push(close);
    await settle();
    Object.assign(missing, await probeMissing(bench, { "many-files": "asked", ...unasked }));

    for (const check of CHECKS) await runCheck(bench, check);
    await sweep();

    expect({ rows: rows.written(), stopped: rows.stopped(), job: said.filter((line) => line.startsWith("duplicate-job")) }).toEqual({ rows: counted, stopped: undefined, job: [...told] });
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
    ["a drill whose first import is refused reports its problem's code and the status, not the removals of sites that are gone", { method: "POST", path: /^\/api\/import\/sites$/, nth: 1 }, /"problem forbidden, last status of 400 or more: 403"/, 0],
    ["a drill whose removal at the end is refused fails, and says no line", { method: "DELETE", path: /^\/api\/sites\/[^/]+$/, nth: 4 }, /could not remove 1 of its 3 sites/, 1],
  ])("%s", async (_what, refusal, failure, left) => {
    expect(await drillOn(refusal)).toMatchObject({ said: [], result: "failed", failure: expect.stringMatching(failure), left });
  }, RUN_MS);

  // Drift: a tool call that failed said nothing of why, so a run that met one stray answer, or a request that never left, could not be read.
  // The words of an answer and of a runtime's failure may quote an address, which a log must not hold.
  test.each<[string, (input: string) => Promise<Response>, string]>([
    [
      "a tool call the install refuses says the problem's code and the status, and nothing else of the answer",
      async (input) => Response.json({ error: { code: "forbidden", message: `Refused at ${input}.` } }, { status: 403 }),
      "problem forbidden, last status of 400 or more: 403",
    ],
    [
      "a tool call whose request gets no answer says the code of what caused the failure, and none of its words",
      async (input) => Promise.reject(new TypeError(`fetch failed for ${input}`, { cause: Object.assign(new Error(`the certificate of ${input}`), { code: "CERT_HAS_EXPIRED" }) })),
      "problem unreachable, no answer of status 400 or more, requests with no answer: CERT_HAS_EXPIRED",
    ],
  ])("%s", async (_what, answer, met) => {
    const fake = await openFake();
    const failing: Fetch = async (input, init) => (init.method === "POST" && new URL(input).pathname === "/api/uploads" ? answer(input) : fake.fetch(input, init));
    const parts = { addresses: fake.addresses, token: fake.token, run: "selftest", missing: {}, fetch: failing, pause: fake.pause, now: fake.now, manyFiles: MANY_FILES, largeCopy: LARGE_COPY };
    const { bench, close } = openBench({ ...parts, say: () => undefined });
    OPENED.push(close);

    const failure = await bench.mcp("publish_site", { path: bench.folder("<p>refused</p>"), name: "refused" }).then(() => "no failure", String);

    expect(failure).toBe(`Error: the MCP tool publish_site answered an error: ${met}`);
  }, RUN_MS);

  // Drift: the line is how a person reading a run learns whether files went straight to the bucket. One that said "used" for a file that went through the install would hide a key the bucket refuses.
  test.each<[string, FakeSwitches, Missing, Outcome["result"], string[]]>([
    ["a file the store takes", {}, {}, "passed", ["a publish sent its file straight to the bucket by a signed ticket: the upload key is used"]],
    ["a file the store takes at its second sending", { storeStumbles: true }, {}, "passed", ["a publish sent its file straight to the bucket by a signed ticket: the upload key is used"]],
    [
      "an install with no upload key, as the run was told",
      { noUploadKey: true },
      { "upload-key": "the token permission for the Upload key" },
      "passed",
      ["a publish sent its file through the install: a file goes straight to the bucket with the token permission for the Upload key"],
    ],
    [
      "a key the run made, which the install does not sign with yet",
      { noUploadKey: true },
      { "settled-upload-key": "an upload key older than two and a half minutes" },
      "passed",
      ["a publish sent its file through the install: a file goes straight to the bucket with an upload key older than two and a half minutes"],
    ],
    [
      "a key the run made, which the store refuses yet",
      { storeRefuses: true },
      { "settled-upload-key": "an upload key older than two and a half minutes" },
      "passed",
      ["the bucket refused the ticket of a publish's file, and the file went through the install: a file goes straight to the bucket with an upload key older than two and a half minutes"],
    ],
    ["a key the store should take and refuses", { storeRefuses: true }, {}, "failed", []],
  ])("the check of the way a file goes, on %s, says one line that holds no address", async (_what, switches, missing, result, lines) => {
    const fake = await openFake(switches);
    const said: string[] = [];
    const { bench, close } = openBench({ addresses: fake.addresses, token: fake.token, run: "selftest", missing, fetch: fake.fetch, pause: fake.pause, now: fake.now, say: (text) => said.push(text), manyFiles: MANY_FILES, largeCopy: LARGE_COPY });
    OPENED.push(close);

    const check = CHECKS.find((one) => one.id === "direct-upload");
    if (check === undefined) throw new Error("the checks hold no direct-upload");

    expect({ result: (await runCheck(bench, check)).result, said, named: said.join().includes("example.") }).toEqual({ result, said: lines, named: false });
  }, RUN_MS);

  // Drift: the bot switches of a zone stop a crawler's user agent and let an assistant's through. A check that passed on a 403 would hide a switch that began to stop assistants.
  test.each<[string, FakeSwitches, Outcome["result"], string[]]>([
    ["a bot block that stops crawlers alone", {}, "passed", [`assistant-fetch: ChatGPT-User let through (302), Perplexity-User let through (302); ${UNVERIFIED}`]],
    ["a bot block that stops assistants too", { stopsAssistants: true }, "failed", [`assistant-fetch: ChatGPT-User stopped (403), Perplexity-User stopped (403); ${UNVERIFIED}`]],
    ["an install without a domain, which no bot block stands in front of", { noDomain: true }, "skipped", []],
  ])("the check of an assistant's single page, on %s, says one line that holds no address, on a pass or as its failure", async (_what, switches, result, lines) => {
    const fake = await openFake(switches);
    const said: string[] = [];
    const sent: string[] = [];
    const counted: Fetch = async (input, init) => {
      sent.push(init.method ?? "GET");

      return fake.fetch(input, init);
    };
    const missing: Missing = {};
    const parts = { addresses: fake.addresses, token: fake.token, run: "selftest", missing, fetch: counted, pause: fake.pause, now: fake.now, manyFiles: MANY_FILES, largeCopy: LARGE_COPY };
    const { bench, close } = openBench({ ...parts, say: (text) => said.push(text) });
    OPENED.push(close);
    Object.assign(missing, await probeMissing(bench, {}));
    sent.length = 0;

    const check = CHECKS.find((one) => one.id === "assistant-fetch");
    if (check === undefined) throw new Error("the checks hold no assistant-fetch");

    // A failure's words are the line and then what was expected of it.
    const outcome = await runCheck(bench, check, (error) => said.push(...String(error).replace(/^Error: /, "").split("\n").slice(0, 1)));

    // Two requests, one for each assistant, and none where the check is skipped.
    expect({ result: outcome.result, said, sent, named: said.join().includes("example.") }).toEqual({ result, said: lines, sent: lines.flatMap(() => ["GET", "GET"]), named: false });
  }, RUN_MS);

  // Drift: a request that gets no answer says nothing of a rule or of the install. A check that failed on it fails a run for the network's sake.
  // One that asked again after an answer would hide a wrong status, and one that lost the failure it met would say nothing of why it failed.
  test.each<[string, string, { readonly method: string; readonly meets: "cut" | "timeout" | "answer"; readonly times: number }, Outcome["result"], number[], string]>([
    ["a changing method to a site's address, cut off once, is asked again, said so, and passes on the answer it then gets", "L8-method", { method: "POST", meets: "cut", times: 1 }, "passed", [1], ""],
    ["the same, cut off twice, is asked a third time after a longer pause, and passes", "L8-method", { method: "POST", meets: "cut", times: 2 }, "passed", [1, 2], ""],
    ["the same, cut off three times, fails with the failure it met: it is asked three times and no more", "L8-method", { method: "POST", meets: "cut", times: 3 }, "failed", [1, 2], CUT],
    ["a read whose time runs out once is asked again, said so, and passes", "no-site", { method: "GET", meets: "timeout", times: 1 }, "passed", [1], ""],
    ["a read whose time runs out three times fails with the failure it met", "no-site", { method: "GET", meets: "timeout", times: 3 }, "failed", [1, 2], TIMED_OUT],
    ["a read that is answered with a wrong status is never asked again, and fails", "no-site", { method: "GET", meets: "answer", times: 1 }, "failed", [], "Error: expect(received).toBe(expected)"],
    ["a computer's login asked of the API, cut off once, is not sent again, and fails", "L11", { method: "POST", meets: "cut", times: 1 }, "failed", [], CUT],
  ])("%s", async (_what, id, fault, result, askings, failure) => {
    const fake = await openFake();
    const said: string[] = [];
    const paused: number[] = [];
    let met = 0;
    const faulty: Fetch = async (input, init) => {
      if ((init.method ?? "GET") !== fault.method || met >= fault.times) return fake.fetch(input, init);

      met += 1;
      if (fault.meets === "answer") return new Response("a failure of the edge", { status: 500 });

      throw fault.meets === "cut" ? Object.assign(new TypeError("The socket connection was closed unexpectedly"), { code: "ECONNRESET" }) : new DOMException("The operation timed out.", "TimeoutError");
    };
    let reported = "";
    const report = (error: unknown): void => {
      [reported = ""] = String(error).split("\n");
    };
    const parts = { addresses: fake.addresses, token: fake.token, run: "selftest", missing: {}, fetch: faulty, now: fake.now, manyFiles: MANY_FILES, largeCopy: LARGE_COPY };
    const { bench, close } = openBench({ ...parts, pause: async (ms) => void paused.push(ms), say: (text) => said.push(text) });
    OPENED.push(close);

    const check = CHECKS.find((one) => one.id === id);
    if (check === undefined) throw new Error(`the checks hold no ${id}`);

    const outcome = await runCheck(bench, check, report);

    expect({ result: outcome.result, said, paused, reported }).toEqual({ result, said: askings.map((asking) => `${ASKED_AGAIN}: ${asking}`), paused: askings.map((asking) => asking * 1000), reported: failure });
  }, RUN_MS);

  // A failure that said only the answers left it open whether the rule was gone or the requests never met in one count; a line that held the address the edge saw would put it in a public log.
  test.each(BURST_CASES)("%s", async (_what, switches, result, line) => {
    const fake = await openFake(switches);
    const said: string[] = [];
    const { bench, close } = openBench({
      addresses: fake.addresses,
      token: fake.token,
      run: "selftest",
      missing: {},
      fetch: fake.fetch,
      pause: fake.pause,
      now: fake.now,
      say: (text) => said.push(text),
      manyFiles: MANY_FILES, largeCopy: LARGE_COPY,
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
