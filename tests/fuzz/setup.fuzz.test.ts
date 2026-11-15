// Anyone can type anything into the three boxes of the setup screen, the token's among them, and send it from the screen or by a program's call.
// Whatever is typed, a refused run answers as if something else had been typed: nothing of it is in the body or a header.

import { expect, test } from "bun:test";
import fc from "fast-check";

import { createSetupConsole } from "../../packages/app/src/console/setup-console";
import { REFUSAL_STATUS } from "../../packages/app/src/console/domain/domain-run";
import type { DomainReading } from "../../packages/app/src/console/domain/records";
import { MemoryCounters } from "../../packages/app/src/limits/memory-counters";
import { CLIENT } from "../../packages/app/tests/console/support/console";
import { fakePlug, firstRunOf } from "../../packages/app/tests/console/support/fake-plug";
import { ORIGIN } from "../../packages/app/tests/console/support/install";
import { AllowanceSpent } from "../../packages/core/src/database/driver";
import { fuzzTarget } from "./config";
import { hostile } from "./hostile";

/** A token in the form a provider takes one. */
const TOKEN = "planted-token-0123456789-abcdefghij";

/** Every refusal the setup has a status for, from its own table: a refusal added there is held to the property with no change here. */
const REFUSALS = Object.keys(REFUSAL_STATUS) as readonly (keyof typeof REFUSAL_STATUS)[];

/** The values no run of the property types: the answers to them are what every refused answer is held to. */
const PLAIN = { domain: "example.com", login: "owner@example.com", token: TOKEN };

/** Text past the most the setup reads of one request, which is 16 KiB. */
const TOO_LONG = "a".repeat(20_000);

/** The two ways a run is sent, each with the path under `/setup` that takes it: the screen's own, and a program's. */
const WAYS = { screen: "data", call: "api" } as const;

/** The plain values that reach each answer the setup gives of its own accord, whatever the plug would say; a new answer of its own gets a row here. The first two are refused on an install with nothing set alone. */
const OWN_ANSWERS: Readonly<Record<string, Run["typed"]>> = {
  "an email that is none": { ...PLAIN, login: "nobody" },
  "a domain that is none": { ...PLAIN, domain: "nowhere" },
  "a request past the cap": { ...PLAIN, domain: TOO_LONG },
};

/** A database every use of which fails the run: a refused run reads and writes none. */
const NO_DATABASE = new Proxy({}, { get: (_target, name) => () => Promise.reject(new Error(`the database was asked for ${String(name)}`)) }) as Parameters<typeof createSetupConsole>[0]["install"]["database"];

/** A database that takes no more for the day: every use of it is refused as a driver refuses once the allowance is used up. */
const SPENT_DATABASE = new Proxy({}, { get: () => () => Promise.reject(new AllowanceSpent("reading")) }) as typeof NO_DATABASE;

/** A run the plug takes: one piece, as the plug names it. */
const TAKEN: DomainReading = { ok: true, rows: [{ object: "DNS record", state: "present", detail: "poplin.example.com", part: "reach" }], steps: [] };

/** One run: what is typed into the three boxes, how it is sent, whether it reads or changes, on which kind of install, and what the plug answers a run that reaches it. */
interface Run {
  readonly typed: { readonly domain: string; readonly login: string; readonly token: string };
  readonly by: keyof typeof WAYS;
  readonly run: "check" | "repair";
  readonly nothingSet: boolean;
  readonly refusal: (typeof REFUSALS)[number];
}

/** The property of this file, under the budget every fuzz file shares. */
const property = fuzzTarget(import.meta.file);

/** Text for one box: noise, markup, a token, a domain or an email with edits, each also padded or in other capitals, and text past the cap. */
const box = fc.oneof(
  fc.string(),
  fc.constantFrom(TOKEN, ` ${TOKEN} `, TOKEN.toUpperCase(), `${TOKEN}.example.com`, `${TOKEN}@example.com`, TOO_LONG, '"><script>alert(1)</script>', "' onfocus='alert(1)", "<b>bold</b>.example", "Example.COM", "Owner@Example.com"),
  hostile(fc.constantFrom(TOKEN, "example.com", "owner@example.com")),
);

/** Any run: any text in each box, sent either way, on either kind of install. */
const runs: fc.Arbitrary<Run> = fc.record({
  typed: fc.record({ domain: box, login: box, token: box }),
  by: fc.constantFrom("screen", "call"),
  run: fc.constantFrom("check", "repair"),
  nothingSet: fc.boolean(),
  refusal: fc.constantFrom(...REFUSALS),
});

/** Send one run to a setup screen of its own, and answer everything it sent back. */
async function answerOf(run: Run, answer: DomainReading = { ok: false, refusal: run.refusal }, database = NO_DATABASE): Promise<string> {
  const plug = fakePlug(() => answer);
  const setup = createSetupConsole({
    install: { database, now: () => 1_700_000_000_000 },
    domain: run.nothingSet ? firstRunOf(plug) : plug,
    open: async () => true,
    counters: new MemoryCounters(),
    visitorOf: async () => "203.0.113.7",
    client: CLIENT,
  });
  const answered = await setup.fetch(new Request(`${ORIGIN}/setup/${WAYS[run.by]}/${run.run}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(run.typed) }));

  return JSON.stringify([answered.status, [...answered.headers], await answered.text()]);
}

/** Every answer a refused run may get: the answers to the plain values, for each way to send, each kind of run, each kind of install, and each refusal, and the same for each answer of the setup's own. */
async function plainAnswers(): Promise<ReadonlySet<string>> {
  const answers = new Set<string>();

  for (const typed of [PLAIN, ...Object.values(OWN_ANSWERS)]) {
    for (const by of ["screen", "call"] as const) {
      for (const run of ["check", "repair"] as const) {
        for (const nothingSet of [true, false]) {
          for (const refusal of REFUSALS) answers.add(await answerOf({ typed, by, run, nothingSet, refusal }));
        }
      }
    }
  }

  return answers;
}

/** The answers to the plain values, read once. */
const PLAIN_ANSWERS = await plainAnswers();

property(
  "whatever is typed into the three boxes, a refused run is answered byte for byte as a run with other values, so no typed value comes back",
  fc.asyncProperty(runs, async (run) => {
    expect(PLAIN_ANSWERS.has(await answerOf(run))).toBe(true);
  }),
);

// Drift: a database that is spent for the day once answered "Something went wrong.", which named nothing. Its refusal is one more answer of the setup, and it must be the one a plug's own refusal of the kind gets, with nothing typed in it.
test("a run whose token is taken while the database takes no more for the day is answered the spent allowance and when to come back, as any other typed values would be", async () => {
  const typed = { ...PLAIN, token: `${TOKEN}-of-another-shape` };
  const answers = await Promise.all((["screen", "call"] as const).map((by) => answerOf({ typed, by, run: "repair", nothingSet: false, refusal: "token" }, TAKEN, SPENT_DATABASE)));

  // The setup's clock stands at 22:13:20 UTC: 6,400 seconds before midnight.
  expect(answers.map((answer) => [answer.startsWith("[503,"), answer.includes('["retry-after","6400"]'), PLAIN_ANSWERS.has(answer)])).toEqual([
    [true, true, true],
    [true, true, true],
  ]);
});

// Control: the property would hold of a setup that refused everything.
test("a run the plug takes still answers its pieces, to the screen and to a program's call", async () => {
  const [screen, call] = [await answerOf({ typed: PLAIN, by: "screen", run: "check", nothingSet: true, refusal: "token" }, TAKEN), await answerOf({ typed: PLAIN, by: "call", run: "check", nothingSet: true, refusal: "token" }, TAKEN)];

  expect([screen.startsWith("[200,"), screen.includes('\\"piece\\":\\"DNS record\\"'), call.startsWith("[200,"), call.includes('\\"object\\":\\"DNS record\\"')]).toEqual([true, true, true, true]);
  expect([PLAIN_ANSWERS.has(screen), PLAIN_ANSWERS.has(call)]).toEqual([false, false]);
});
