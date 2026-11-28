// The reading of the API rule at Cloudflare runs against a local fake: the live check trusts its answer, and a reading that took another rule for the API rule, or another zone for the install's, would pass a zone that lacks the rule on a real run alone.

import { describe, expect, test } from "bun:test";

import { readApiRule } from "../../live/api-rule";
import { INSTALL_OBJECTS } from "../../src/shared/install/install-objects";
import { apiExpression } from "../../src/with-domain/pieces/rules/guards";
import { withFake } from "../shared/install/support/fake-cloudflare";
import { LAYOUT } from "../shared/install/support/layouts";
import { type Asked, page, refusal, reply } from "../shared/install/support/replies";

/** The account the zone is in. */
const ACCOUNT = "account-a";

/** The install's zone as Cloudflare lists it, after one of the same name in another account and one of the account's that nobody proved theirs. */
const ZONES = [
  { id: "zone-0", name: LAYOUT.domain, plan: { name: "Free Website" }, account: { id: "account-b" }, status: "active" },
  { id: "zone-2", name: LAYOUT.domain, plan: { name: "Free Website" }, account: { id: ACCOUNT }, status: "pending" },
  { id: "zone-1", name: LAYOUT.domain, plan: { name: "Free Website" }, account: { id: ACCOUNT }, status: "active" },
];

/** Where the guard rules of the install's zone are read. */
const PHASE = "/zones/zone-1/rulesets/phases/http_request_firewall_custom/entrypoint";

/** The API rule as a repair made it, beside a rule of the owner's. */
const RULES = [
  { id: "theirs", expression: 'http.host eq "www.example.com"', action: "block" },
  { id: "a1", ref: INSTALL_OBJECTS.apiRef, description: INSTALL_OBJECTS.apiDescription, expression: apiExpression(LAYOUT), action: "block", enabled: true },
];

/** Answer as Cloudflare does: the account's zones, and the rules of the phase as given. */
function zone(phase: () => Response): (asked: Asked) => Response | undefined {
  return (asked) => {
    const path = asked.path.split("?")[0] ?? "";
    if (path === "/zones") return page(asked, ZONES);

    return path === PHASE ? phase() : undefined;
  };
}

describe("the API rule of the install's zone, read at a local fake of Cloudflare", () => {
  test("the rule is found by its ref in the account's active zone of the install's domain, not in another account's or a pending one, beside the rule poplin writes for that domain; a rule of the owner's is no part of the answer", async () => {
    await withFake(zone(() => reply({ id: "set-custom", rules: RULES })), async (connection, asked) => {
      const reading = await readApiRule(connection, ACCOUNT, LAYOUT.domain);

      expect(reading).toEqual({
        wanted: { ref: INSTALL_OBJECTS.apiRef, description: INSTALL_OBJECTS.apiDescription, expression: apiExpression(LAYOUT), action: "block", enabled: true },
        held: { ref: INSTALL_OBJECTS.apiRef, description: INSTALL_OBJECTS.apiDescription, expression: apiExpression(LAYOUT), action: "block", enabled: true },
      });
      expect(asked.map((entry) => `${entry.method} ${entry.path.split("?")[0]}`).at(-1)).toBe(`GET ${PHASE}`);
    });
  });

  test.each([
    ["a phase that never had a rule", (): Response => refusal(404, 10003, "could not find entrypoint ruleset in the phase")],
    ["a phase whose rules lack poplin's", (): Response => reply({ id: "set-custom", rules: RULES.slice(0, 1) })],
  ])("%s answers no rule held, beside the rule poplin wants", async (_what, phase) => {
    await withFake(zone(phase), async (connection) => {
      const reading = await readApiRule(connection, ACCOUNT, LAYOUT.domain);

      expect([reading.held, reading.wanted.ref]).toEqual([undefined, INSTALL_OBJECTS.apiRef]);
    });
  });

  // Drift: a reader that answered the wanted rule wherever its ref stands would pass a rule that was switched off or rewritten by hand, and the live check would say all is well.
  test("a rule of poplin's ref that the zone holds switched off and with another expression is answered as the zone holds it, in the fields of the wanted rule alone", async () => {
    const changed = { ...RULES[1], expression: 'http.host eq "poplin.example.com"', enabled: false, version: "3", last_updated: "2026-01-01T00:00:00Z" };

    await withFake(zone(() => reply({ id: "set-custom", rules: [RULES[0], changed] })), async (connection) => {
      const reading = await readApiRule(connection, ACCOUNT, LAYOUT.domain);

      expect(reading.held).toEqual({ ref: INSTALL_OBJECTS.apiRef, description: INSTALL_OBJECTS.apiDescription, expression: changed.expression, action: "block", enabled: false });
    });
  });

  // The message of a failed reading reaches a public log: it holds this file's words alone.
  test.each([
    ["a key that may not read the rules", zone(() => refusal(403, 10_000, "Authentication error for zone-1")), "Error: the zone's custom rules at Cloudflare could not be read: refused"],
    ["an account with no zone of the domain", (asked: Asked) => page(asked, ZONES.slice(0, 1)), "Error: the account holds no zone of the install's domain"],
  ])("%s is told in words that quote nothing Cloudflare said", async (_what, answers, told) => {
    await withFake(answers, async (connection) => {
      expect(await readApiRule(connection, ACCOUNT, LAYOUT.domain).catch((error: unknown) => String(error))).toBe(told);
    });
  });
});
