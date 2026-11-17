import { describe, expect, test } from "bun:test";

import { beginLogin, decideLogin, listLogins, redeemLogin, showLogin } from "../../../src/actions/access/computer-logins";
import { listTokens } from "../../../src/actions/access/manage-tokens";
import { sweepExpired } from "../../../src/actions/install/sweep";
import { type LoginId, parseLoginSecret, parseUserCode } from "../../../src/auth/computer-logins";
import type { Actor } from "../../../src/auth/scopes";
import { parseToken, type TokenId } from "../../../src/auth/tokens";
import { ADMIN, makeWorld, NOW, OWNER, type World } from "../support/actions-fixture";

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

/** The id of a begun login, which its secret starts with. */
function idOf(login: { readonly secret: string }): LoginId {
  return parseLoginSecret(login.secret) ?? ("" as LoginId);
}

/** The decision that lets a begun login in, as a person who sees its terminal makes it: with the last four letters of its code. */
function allowing(login: { readonly code: string; readonly secret: string }, scope: "admin" | "publisher" = "publisher"): Parameters<typeof decideLogin>[2] {
  return { login: idOf(login), allow: true, scope, letters: login.code.slice(-4) };
}

/** The decision that keeps a begun login out. */
function denying(login: { readonly secret: string }): Parameters<typeof decideLogin>[2] {
  return { login: idOf(login), allow: false };
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

  // Drift: the name is shown to the admin who decides; a name that could hold a line break, run for pages, or turn its letters around would let a request dress itself up as part of the page.
  test.each([
    ["a scope that is neither", { scope: "owner", computer: "laptop" }, "scope"],
    ["a name with a line break", { scope: "admin", computer: "laptop\nallowed by ada" }, "computer"],
    ["a name with a tab", { scope: "admin", computer: "laptop\tada" }, "computer"],
    ["a name with a line separator", { scope: "admin", computer: "laptop\u2028allowed by ada" }, "computer"],
    ["a name with a paragraph separator", { scope: "admin", computer: "laptop\u2029allowed by ada" }, "computer"],
    ["a name whose letters an override turns around", { scope: "admin", computer: "laptop \u202Eada yb dewolla" }, "computer"],
    ["a name with an isolate that turns its letters around", { scope: "admin", computer: "\u2067laptop\u2069" }, "computer"],
    ["a name with a right-to-left mark", { scope: "admin", computer: "laptop\u200F" }, "computer"],
    ["a name with a space of no width", { scope: "admin", computer: "lap\u200Btop" }, "computer"],
    ["a name with a byte order mark", { scope: "admin", computer: "\uFEFFlaptop" }, "computer"],
    ["a name with half of a pair", { scope: "admin", computer: "laptop\uD83D" }, "computer"],
    ["a name of 101 characters", { scope: "admin", computer: "x".repeat(101) }, "computer"],
    ["a key that is not asked for", { scope: "admin", computer: "laptop", note: "ci" }, "note"],
  ])("refuses %s, and stores nothing", async (_what, request, about) => {
    const world = await makeWorld();

    expect(await beginLogin(world.install, request as Parameters<typeof beginLogin>[1], VISITOR)).toEqual({ ok: false, code: "bad_argument", about });
  });

  // Drift: a rule that refused more than what hides or turns text would lock out a computer named in another script.
  test.each([
    ["none", ""],
    ["one of 100 characters", "x".repeat(100)],
    ["one with spaces and marks", "Ada's laptop (studio) #2"],
    ["one in another script", "\u05DE\u05D7\u05E9\u05D1 \u0634\u0628\u0643\u0629 \u30CE\u30FC\u30C8"],
    ["one with a picture of two code units", "laptop \u{1F4BB}"],
  ])("takes a name that is %s, and lists it as given", async (_what, computer) => {
    const world = await makeWorld();
    const login = await beginLogin(world.install, { scope: "publisher", computer }, VISITOR);
    const listed = await listLogins(world.install, ADMIN);

    expect([login.ok, listed.ok ? listed.logins.map((entry) => entry.computer) : undefined]).toEqual([true, [computer]]);
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
      const allowed = await decideLogin(world.install, ADMIN, allowing(other));
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
    await decideLogin(world.install, ADMIN, allowing(allowed));
    await decideLogin(world.install, ADMIN, denying(denied));
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

describe("listLogins", () => {
  // Drift: the list is where an admin picks a login to review. One that held a decided or stale login would offer a dead end, and one a token could read would show it who is about to log in.
  test("an admin behind a session is listed the logins that wait, the newest first, without a secret; a token and a publisher are listed none", async () => {
    const world = await makeWorld();
    const [first, denied, allowed] = [await begun(world, "admin"), await begun(world, "publisher", "another-visitor"), await begun(world, "publisher", "a-third-visitor")];
    world.clock.now = NOW + MINUTE;
    const recent = await begun(world, "publisher", "a-fourth-visitor");
    await decideLogin(world.install, ADMIN, denying(denied));
    await decideLogin(world.install, ADMIN, allowing(allowed));

    const listed = await listLogins(world.install, ADMIN);
    world.clock.now = NOW + 10 * MINUTE;

    expect(listed).toEqual({
      ok: true,
      logins: [
        { id: idOf(recent), scope: "publisher", computer: "laptop", asked: NOW + MINUTE, expires: NOW + 11 * MINUTE },
        { id: idOf(first), scope: "admin", computer: "laptop", asked: NOW, expires: NOW + 10 * MINUTE },
      ],
    });
    expect(JSON.stringify(listed).includes(first.secret.slice(-64))).toBe(false);
    expect([await listLogins(world.install, ADMIN), await listLogins(world.install, ADMIN_TOKEN), await listLogins(world.install, OWNER)]).toEqual([
      { ok: true, logins: [expect.objectContaining({ id: idOf(recent) })] },
      { ok: false, code: "not_allowed" },
      { ok: false, code: "not_allowed" },
    ]);
  });
});

describe("decideLogin", () => {
  // Drift: only a person behind a session lets a computer in. A token that could allow a login would mint itself a successor for ever, and a publisher that could would make itself an admin.
  test.each([
    ["a publisher", OWNER],
    ["an admin's token", ADMIN_TOKEN],
  ])("%s neither sees nor decides a login, which stays pending", async (_who, actor) => {
    const world = await makeWorld();
    const login = await begun(world, "admin");
    const { secret } = login;

    expect([await showLogin(world.install, actor, idOf(login)), await decideLogin(world.install, actor, allowing(login))]).toEqual([
      { ok: false, code: "not_allowed" },
      { ok: false, code: "not_allowed" },
    ]);
    expect([await redeemLogin(world.install, { secret }), await world.audit()]).toEqual([{ ok: true, state: "pending" }, []]);
  });

  // Drift: the admin's choice at Allow is the last word on what a computer may do. A choice that could raise a publisher's request, was dropped on the way, or was left out and read as "what it asked" would hand out an admin's token nobody chose.
  test.each([
    ["an admin's request lowered to a publisher's", "admin", "publisher", "publisher"],
    ["an admin's request allowed as asked", "admin", "admin", "admin"],
    ["an admin's request allowed with no scope named", "admin", undefined, undefined],
    ["a publisher's request allowed as asked", "publisher", "publisher", "publisher"],
    ["a publisher's request raised to an admin's", "publisher", "admin", undefined],
  ] as const)("%s", async (_what, asks, scope, becomes) => {
    const world = await makeWorld();
    const login = await begun(world, asks);
    const { secret } = login;
    const { scope: named, ...unnamed } = allowing(login, scope) as Extract<Parameters<typeof decideLogin>[2], { allow: true }>;

    const decided = await decideLogin(world.install, ADMIN, (scope === undefined ? unnamed : { ...unnamed, scope: named }) as Parameters<typeof decideLogin>[2]);
    const redeemed = await redeemLogin(world.install, { secret });

    if (becomes === undefined) {
      expect([decided, redeemed, await world.audit()]).toEqual([{ ok: false, code: "bad_argument", about: "scope" }, { ok: true, state: "pending" }, []]);

      return;
    }

    expect(decided).toMatchObject({ ok: true, login: { scope: becomes } });
    expect(redeemed).toMatchObject({ ok: true, state: "allowed", record: { scope: becomes } });
    expect(await world.audit()).toEqual(["login_allowed", "token_added"]);
  });

  // Drift: the letters are typed by a person; one spelling refused would lock out the person who did everything asked.
  test.each([
    ["the last four letters", (code: string) => code.slice(-4)],
    ["the last four in small letters, with spaces", (code: string) => ` ${code.slice(-4, -2).toLowerCase()} ${code.slice(-2).toLowerCase()} `],
    ["the whole code", (code: string) => code],
    ["the whole code in small letters, without its dash", (code: string) => code.replace("-", "").toLowerCase()],
  ])("a login is allowed by %s, and is decided once", async (_what, typed) => {
    const world = await makeWorld();
    const login = await begun(world);
    const shown: Awaited<ReturnType<typeof showLogin>> = { ok: true, login: { id: idOf(login), scope: "publisher", computer: "laptop", asked: NOW, expires: NOW + 10 * MINUTE } };

    expect([await showLogin(world.install, ADMIN, idOf(login)), await decideLogin(world.install, ADMIN, { ...allowing(login), letters: typed(login.code) } as Parameters<typeof decideLogin>[2])]).toEqual([shown, shown]);
    expect([await decideLogin(world.install, ADMIN, denying(login)), await decideLogin(world.install, ADMIN, allowing(login)), await showLogin(world.install, ADMIN, idOf(login))]).toEqual([
      { ok: false, code: "no_such_login" },
      { ok: false, code: "no_such_login" },
      { ok: false, code: "no_such_login" },
    ]);
    expect(await world.audit()).toEqual(["login_allowed"]);
  });

  // Drift: the letters are the one thing a stranger who began a login and sent its address cannot give the admin a page to read them from. Any text but the code's own end must let nobody in, and tell nothing of the code.
  test.each([
    ["no letters", () => ""],
    ["three of the last four", (code: string) => code.slice(-3)],
    ["the last four with one changed", (code: string) => `${code.slice(-4, -1)}${code.endsWith("B") ? "C" : "B"}`],
    ["the last five", (code: string) => code.replace("-", "").slice(-5)],
    ["the code twice", (code: string) => `${code}${code}`],
    ["a text far longer than a code", () => "B".repeat(5000)],
    ["the code of another login", (_code: string, other: string) => other],
  ])("a login is not allowed by %s, stays pending, and can still be allowed", async (_what, typed) => {
    const world = await makeWorld();
    const [login, other] = [await begun(world, "admin"), await begun(world, "admin", "another-visitor")];
    const refused = await decideLogin(world.install, ADMIN, { ...allowing(login, "admin"), letters: typed(login.code, other.code) } as Parameters<typeof decideLogin>[2]);

    expect([refused, await redeemLogin(world.install, { secret: login.secret }), await world.audit()]).toEqual([{ ok: false, code: "not_confirmed", about: "letters" }, { ok: true, state: "pending" }, []]);
    expect(JSON.stringify(refused)).not.toContain(login.code.slice(-4));
    expect(await decideLogin(world.install, ADMIN, allowing(login, "admin"))).toMatchObject({ ok: true });
  });

  // Drift: no answer an admin's page is given may hold a part of a code: a page that held the half a person types could show it, and one that held the other half would give the answer for a code whose halves are the same.
  test("what is listed, shown, and answered at a decision holds neither half of a code", async () => {
    const world = await makeWorld();
    const login = await begun(world, "admin");
    const answers = [await listLogins(world.install, ADMIN), await showLogin(world.install, ADMIN, idOf(login)), await decideLogin(world.install, ADMIN, denying(login))];
    const text = JSON.stringify(answers);

    expect([answers.map((answer) => answer.ok), text.includes(login.code.slice(0, 4)), text.includes(login.code.slice(-4))]).toEqual([[true, true, true], false, false]);
  });

  // Drift: an id of the right form names one login; every other text, a code where an id goes, and a login past its ten minutes must look the same to whoever tries them.
  test.each([
    ["an id of no login", () => "0".repeat(16), 0],
    ["the login's code where its id goes", (login: { readonly code: string }) => login.code, 0],
    ["a text far longer than an id", () => "b".repeat(5000), 0],
    ["the id of a login that ran out", (login: { readonly secret: string }) => idOf(login), 10 * MINUTE],
  ])("%s is no login to show or to allow", async (_what, named, later) => {
    const world = await makeWorld();
    const login = await begun(world);
    world.clock.now = NOW + later;

    expect([await showLogin(world.install, ADMIN, named(login)), await decideLogin(world.install, ADMIN, { ...allowing(login), login: named(login) } as Parameters<typeof decideLogin>[2])]).toEqual([
      { ok: false, code: "no_such_login" },
      { ok: false, code: "no_such_login" },
    ]);
    expect([await redeemLogin(world.install, { secret: login.secret }), await world.audit()]).toEqual([{ ok: true, state: later === 0 ? "pending" : "expired" }, []]);
  });
});

describe("redeemLogin", () => {
  // Drift: the token leaves the install in this one answer. A second answer, or one to a secret that is not the login's, would hand a token to someone the admin never looked at.
  test("an allowed login answers its token once, to its own secret alone, and the token is the scope that was asked", async () => {
    const world = await makeWorld();
    const { code, secret } = await begun(world);
    const other = await begun(world);
    await decideLogin(world.install, ADMIN, allowing({ code, secret }));
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
    await decideLogin(world.install, ADMIN, allowing({ code, secret }));

    const answers = await Promise.all([1, 2, 3].map(() => redeemLogin(world.install, { secret })));

    expect([answers.map((answer) => (answer.ok ? answer.state : answer.code)).sort(), await tokenCount(world)]).toEqual([["allowed", "expired", "expired"], 1]);
  });

  // Drift: every state but allowed must end in no token, and say which it is, so a terminal knows whether to wait or to stop.
  test("a denied login answers denied, one allowed too late answers expired, and neither makes a token", async () => {
    const world = await makeWorld();
    const [denied, late] = [await begun(world), await begun(world)];
    await decideLogin(world.install, ADMIN, denying(denied));
    await decideLogin(world.install, ADMIN, allowing(late));

    const refused = await redeemLogin(world.install, { secret: denied.secret });
    world.clock.now = NOW + 10 * MINUTE;

    expect([refused, await redeemLogin(world.install, { secret: late.secret }), await tokenCount(world)]).toEqual([{ ok: true, state: "denied" }, { ok: true, state: "expired" }, 0]);
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
