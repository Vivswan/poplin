// Anyone can type anything into the three boxes of the setup page, the token's among them, and send it by the form or by a program's call.
// Whatever is typed, a refused run answers as if something else had been typed: nothing of it is in the body, a header, or a redirect.

import { expect, test } from "bun:test";
import fc from "fast-check";

import type { DomainReading } from "../../packages/app/src/dashboard/domain/records";
import { createSetup } from "../../packages/app/src/dashboard/domain/setup";
import { MemoryCounters } from "../../packages/app/src/limits/memory-counters";
import { fakePlug, firstRunOf } from "../../packages/app/tests/dashboard/domain/support/fake-plug";
import { formHeadersOf } from "../../packages/app/tests/dashboard/support/browser";
import { CSRF_SECRET, ORIGIN } from "../../packages/app/tests/dashboard/support/install";
import { fuzzTarget } from "./config";
import { hostile } from "./hostile";

/** A token in the form a provider takes one. */
const TOKEN = "planted-token-0123456789-abcdefghij";

/** The refusals a plug answers a run with. */
const PLUG_REFUSALS = ["token", "unreachable", "no_domain", "not_set_up"] as const;

/** The values no run of the property types: the answers to them are what every refused answer is held to. */
const PLAIN = { domain: "example.com", login: "owner@example.com", token: TOKEN };

/** A database every use of which fails the run: a refused run reads and writes none. */
const NO_DATABASE = new Proxy({}, { get: (_target, name) => () => Promise.reject(new Error(`the database was asked for ${String(name)}`)) }) as Parameters<typeof createSetup>[0]["install"]["database"];

/** One run: what is typed into the three boxes, how it is sent, whether it reads or changes, on which kind of install, and what the plug answers a run that reaches it. */
interface Run {
  readonly typed: { readonly domain: string; readonly login: string; readonly token: string };
  readonly by: "form" | "call";
  readonly run: "check" | "repair";
  readonly nothingSet: boolean;
  readonly refusal: (typeof PLUG_REFUSALS)[number];
}

/** The property of this file, under the budget every fuzz file shares. */
const property = fuzzTarget(import.meta.file);

/** Text for one box: noise, markup, a token, a domain or an email with edits, each also padded or in other capitals. */
const box = fc.oneof(
  fc.string(),
  fc.constantFrom(TOKEN, ` ${TOKEN} `, TOKEN.toUpperCase(), `${TOKEN}.example.com`, `${TOKEN}@example.com`, '"><script>alert(1)</script>', "' onfocus='alert(1)", "<b>bold</b>.example", "Example.COM", "Owner@Example.com"),
  hostile(fc.constantFrom(TOKEN, "example.com", "owner@example.com")),
);

/** Any run: any text in each box, sent either way, on either kind of install. */
const runs: fc.Arbitrary<Run> = fc.record({
  typed: fc.record({ domain: box, login: box, token: box }),
  by: fc.constantFrom("form", "call"),
  run: fc.constantFrom("check", "repair"),
  nothingSet: fc.boolean(),
  refusal: fc.constantFrom(...PLUG_REFUSALS),
});

/** Send one run to a setup page of its own, and answer everything the page sent back, the page's own random parts taken out. */
async function answerOf(run: Run, answer: DomainReading = { ok: false, refusal: run.refusal }): Promise<string> {
  const plug = fakePlug(() => answer);
  const setup = createSetup({
    install: { database: NO_DATABASE, now: () => 1_700_000_000_000 },
    domain: run.nothingSet ? firstRunOf(plug) : plug,
    open: async () => true,
    counters: new MemoryCounters(),
    visitorOf: async () => "203.0.113.7",
    csrfSecret: CSRF_SECRET,
  });
  const page = await setup.fetch(new Request(`${ORIGIN}/setup`));
  const csrf = /name="csrf" value="([^"]+)"/.exec(await page.clone().text())?.[1] ?? "";
  const request =
    run.by === "form"
      ? new Request(`${ORIGIN}/setup/${run.run}`, { method: "POST", headers: formHeadersOf(page, ORIGIN), body: new URLSearchParams({ csrf, ...run.typed }).toString() })
      : new Request(`${ORIGIN}/setup/api/${run.run}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(run.typed) });
  const answered = await setup.fetch(request);
  const headers = [...answered.headers].map(([name, value]) => [name, value.replace(/'nonce-[^']+'/, "nonce")]);
  const body = (await answered.text()).replace(/name="csrf" value="[^"]+"/, "csrf").replace(/<style nonce="[^"]+">/, "<style>");

  return JSON.stringify([answered.status, headers, body]);
}

/** Every answer a refused run may get: the answers to the plain values, for each way to send, each kind of run, each kind of install, and each refusal, a mistyped box included. */
async function plainAnswers(): Promise<ReadonlySet<string>> {
  const answers = new Set<string>();

  for (const by of ["form", "call"] as const) {
    for (const run of ["check", "repair"] as const) {
      for (const nothingSet of [true, false]) {
        for (const refusal of PLUG_REFUSALS) answers.add(await answerOf({ typed: PLAIN, by, run, nothingSet, refusal }));
      }

      answers.add(await answerOf({ typed: { ...PLAIN, login: "nobody" }, by, run, nothingSet: true, refusal: "token" }));
      answers.add(await answerOf({ typed: { ...PLAIN, domain: "nowhere" }, by, run, nothingSet: true, refusal: "token" }));
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

// Control: the property would hold of a page that refused everything.
test("a run the plug takes still shows its table, by the form and by a program's call", async () => {
  const taken: DomainReading = { ok: true, rows: [{ object: "DNS record", state: "present", detail: "poplin.example.com" }], steps: [] };
  const [form, call] = [await answerOf({ typed: PLAIN, by: "form", run: "check", nothingSet: true, refusal: "token" }, taken), await answerOf({ typed: PLAIN, by: "call", run: "check", nothingSet: true, refusal: "token" }, taken)];

  expect([form.startsWith("[200,"), form.includes("<td>DNS record</td>"), call.startsWith("[200,"), call.includes('\\"object\\":\\"DNS record\\"')]).toEqual([true, true, true, true]);
  // A refusal reads the same for a check and a repair, and a call the same on both kinds of install: the forty plain runs make sixteen answers.
  expect([PLAIN_ANSWERS.has(form), PLAIN_ANSWERS.has(call), PLAIN_ANSWERS.size]).toEqual([false, false, 16]);
});
