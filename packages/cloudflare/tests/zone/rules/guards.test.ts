import { describe, expect, test } from "bun:test";
import type { ZonePlan } from "../../../src/zone/client";
import { botsExpression, outsidePagesExpression, planGuards, syncGuards } from "../../../src/zone/rules/guards";
import type { DomainLayout } from "../../../src/zone/layout";
import type { RuleBody } from "../../../src/zone/rules/rules";
import { reportOf } from "../../../src/zone/sync";
import { refusal, reply, withFake } from "../support/fake-cloudflare";
import { LAYOUT } from "../support/layouts";

const OUTSIDE =
  'ends_with(http.host, "-poplin.example.com") and any(http.request.headers["sec-fetch-site"][*] eq "cross-site") and any(http.request.headers["sec-fetch-dest"][*] ne "document")';
const BOTS = 'ends_with(http.host, "-poplin.example.com") and cf.client.bot';
const BOTS_BUT_SEARCH = 'ends_with(http.host, "-poplin.example.com") and cf.client.bot and cf.verified_bot_category ne "Search Engine Crawler"';
const SLOTS_FULL = "the zone's plan allows no further custom rule and other rules hold every slot";
const BLOCKING = { layout: LAYOUT, plan: "free", outsidePages: "blocked", searchEnginesAllowed: false } as const;

function outsideRule(expression: string = OUTSIDE): RuleBody {
  return { ref: "poplin_outside_pages", description: "poplin: stop pages of other domains", expression, action: "block", enabled: true };
}

function botsRule(expression: string = BOTS): RuleBody {
  return { ref: "poplin_bots", description: "poplin: stop verified bots", expression, action: "block", enabled: true };
}

function ownersRules(count: number): { id: string; expression: string; action: string }[] {
  return [...Array(count).keys()].map((index) => ({ id: `theirs${index}`, expression: 'http.host eq "www.example.com"', action: "block" }));
}

describe("the guard expressions", () => {
  test("the outside pages rule reads the site hostnames alone and lets through a request that lacks either Fetch Metadata header and a cross-site one for a document: a typed address or a followed link is never blocked", () => {
    expect(outsidePagesExpression(LAYOUT)).toBe(OUTSIDE);
  });

  const bots: readonly { readonly name: string; readonly searchEnginesAllowed: boolean; readonly expression: string }[] = [
    { name: "search engines stopped", searchEnginesAllowed: false, expression: BOTS },
    { name: "search engines let through", searchEnginesAllowed: true, expression: BOTS_BUT_SEARCH },
  ];

  test.each(bots)(
    "the bots rule with $name reads the site hostnames alone, never the dashboard's or the zone's own",
    ({ searchEnginesAllowed, expression }) => {
      expect(botsExpression(LAYOUT, searchEnginesAllowed)).toBe(expression);
    },
  );

  test("a domain forged into a layout makes both builders throw: the text is never written into a rule", () => {
    const forged = { ...LAYOUT, domain: 'example.com") or (http.host ne "' } as unknown as DomainLayout;

    expect(() => outsidePagesExpression(forged)).toThrow();
    expect(() => botsExpression(forged, false)).toThrow();
  });
});

describe("planGuards", () => {
  const settings: readonly {
    readonly plan: ZonePlan;
    readonly outsidePages: "blocked" | "allowed";
    readonly searchEnginesAllowed: boolean;
    readonly rules: readonly RuleBody[];
  }[] = [
    { plan: "free", outsidePages: "blocked", searchEnginesAllowed: false, rules: [outsideRule(), botsRule()] },
    { plan: "free", outsidePages: "blocked", searchEnginesAllowed: true, rules: [outsideRule(), botsRule(BOTS_BUT_SEARCH)] },
    { plan: "free", outsidePages: "allowed", searchEnginesAllowed: false, rules: [botsRule()] },
    { plan: "free", outsidePages: "allowed", searchEnginesAllowed: true, rules: [botsRule(BOTS_BUT_SEARCH)] },
    { plan: "pro", outsidePages: "blocked", searchEnginesAllowed: false, rules: [outsideRule(), botsRule()] },
    { plan: "pro", outsidePages: "allowed", searchEnginesAllowed: true, rules: [botsRule(BOTS_BUT_SEARCH)] },
  ];

  test.each(settings)(
    "$plan, outside pages $outsidePages, search engines allowed $searchEnginesAllowed, on a zone with no custom rule: the settings alone choose the rules, since each reads only the site hostnames",
    ({ rules, ...desired }) => {
      const steps = planGuards({ layout: LAYOUT, ...desired }, undefined);

      expect<unknown>(steps.map((step) => ("rule" in step ? step.rule : step))).toEqual([...rules]);
      expect(steps.map((step) => step.kind)).toEqual(rules.map(() => "create"));
    },
  );

  test("a zone with custom rules of the owner's: poplin's rules are added to the existing ruleset and theirs are named in no step", () => {
    expect<unknown>(planGuards(BLOCKING, { id: "set-custom", rules: ownersRules(3) })).toEqual([
      { kind: "create", subject: "outside pages rule", rulesetId: "set-custom", rule: outsideRule() },
      { kind: "create", subject: "bots rule", rulesetId: "set-custom", rule: botsRule() },
    ]);
  });

  test("planned again over its own rules on a full Free zone: they count as held, nothing changes, and the report says so", () => {
    const current = { id: "set-custom", rules: [...ownersRules(3), { id: "o1", ...outsideRule() }, { id: "b1", ...botsRule() }] };
    const steps = planGuards(BLOCKING, current);

    expect(steps).toEqual([
      { kind: "leave", subject: "outside pages rule" },
      { kind: "leave", subject: "bots rule" },
    ]);
    expect(reportOf(steps).changedNothing).toBe(true);
  });

  const flips: readonly { readonly name: string; readonly desired: object; readonly steps: readonly object[] }[] = [
    {
      name: "outside pages switched to allowed removes poplin's rule by its id and leaves the bots rule",
      desired: { outsidePages: "allowed" },
      steps: [
        { kind: "remove", subject: "outside pages rule", rulesetId: "set-custom", ruleId: "o1" },
        { kind: "leave", subject: "bots rule" },
      ],
    },
    {
      name: "search engines switched to allowed changes the bots rule in place",
      desired: { searchEnginesAllowed: true },
      steps: [
        { kind: "leave", subject: "outside pages rule" },
        { kind: "change", subject: "bots rule", rulesetId: "set-custom", ruleId: "b1", rule: botsRule(BOTS_BUT_SEARCH) },
      ],
    },
  ];

  test.each(flips)("$name: a setting that flips reaches Cloudflare, and no step names a rule of the owner's", ({ desired, steps }) => {
    const current = { id: "set-custom", rules: [{ id: "o1", ...outsideRule() }, ...ownersRules(2), { id: "b1", ...botsRule() }] };

    expect<unknown>(planGuards({ ...BLOCKING, ...desired }, current)).toEqual(steps);
  });

  test("outside pages allowed on a zone that never had the rule: nothing is planned for it", () => {
    const steps = planGuards({ ...BLOCKING, outsidePages: "allowed" }, { id: "set-custom", rules: [{ id: "b1", ...botsRule() }] });

    expect(steps).toEqual([{ kind: "leave", subject: "bots rule" }]);
  });

  test("a rule of poplin's that was switched off is changed back: it would stop nothing while the report said all is well", () => {
    const current = {
      id: "set-custom",
      rules: [
        { id: "o1", ...outsideRule(), enabled: false },
        { id: "b1", ...botsRule(), action: "log" },
      ],
    };

    expect(planGuards(BLOCKING, current).map((step) => step.kind)).toEqual(["change", "change"]);
  });

  const slots: readonly { readonly plan: ZonePlan; readonly others: number; readonly created: readonly string[]; readonly skipped: readonly string[] }[] = [
    { plan: "free", others: 3, created: ["outside pages rule", "bots rule"], skipped: [] },
    { plan: "free", others: 4, created: ["outside pages rule"], skipped: ["bots rule"] },
    { plan: "free", others: 5, created: [], skipped: ["outside pages rule", "bots rule"] },
    { plan: "pro", others: 5, created: ["outside pages rule", "bots rule"], skipped: [] },
    { plan: "pro", others: 19, created: ["outside pages rule"], skipped: ["bots rule"] },
    { plan: "business", others: 100, created: [], skipped: ["outside pages rule", "bots rule"] },
  ];

  test.each(slots)(
    "$plan with $others custom rules of the owner's: a rule with no slot left is a skip with its reason, never a failure",
    ({ plan, others, created, skipped }) => {
      const report = reportOf(planGuards({ ...BLOCKING, plan }, { id: "set-custom", rules: ownersRules(others) }));

      expect(report).toMatchObject({ created, skipped: skipped.map((subject) => ({ subject, reason: SLOTS_FULL })) });
    },
  );

  test("a full Free zone where outside pages are switched to allowed: the removal frees the slot the bots rule then takes", () => {
    const current = { id: "set-custom", rules: [...ownersRules(4), { id: "o1", ...outsideRule() }] };

    expect(planGuards({ ...BLOCKING, outsidePages: "allowed" }, current).map((step) => step.kind)).toEqual(["remove", "create"]);
  });
});

describe("syncGuards", () => {
  test("two runs against a zone with no custom rules: the first makes the ruleset with both rules in one request, the second run sends no change", async () => {
    let ruleset: { id: string; rules: object[] } | undefined;

    await withFake(
      (asked) => {
        if (asked.method === "GET") return ruleset === undefined ? refusal(404, 10003, "could not find entrypoint ruleset in the phase") : reply(ruleset);

        if (asked.path === "/zones/zone-1/rulesets") {
          const body = asked.body as { rules: object[] };
          ruleset = { id: "set-custom", rules: body.rules.map((rule, index) => ({ id: `r${index}`, ...rule })) };
        }

        return reply(ruleset);
      },
      async (connection, asked) => {
        const first = await syncGuards(connection, "zone-1", BLOCKING, "apply");
        const sent = asked.length;
        const second = await syncGuards(connection, "zone-1", BLOCKING, "apply");

        expect(first).toMatchObject({ ok: true, report: { created: ["outside pages rule", "bots rule"], changedNothing: false } });
        expect(second).toMatchObject({ ok: true, report: { left: ["outside pages rule", "bots rule"], changedNothing: true } });
        expect(asked.map((entry) => `${entry.method} ${entry.path}`)).toEqual([
          "GET /zones/zone-1/rulesets/phases/http_request_firewall_custom/entrypoint",
          "POST /zones/zone-1/rulesets",
          "GET /zones/zone-1/rulesets/phases/http_request_firewall_custom/entrypoint",
        ]);
        expect(asked.slice(sent)).toHaveLength(1);
        expect(asked[1]?.body).toEqual({ kind: "zone", phase: "http_request_firewall_custom", name: "poplin guard rules", rules: [outsideRule(), botsRule()] });
      },
    );
  });

  test("outside pages switched to allowed on a zone with the owner's rules: one DELETE for poplin's rule by its id, and no request that could replace the ruleset", async () => {
    const ruleset = { id: "set-custom", rules: [...ownersRules(2), { id: "o1", ...outsideRule() }, { id: "b1", ...botsRule() }] };

    await withFake(
      (asked) => reply(asked.method === "GET" ? ruleset : { id: "set-custom" }),
      async (connection, asked) => {
        expect(await syncGuards(connection, "zone-1", { ...BLOCKING, outsidePages: "allowed" }, "apply")).toMatchObject({
          ok: true,
          report: { removed: ["outside pages rule"], left: ["bots rule"] },
        });
        expect(asked.slice(1).map((entry) => `${entry.method} ${entry.path}`)).toEqual(["DELETE /zones/zone-1/rulesets/set-custom/rules/o1"]);
      },
    );
  });

  test("a Free zone whose five slots are taken: the run succeeds, sends no change, and the report carries the reason for each rule", async () => {
    await withFake(
      () => reply({ id: "set-custom", rules: ownersRules(5) }),
      async (connection, asked) => {
        expect(await syncGuards(connection, "zone-1", BLOCKING, "apply")).toMatchObject({
          ok: true,
          report: {
            skipped: [
              { subject: "outside pages rule", reason: SLOTS_FULL },
              { subject: "bots rule", reason: SLOTS_FULL },
            ],
            changedNothing: true,
          },
        });
        expect(asked.map((entry) => entry.method)).toEqual(["GET"]);
      },
    );
  });
});
