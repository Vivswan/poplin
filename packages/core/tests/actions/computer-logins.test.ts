import { describe, expect, test } from "bun:test";

import { beginLogin, decideLogin, redeemLogin, showLogin } from "../../src/actions/computer-logins";
import { listTokens } from "../../src/actions/manage-tokens";
import { sweepExpired } from "../../src/actions/sweep";
import { parseUserCode } from "../../src/auth/computer-logins";
import type { Actor } from "../../src/auth/scopes";
import { parseToken, type TokenId } from "../../src/auth/tokens";
import { ADMIN, makeWorld, NOW, OWNER, type World } from "./support/actions-fixture";

/** How many milliseconds a minute holds. */
const MINUTE = 60_000;

/** How many milliseconds a second holds. */
const SECOND = 1000;

/** An admin's token: an admin, and no person behind a session. */
const ADMIN_TOKEN: Actor = { scope: "admin", holder: "00000000000000cc" as TokenId };

/** The visitor a login is begun by where a test names none. */
const VISITOR = "one-visitor";

/** A login begun at the world's clock; the test fails here when it is refused. */
async function begun(world: World, scope: "admin" | "publisher" = "publisher", visitor = VISITOR): Promise<{ readonly code: string; readonly secret: string }> {
  const login = await beginLogin(world.install, { scope, computer: "laptop" }, visitor);
  if (!login.ok) throw new Error(`the fixture login was refused: ${login.code}`);

  return login;
}

/** The stored state of the login under a code, `undefined` when none is stored. */
async function stateOf(world: World, shown: string): Promise<string | undefined> {
  const code = parseUserCode(shown);
  if (code === undefined) throw new Error(`the fixture's code is no code: ${shown}`);

  return (await world.install.database.findComputerLogin(code))?.state;
}

async function tokenCount(world: World): Promise<number> {
  const listed = await listTokens(world.install, ADMIN);

  return listed.ok ? listed.tokens.length : -1;
}

describe("beginLogin", () => {
  // Drift: anyone can ask for a login, so what one is before an admin looks at it must be nothing: no token, no audit entry, and an answer that only says wait.
  test("a begun login grants nothing: its secret is answered pending, no token exists, and nothing is logged", async () => {
    const world = await makeWorld();

    const login = await beginLogin(world.install, { scope: "admin", computer: "laptop" }, VISITOR);
    const secret = login.ok ? login.secret : "";

    expect(login).toEqual({ ok: true, code: expect.stringMatching(/^[BCDFGHJKLMNPQRSTVWXZ]{4}-[BCDFGHJKLMNPQRSTVWXZ]{4}$/), secret: expect.stringMatching(/^poplin_login_[0-9a-f]{16}_[0-9a-f]{64}$/), expires_in: 600, interval: 5 });
    expect([parseToken(secret).ok, await redeemLogin(world.install, { secret }), await tokenCount(world), await world.audit()]).toEqual([false, { ok: true, state: "pending" }, 0, []]);
  });

  // Drift: the name is shown to the admin who decides; a name that could hold a line break or run for pages would let a request dress itself up as part of the page.
  test.each([
    ["a scope that is neither", { scope: "owner", computer: "laptop" }, "scope"],
    ["a name with a line break", { scope: "admin", computer: "laptop\nallowed by ada" }, "computer"],
    ["a name of 101 characters", { scope: "admin", computer: "x".repeat(101) }, "computer"],
    ["a key that is not asked for", { scope: "admin", computer: "laptop", note: "ci" }, "note"],
  ])("refuses %s, and stores nothing", async (_what, request, about) => {
    const world = await makeWorld();

    expect(await beginLogin(world.install, request as Parameters<typeof beginLogin>[1], VISITOR)).toEqual({ ok: false, code: "bad_argument", about });
  });

  // Drift: anyone may begin a login and nobody is asked first. Were the waiting logins counted for everyone together, one address at the pace it is allowed would hold every place and no real computer could log in.
  test("one visitor beginning five logins a minute for thirty minutes keeps three waiting, and another visitor's login is begun, allowed, and collected all the while", async () => {
    const world = await makeWorld();
    const others: boolean[] = [];
    const flood: { readonly secret: string }[] = [];

    for (let minute = 0; minute < 30; minute += 1) {
      for (let sent = 0; sent < 5; sent += 1) {
        world.clock.now = NOW + minute * MINUTE + sent;
        flood.push(await begun(world, "publisher", "flood"));
      }

      const other = await begun(world, "publisher", `other-${minute % 2}`);
      const allowed = await decideLogin(world.install, ADMIN, { code: other.code, allow: true });
      const collected = await redeemLogin(world.install, { secret: other.secret });
      others.push(allowed.ok && collected.ok && collected.state === "allowed");
    }
    const answered = [];
    for (const { secret } of flood.slice(-5)) answered.push(await redeemLogin(world.install, { secret }));

    expect([others.every(Boolean), others.length, await tokenCount(world)]).toEqual([true, 30, 30]);
    expect(answered.map((answer) => answer.ok && answer.state)).toEqual(["expired", "expired", "pending", "pending", "pending"]);
  });

  // Drift: a place is for a login somebody may still decide. A denied or stale one that kept its place would push out one that waits, and an allowed one that lost it would take the token from a computer an admin just let in.
  test("a decided login and one that ran out hold no place, and neither an allowed nor a denied login gives way to a newer one", async () => {
    const world = await makeWorld();
    const stale = await begun(world);
    world.clock.now = NOW + 10 * MINUTE - 2 * SECOND;
    const [allowed, denied] = [await begun(world), await begun(world)];
    await decideLogin(world.install, ADMIN, { code: allowed.code, allow: true });
    await decideLogin(world.install, ADMIN, { code: denied.code, allow: false });
    const waiting = [await begun(world), await begun(world)];
    const kept = await stateOf(world, stale.code);
    world.clock.now = NOW + 10 * MINUTE;
    waiting.push(await begun(world));
    const pending = await Promise.all(waiting.map(({ code }) => stateOf(world, code)));
    for (let more = 0; more < 4; more += 1) await begun(world);

    expect([kept, pending]).toEqual(["pending", ["pending", "pending", "pending"]]);
    expect([await redeemLogin(world.install, { secret: denied.secret }), await redeemLogin(world.install, { secret: allowed.secret })]).toEqual([{ ok: true, state: "denied" }, expect.objectContaining({ ok: true, state: "allowed" })]);
  });

  // Drift: the bound on all waiting logins is what keeps the table small under many addresses. Refusing the newcomer there would let a crowd of addresses do what one cannot; the place is taken from whoever holds the most.
  test("with fifty logins waiting the next visitor is let in, and the oldest login of the visitor with the most is the one that gives way", async () => {
    const world = await makeWorld();
    const single = [];
    for (let visitor = 0; visitor < 47; visitor += 1) single.push(await begun(world, "publisher", `single-${visitor}`));
    const crowd = [];
    for (let sent = 1; sent <= 3; sent += 1) {
      world.clock.now = NOW + sent * SECOND;
      crowd.push(await begun(world, "publisher", "crowd"));
    }

    const next = await begun(world, "publisher", "next");
    const states = async (logins: readonly { readonly code: string }[]): Promise<(string | undefined)[]> => Promise.all(logins.map(({ code }) => stateOf(world, code)));

    expect([await states(crowd), [...new Set(await states([...single, next]))]]).toEqual([[undefined, "pending", "pending"], ["pending"]]);
  });
});

describe("decideLogin", () => {
  // Drift: only a person behind a session lets a computer in. A token that could allow a login would mint itself a successor for ever, and a publisher that could would make itself an admin.
  test.each([
    ["a publisher", OWNER],
    ["an admin's token", ADMIN_TOKEN],
  ])("%s neither sees nor decides a login, which stays pending", async (_who, actor) => {
    const world = await makeWorld();
    const { code, secret } = await begun(world, "admin");

    expect([await showLogin(world.install, actor, code), await decideLogin(world.install, actor, { code, allow: true })]).toEqual([
      { ok: false, code: "not_allowed" },
      { ok: false, code: "not_allowed" },
    ]);
    expect([await redeemLogin(world.install, { secret }), await world.audit()]).toEqual([{ ok: true, state: "pending" }, []]);
  });

  // Drift: the code is typed by a person and travels in an address; one spelling refused would turn a correct code into "no such login".
  test("a code is found however it is typed, shows what it asks for, and is decided once", async () => {
    const world = await makeWorld();
    const { code } = await begun(world);
    const shown: Awaited<ReturnType<typeof showLogin>> = { ok: true, login: { code, scope: "publisher", computer: "laptop", asked: NOW, expires: NOW + 10 * MINUTE } };

    expect([await showLogin(world.install, ADMIN, code.toLowerCase()), await showLogin(world.install, ADMIN, ` ${code.replace("-", " ")} `), await showLogin(world.install, ADMIN, code.replace("-", ""))]).toEqual([
      shown,
      shown,
      shown,
    ]);
    expect([await decideLogin(world.install, ADMIN, { code, allow: false }), await decideLogin(world.install, ADMIN, { code, allow: true }), await showLogin(world.install, ADMIN, code)]).toEqual([
      shown,
      { ok: false, code: "no_such_login" },
      { ok: false, code: "no_such_login" },
    ]);
    expect(await world.audit()).toEqual(["login_denied"]);
  });

  // Drift: a code of the right form names one login in 25 billion; every other code, and a login past its ten minutes, must look the same to whoever tries them.
  test.each([
    ["a code of no login", "BBBB-BBBB", 0],
    ["a text that is no code", "AEIO-U123", 0],
    ["a text far longer than a code", "B".repeat(5000), 0],
    ["the code of a login that ran out", undefined, 10 * MINUTE],
  ])("%s is no login to show or to allow", async (_what, typed, later) => {
    const world = await makeWorld();
    const { code, secret } = await begun(world);
    world.clock.now = NOW + later;

    expect([await showLogin(world.install, ADMIN, typed ?? code), await decideLogin(world.install, ADMIN, { code: typed ?? code, allow: true })]).toEqual([
      { ok: false, code: "no_such_login" },
      { ok: false, code: "no_such_login" },
    ]);
    expect([await redeemLogin(world.install, { secret }), await world.audit()]).toEqual([{ ok: true, state: later === 0 ? "pending" : "expired" }, []]);
  });
});

describe("redeemLogin", () => {
  // Drift: the token leaves the install in this one answer. A second answer, or one to a secret that is not the login's, would hand a token to someone the admin never looked at.
  test("an allowed login answers its token once, to its own secret alone, and the token is the scope that was asked", async () => {
    const world = await makeWorld();
    const { code, secret } = await begun(world);
    const other = await begun(world);
    await decideLogin(world.install, ADMIN, { code, allow: true });
    const forged = `${secret.slice(0, -1)}${secret.endsWith("0") ? "1" : "0"}`;

    const answers = [await redeemLogin(world.install, { secret: forged }), await redeemLogin(world.install, { secret: other.secret }), await redeemLogin(world.install, { secret })];
    const again = [await redeemLogin(world.install, { secret }), await redeemLogin(world.install, { secret: forged })];

    expect(answers).toEqual([
      { ok: true, state: "expired" },
      { ok: true, state: "pending" },
      { ok: true, state: "allowed", token: expect.stringMatching(/^poplin_[0-9a-f]{16}_[0-9a-f]{64}$/), record: { id: expect.any(String), scope: "publisher", note: "laptop", created: NOW, expires: "never" } },
    ]);
    expect([again, await tokenCount(world), await world.audit()]).toEqual([[{ ok: true, state: "expired" }, { ok: true, state: "expired" }], 1, ["login_allowed", "token_added"]]);
  });

  // Drift: two terminals holding one secret, or one that asks twice at once, must not each be given a token.
  test("of questions asked at the same moment one is answered the token", async () => {
    const world = await makeWorld();
    const { code, secret } = await begun(world, "admin");
    await decideLogin(world.install, ADMIN, { code, allow: true });

    const answers = await Promise.all([1, 2, 3].map(() => redeemLogin(world.install, { secret })));

    expect([answers.map((answer) => (answer.ok ? answer.state : answer.code)).sort(), await tokenCount(world)]).toEqual([["allowed", "expired", "expired"], 1]);
  });

  // Drift: every state but allowed must end in no token, and say which it is, so a terminal knows whether to wait or to stop.
  test("a denied login answers denied, one allowed too late answers expired, and neither makes a token", async () => {
    const world = await makeWorld();
    const [denied, late] = [await begun(world), await begun(world)];
    await decideLogin(world.install, ADMIN, { code: denied.code, allow: false });
    await decideLogin(world.install, ADMIN, { code: late.code, allow: true });

    const refused = await redeemLogin(world.install, { secret: denied.secret });
    world.clock.now = NOW + 10 * MINUTE;

    expect([refused, await redeemLogin(world.install, { secret: late.secret }), await tokenCount(world)]).toEqual([{ ok: true, state: "denied" }, { ok: true, state: "expired" }, 0]);
  });

  // Drift: a terminal that asks without pause costs a write a request; the answer that tells it to wait longer is the only brake it is given.
  test("a question under five seconds after the one before it is told to slow down, and one after five seconds is not", async () => {
    const world = await makeWorld();
    const { secret } = await begun(world);
    const states: string[] = [];

    for (const at of [0, 1, 4999, 5000, 5001, 10_000]) {
      world.clock.now = NOW + at;
      const answer = await redeemLogin(world.install, { secret });
      states.push(answer.ok ? answer.state : answer.code);
    }

    expect(states).toEqual(["pending", "slow_down", "slow_down", "pending", "slow_down", "pending"]);
  });

  // Drift: the body comes from anyone; a value of another form must be refused as an argument, never read as a secret or thrown on.
  test.each([
    ["no secret", {}, "secret"],
    ["a secret that is a number", { secret: 7 }, "secret"],
    ["a secret of a megabyte", { secret: "x".repeat(1_000_000) }, "secret"],
    ["a key beside the secret", { secret: "x", token: "y" }, "token"],
  ])("refuses %s", async (_what, request, about) => {
    const world = await makeWorld();

    expect(await redeemLogin(world.install, request as Parameters<typeof redeemLogin>[1])).toEqual({ ok: false, code: "bad_argument", about });
  });
});

describe("the sweep", () => {
  // Drift: a login nobody decided or collected has no other way out of the table; without the sweep each one would stay for good.
  test("the last step of a walk removes the logins that ran out and leaves the ones still waiting", async () => {
    const world = await makeWorld();
    const old = await begun(world);
    world.clock.now = NOW + 9 * MINUTE + 59 * SECOND;
    const waiting = await begun(world);
    world.clock.now = NOW + 10 * MINUTE;

    const steps = [];
    for (const from of [{ trash: false }, { trash: true }, { uploads: true }, { leftovers: true }] as const) steps.push(await sweepExpired(world.install, ADMIN, { limit: 10, from }));

    expect(steps.map((step) => (step.ok ? step.logins : step.code))).toEqual([0, 0, 0, 1]);
    expect([await redeemLogin(world.install, { secret: old.secret }), await redeemLogin(world.install, { secret: waiting.secret })]).toEqual([
      { ok: true, state: "expired" },
      { ok: true, state: "pending" },
    ]);
    expect(await Promise.all([old.code, waiting.code].map((code) => stateOf(world, code)))).toEqual([undefined, "pending"]);
  });
});
