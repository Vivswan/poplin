import { describe, expect, test } from "bun:test";
import { type Hostname, parseHostname } from "../src/cloudflare/hostname";
import { type DomainLayout, parseDomainLayout } from "../src/cloudflare/layout";
import { reportOf } from "../src/cloudflare/sync";
import { planWaf, rateRuleExpression, syncWaf } from "../src/cloudflare/waf";
import { refusal, reply, withFake } from "./fake-cloudflare";
import { OTHER_SUFFIX, SUFFIXED } from "./layouts";

const FREE_RATE = 'http.request.uri.path contains "/"';
const PAID_RATE = 'ends_with(http.host, "-page.example.com") or http.host eq "admin.example.com"';
const LIMIT = { characteristics: ["cf.colo.id", "ip.src"], period: 10, requests_per_period: 300, mitigation_timeout: 10 };
const SLOT_TAKEN = "the zone's plan allows no further rate rule and other rules hold every slot";
const LIMITS_OTHERS = "the Free plan's rate rule would also limit this zone's other hostnames";

const HOSTILE: readonly string[] = [
  'a".example.com',
  'www.example.com" or http.host ne "',
  "a\\.example.com",
  'a\\".example.com',
  "*.example.com",
  "a*.example.com",
  "a?.example.com",
  "{a}.example.com",
  "a b.example.com",
  "a.example.com\n",
  "a.example.com\r\nb.example.com",
  "\u00fc.example.com",
  "x\u0430.example.com",
  "a\uff0eexample.com",
  "a.example.com\u0000",
  "A.example.com",
  "a.example.com.",
  "a..example.com",
  "-a.example.com",
  "a-.example.com",
  `${"a".repeat(64)}.example.com`,
  `${"a.".repeat(130)}example.com`,
  "",
  "localhost",
];

const HOSTILE_SUFFIXES: readonly string[] = ['-page"', '-p") or (http.host ne "', "-page\\", "-page*", "-p\u00fc", "-Page", "-p e"];

function rateRule(expression: string): unknown {
  return { ref: "poplin_rate", description: "poplin: limit requests per address", expression, action: "block", enabled: true, ratelimit: LIMIT };
}

describe("rateRuleExpression", () => {
  const cases: readonly { readonly name: string; readonly layout: DomainLayout; readonly plan: "free" | "pro" | "business"; readonly expression: string }[] = [
    { name: "the Free plan, whose rate rules read the path alone", layout: SUFFIXED, plan: "free", expression: FREE_RATE },
    { name: "a paid plan", layout: SUFFIXED, plan: "pro", expression: PAID_RATE },
    {
      name: "another suffix and admin hostname on a paid plan",
      layout: OTHER_SUFFIX,
      plan: "business",
      expression: 'ends_with(http.host, "-s1-x.example.com") or http.host eq "admin.tools.example.com"',
    },
  ];

  test.each(cases)("$name: the rule counts the requests the routes send to the Worker, and on a paid plan no other", ({ layout, plan, expression }) => {
    expect(rateRuleExpression(layout, plan)).toBe(expression);
  });
});

describe("hostile text never reaches an expression", () => {
  test.each(HOSTILE)("%j is refused as a hostname, and as any hostname of a layout", (text) => {
    expect(parseHostname(text).ok).toBe(false);
    expect(parseDomainLayout({ domain: text, adminHostname: `admin.${text}`, suffix: "-page" }).ok).toBe(false);
    expect(parseDomainLayout({ domain: "example.com", adminHostname: text, suffix: "-page" }).ok).toBe(false);
  });

  test.each(HOSTILE_SUFFIXES)("%j is refused as a suffix", (suffix) => {
    expect(parseDomainLayout({ domain: "example.com", adminHostname: "admin.example.com", suffix })).toEqual({ ok: false, refusal: "bad-suffix" });
  });

  const unsafe = HOSTILE.filter((text) => !/^[a-z0-9.-]*$/.test(text));

  test.each(unsafe)("%j cast to a hostname, past the check, makes the builder throw: the text is never written into a rule", (text) => {
    const forged = text as Hostname;

    expect(() => rateRuleExpression({ ...SUFFIXED, domain: forged }, "pro")).toThrow();
    expect(() => rateRuleExpression({ ...SUFFIXED, adminHostname: forged }, "pro")).toThrow();
  });

  test.each(HOSTILE_SUFFIXES)("%j forged into a layout as its suffix makes the builder throw", (suffix) => {
    const forged = { ...SUFFIXED, suffix } as DomainLayout;

    expect(() => rateRuleExpression(forged, "pro")).toThrow();
  });
});

describe("planWaf", () => {
  const settled = { id: "set-rate", rules: [{ id: "r1", ...(rateRule(PAID_RATE) as object) }] };

  const scopes: readonly { readonly name: string; readonly plan: "free" | "pro"; readonly sharesZone: boolean; readonly step: object }[] = [
    {
      name: "the Free plan on a zone with no other hostname gets the whole-zone rule",
      plan: "free",
      sharesZone: false,
      step: { kind: "create", subject: "rate rule", rulesetId: undefined, rule: rateRule(FREE_RATE) },
    },
    {
      name: "the Free plan on a zone with other hostnames gets no rate rule, and the reason is said",
      plan: "free",
      sharesZone: true,
      step: { kind: "skip", subject: "rate rule", reason: LIMITS_OTHERS },
    },
    {
      name: "a paid plan on a zone with no other hostname gets the rule that reads the hostname",
      plan: "pro",
      sharesZone: false,
      step: { kind: "create", subject: "rate rule", rulesetId: undefined, rule: rateRule(PAID_RATE) },
    },
    {
      name: "a paid plan on a zone with other hostnames gets the same rule",
      plan: "pro",
      sharesZone: true,
      step: { kind: "create", subject: "rate rule", rulesetId: undefined, rule: rateRule(PAID_RATE) },
    },
  ];

  test.each(scopes)(
    "$name: the rate rule is the plan's one step, it never counts a hostname that is not poplin's, and it is never dropped without a word",
    ({ plan, sharesZone, step }) => {
      expect<unknown>(planWaf({ layout: SUFFIXED, plan, sharesZone }, undefined)).toEqual([step]);
    },
  );

  test("a zone with rate rules of the owner's and a free slot: poplin's rule is added to the existing ruleset and theirs are named in no step", () => {
    const current = { id: "set-rate", rules: [{ id: "r0", expression: PAID_RATE, action: "block" }] };

    expect<unknown>(planWaf({ layout: SUFFIXED, plan: "pro", sharesZone: true }, current)).toEqual([
      { kind: "create", subject: "rate rule", rulesetId: "set-rate", rule: rateRule(PAID_RATE) },
    ]);
  });

  test("a hostname added to a Free zone after setup: the whole-zone rate rule an earlier run made is removed, and that run and the next both say why there is none", () => {
    const current = { id: "set-rate", rules: [{ id: "r1", ...(rateRule(FREE_RATE) as object) }] };
    const desired = { layout: SUFFIXED, plan: "free" as const, sharesZone: true };

    expect<unknown>(planWaf(desired, current)).toEqual([
      { kind: "remove", subject: "rate rule", rulesetId: "set-rate", ruleId: "r1" },
      { kind: "skip", subject: "rate rule", reason: LIMITS_OTHERS },
    ]);
    expect<unknown>(planWaf(desired, { id: "set-rate", rules: [] })).toEqual([{ kind: "skip", subject: "rate rule", reason: LIMITS_OTHERS }]);
  });

  const slots: readonly { readonly plan: "free" | "pro" | "business"; readonly others: number; readonly taken: boolean }[] = [
    { plan: "free", others: 1, taken: true },
    { plan: "pro", others: 1, taken: false },
    { plan: "pro", others: 2, taken: true },
    { plan: "business", others: 4, taken: false },
    { plan: "business", others: 5, taken: true },
  ];

  test.each(slots)("$plan with $others rate rules of the owner's: a taken slot is a skip with its reason, never a failure", ({ plan, others, taken }) => {
    const rules = [...Array(others).keys()].map((index) => ({ id: `r${index}`, expression: "true", action: "block" }));
    const steps = planWaf({ layout: SUFFIXED, plan, sharesZone: false }, { id: "set-rate", rules });

    expect(steps).toMatchObject([
      taken ? { kind: "skip", subject: "rate rule", reason: SLOT_TAKEN } : { kind: "create", subject: "rate rule", rulesetId: "set-rate" },
    ]);
  });

  test("planned again over its own rule, with a slot now held by poplin's rule: nothing changes and the report says so", () => {
    const steps = planWaf({ layout: SUFFIXED, plan: "pro", sharesZone: true }, settled);

    expect(steps).toEqual([{ kind: "leave", subject: "rate rule" }]);
    expect(reportOf(steps).changedNothing).toBe(true);
  });

  test("a suffix change changes poplin's rule in place, by its id", () => {
    expect<unknown>(planWaf({ layout: OTHER_SUFFIX, plan: "pro", sharesZone: true }, settled)).toEqual([
      { kind: "change", subject: "rate rule", rulesetId: "set-rate", ruleId: "r1", rule: rateRule(rateRuleExpression(OTHER_SUFFIX, "pro")) },
    ]);
  });

  const edits: readonly { readonly name: string; readonly rule: object }[] = [
    { name: "switched off", rule: { enabled: false } },
    { name: "given another limit", rule: { ratelimit: { ...LIMIT, requests_per_period: 3 } } },
    { name: "given a counting expression that counts nothing", rule: { ratelimit: { ...LIMIT, counting_expression: "false" } } },
  ];

  test.each(edits)("a rule of poplin's that was $name is changed back: it would limit nothing while the report said all is well", ({ rule }) => {
    const current = { id: "set-rate", rules: [{ id: "r1", ...(rateRule(PAID_RATE) as object), ...rule }] };

    expect(planWaf({ layout: SUFFIXED, plan: "pro", sharesZone: true }, current).map((step) => step.kind)).toEqual(["change"]);
  });
});

describe("syncWaf", () => {
  test("two runs against a zone with no rate rules: the first makes the rule and its ruleset and reads no other phase, the second sends no change and reports none", async () => {
    let ruleset: { id: string; rules: unknown[] } | undefined;

    await withFake(
      (asked) => {
        if (asked.method === "GET") return ruleset === undefined ? refusal(404, 10003, "could not find entrypoint ruleset in the phase") : reply(ruleset);

        const body = asked.body as { rules: object[] };
        ruleset = { id: "set-rate", rules: body.rules.map((rule) => ({ id: "r1", ...rule })) };

        return reply(ruleset);
      },
      async (connection, asked) => {
        const desired = { layout: SUFFIXED, plan: "pro" as const, sharesZone: true };
        const first = await syncWaf(connection, "zone-1", desired);
        const sent = asked.length;
        const second = await syncWaf(connection, "zone-1", desired);

        expect(first).toMatchObject({ ok: true, report: { created: ["rate rule"], changedNothing: false } });
        expect(second).toMatchObject({ ok: true, report: { left: ["rate rule"], changedNothing: true } });
        expect(asked.map((entry) => `${entry.method} ${entry.path}`)).toEqual([
          "GET /zones/zone-1/rulesets/phases/http_ratelimit/entrypoint",
          "POST /zones/zone-1/rulesets",
          "GET /zones/zone-1/rulesets/phases/http_ratelimit/entrypoint",
        ]);
        expect(asked.slice(sent)).toHaveLength(1);
        expect(asked[1]?.body).toEqual({ kind: "zone", phase: "http_ratelimit", name: "default", rules: [rateRule(PAID_RATE)] });
      },
    );
  });

  test("a Free zone whose one slot is taken: the run succeeds, changes nothing, and the report carries the reason", async () => {
    const ruleset = { id: "set-rate", rules: [{ id: "r0", expression: "true", action: "block", ratelimit: { ...LIMIT, requests_per_period: 50 } }] };

    await withFake(
      () => reply(ruleset),
      async (connection, asked) => {
        expect(await syncWaf(connection, "zone-1", { layout: SUFFIXED, plan: "free", sharesZone: false })).toMatchObject({
          ok: true,
          report: { skipped: [{ subject: "rate rule", reason: SLOT_TAKEN }], changedNothing: true },
        });
        expect(asked.map((entry) => entry.method)).toEqual(["GET"]);
      },
    );
  });
});
