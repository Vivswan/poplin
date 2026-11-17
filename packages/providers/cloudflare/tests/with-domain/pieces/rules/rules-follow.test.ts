// The settings of the guard rules carried to Cloudflare with the kept key, against the answers Cloudflare documents for its zones and its rulesets.
// Without these a changed setting could leave the rule of before standing, rewrite a rule that is not poplin's, read as carried when Cloudflare refused it, or give the key away in an answer.

import { describe, expect, test } from "bun:test";
import type { RulesFollow } from "@poplin/app/src/console/settings/rules-follow";
import { readKeptKey } from "../../../../src/shared/install/key/kept-key";
import { createRulesFollow, RULES_PUSH_CALLS } from "../../../../src/with-domain/pieces/rules/rules-follow";
import { botsExpression, outsidePagesExpression } from "../../../../src/with-domain/pieces/rules/guards";
import { INSTALL_OBJECTS } from "../../../../src/shared/install/install-objects";
import { withFake } from "../../../shared/install/support/fake-cloudflare";
import { LAYOUT } from "../../../shared/install/support/layouts";
import { type Asked, page, refusal, reply } from "../../../shared/install/support/replies";

/** The account the zone is in. */
const ACCOUNT = "account-a";

/** A key in the form the reader takes, and nothing like one Cloudflare makes. */
const KEY = "kept-key-of-the-test";

/** The install's zone as Cloudflare lists it, beside one of another domain. */
const ZONES = [
  { id: "zone-0", name: "other.example", plan: { name: "Free Website" }, account: { id: ACCOUNT } },
  { id: "zone-1", name: LAYOUT.domain, plan: { name: "Free Website" }, account: { id: ACCOUNT } },
];

/** Where the guard rules are read, and where one of them is written. */
const PATHS = { zones: "/zones", phase: "/zones/zone-1/rulesets/phases/http_request_firewall_custom/entrypoint", rules: "/zones/zone-1/rulesets/set-custom/rules" } as const;

/** The two rules as a repair left them, for pages of other domains blocked and search engines stopped, beside a rule of the owner's. */
const HELD = {
  id: "set-custom",
  rules: [
    { id: "theirs", expression: 'http.host eq "www.example.com"', action: "block" },
    { id: "o1", ref: INSTALL_OBJECTS.outsideRef, description: INSTALL_OBJECTS.outsideDescription, expression: outsidePagesExpression(LAYOUT), action: "block", enabled: true },
    { id: "b1", ref: INSTALL_OBJECTS.botsRef, description: INSTALL_OBJECTS.botsDescription, expression: botsExpression(LAYOUT, false), action: "block", enabled: true },
  ],
};

/** What a fake zone answers each call with. Left out, the lists hold what the zone held before the change and a write is taken. */
interface Answers {
  readonly zones?: (asked: Asked) => Response;
  readonly phase?: () => Response;
  readonly write?: (asked: Asked) => Response;
}

/** Answer as Cloudflare does: the account's zones, the rules of the phase, and a write of one rule. */
function zone(answers: Answers): (asked: Asked) => Response | undefined {
  return (asked) => {
    const path = asked.path.split("?")[0] ?? "";
    if (asked.method !== "GET") return path.startsWith(PATHS.rules) ? (answers.write ?? (() => reply({ id: HELD.id })))(asked) : undefined;

    if (path === PATHS.zones) return (answers.zones ?? ((listed) => page(listed, ZONES)))(asked);

    return path === PATHS.phase ? (answers.phase ?? (() => reply(HELD)))() : undefined;
  };
}

/** The writes among what was asked, each as its method and its path. */
function writes(asked: readonly Asked[]): string[] {
  return asked.filter((entry) => entry.method !== "GET").map((entry) => `${entry.method} ${entry.path}`);
}

/** A failure of Cloudflare's own, which the SDK tries again at once. */
const DOWN = (): Response => refusal(503, 1, `Service unavailable ${KEY}`, { "retry-after-ms": "1" });

function followOf(connection: { readonly baseUrl?: string | undefined }): RulesFollow {
  return createRulesFollow(readKeptKey(KEY, { baseUrl: connection.baseUrl }), { accountId: ACCOUNT, layout: LAYOUT });
}

describe("createRulesFollow", () => {
  // Drift: each setting has one rule of its own. A change must write that rule alone, by its id, in the install's own zone: a request that named the owner's rule, another zone, or the whole ruleset could undo what is not poplin's.
  test("both settings changed remove the outside pages rule and rewrite the bots rule, each by its id, and touch nothing else", async () => {
    await withFake(zone({}), async (connection, asked) => {
      const pushed = await followOf(connection).push({ outside_pages: "allowed", search_engines_allowed: true });
      const edit = asked.find((entry) => entry.method === "PATCH");

      expect([pushed, writes(asked)]).toEqual([{ ok: true, rules: "written" }, [`DELETE ${PATHS.rules}/o1`, `PATCH ${PATHS.rules}/b1`]]);
      expect(edit?.body).toMatchObject({ expression: botsExpression(LAYOUT, true) });
      expect([asked.length <= RULES_PUSH_CALLS, new Set(asked.map((entry) => entry.key))]).toEqual([true, new Set([`Bearer ${KEY}`])]);
    });
  });

  // Drift: rules that already stand as the settings ask are written again by nothing: the scheduled run confirms a change by this read, and must cost only the reads there.
  // A try that wrote nothing and did not say so would never let the change stop waiting; one that said so after a write would end the waiting on a read made before it.
  test("settings the rules already hold are written nowhere, and the try says that they stood", async () => {
    await withFake(zone({}), async (connection, asked) => {
      expect([await followOf(connection).push({ outside_pages: "blocked", search_engines_allowed: false }), writes(asked), asked.length]).toEqual([{ ok: true, rules: "stood" }, [], 3]);
    });
  });

  const refused: readonly { readonly name: string; readonly answers: Answers; readonly ends: Awaited<ReturnType<RulesFollow["push"]>>; readonly written: number }[] = [
    { name: "a key Cloudflare no longer knows", answers: { zones: () => refusal(401, 10_000, `Authentication error ${KEY}`) }, ends: { ok: false, refusal: "key_refused" }, written: 0 },
    { name: "a key with no right to read the rules", answers: { phase: () => refusal(403, 10_000, "Authentication error") }, ends: { ok: false, refusal: "lacks_right" }, written: 0 },
    { name: "a key with no right to write a rule", answers: { write: () => refusal(403, 10_000, "Authentication error") }, ends: { ok: false, refusal: "lacks_right" }, written: 1 },
    { name: "Cloudflare failing while the zones are listed", answers: { zones: DOWN }, ends: { ok: false, refusal: "unreachable" }, written: 0 },
    { name: "an account that holds no zone of the install's domain", answers: { zones: (asked) => page(asked, ZONES.slice(0, 1)) }, ends: { ok: false, refusal: "not_made" }, written: 0 },
    // The first rule is written, and the second fails: a try that stopped part of the way is no success, so the change goes on waiting and is tried again.
    {
      name: "Cloudflare refusing the second rule after it took the first",
      answers: { write: (asked) => (asked.method === "DELETE" ? reply({ id: HELD.id }) : refusal(403, 10_000, "Authentication error")) },
      ends: { ok: false, refusal: "lacks_right" },
      written: 2,
    },
  ];

  // Drift: each answer is one of the refusals the install knows what to do with, and none of them may read as carried.
  test.each(refused)("$name ends as $ends, and no text of the answer holds the key", async ({ answers, ends, written }) => {
    await withFake(zone(answers), async (connection, asked) => {
      const follow = followOf(connection);
      const pushed = await follow.push({ outside_pages: "allowed", search_engines_allowed: true });

      expect([pushed, writes(asked).length]).toEqual([ends, written]);
      expect([JSON.stringify([follow, pushed]), Bun.inspect(follow), Bun.inspect(pushed)].join("\n")).not.toContain(KEY);
    });
  });
});
