import { describe, expect, test } from "bun:test";
import { plainHttpExpression, planHttps, syncHttps } from "../../../src/zone/https/https";
import { refusal, reply, withFake } from "../support/fake-cloudflare";
import { LAYOUT, ONE_WORD } from "../support/layouts";

const EXPRESSION = 'not ssl and (ends_with(http.host, "-poplin.example.com") or ends_with(http.host, "-page.example.com") or http.host eq "poplin.example.com")';
const RULE = {
  ref: "poplin_https",
  description: "poplin: send http to https",
  expression: EXPRESSION,
  action: "redirect",
  enabled: true,
  action_parameters: { from_value: { target_url: { expression: 'concat("https://", http.host, http.request.uri.path)' }, status_code: 301, preserve_query_string: true } },
};
const DESIRED = { layout: LAYOUT, plan: "free" } as const;
const SLOTS_FULL = "the zone's plan allows no further redirect rule and other rules hold every slot";

function ownersRules(count: number): { id: string; expression: string; action: string }[] {
  return [...Array(count).keys()].map((index) => ({ id: `theirs${index}`, expression: 'http.host eq "www.example.com"', action: "redirect" }));
}

describe("plainHttpExpression", () => {
  // Drift: a rule that read another hostname would redirect the zone's own http pages, which poplin was never asked to touch.
  test("it is true only for a request over http to a site hostname or the admin hostname: one term per ending and the admin hostname by its whole name", () => {
    expect([plainHttpExpression(LAYOUT), plainHttpExpression(ONE_WORD)]).toEqual([EXPRESSION, 'not ssl and (ends_with(http.host, "-poplin.example.com") or http.host eq "poplin.example.com")']);
  });
});

describe("planHttps", () => {
  const cases: readonly { readonly name: string; readonly zoneRedirects: boolean; readonly rules: Parameters<typeof planHttps>[1]["rules"]; readonly step: object }[] = [
    { name: "a zone that redirects by itself", zoneRedirects: true, rules: undefined, step: { kind: "leave", subject: "https redirect" } },
    { name: "a zone that redirects by itself and has redirect rules of its own", zoneRedirects: true, rules: { id: "set-1", rules: ownersRules(2) }, step: { kind: "leave", subject: "https redirect" } },
    { name: "a zone that does not redirect and never had a redirect rule", zoneRedirects: false, rules: undefined, step: { kind: "create", subject: "https redirect", rulesetId: undefined, rule: RULE } },
    { name: "a zone that does not redirect and has rules of its own", zoneRedirects: false, rules: { id: "set-1", rules: ownersRules(2) }, step: { kind: "create", subject: "https redirect", rulesetId: "set-1", rule: RULE } },
    { name: "a Free zone whose ten redirect rules are all its own", zoneRedirects: false, rules: { id: "set-1", rules: ownersRules(10) }, step: { kind: "skip", subject: "https redirect", reason: SLOTS_FULL } },
    { name: "poplin's rule as written", zoneRedirects: false, rules: { id: "set-1", rules: [{ id: "h1", ...RULE }] }, step: { kind: "leave", subject: "https redirect" } },
    { name: "poplin's rule as written, on a zone that now redirects by itself too", zoneRedirects: true, rules: { id: "set-1", rules: [{ id: "h1", ...RULE }] }, step: { kind: "leave", subject: "https redirect" } },
    {
      name: "poplin's rule pointed at a fixed address by hand",
      zoneRedirects: false,
      rules: { id: "set-1", rules: [{ id: "h1", ...RULE, action_parameters: { from_value: { target_url: { value: "https://elsewhere.example/" }, status_code: 301, preserve_query_string: true } } }] },
      step: { kind: "change", subject: "https redirect", rulesetId: "set-1", ruleId: "h1", rule: RULE },
    },
    {
      name: "poplin's rule with another status",
      zoneRedirects: false,
      rules: { id: "set-1", rules: [{ id: "h1", ...RULE, action_parameters: { from_value: { ...RULE.action_parameters.from_value, status_code: 302 } } }] },
      step: { kind: "change", subject: "https redirect", rulesetId: "set-1", ruleId: "h1", rule: RULE },
    },
    {
      name: "poplin's rule widened to every hostname",
      zoneRedirects: false,
      rules: { id: "set-1", rules: [{ id: "h1", ...RULE, expression: "not ssl" }] },
      step: { kind: "change", subject: "https redirect", rulesetId: "set-1", ruleId: "h1", rule: RULE },
    },
  ];

  // Drift: poplin would flip or duplicate what the zone already does, leave a rule someone bent, or name a rule of the owner's in a step.
  test.each(cases)("$name: the one step is $step.kind", ({ zoneRedirects, rules, step }) => {
    expect<unknown>(planHttps(DESIRED, { zoneRedirects, rules })).toEqual([step]);
  });
});

describe("syncHttps", () => {
  // Drift: the client would write the zone-wide switch, write another rule's shape, or write on every run.
  test("two runs on a zone that does not redirect: the first makes the rule and its ruleset and never writes the zone's switch, the second sends no change", async () => {
    let ruleset: { id: string; rules: object[] } | undefined;

    await withFake(
      (asked) => {
        if (asked.path.includes("/settings/")) return reply({ id: "always_use_https", value: "off" });

        if (asked.method === "GET") return ruleset === undefined ? refusal(404, 10003, "could not find entrypoint ruleset in the phase") : reply(ruleset);

        ruleset = { id: "set-redirect", rules: ((asked.body as { rules: object[] }).rules ?? []).map((rule, index) => ({ id: `rule-${index}`, ...rule })) };

        return reply(ruleset);
      },
      async (connection, asked) => {
        const first = await syncHttps(connection, "zone-1", DESIRED, "apply");
        const sent = asked.length;
        const second = await syncHttps(connection, "zone-1", DESIRED, "apply");

        expect(first).toMatchObject({ ok: true, report: { created: ["https redirect"], changedNothing: false } });
        expect(second).toMatchObject({ ok: true, report: { left: ["https redirect"], changedNothing: true } });
        expect(asked.slice(0, sent).map((entry) => `${entry.method} ${entry.path}`)).toEqual([
          "GET /zones/zone-1/settings/always_use_https",
          "GET /zones/zone-1/rulesets/phases/http_request_dynamic_redirect/entrypoint",
          "POST /zones/zone-1/rulesets",
        ]);
        expect(asked[2]?.body).toEqual({ kind: "zone", phase: "http_request_dynamic_redirect", name: "poplin redirect rule", rules: [RULE] });
        expect(asked.slice(sent).every((entry) => entry.method === "GET")).toBe(true);
      },
    );
  });

  // Drift: a zone that already redirects every hostname would get a second redirect of poplin's beside it.
  test("a zone whose Always Use HTTPS is on is left as it is: nothing is written, in a plan and in a repair alike", async () => {
    await withFake(
      (asked) => (asked.path.includes("/settings/") ? reply({ id: "always_use_https", value: "on" }) : refusal(404, 10003, "could not find entrypoint ruleset in the phase")),
      async (connection, asked) => {
        const synced = [await syncHttps(connection, "zone-1", DESIRED, "plan"), await syncHttps(connection, "zone-1", DESIRED, "apply")];

        expect(synced).toEqual([1, 2].map(() => expect.objectContaining({ ok: true, report: expect.objectContaining({ left: ["https redirect"], changedNothing: true }) })));
        expect(asked.filter((entry) => entry.method !== "GET")).toEqual([]);
      },
    );
  });

  // Drift: a switch that could not be read would be taken as off, and a zone that already redirects every hostname would get poplin's rule beside it.
  test("a key that may not read the zone's switch: the run fails with Cloudflare's refusal, and nothing is read or sent after it", async () => {
    await withFake(
      () => refusal(403, 10000, "Authentication error"),
      async (connection, asked) => {
        expect(await syncHttps(connection, "zone-1", DESIRED, "apply")).toMatchObject({ ok: false, failure: "refused", report: { changedNothing: true } });
        expect(asked.map((entry) => `${entry.method} ${entry.path}`)).toEqual(["GET /zones/zone-1/settings/always_use_https"]);
      },
    );
  });
});
