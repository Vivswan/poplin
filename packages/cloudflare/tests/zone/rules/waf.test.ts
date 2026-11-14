import { describe, expect, test } from "bun:test";
import { type Hostname, parseHostname } from "@poplin/core/src/names/hostname";
import { type DomainLayout, parseDomainLayout } from "../../../src/zone/layout";
import { reportOf } from "../../../src/zone/sync";
import { defaultRateRule, planWaf, rateRuleExpression, syncWaf } from "../../../src/zone/rules/waf";
import { refusal, reply, withFake } from "../support/fake-cloudflare";
import { OTHER_SUFFIX, SUFFIXED } from "../support/layouts";

const FREE_RATE = 'starts_with(http.request.uri.path, "/")';
const PAID_RATE = 'ends_with(http.host, "-page.example.com") or http.host eq "admin.example.com"';
const LIMIT = { characteristics: ["cf.colo.id", "ip.src"], period: 10, requests_per_period: 300, mitigation_timeout: 10 };
const SLOT_TAKEN = "the zone's plan allows no further rate rule and other rules hold every slot";
const LIMITS_OTHERS = "a rate rule that counts the whole zone would also limit this zone's other hostnames";
const NEEDS_PAID_PLAN = "a rate rule of the Free plan may read the path alone, never the hostname";
const SWITCHED_OFF = "the rate rule is set to off";

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
  return { ref: "poplin_rate", description: "poplin: 300 requests per 10 seconds per address", expression, action: "block", enabled: true, ratelimit: LIMIT };
}

describe("rateRuleExpression", () => {
  const cases: readonly { readonly name: string; readonly layout: DomainLayout; readonly rateRule: "zone" | "hostnames"; readonly expression: string }[] = [
    { name: "the whole zone, which reads the path alone", layout: SUFFIXED, rateRule: "zone", expression: FREE_RATE },
    { name: "the hostnames", layout: SUFFIXED, rateRule: "hostnames", expression: PAID_RATE },
    {
      name: "the hostnames of another suffix and admin hostname",
      layout: OTHER_SUFFIX,
      rateRule: "hostnames",
      expression: 'ends_with(http.host, "-s1-x.example.com") or http.host eq "admin.tools.example.com"',
    },
  ];

  test.each(cases)("$name: the rule counts the requests the routes send to the Worker, and as `hostnames` no other", ({ layout, rateRule, expression }) => {
    expect(rateRuleExpression(layout, rateRule)).toBe(expression);
  });
});

describe("hostile text never reaches an expression", () => {
  test.each(HOSTILE)("%j is refused as a hostname, and as any hostname of a layout", (text) => {
    expect(parseHostname(text).ok).toBe(false);
    expect(parseDomainLayout({ domain: text, admin_hostname: `admin.${text}`, suffix: "-page" }).ok).toBe(false);
    expect(parseDomainLayout({ domain: "example.com", admin_hostname: text, suffix: "-page" }).ok).toBe(false);
  });

  test.each(HOSTILE_SUFFIXES)("%j is refused as a suffix", (suffix) => {
    expect(parseDomainLayout({ domain: "example.com", admin_hostname: "admin.example.com", suffix })).toEqual({ ok: false, refusal: "bad-suffix" });
  });

  const unsafe = HOSTILE.filter((text) => !/^[a-z0-9.-]*$/.test(text));

  test.each(unsafe)("%j cast to a hostname, past the check, makes the builder throw: the text is never written into a rule", (text) => {
    const forged = text as Hostname;

    expect(() => rateRuleExpression({ ...SUFFIXED, domain: forged }, "hostnames")).toThrow();
    expect(() => rateRuleExpression({ ...SUFFIXED, adminHostname: forged }, "hostnames")).toThrow();
  });

  test.each(HOSTILE_SUFFIXES)("%j forged into a layout as its suffix makes the builder throw", (suffix) => {
    const forged = { ...SUFFIXED, suffix } as DomainLayout;

    expect(() => rateRuleExpression(forged, "hostnames")).toThrow();
  });
});

describe("defaultRateRule", () => {
  test.each([
    ["free", "zone"],
    ["pro", "hostnames"],
    ["business", "hostnames"],
    ["enterprise", "hostnames"],
  ] as const)("on the %s plan a caller that has not chosen is offered %s: the Free plan refuses a rate rule that reads the hostname", (plan, rateRule) => {
    expect(defaultRateRule(plan)).toBe(rateRule);
  });
});

describe("planWaf follows the choice, and the plan only checks it", () => {
  const settledZone = { id: "set-rate", rules: [{ id: "r1", ...(rateRule(FREE_RATE) as object) }] };
  const settledHostnames = { id: "set-rate", rules: [{ id: "r1", ...(rateRule(PAID_RATE) as object) }] };

  const choices: readonly { readonly name: string; readonly desired: object; readonly current: object | undefined; readonly steps: readonly object[] }[] = [
    {
      name: "the whole zone on a paid plan, over the rule the OpenTofu module's default made: it is left, never rewritten to the hostnames",
      desired: { plan: "pro", sharesZone: false, rateRule: "zone" },
      current: settledZone,
      steps: [{ kind: "leave", subject: "rate rule" }],
    },
    {
      name: "the whole zone on a paid plan whose zone has hostnames of its own: skipped, as the module refuses it",
      desired: { plan: "pro", sharesZone: true, rateRule: "zone" },
      current: undefined,
      steps: [{ kind: "skip", subject: "rate rule", reason: LIMITS_OTHERS }],
    },
    {
      name: "the whole zone on a zone with hostnames of its own, over a rule that reads the hostnames: skipped, and that rule stays, as the module refuses the input and removes nothing",
      desired: { plan: "pro", sharesZone: true, rateRule: "zone" },
      current: settledHostnames,
      steps: [{ kind: "skip", subject: "rate rule", reason: LIMITS_OTHERS }],
    },
    {
      name: "the hostnames on the Free plan over the whole-zone rule: skipped, and the rule that limits the zone stays",
      desired: { plan: "free", sharesZone: false, rateRule: "hostnames" },
      current: settledZone,
      steps: [{ kind: "skip", subject: "rate rule", reason: NEEDS_PAID_PLAN }],
    },
    {
      name: "the hostnames on the Free plan: skipped with the reason, and no request Cloudflare would refuse is planned",
      desired: { plan: "free", sharesZone: false, rateRule: "hostnames" },
      current: undefined,
      steps: [{ kind: "skip", subject: "rate rule", reason: NEEDS_PAID_PLAN }],
    },
    {
      name: "off on a zone with no rule",
      desired: { plan: "pro", sharesZone: false, rateRule: "off" },
      current: undefined,
      steps: [{ kind: "skip", subject: "rate rule", reason: SWITCHED_OFF }],
    },
    {
      name: "off over the rule an earlier run made: the rule is removed by its id, and the reason is said",
      desired: { plan: "free", sharesZone: false, rateRule: "off" },
      current: settledZone,
      steps: [
        { kind: "remove", subject: "rate rule", rulesetId: "set-rate", ruleId: "r1" },
        { kind: "skip", subject: "rate rule", reason: SWITCHED_OFF },
      ],
    },
  ];

  test.each(choices)("$name", ({ desired, current, steps }) => {
    expect<unknown>(planWaf({ layout: SUFFIXED, ...desired } as Parameters<typeof planWaf>[0], current as Parameters<typeof planWaf>[1])).toEqual(steps);
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
      expect<unknown>(planWaf({ layout: SUFFIXED, plan, sharesZone, rateRule: defaultRateRule(plan) }, undefined)).toEqual([step]);
    },
  );

  test("a zone with rate rules of the owner's and a free slot: poplin's rule is added to the existing ruleset and theirs are named in no step", () => {
    const current = { id: "set-rate", rules: [{ id: "r0", expression: PAID_RATE, action: "block" }] };

    expect<unknown>(planWaf({ layout: SUFFIXED, plan: "pro", sharesZone: true, rateRule: "hostnames" }, current)).toEqual([
      { kind: "create", subject: "rate rule", rulesetId: "set-rate", rule: rateRule(PAID_RATE) },
    ]);
  });

  test("a hostname added to a Free zone after setup: the whole-zone rate rule an earlier run made is removed, and that run and the next both say why there is none", () => {
    const current = { id: "set-rate", rules: [{ id: "r1", ...(rateRule(FREE_RATE) as object) }] };
    const desired = { layout: SUFFIXED, plan: "free", sharesZone: true, rateRule: "zone" } as const;

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
    const steps = planWaf({ layout: SUFFIXED, plan, sharesZone: false, rateRule: defaultRateRule(plan) }, { id: "set-rate", rules });

    expect(steps).toMatchObject([
      taken ? { kind: "skip", subject: "rate rule", reason: SLOT_TAKEN } : { kind: "create", subject: "rate rule", rulesetId: "set-rate" },
    ]);
  });

  test("planned again over its own rule, with a slot now held by poplin's rule: nothing changes and the report says so", () => {
    const steps = planWaf({ layout: SUFFIXED, plan: "pro", sharesZone: true, rateRule: "hostnames" }, settled);

    expect(steps).toEqual([{ kind: "leave", subject: "rate rule" }]);
    expect(reportOf(steps).changedNothing).toBe(true);
  });

  test("a suffix change changes poplin's rule in place, by its id", () => {
    expect<unknown>(planWaf({ layout: OTHER_SUFFIX, plan: "pro", sharesZone: true, rateRule: "hostnames" }, settled)).toEqual([
      { kind: "change", subject: "rate rule", rulesetId: "set-rate", ruleId: "r1", rule: rateRule(rateRuleExpression(OTHER_SUFFIX, "hostnames")) },
    ]);
  });

  const edits: readonly { readonly name: string; readonly rule: object }[] = [
    { name: "switched off", rule: { enabled: false } },
    { name: "given another limit", rule: { ratelimit: { ...LIMIT, requests_per_period: 3 } } },
    { name: "given a counting expression that counts nothing", rule: { ratelimit: { ...LIMIT, counting_expression: "false" } } },
  ];

  test.each(edits)("a rule of poplin's that was $name is changed back: it would limit nothing while the report said all is well", ({ rule }) => {
    const current = { id: "set-rate", rules: [{ id: "r1", ...(rateRule(PAID_RATE) as object), ...rule }] };

    expect(planWaf({ layout: SUFFIXED, plan: "pro", sharesZone: true, rateRule: "hostnames" }, current).map((step) => step.kind)).toEqual(["change"]);
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
        const desired = { layout: SUFFIXED, plan: "pro", sharesZone: true, rateRule: "hostnames" } as const;
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
        expect(asked[1]?.body).toEqual({ kind: "zone", phase: "http_ratelimit", name: "poplin rate rule", rules: [rateRule(PAID_RATE)] });
      },
    );
  });

  test("a Free zone whose one slot is taken: the run succeeds, changes nothing, and the report carries the reason", async () => {
    const ruleset = { id: "set-rate", rules: [{ id: "r0", expression: "true", action: "block", ratelimit: { ...LIMIT, requests_per_period: 50 } }] };

    await withFake(
      () => reply(ruleset),
      async (connection, asked) => {
        expect(await syncWaf(connection, "zone-1", { layout: SUFFIXED, plan: "free", sharesZone: false, rateRule: "zone" })).toMatchObject({
          ok: true,
          report: { skipped: [{ subject: "rate rule", reason: SLOT_TAKEN }], changedNothing: true },
        });
        expect(asked.map((entry) => entry.method)).toEqual(["GET"]);
      },
    );
  });
});
