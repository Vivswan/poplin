import { describe, expect, test } from "bun:test";
import { type Hostname, parseHostname } from "../src/cloudflare/hostname";
import { type DomainLayout, parseDomainLayout } from "../src/cloudflare/layout";
import { reportOf } from "../src/cloudflare/sync";
import { hostRuleExpression, planWaf, rateRuleExpression, syncWaf } from "../src/cloudflare/waf";
import { refusal, reply, withFake } from "./fake-cloudflare";
import { BARE_GALLERY, hostOf, NO_GALLERY, NO_PREFIX, PER_SITE, PREFIXED, WILDCARD } from "./layouts";

const WWW = hostOf("www.example.com");
const MAIL = hostOf("mail.example.com");
const UNDER_DOMAIN = 'ends_with(http.host, ".example.com")';
const PREFIXED_SITES = `${UNDER_DOMAIN} and starts_with(http.host, "page-")`;
const SUBDOMAIN_SITES = 'ends_with(http.host, ".pages.example.com")';
const FREE_RATE = 'http.request.uri.path contains "/"';
const LIMIT = { characteristics: ["cf.colo.id", "ip.src"], period: 10, requests_per_period: 300, mitigation_timeout: 10 };
const CUSTOM_PHASE = "http_request_firewall_custom";
const RATE_PHASE = "http_ratelimit";
const SLOT_TAKEN = "the zone's plan allows no further rate rule and other rules hold every slot";
const LIMITS_OTHERS = "the Free plan's rate rule would also limit this zone's other hostnames";
const TOO_LONG = "the zone's other hostnames do not fit in one rule expression";
const CANNOT_TELL = "no prefix sets a site apart from a made-up hostname, so the rule would block nothing";

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

const HOSTILE_PREFIXES: readonly string[] = [
  'page-"',
  'p") or (http.host ne "',
  "page\\",
  "page*",
  "p\u00fc-",
  "Page-",
  "-page",
  "page.",
  "p ",
  "a".repeat(10),
];

function hostRule(expression: string): unknown {
  return { ref: "poplin_host", description: "poplin: block hostnames that are no site", expression, action: "block", enabled: true };
}

function rateRule(expression: string): unknown {
  return { ref: "poplin_rate", description: "poplin: limit requests per address", expression, action: "block", enabled: true, ratelimit: LIMIT };
}

describe("hostRuleExpression", () => {
  const cases: readonly {
    readonly name: string;
    readonly layout: DomainLayout;
    readonly listed: readonly Hostname[];
    readonly expression: string | undefined;
  }[] = [
    {
      name: "domain",
      layout: PREFIXED,
      listed: [WWW, MAIL, WWW],
      expression: `${UNDER_DOMAIN} and not (${PREFIXED_SITES}) and not http.host in {"admin.example.com" "mail.example.com" "pages.example.com" "www.example.com"}`,
    },
    {
      name: "domain, gallery off, an empty list",
      layout: NO_GALLERY,
      listed: [],
      expression: `${UNDER_DOMAIN} and not (${PREFIXED_SITES}) and not http.host in {"admin.example.com"}`,
    },
    {
      name: "domain, gallery on the bare domain",
      layout: BARE_GALLERY,
      listed: [WWW],
      expression: `${UNDER_DOMAIN} and not (${PREFIXED_SITES}) and not http.host in {"admin.example.com" "example.com" "www.example.com"}`,
    },
    {
      name: "subdomain-per-site",
      layout: PER_SITE,
      listed: [WWW],
      expression: `${UNDER_DOMAIN} and not (${SUBDOMAIN_SITES}) and not http.host in {"admin.example.com" "pages.example.com" "www.example.com"}`,
    },
    {
      name: "subdomain-wildcard",
      layout: WILDCARD,
      listed: [],
      expression: `${UNDER_DOMAIN} and not (${SUBDOMAIN_SITES}) and not http.host in {"admin.example.com" "pages.example.com"}`,
    },
    { name: "domain with an empty prefix", layout: NO_PREFIX, listed: [WWW], expression: undefined },
  ];

  test.each(cases)("$name: the rule blocks every hostname under the domain but the sites, the Worker's own, and the list", ({ layout, listed, expression }) => {
    expect(hostRuleExpression(layout, listed)).toBe(expression);
  });
});

describe("rateRuleExpression", () => {
  const cases: readonly {
    readonly name: string;
    readonly layout: DomainLayout;
    readonly listed: readonly Hostname[];
    readonly plan: "free" | "pro";
    readonly expression: string;
  }[] = [
    { name: "the Free plan, whose rate rules read the path alone", layout: PREFIXED, listed: [WWW], plan: "free", expression: FREE_RATE },
    {
      name: "domain on a paid plan",
      layout: PREFIXED,
      listed: [WWW],
      plan: "pro",
      expression: `((${PREFIXED_SITES}) or http.host in {"admin.example.com" "pages.example.com"}) and not http.host in {"www.example.com"}`,
    },
    {
      name: "domain with an empty prefix and an empty list",
      layout: NO_PREFIX,
      listed: [],
      plan: "pro",
      expression: `(${UNDER_DOMAIN}) or http.host in {"admin.example.com" "pages.example.com"}`,
    },
    {
      name: "a subdomain layout",
      layout: PER_SITE,
      listed: [],
      plan: "pro",
      expression: `(${SUBDOMAIN_SITES}) or http.host in {"admin.example.com" "pages.example.com"}`,
    },
  ];

  test.each(cases)("$name: the rule counts the requests the Worker answers", ({ layout, listed, plan, expression }) => {
    expect(rateRuleExpression(layout, listed, plan)).toBe(expression);
  });
});

describe("hostile text never reaches an expression", () => {
  test.each(HOSTILE)("%j is refused as a hostname, and as any hostname of a layout", (text) => {
    expect(parseHostname(text).ok).toBe(false);
    expect(parseDomainLayout({ names: "domain", domain: text, adminHostname: `admin.${text}`, pagesHostname: undefined, prefix: "page-" }).ok).toBe(false);
    expect(parseDomainLayout({ names: "domain", domain: "example.com", adminHostname: text, pagesHostname: undefined, prefix: "page-" }).ok).toBe(false);
    expect(parseDomainLayout({ names: "domain", domain: "example.com", adminHostname: "admin.example.com", pagesHostname: text, prefix: "page-" }).ok).toBe(
      false,
    );
  });

  test.each(HOSTILE_PREFIXES)("%j is refused as a prefix", (prefix) => {
    expect(parseDomainLayout({ names: "domain", domain: "example.com", adminHostname: "admin.example.com", pagesHostname: undefined, prefix })).toEqual({
      ok: false,
      refusal: "bad-prefix",
    });
  });

  const unsafe = HOSTILE.filter((text) => !/^[a-z0-9.-]*$/.test(text));

  test.each(unsafe)("%j cast to a hostname, past the check, makes both builders throw: the text is never written into a rule", (text) => {
    const forged = text as Hostname;

    expect(() => hostRuleExpression(PREFIXED, [forged])).toThrow();
    expect(() => rateRuleExpression(PREFIXED, [forged], "pro")).toThrow();
    expect(() => hostRuleExpression({ ...PREFIXED, domain: forged }, [])).toThrow();
    expect(() => rateRuleExpression({ ...PER_SITE, pagesHostname: forged }, [], "pro")).toThrow();
  });

  test.each(HOSTILE_PREFIXES.filter((prefix) => !/^[a-z0-9.-]+$/.test(prefix)))("%j forged into a layout as its prefix makes both builders throw", (prefix) => {
    const forged = { ...PREFIXED, prefix } as DomainLayout;

    expect(() => hostRuleExpression(forged, [])).toThrow();
    expect<unknown>(() => rateRuleExpression(forged, [], "pro")).toThrow();
  });
});

describe("planWaf", () => {
  const hostExpression = hostRuleExpression(PREFIXED, [WWW]) ?? "";
  const paidRate = rateRuleExpression(PREFIXED, [WWW], "pro");
  const none = { custom: undefined, rate: undefined };
  const settled = {
    custom: {
      id: "set-custom",
      rules: [
        { id: "c0", description: "the owner's own rule", expression: "ip.src eq 192.0.2.7", action: "block" },
        { id: "c1", ...(hostRule(hostExpression) as object) },
      ],
    },
    rate: { id: "set-rate", rules: [{ id: "r1", ...(rateRule(paidRate) as object) }] },
  };

  test("a zone with no rules in either phase: both rules are created, each making its phase's ruleset", () => {
    expect<unknown>(planWaf({ layout: PREFIXED, listed: [WWW], plan: "pro" }, none)).toEqual([
      { kind: "create", subject: "host rule", phase: CUSTOM_PHASE, rulesetId: undefined, rule: hostRule(hostExpression) },
      { kind: "create", subject: "rate rule", phase: RATE_PHASE, rulesetId: undefined, rule: rateRule(paidRate) },
    ]);
  });

  test("a zone with the owner's own custom rules: poplin's rule is added to the existing ruleset and theirs are named in no step", () => {
    const current = { custom: { id: "set-custom", rules: [{ id: "c0", expression: hostExpression, action: "block" }] }, rate: undefined };

    expect<unknown>(planWaf({ layout: PREFIXED, listed: [WWW], plan: "pro" }, current)[0]).toEqual({
      kind: "create",
      subject: "host rule",
      phase: CUSTOM_PHASE,
      rulesetId: "set-custom",
      rule: hostRule(hostExpression),
    });
  });

  const scopes: readonly { readonly name: string; readonly plan: "free" | "pro"; readonly listed: readonly Hostname[]; readonly step: object }[] = [
    {
      name: "the Free plan on a zone with no other hostname gets the whole-zone rule",
      plan: "free",
      listed: [],
      step: { kind: "create", subject: "rate rule", phase: RATE_PHASE, rulesetId: undefined, rule: rateRule(FREE_RATE) },
    },
    {
      name: "the Free plan on a zone with other hostnames gets no rate rule, and the reason is said",
      plan: "free",
      listed: [WWW],
      step: { kind: "skip", subject: "rate rule", reason: LIMITS_OTHERS },
    },
    {
      name: "a paid plan on a zone with other hostnames gets a rule that reads the hostname",
      plan: "pro",
      listed: [WWW],
      step: { kind: "create", subject: "rate rule", phase: RATE_PHASE, rulesetId: undefined, rule: rateRule(paidRate) },
    },
  ];

  test.each(scopes)("$name: poplin's rate rule never counts requests to a hostname that is not its own", ({ plan, listed, step }) => {
    expect<unknown>(planWaf({ layout: PREFIXED, listed, plan }, none)[1]).toEqual(step);
  });

  test("a hostname added to a Free zone after setup: the whole-zone rate rule an earlier run made is removed", () => {
    const current = { custom: undefined, rate: { id: "set-rate", rules: [{ id: "r1", ...(rateRule(FREE_RATE) as object) }] } };

    expect<unknown>(planWaf({ layout: PREFIXED, listed: [WWW], plan: "free" }, current)[1]).toEqual({
      kind: "remove",
      subject: "rate rule",
      rulesetId: "set-rate",
      ruleId: "r1",
    });
  });

  const slots: readonly { readonly plan: "free" | "pro" | "business"; readonly others: number; readonly taken: boolean }[] = [
    { plan: "free", others: 1, taken: true },
    { plan: "pro", others: 1, taken: false },
    { plan: "pro", others: 2, taken: true },
    { plan: "business", others: 4, taken: false },
    { plan: "business", others: 5, taken: true },
  ];

  test.each(slots)(
    "$plan with $others rate rules of the owner's: a taken slot is a plain skip beside the host rule, never a failure",
    ({ plan, others, taken }) => {
      const rules = [...Array(others).keys()].map((index) => ({ id: `r${index}`, expression: "true", action: "block" }));
      const steps = planWaf({ layout: PREFIXED, listed: [], plan }, { custom: undefined, rate: { id: "set-rate", rules } });

      expect(steps[0]?.kind).toBe("create");
      expect(steps[1]).toMatchObject(
        taken ? { kind: "skip", subject: "rate rule", reason: SLOT_TAKEN } : { kind: "create", subject: "rate rule", rulesetId: "set-rate" },
      );
    },
  );

  test("an empty prefix: the host rule is not created and the reason is said, the rate rule still is", () => {
    expect<unknown>(planWaf({ layout: NO_PREFIX, listed: [], plan: "free" }, none)).toEqual([
      { kind: "skip", subject: "host rule", reason: CANNOT_TELL },
      { kind: "create", subject: "rate rule", phase: RATE_PHASE, rulesetId: undefined, rule: rateRule(FREE_RATE) },
    ]);
  });

  test("a prefix emptied after setup: the host rule an earlier run made is removed, since it would go on blocking sites", () => {
    expect<unknown>(planWaf({ layout: NO_PREFIX, listed: [WWW], plan: "pro" }, settled)).toEqual([
      { kind: "remove", subject: "host rule", rulesetId: "set-custom", ruleId: "c1" },
      { kind: "change", subject: "rate rule", rulesetId: "set-rate", ruleId: "r1", rule: rateRule(rateRuleExpression(NO_PREFIX, [WWW], "pro")) },
    ]);
  });

  test("planned again over its own rules, with a slot now held by poplin's rule: nothing changes and the report says so", () => {
    const steps = planWaf({ layout: PREFIXED, listed: [WWW], plan: "pro" }, settled);

    expect(steps).toEqual([
      { kind: "leave", subject: "host rule" },
      { kind: "leave", subject: "rate rule" },
    ]);
    expect(reportOf(steps).changedNothing).toBe(true);
  });

  test("a hostname added to the list changes both of poplin's rules in place, by their ids", () => {
    expect<unknown>(planWaf({ layout: PREFIXED, listed: [WWW, MAIL], plan: "pro" }, settled)).toEqual([
      { kind: "change", subject: "host rule", rulesetId: "set-custom", ruleId: "c1", rule: hostRule(hostRuleExpression(PREFIXED, [WWW, MAIL]) ?? "") },
      { kind: "change", subject: "rate rule", rulesetId: "set-rate", ruleId: "r1", rule: rateRule(rateRuleExpression(PREFIXED, [WWW, MAIL], "pro")) },
    ]);
  });

  test("a rule of poplin's that was switched off, or given another limit or a counting expression that counts nothing, is changed back", () => {
    const edited = {
      custom: { id: "set-custom", rules: [{ id: "c1", ...(hostRule(hostExpression) as object), enabled: false }] },
      rate: { id: "set-rate", rules: [{ id: "r1", ...(rateRule(paidRate) as object), ratelimit: { ...LIMIT, requests_per_period: 3 } }] },
    };

    const uncounted = {
      ...edited,
      rate: { id: "set-rate", rules: [{ id: "r1", ...(rateRule(paidRate) as object), ratelimit: { ...LIMIT, counting_expression: "false" } }] },
    };

    expect(planWaf({ layout: PREFIXED, listed: [WWW], plan: "pro" }, edited).map((step) => step.kind)).toEqual(["change", "change"]);
    expect(planWaf({ layout: PREFIXED, listed: [WWW], plan: "pro" }, uncounted).map((step) => step.kind)).toEqual(["change", "change"]);
  });

  test("a list too long for one expression: the host rule is skipped with the reason rather than sent to be refused", () => {
    const listed = [...Array(200).keys()].map((index) => hostOf(`a-long-hostname-number-${index}.example.com`));

    expect(planWaf({ layout: PREFIXED, listed, plan: "pro" }, none)).toEqual([
      { kind: "skip", subject: "host rule", reason: TOO_LONG },
      { kind: "skip", subject: "rate rule", reason: TOO_LONG },
    ]);
  });
});

describe("syncWaf", () => {
  test("two runs against a zone whose rate slot is taken: the first makes the host rule alone, the second sends no change and reports none", async () => {
    const rulesets: Record<string, { id: string; rules: unknown[] } | undefined> = {
      [CUSTOM_PHASE]: undefined,
      [RATE_PHASE]: { id: "set-rate", rules: [{ id: "r0", expression: "true", action: "block", ratelimit: { ...LIMIT, requests_per_period: 50 } }] },
    };

    await withFake(
      (asked) => {
        const phase = asked.path.split("/").at(-2) ?? "";

        if (asked.method === "GET")
          return rulesets[phase] === undefined ? refusal(404, 10003, "could not find entrypoint ruleset in the phase") : reply(rulesets[phase]);

        const body = asked.body as { phase: string; rules: object[] };
        rulesets[body.phase] = { id: "set-custom", rules: body.rules.map((rule) => ({ id: "c1", ...rule })) };

        return reply(rulesets[body.phase]);
      },
      async (connection, asked) => {
        const desired = { layout: PREFIXED, listed: [], plan: "free" as const };
        const first = await syncWaf(connection, "zone-1", desired);
        const sent = asked.length;
        const second = await syncWaf(connection, "zone-1", desired);

        expect(first).toMatchObject({
          ok: true,
          report: { created: ["host rule"], skipped: [{ subject: "rate rule", reason: SLOT_TAKEN }], changedNothing: false },
        });
        expect(second).toMatchObject({
          ok: true,
          report: { left: ["host rule"], skipped: [{ subject: "rate rule", reason: SLOT_TAKEN }], changedNothing: true },
        });
        expect(asked.slice(sent).map((entry) => entry.method)).toEqual(["GET", "GET"]);
        expect(asked.find((entry) => entry.method === "POST")).toMatchObject({
          path: "/zones/zone-1/rulesets",
          body: { kind: "zone", phase: CUSTOM_PHASE, rules: [hostRule(hostRuleExpression(PREFIXED, []) ?? "")] },
        });
        expect(rulesets[RATE_PHASE]?.rules).toHaveLength(1);
      },
    );
  });
});
