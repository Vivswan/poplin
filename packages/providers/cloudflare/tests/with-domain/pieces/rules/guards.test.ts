import { describe, expect, test } from "bun:test";
import type { ZonePlan } from "../../../../src/shared/install/client";
import { apiExpression, botsExpression, outsidePagesExpression, planGuards, syncGuards } from "../../../../src/with-domain/pieces/rules/guards";
import type { DomainLayout } from "../../../../src/with-domain/layout";
import type { RuleBody } from "../../../../src/with-domain/pieces/rules/rules";
import { reportOf } from "../../../../src/shared/install/sync";
import { withFake } from "../../../shared/install/support/fake-cloudflare";
import { refusal, reply } from "../../../shared/install/support/replies";
import { LAYOUT, ONE_WORD } from "../../../shared/install/support/layouts";
import { siteEndings } from "../../../../src/with-domain/layout";

const SITES = '(ends_with(http.host, "-poplin.example.com") or ends_with(http.host, "-page.example.com"))';
const OUTSIDE = `${SITES} and any(http.request.headers["sec-fetch-site"][*] eq "cross-site") and any(http.request.headers["sec-fetch-dest"][*] ne "document")`;
const SCANNER_PATHS = [
  'ends_with(http.request.uri.path, ".php")',
  'ends_with(http.request.uri.path, "/.env")',
  'http.request.uri.path contains "/.env."',
  'http.request.uri.path contains "/.git/"',
  'starts_with(http.request.uri.path, "/wp-admin/")',
  'starts_with(http.request.uri.path, "/cgi-bin/")',
  'starts_with(lower(http.request.uri.path), "/phpmyadmin")',
];
const NEVER_A_SITES = `not http.request.method in {"GET" "HEAD"} or ${SCANNER_PATHS.join(" or ")}`;
const OFF_THE_EDGE = 'not starts_with(http.request.uri.path, "/cdn-cgi/")';
const BOTS = `${SITES} and ${OFF_THE_EDGE} and ((cf.client.bot and cf.verified_bot_category ne "AI Assistant" and cf.verified_bot_category ne "Page Preview") or ${NEVER_A_SITES})`;
const BOTS_BUT_SEARCH = `${SITES} and ${OFF_THE_EDGE} and ((cf.client.bot and cf.verified_bot_category ne "AI Assistant" and cf.verified_bot_category ne "Page Preview" and cf.verified_bot_category ne "Search Engine Crawler") or ${NEVER_A_SITES})`;
const API_PATHS = '(http.request.uri.path eq "/api" or starts_with(http.request.uri.path, "/api/"))';
const LOGIN_ROUTES = 'not http.request.uri.path in {"/api/logins" "/api/logins/token"}';
const NO_HEADER = 'not any(http.request.headers["authorization"][*] ne "")';
const API = `http.host eq "poplin.example.com" and ${API_PATHS} and ${LOGIN_ROUTES} and ${NO_HEADER}`;
const ONE_ENDING = 'ends_with(http.host, "-poplin.example.com")';
const SLOTS_FULL = "the zone's plan allows no further custom rule and other rules hold every slot";
const BLOCKING = { layout: LAYOUT, plan: "free", outsidePages: "blocked", searchEnginesAllowed: false } as const;

function outsideRule(expression: string = OUTSIDE): RuleBody {
  return { ref: "poplin_outside_pages", description: "poplin: stop pages of other domains", expression, action: "block", enabled: true };
}

function botsRule(expression: string = BOTS): RuleBody {
  return { ref: "poplin_bots", description: "poplin: stop verified bots, other methods, and scanner paths", expression, action: "block", enabled: true };
}

function apiGuard(): RuleBody {
  return { ref: "poplin_api", description: "poplin: stop API requests with no token", expression: API, action: "block", enabled: true };
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

  // Drift: a verified bot has one kind. A rule without `AI Assistant` or `Page Preview` stops an assistant that opens one page for a person, or a chat app's link preview; one that names a further kind, `AI Crawler` say, lets a training crawler in.
  test.each(bots)(
    "the bots rule with $name lets a verified assistant and a link preview through, and reads the site hostnames alone, never the dashboard's or the zone's own",
    ({ searchEnginesAllowed, expression }) => {
      expect(botsExpression(LAYOUT, searchEnginesAllowed)).toBe(expression);
    },
  );

  // Drift: the two routes a machine logs in through carry no token, so a rule that read the header alone would turn the CLI's login away at the edge.
  // The Worker takes the scheme in any case (`bearer`, two spaces), so the edge reads only that the header is there: a rule that read `Bearer` would block a token the Worker takes.
  test("the API rule reads the admin hostname alone, every path at or under /api but the two login routes, and whether an Authorization header is there at all", () => {
    expect(apiExpression(LAYOUT)).toBe(API);
  });

  // Drift: `http.request.headers.names` keeps each header's name as the client wrote it, and a CLI over HTTP/1.1 writes `Authorization`: a rule that looked for `authorization` there would block every such call.
  // The header map's keys are lowercased by Cloudflare, so the rule reads the map.
  test("the API rule reads the header map, whose keys are lowercased, and never the list of header names, which keeps a header's case", () => {
    expect([apiExpression(LAYOUT).includes('http.request.headers["authorization"]'), apiExpression(LAYOUT).includes("http.request.headers.names")]).toEqual([true, false]);
  });

  // Drift: the dashboard and the API take POST, PUT, and DELETE on the admin hostname; a site rule that reached it would lock the owner out of every change, and an API rule that reached a site would block its visitors.
  test.each([
    ["the public word `page`", LAYOUT],
    ["the public word `poplin`", ONE_WORD],
  ])("with %s, no site guard names the admin hostname, the API rule names no site ending, and the admin hostname ends in none of the endings the site guards read", (_what, layout) => {
    const sites = [outsidePagesExpression(layout), botsExpression(layout, false), botsExpression(layout, true)];
    const endings = siteEndings(layout);
    const namedByApi = endings.filter((ending) => apiExpression(layout).includes(ending));

    expect([sites.filter((expression) => expression.includes("http.host eq")), namedByApi, endings.filter((ending) => layout.adminHostname.endsWith(ending))]).toEqual([[], [], []]);
  });

  // Drift: two terms without brackets would bind the `and` to the last ending alone.
  test("a layout whose public word is `poplin` has one ending, written without brackets; any other has two inside brackets", () => {
    expect([outsidePagesExpression(ONE_WORD).startsWith(`${ONE_ENDING} and any(`), botsExpression(ONE_WORD, false).startsWith(`${ONE_ENDING} and ${OFF_THE_EDGE} and (`), botsExpression(LAYOUT, false).startsWith(`${SITES} and `)]).toEqual([
      true,
      true,
      true,
    ]);
  });

  test("a domain forged into a layout makes every builder throw: the text is never written into a rule", () => {
    const forged = { ...LAYOUT, domain: 'example.com") or (http.host ne "', adminHostname: 'poplin.example.com" or (http.host ne "' } as unknown as DomainLayout;

    expect(() => outsidePagesExpression(forged)).toThrow();
    expect(() => botsExpression(forged, false)).toThrow();
    expect(() => apiExpression(forged)).toThrow();
  });
});

describe("planGuards", () => {
  const settings: readonly {
    readonly plan: ZonePlan;
    readonly outsidePages: "blocked" | "allowed";
    readonly searchEnginesAllowed: boolean;
    readonly rules: readonly RuleBody[];
  }[] = [
    { plan: "free", outsidePages: "blocked", searchEnginesAllowed: false, rules: [outsideRule(), botsRule(), apiGuard()] },
    { plan: "free", outsidePages: "blocked", searchEnginesAllowed: true, rules: [outsideRule(), botsRule(BOTS_BUT_SEARCH), apiGuard()] },
    { plan: "free", outsidePages: "allowed", searchEnginesAllowed: false, rules: [botsRule(), apiGuard()] },
    { plan: "free", outsidePages: "allowed", searchEnginesAllowed: true, rules: [botsRule(BOTS_BUT_SEARCH), apiGuard()] },
    { plan: "pro", outsidePages: "blocked", searchEnginesAllowed: false, rules: [outsideRule(), botsRule(), apiGuard()] },
    { plan: "pro", outsidePages: "allowed", searchEnginesAllowed: true, rules: [botsRule(BOTS_BUT_SEARCH), apiGuard()] },
  ];

  test.each(settings)(
    "$plan, outside pages $outsidePages, search engines allowed $searchEnginesAllowed, on a zone with no custom rule: the settings choose the site rules, and the API rule is wanted under every setting",
    ({ rules, ...desired }) => {
      const steps = planGuards({ layout: LAYOUT, ...desired }, undefined);

      expect<unknown>(steps.map((step) => ("rule" in step ? step.rule : step))).toEqual([...rules]);
      expect(steps.map((step) => step.kind)).toEqual(rules.map(() => "create"));
    },
  );

  test("a zone with custom rules of the owner's: poplin's rules are added to the existing ruleset and theirs are named in no step", () => {
    expect<unknown>(planGuards(BLOCKING, { id: "set-custom", rules: ownersRules(2) })).toEqual([
      { kind: "create", subject: "outside pages rule", rulesetId: "set-custom", rule: outsideRule() },
      { kind: "create", subject: "bots rule", rulesetId: "set-custom", rule: botsRule() },
      { kind: "create", subject: "API rule", rulesetId: "set-custom", rule: apiGuard() },
    ]);
  });

  test("planned again over its own rules on a full Free zone: they count as held, nothing changes, and the report says so", () => {
    const current = { id: "set-custom", rules: [...ownersRules(2), { id: "o1", ...outsideRule() }, { id: "b1", ...botsRule() }, { id: "a1", ...apiGuard() }] };
    const steps = planGuards(BLOCKING, current);

    expect(steps).toEqual([
      { kind: "leave", subject: "outside pages rule" },
      { kind: "leave", subject: "bots rule" },
      { kind: "leave", subject: "API rule" },
    ]);
    expect(reportOf(steps).changedNothing).toBe(true);
  });

  const flips: readonly { readonly name: string; readonly desired: object; readonly steps: readonly object[] }[] = [
    {
      name: "outside pages switched to allowed removes poplin's rule by its id and leaves the other two",
      desired: { outsidePages: "allowed" },
      steps: [
        { kind: "remove", subject: "outside pages rule", rulesetId: "set-custom", ruleId: "o1" },
        { kind: "leave", subject: "bots rule" },
        { kind: "leave", subject: "API rule" },
      ],
    },
    {
      name: "search engines switched to allowed changes the bots rule in place",
      desired: { searchEnginesAllowed: true },
      steps: [
        { kind: "leave", subject: "outside pages rule" },
        { kind: "change", subject: "bots rule", rulesetId: "set-custom", ruleId: "b1", rule: botsRule(BOTS_BUT_SEARCH) },
        { kind: "leave", subject: "API rule" },
      ],
    },
  ];

  test.each(flips)("$name: a setting that flips reaches Cloudflare, and no step names a rule of the owner's", ({ desired, steps }) => {
    const current = { id: "set-custom", rules: [{ id: "o1", ...outsideRule() }, ...ownersRules(2), { id: "b1", ...botsRule() }, { id: "a1", ...apiGuard() }] };

    expect<unknown>(planGuards({ ...BLOCKING, ...desired }, current)).toEqual(steps);
  });

  test("outside pages allowed on a zone that never had the rule: nothing is planned for it", () => {
    const steps = planGuards({ ...BLOCKING, outsidePages: "allowed" }, { id: "set-custom", rules: [{ id: "b1", ...botsRule() }, { id: "a1", ...apiGuard() }] });

    expect(steps).toEqual([
      { kind: "leave", subject: "bots rule" },
      { kind: "leave", subject: "API rule" },
    ]);
  });

  // Drift: a version before this one made the two site rules alone. A plan that left a zone as it found it would never add the API rule to it.
  test("a zone with the two site rules of a version before gets the API rule added, and the two are left", () => {
    const current = { id: "set-custom", rules: [{ id: "o1", ...outsideRule() }, { id: "b1", ...botsRule() }] };

    expect<unknown>(planGuards(BLOCKING, current)).toEqual([
      { kind: "leave", subject: "outside pages rule" },
      { kind: "leave", subject: "bots rule" },
      { kind: "create", subject: "API rule", rulesetId: "set-custom", rule: apiGuard() },
    ]);
  });

  test("a rule of poplin's that was switched off is changed back: it would stop nothing while the report said all is well", () => {
    const current = {
      id: "set-custom",
      rules: [
        { id: "o1", ...outsideRule(), enabled: false },
        { id: "b1", ...botsRule(), action: "log" },
        { id: "a1", ...apiGuard(), enabled: false },
      ],
    };

    expect(planGuards(BLOCKING, current).map((step) => step.kind)).toEqual(["change", "change", "change"]);
  });

  const slots: readonly { readonly plan: ZonePlan; readonly others: number; readonly created: readonly string[]; readonly skipped: readonly string[] }[] = [
    { plan: "free", others: 2, created: ["outside pages rule", "bots rule", "API rule"], skipped: [] },
    { plan: "free", others: 3, created: ["outside pages rule", "bots rule"], skipped: ["API rule"] },
    { plan: "free", others: 4, created: ["outside pages rule"], skipped: ["bots rule", "API rule"] },
    { plan: "free", others: 5, created: [], skipped: ["outside pages rule", "bots rule", "API rule"] },
    { plan: "pro", others: 5, created: ["outside pages rule", "bots rule", "API rule"], skipped: [] },
    { plan: "pro", others: 18, created: ["outside pages rule", "bots rule"], skipped: ["API rule"] },
    { plan: "business", others: 100, created: [], skipped: ["outside pages rule", "bots rule", "API rule"] },
  ];

  test.each(slots)(
    "$plan with $others custom rules of the owner's: a rule with no slot left is a skip with its reason, never a failure",
    ({ plan, others, created, skipped }) => {
      const report = reportOf(planGuards({ ...BLOCKING, plan }, { id: "set-custom", rules: ownersRules(others) }));

      expect(report).toMatchObject({ created, skipped: skipped.map((subject) => ({ subject, reason: SLOTS_FULL })) });
    },
  );

  test("a full Free zone where outside pages are switched to allowed: the removal frees the slot the bots rule then takes, and the API rule finds none", () => {
    const current = { id: "set-custom", rules: [...ownersRules(4), { id: "o1", ...outsideRule() }] };

    expect(planGuards({ ...BLOCKING, outsidePages: "allowed" }, current).map((step) => step.kind)).toEqual(["remove", "create", "skip"]);
  });
});

describe("syncGuards", () => {
  test("two runs against a zone with no custom rules: the first makes the ruleset with all three rules in one request, the second run sends no change", async () => {
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

        expect(first).toMatchObject({ ok: true, report: { created: ["outside pages rule", "bots rule", "API rule"], changedNothing: false } });
        expect(second).toMatchObject({ ok: true, report: { left: ["outside pages rule", "bots rule", "API rule"], changedNothing: true } });
        expect(asked.map((entry) => `${entry.method} ${entry.path}`)).toEqual([
          "GET /zones/zone-1/rulesets/phases/http_request_firewall_custom/entrypoint",
          "POST /zones/zone-1/rulesets",
          "GET /zones/zone-1/rulesets/phases/http_request_firewall_custom/entrypoint",
        ]);
        expect(asked.slice(sent)).toHaveLength(1);
        expect(asked[1]?.body).toEqual({ kind: "zone", phase: "http_request_firewall_custom", name: "poplin guard rules", rules: [outsideRule(), botsRule(), apiGuard()] });
      },
    );
  });

  test("outside pages switched to allowed on a zone with the owner's rules: one DELETE for poplin's rule by its id, and no request that could replace the ruleset", async () => {
    const ruleset = { id: "set-custom", rules: [...ownersRules(2), { id: "o1", ...outsideRule() }, { id: "b1", ...botsRule() }, { id: "a1", ...apiGuard() }] };

    await withFake(
      (asked) => reply(asked.method === "GET" ? ruleset : { id: "set-custom" }),
      async (connection, asked) => {
        expect(await syncGuards(connection, "zone-1", { ...BLOCKING, outsidePages: "allowed" }, "apply")).toMatchObject({
          ok: true,
          report: { removed: ["outside pages rule"], left: ["bots rule", "API rule"] },
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
              { subject: "API rule", reason: SLOTS_FULL },
            ],
            changedNothing: true,
          },
        });
        expect(asked.map((entry) => entry.method)).toEqual(["GET"]);
      },
    );
  });
});
