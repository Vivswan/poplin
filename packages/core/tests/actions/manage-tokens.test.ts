import { describe, expect, test } from "bun:test";

import { issueToken, listTokenStates, listTokens, revokeToken } from "../../src/actions/manage-tokens";
import { verifyToken } from "../../src/auth/tokens";
import { ADMIN, DAY, makeWorld, NOW, OWNER } from "./support/actions-fixture";

describe("the tokens that work and the ones that ended", () => {
  // Drift: a removed token keeps its row. A listing that told it among the working ones would show a dead token as live, and one that dropped it would lose who removed it and when.
  test("a removed token and one that ran out are told apart from the working ones, each with how it ended, and a removed one is in no other listing", async () => {
    const world = await makeWorld();
    const issue = async (scope: "admin" | "publisher", note: string): Promise<string> => {
      world.clock.now += 1;
      const issued = await issueToken(world.install, ADMIN, { scope, note });
      if (!issued.ok) throw new Error("the token was not issued");

      return issued.record.id;
    };
    const [laptop, agent, ci] = [await issue("admin", "laptop"), await issue("publisher", "agent"), await issue("publisher", "ci")];
    world.clock.now = NOW + DAY;
    await revokeToken(world.install, ADMIN, agent);
    world.clock.now = NOW + 31 * DAY;
    const names = (tokens: readonly { readonly note: string }[]): string[] => tokens.map((token) => token.note);
    const [states, listed] = [await listTokenStates(world.install, ADMIN), await listTokens(world.install, ADMIN)];

    expect<unknown>([states, listed.ok && names(listed.tokens), await listTokenStates(world.install, OWNER)]).toEqual([
      {
        ok: true,
        tokens: [{ id: ci, scope: "publisher", note: "ci", created: NOW + 3, expires: "never" }],
        ended: [
          { id: laptop, scope: "admin", note: "laptop", created: NOW + 1, ended: NOW + 1 + 30 * DAY, how: "ran_out" },
          { id: agent, scope: "publisher", note: "agent", created: NOW + 2, ended: NOW + DAY, how: "removed", by: ADMIN.holder },
        ],
        more: false,
      },
      ["ci", "laptop"],
      { ok: false, code: "not_allowed" },
    ]);
  });

  // Drift: a request finds its token's record through this one read. Were a removed token's kept row found there, its unchanged hash would still match.
  test("a removed token has no record to be checked against, though its value matched until it was removed", async () => {
    const world = await makeWorld();
    const issued = await issueToken(world.install, ADMIN, { scope: "publisher", note: "agent" });
    if (!issued.ok) throw new Error("the token was not issued");
    const before = await world.install.database.getToken(issued.record.id);
    const matched = before === undefined ? undefined : (await verifyToken(issued.token, before, NOW)).ok;
    await revokeToken(world.install, ADMIN, issued.record.id);

    expect([matched, await world.install.database.getToken(issued.record.id), await revokeToken(world.install, ADMIN, issued.record.id)]).toEqual([
      true,
      undefined,
      { ok: false, code: "not_found" },
    ]);
  });
});
