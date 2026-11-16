import { describe, expect, spyOn, test } from "bun:test";

import { removeLogin } from "../../src/actions/logins";
import { countUserTokens, issueToken, listTokenStates, listTokens, nameTokens, revokeToken } from "../../src/actions/manage-tokens";
import type { Login } from "../../src/auth/logins";
import type { TokenId } from "../../src/auth/tokens";
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

  // Drift: a page names whoever its rows hold, emails among them, and a request may call the database only so often. A page that asked once for each row would fail when long, and one that answered a publisher would tell it of the other tokens.
  test("the tokens among the holders of a page are named in one call of the database, emails are skipped, and only an admin is answered", async () => {
    const world = await makeWorld();
    const issued = await issueToken(world.install, ADMIN, { scope: "publisher", note: "agent" });
    if (!issued.ok) throw new Error("the token was not issued");
    const others = Array.from({ length: 150 }, (_other, index) => index.toString(16).padStart(16, "0"));
    const reads = spyOn(world.install.database, "getTokenNames");

    const named = await nameTokens(world.install, ADMIN, [ADMIN.holder, ...others, issued.record.id]);
    const sizes = reads.mock.calls.map(([ids]) => ids.length);

    expect<unknown>([named, sizes, await nameTokens(world.install, OWNER, [issued.record.id])]).toEqual([{ ok: true, names: { [issued.record.id]: "agent" } }, [151], { ok: false, code: "not_allowed" }]);
  });

  // Drift: an agent's token is the person who allowed it. A publisher token made by an admin token would outlive its person were it counted as nobody's, and the list of ended tokens would call a token that went with its user removed by hand.
  test("a user's tokens are counted with the ones their tokens made, all of them end when the user is removed, and each is told as gone with its user", async () => {
    const bo = "bo@example.com" as Login;
    const world = await makeWorld({ logins: [ADMIN.holder as Login, bo] });
    const issue = async (holder: Login | TokenId, scope: "admin" | "publisher", note: string): Promise<TokenId> => {
      const issued = await issueToken(world.install, { scope: "admin", holder }, { scope, note });
      if (!issued.ok) throw new Error("the token was not issued");

      return issued.record.id;
    };
    const kept = await issue(ADMIN.holder as Login, "publisher", "kept");
    const laptop = await issue(bo, "admin", "laptop");
    const agent = await issue(laptop, "publisher", "agent");
    const counted = await countUserTokens(world.install, ADMIN);
    world.clock.now = NOW + DAY;

    const removed = await removeLogin(world.install, ADMIN, { login: bo });
    const states = await listTokenStates(world.install, ADMIN);
    const gone = { scope: "publisher", created: NOW, ended: NOW + DAY, how: "user_removed", by: ADMIN.holder };

    expect<unknown>([counted, await countUserTokens(world.install, OWNER), removed.ok, await countUserTokens(world.install, ADMIN)]).toEqual([
      { ok: true, counts: { [ADMIN.holder]: 1, [bo]: 2 } },
      { ok: false, code: "not_allowed" },
      true,
      { ok: true, counts: { [ADMIN.holder]: 1 } },
    ]);
    expect<unknown>(states.ok && [states.tokens.map((token) => token.id), [...states.ended].sort((left, right) => left.note.localeCompare(right.note))]).toEqual([
      [kept],
      [
        { ...gone, id: agent, note: "agent" },
        { ...gone, id: laptop, note: "laptop", scope: "admin" },
      ],
    ]);
  });
});
