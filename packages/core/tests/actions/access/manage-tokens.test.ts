import { describe, expect, spyOn, test } from "bun:test";

import { removeLogin } from "../../../src/actions/access/logins";
import { changeTokenExpiry, countUserTokens, issueToken, listTokenStates, listTokens, nameTokens, revokeToken } from "../../../src/actions/access/manage-tokens";
import type { Login } from "../../../src/auth/logins";
import type { Actor } from "../../../src/auth/scopes";
import type { TokenId, TokenRecord } from "../../../src/auth/tokens";
import { verifyToken } from "../../../src/auth/tokens";
import { ADMIN, DAY, makeWorld, NOW, OWNER } from "../support/actions-fixture";

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
    const world = await makeWorld({ users: [ADMIN.holder as Login, bo] });
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

describe("changeTokenExpiry", () => {
  // Drift: an expiry is the token's own, whatever its role, and only a person moves it. A token that moved one would outlive its own day, and a moment that has passed would end a token with no entry of a removal.
  test("a person sets a working token to expire later, sooner, or never, whatever its role; a token, a publisher, a passed moment, and a token that ended are refused", async () => {
    const world = await makeWorld();
    const issue = async (scope: "admin" | "publisher", note: string): Promise<{ readonly id: string; readonly token: string }> => {
      const issued = await issueToken(world.install, ADMIN, { scope, note });
      if (!issued.ok) throw new Error("the token was not issued");

      return { id: issued.record.id, token: issued.token };
    };
    const [laptop, ci, gone] = [await issue("admin", "laptop"), await issue("publisher", "ci"), await issue("publisher", "gone")];
    await revokeToken(world.install, ADMIN, gone.id);
    const asToken: Actor = { scope: "admin", holder: laptop.id as TokenId };
    world.clock.now = NOW + 1;

    const answers = [
      await changeTokenExpiry(world.install, ADMIN, laptop.id, { expires: "never" }),
      await changeTokenExpiry(world.install, ADMIN, ci.id, { expires: new Date(NOW + 90 * DAY).toISOString() }),
      await changeTokenExpiry(world.install, ADMIN, ci.id, { expires: "7d" }),
      await changeTokenExpiry(world.install, asToken, ci.id, { expires: "never" }),
      await changeTokenExpiry(world.install, OWNER, ci.id, { expires: "never" }),
      await changeTokenExpiry(world.install, ADMIN, ci.id, { expires: new Date(NOW).toISOString() }),
      await changeTokenExpiry(world.install, ADMIN, ci.id, { expires: "soon" }),
      await changeTokenExpiry(world.install, ADMIN, "no-token", { expires: "never" }),
      await changeTokenExpiry(world.install, ADMIN, gone.id, { expires: "never" }),
    ];
    const record = async (id: string): Promise<TokenRecord | undefined> => world.install.database.getToken(id as TokenId);
    const [endless, dated] = [await record(laptop.id), await record(ci.id)];
    const works = async (token: string, of: TokenRecord | undefined, at: number): Promise<boolean> => of !== undefined && (await verifyToken(token, of, at)).ok;

    expect<unknown>(answers).toEqual([
      { ok: true, token: { id: laptop.id, scope: "admin", note: "laptop", created: NOW, expires: "never" } },
      { ok: true, token: { id: ci.id, scope: "publisher", note: "ci", created: NOW, expires: NOW + 90 * DAY } },
      { ok: true, token: { id: ci.id, scope: "publisher", note: "ci", created: NOW, expires: NOW + 1 + 7 * DAY } },
      { ok: false, code: "not_allowed" },
      { ok: false, code: "not_allowed" },
      { ok: false, code: "bad_argument", about: "expires" },
      { ok: false, code: "bad_argument", about: "expires" },
      { ok: false, code: "bad_argument", about: "token" },
      { ok: false, code: "not_found" },
    ]);
    // The admin token outlives its 30 days, and the publisher token ends on its day and not a millisecond later.
    expect([await works(laptop.token, endless, NOW + 400 * DAY), await works(ci.token, dated, NOW + 7 * DAY), await works(ci.token, dated, NOW + 1 + 7 * DAY)]).toEqual([true, true, false]);
    expect((await world.audit()).filter((action) => action === "token_expiry_changed").length).toBe(3);
  });
});
