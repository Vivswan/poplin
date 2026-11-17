// The users carried to the provider after a change of them: what the screen is told, what keeps waiting, and which list the provider ends with.
// Without these a user who was added could wait for a repair nobody is told to press, or the provider could keep an older list while the install says the change is settled.

import { describe, expect, test } from "bun:test";
import type { Login } from "@poplin/core/src/auth/logins";

import type { DomainRow } from "../../../src/console/domain/records";
import { type FollowRefusal, type FollowTry, followUsers, type UsersFollow } from "../../../src/console/access/users-follow";
import { openConsole } from "../support/console";
import { fakePlug } from "../support/fake-plug";
import { openOwned } from "../support/install";

/** Two more users than the owner. */
const [BO, CY] = ["bo@example.com" as Login, "cy@example.com" as Login];

/** The one row of a domain whose login stands. */
const LOGIN_STANDS: readonly DomainRow[] = [{ object: "Login policy", state: "present", detail: "the users", part: "login" }];

/** A test install. */
type Owned = Awaited<ReturnType<typeof openOwned>>;

/** A provider's side of the users written by hand: it holds the last list it took, and records every list it was handed. */
interface FakeFollow extends UsersFollow {
  /** Every list handed over, in order. */
  readonly pushed: (readonly Login[])[];

  /** The list the provider holds, `undefined` before it took any. */
  held: readonly Login[] | undefined;

  /** Whom the provider mails for the install, their emails with commas between them: read, and written only where it differs from the emails a try is handed. */
  mailed: string | undefined;

  /** Whom the next try reads as mailed, in place of who is: a read that trails a write. */
  trails: string | undefined;
}

/**
 * Make a provider's side of the users.
 *
 * @param answer - what a try answers, told how many came before it; a try it leaves alone is taken. It runs while the try is under way, so a test changes the users from it as another admin would meanwhile
 */
function fakeFollow(answer: (earlier: number) => Promise<FollowRefusal | undefined> | FollowRefusal | undefined = () => undefined, holdsKey = true): FakeFollow {
  const follow: FakeFollow = {
    where: "Example Cloud",
    pushed: [],
    held: undefined,
    mailed: undefined,
    trails: undefined,
    holdsKey: () => holdsKey,
    async push(users, alerts) {
      follow.pushed.push(users);
      const refusal = await answer(follow.pushed.length - 1);
      if (refusal !== undefined) return { ok: false, refusal };

      follow.held = users;
      const to = alerts.join(",");
      const stood = (follow.trails ?? follow.mailed) === to;
      follow.trails = undefined;
      if (!stood) follow.mailed = to;

      return { ok: true, stood };
    },
  };

  return follow;
}

/** Keep a first run of the domain, so the install remembers a change of the users, then add a user a moment later and answer the users after it. */
async function added(opened: Owned, login: Login): Promise<readonly Login[]> {
  if ((await opened.install.database.readDomainCheck()) === undefined) {
    await opened.install.database.keepDomainCheck({ ran_at: opened.install.now(), by: opened.owner, run: "repair", pieces: [] }, {});
  }

  opened.clock.now += 1;
  const change = await opened.install.database.addLogin(login, { as: "person", by: opened.owner, at: opened.install.now() });
  if (change.kind !== "done") throw new Error("the user was not added");

  return change.values.users;
}

/** Put another user first, a moment later, as a change of the setting does. */
async function firstIs(opened: Owned, users: readonly Login[]): Promise<void> {
  opened.clock.now += 1;
  await opened.install.database.changeSettings({ users: [...users] }, { as: "person", by: opened.owner, at: opened.install.now() });
}

/** Move the clock a minute on, and answer a try that trusts its reads where nothing changed or tried in that minute, as the scheduled run makes one. */
function aMinuteOn(opened: Owned): FollowTry {
  opened.clock.now += 60_000;

  return { quietSince: opened.install.now() - 30_000 };
}

/** Whether the alerts are marked as changed, with no later read to confirm them. */
async function unconfirmed(opened: Owned): Promise<boolean> {
  return ((await opened.install.database.readDomainCheck())?.alerts_changed_at ?? null) !== null;
}

/** Whether a change of the users waits. An install that keeps no run of its domain remembers none, which is no waiting. */
async function waits(opened: Owned): Promise<boolean> {
  const kept = await opened.install.database.readDomainCheck();

  return kept !== undefined && kept.users_changed_at !== null;
}

async function problems(opened: Owned): Promise<string[]> {
  return (await opened.install.database.listProblems("2000-01-01")).map((problem) => problem.kind);
}

describe("followUsers", () => {
  // Drift: a change the provider took would go on asking for a repair, or one it did not take would read as settled and the new user could not log in with nothing said.
  test("a list the provider took settles the change, and is the list read after it", async () => {
    const opened = await openOwned();
    const follow = fakeFollow();
    await added(opened, BO);

    expect([await waits(opened), await followUsers(opened.install, follow), await waits(opened)]).toEqual([true, { carried: true }, false]);
    expect(follow.pushed).toEqual([[opened.owner, BO]]);
  });

  const refusals: readonly { readonly refusal: FollowRefusal; readonly sentence: string; readonly noted: boolean }[] = [
    { refusal: "key_refused", sentence: "Example Cloud refused poplin's key, so the login list there is as it was. Open Domain and press Repair.", noted: true },
    { refusal: "lacks_right", sentence: "poplin's key may not change the login list at Example Cloud. Open Domain and press Repair.", noted: true },
    { refusal: "not_made", sentence: "The login list at Example Cloud is missing. Open Domain and press Repair.", noted: true },
    { refusal: "unreachable", sentence: "The login list at Example Cloud was not reached; it is tried again by itself.", noted: false },
  ];

  // Drift: every refusal leaves the stored users as they are and the change waiting, with a sentence that names the provider in the provider's own word. One that no later try mends is a problem of the domain; one that mends itself is none.
  test.each(refusals)("a try answered $refusal leaves the change waiting and says what to do", async ({ refusal, sentence, noted }) => {
    const opened = await openOwned();
    await added(opened, BO);
    const followed = await followUsers(opened.install, fakeFollow(() => refusal));

    expect(followed).toEqual({ carried: false, why: refusal, sentence });
    expect([await waits(opened), (await opened.install.database.readSettings())?.users, await problems(opened)]).toEqual([true, [opened.owner, BO], noted ? ["users_not_carried"] : []]);
  });

  const halves: readonly { readonly refusal: FollowRefusal; readonly why: "half_retried" | "half_refused"; readonly sentence: string; readonly noted: boolean }[] = [
    { refusal: "unreachable", why: "half_retried", sentence: "The login list at Example Cloud was written, but the change is not complete; the rest is tried again by itself.", noted: false },
    { refusal: "lacks_right", why: "half_refused", sentence: "The login list at Example Cloud was written, but the change is not complete. Open Domain and press Repair.", noted: true },
    { refusal: "key_refused", why: "half_refused", sentence: "The login list at Example Cloud was written, but the change is not complete. Open Domain and press Repair.", noted: true },
  ];

  // Drift: the provider took the list and refused what else follows the users. Told "the login list there is as it was", an admin would think a removed user still gets in, or add a user twice.
  test.each(halves)("a try that wrote the list and was answered $refusal for the rest says the change is not complete, and claims nothing of the list", async ({ refusal, why, sentence, noted }) => {
    const opened = await openOwned();
    await added(opened, BO);
    const follow: UsersFollow = { where: "Example Cloud", holdsKey: () => true, push: async () => ({ ok: false, refusal, written: true }) };

    expect(await followUsers(opened.install, follow)).toEqual({ carried: false, why, sentence });
    expect([await waits(opened), await problems(opened)]).toEqual([true, noted ? ["users_not_carried"] : []]);
  });

  // Drift: a scheduled retry reads [owner, bo] and its write of the list is slow. Meanwhile cy is added, carried, and settled. The retry's older list then lands, and its request for the rest fails.
  // Answered as a plain refusal, nothing would wait: the provider would hold the list without cy for good, and cy could never log in.
  test("a retry whose older list lands after a newer one was settled, and which is then refused the rest, leaves the change waiting", async () => {
    const opened = await openOwned();
    await added(opened, BO);
    const provider: { held: readonly Login[] } = { held: [] };
    const newer: UsersFollow = {
      where: "Example Cloud",
      holdsKey: () => true,
      push: async (users) => {
        provider.held = users;

        return { ok: true, stood: false };
      },
    };
    const retry: UsersFollow = {
      ...newer,
      push: async (users) => {
        await added(opened, CY);
        const settled = await followUsers(opened.install, newer);
        const between = [settled, provider.held, await waits(opened)];
        provider.held = users;
        expect(between).toEqual([{ carried: true }, [opened.owner, BO, CY], false]);

        return { ok: false, refusal: "unreachable", written: true };
      },
    };
    const followed = await followUsers(opened.install, retry);

    expect([followed.carried, provider.held, await waits(opened)]).toEqual([false, [opened.owner, BO], true]);
    expect(await followUsers(opened.install, newer)).toEqual({ carried: true });
    expect([provider.held, await waits(opened)]).toEqual([[opened.owner, BO, CY], false]);
  });

  // Drift: two changes close together. A list carried while another admin adds a user is stale the moment it lands; settled as it is, the provider would keep it and the second user could not log in.
  test("a list that changed while it was carried is carried again, so the provider ends with the latest", async () => {
    const opened = await openOwned();
    const follow = fakeFollow(async (earlier) => {
      if (earlier === 0) await added(opened, CY);

      return undefined;
    });
    await added(opened, BO);
    const followed = await followUsers(opened.install, follow);

    expect([followed, follow.held, await waits(opened)]).toEqual([{ carried: true }, [opened.owner, BO, CY], false]);
  });

  // Drift: the users change on every try. The second list is stale too, and nothing more is tried in this request: the change must go on waiting, for the scheduled run to carry.
  test("users that change again on the second try are left waiting, and the screen is told they follow by themselves", async () => {
    const opened = await openOwned();
    const more = ["di@example.com" as Login, CY];
    const follow = fakeFollow(async () => {
      const next = more.pop();
      if (next !== undefined) await added(opened, next);

      return undefined;
    });
    await added(opened, BO);
    const followed = await followUsers(opened.install, follow);

    expect(followed).toEqual({ carried: false, why: "changed_again", sentence: "The users changed again meanwhile; the login list at Example Cloud is brought up to date by itself." });
    expect([follow.pushed.length, await waits(opened)]).toEqual([2, true]);
  });

  // Drift: the first user changed to another person and back at once. The second try reads who is mailed as it was before the first one's write, finds it standing, and writes nothing: the other person is mailed on.
  // The list itself is written every time, so the change of the users is settled; what the try compared must stay to be confirmed, or no later run reads the provider again.
  test("a first user put back at once, whose try reads who is mailed as before the first write, settles the users and leaves the rest to confirm; the try that confirms writes it, and the one after it ends the waiting", async () => {
    const opened = await openOwned();
    const follow = fakeFollow();
    follow.mailed = opened.owner;
    await added(opened, BO);
    await firstIs(opened, [BO, opened.owner]);
    await followUsers(opened.install, follow);
    follow.trails = opened.owner;
    await firstIs(opened, [opened.owner, BO]);

    expect([await followUsers(opened.install, follow), follow.mailed, await waits(opened), await unconfirmed(opened)]).toEqual([{ carried: true }, BO, false, true]);
    expect([await followUsers(opened.install, follow, aMinuteOn(opened)), follow.mailed, await unconfirmed(opened)]).toEqual([{ carried: true }, opened.owner, true]);
    // A try that comes at once finds the alerts standing, and is trusted with nothing: its read may be of before the write.
    expect([await followUsers(opened.install, follow, { quietSince: opened.install.now() - 30_000 }), await unconfirmed(opened)]).toEqual([{ carried: true }, true]);
    expect([await followUsers(opened.install, follow, aMinuteOn(opened)), follow.mailed, await waits(opened), await unconfirmed(opened)]).toEqual([{ carried: true }, opened.owner, false, false]);
  });

  // Drift: who gets the alerts is a setting of its own, carried with the users. A change of it that set no mark would be compared by no later run, and a try whose read trailed the last write would leave the alerts going to the users chosen before.
  test("a change of who the alerts go to is carried with the users and marks the alerts by itself; one put back at once, whose try reads the alerts as before the first write, is written by the try that confirms", async () => {
    const opened = await openOwned();
    const follow = fakeFollow();
    const choose = async (chosen: Login[]): Promise<void> => {
      opened.clock.now += 1;
      await opened.install.database.changeSettings({ alert_users: chosen }, { as: "person", by: opened.owner, at: opened.install.now() });
    };
    await added(opened, BO);
    await followUsers(opened.install, follow);
    await followUsers(opened.install, follow, aMinuteOn(opened));
    const before = [follow.mailed, await waits(opened), await unconfirmed(opened)];
    await choose([BO, opened.owner]);
    const marked = [await waits(opened), await unconfirmed(opened)];

    expect([before, marked]).toEqual([
      [opened.owner, false, false],
      [true, true],
    ]);
    expect([await followUsers(opened.install, follow), follow.mailed, await waits(opened)]).toEqual([{ carried: true }, `${BO},${opened.owner}`, false]);

    follow.trails = opened.owner;
    await choose([]);

    expect([await followUsers(opened.install, follow), follow.mailed, await waits(opened), await unconfirmed(opened)]).toEqual([{ carried: true }, `${BO},${opened.owner}`, false, true]);
    expect([await followUsers(opened.install, follow, aMinuteOn(opened)), follow.mailed, await unconfirmed(opened)]).toEqual([{ carried: true }, opened.owner, true]);
    expect([await followUsers(opened.install, follow, aMinuteOn(opened)), follow.mailed, await unconfirmed(opened)]).toEqual([{ carried: true }, opened.owner, false]);
  });

  // Drift: a try that confirms is trusted for its read alone. One that found the rest standing over users that changed while it read would end the waiting for a first user it never compared.
  test("a try that confirms while the users change leaves the rest to confirm", async () => {
    const opened = await openOwned();
    await added(opened, BO);
    const follow = fakeFollow(async (earlier) => {
      if (earlier === 1) await firstIs(opened, [BO, opened.owner]);

      return undefined;
    });
    await followUsers(opened.install, follow);

    expect([await followUsers(opened.install, follow, aMinuteOn(opened)), follow.mailed, await unconfirmed(opened)]).toEqual([{ carried: true }, BO, true]);
  });

  // Drift: an install with no key can carry nothing, so it is asked nothing and writes nothing: the change waits under the mark its own storing set, and Domain says to press Repair.
  test("an install that holds no key is told so with no try at the provider and no statement of the database", async () => {
    const opened = await openOwned();
    const follow = fakeFollow(() => undefined, false);
    await added(opened, BO);
    const before = await opened.install.database.readDomainCheck();
    const followed = await followUsers(opened.install, follow);

    expect(followed).toEqual({ carried: false, why: "no_key", sentence: "poplin holds no key for Example Cloud, so the login list there is as it was. Open Domain and press Repair." });
    expect([follow.pushed, await opened.install.database.readDomainCheck(), await problems(opened)]).toEqual([[], before, []]);
  });

  // Drift: two tries at once. While one carries the newest users, an older list of another admin lands at the provider after it, and that admin's try settles nothing.
  // Settled on the stored users alone, the first try would end the waiting over a provider that holds the older list, and nothing would ever carry the newest.
  test("a try that another try overtook at the provider does not settle the change, and carries the users once more", async () => {
    const opened = await openOwned();
    await added(opened, BO);
    const follow = fakeFollow(async (earlier) => {
      if (earlier === 0) await opened.install.database.settleUsers({ users: [opened.owner], since: 0 }, opened.install.now());

      return undefined;
    });
    const followed = await followUsers(opened.install, follow);

    expect([followed, follow.pushed, await waits(opened)]).toEqual([{ carried: true }, [[opened.owner, BO], [opened.owner, BO]], false]);
  });

  // Drift: an install that never kept a run of its domain has no row to remember a waiting change by, so no scheduled run would carry it. Told "it is tried again by itself", the admin would wait for a login that never comes.
  test("on an install that keeps no run of its domain, a try the provider did not answer is noted as a problem and sends the admin to Repair", async () => {
    const opened = await openOwned();
    await opened.install.database.addLogin(BO, { as: "person", by: opened.owner, at: opened.install.now() });
    const followed = await followUsers(opened.install, fakeFollow(() => "unreachable"));

    expect(followed).toEqual({ carried: false, why: "forgotten", sentence: "The login list at Example Cloud is not up to date. Open Domain and press Repair." });
    expect(await problems(opened)).toEqual(["users_not_carried"]);
  });

  // Drift: the same install, and a try that wrote the list before it was refused the rest. "The login list is not up to date" would be false: it is the rest that is behind.
  test("on an install that keeps no run of its domain, a try that wrote the list and was refused the rest says the change is not complete", async () => {
    const opened = await openOwned();
    const follow: UsersFollow = { where: "Example Cloud", holdsKey: () => true, push: async () => ({ ok: false, refusal: "unreachable", written: true }) };

    expect(await followUsers(opened.install, follow)).toEqual({ carried: false, why: "half_refused", sentence: "The login list at Example Cloud was written, but the change is not complete. Open Domain and press Repair." });
    expect(await problems(opened)).toEqual(["users_not_carried"]);
  });

  // Drift: a try reads [owner, bo] before the install kept any run of its domain. While its write is under way cy is added and a first repair carries all three and is kept. The try's older list then lands, and it is refused the rest.
  // A try that set no mark because it began under none would leave the kept run saying nothing waits, over a provider that holds the list without cy.
  test("a try that began before the install's first run was kept, and is refused after that run, leaves the change waiting under it", async () => {
    const opened = await openOwned();
    await opened.install.database.addLogin(BO, { as: "person", by: opened.owner, at: opened.install.now() });
    const provider: { held: readonly Login[] } = { held: [] };
    const follow: UsersFollow = {
      where: "Example Cloud",
      holdsKey: () => true,
      push: async (users) => {
        await opened.install.database.addLogin(CY, { as: "person", by: opened.owner, at: opened.install.now() });
        const repaired = [opened.owner, BO, CY];
        await opened.install.database.keepDomainCheck({ ran_at: opened.install.now(), by: opened.owner, run: "repair", pieces: [] }, {}, { users: repaired, since: opened.install.now() });
        expect(await waits(opened)).toBe(false);
        provider.held = users;

        return { ok: false, refusal: "unreachable", written: true };
      },
    };
    const followed = await followUsers(opened.install, follow);

    // The run is kept by now, so the scheduled run carries the users again: the words say so, and no problem is noted.
    expect(followed).toEqual({ carried: false, why: "half_retried", sentence: "The login list at Example Cloud was written, but the change is not complete; the rest is tried again by itself." });
    expect([provider.held, await waits(opened), await problems(opened)]).toEqual([[opened.owner, BO], true, []]);
  });
});

describe("the console", () => {
  // Drift: a user added or taken out on the Access screen is carried only if the route hands the door the list after its own change. Carried before the write, or not at all, the provider keeps the old users.
  test("carries the users after each one is added or taken out, and its answer has no note for a change the provider took", async () => {
    const follow = fakeFollow();
    const opened = await openConsole("", fakePlug(() => ({ ok: true, rows: LOGIN_STANDS, steps: [] })), { follow });
    const answers = [await (await opened.change("/data/people/add", { login: BO })).json(), await (await opened.change("/data/people/remove", { login: BO })).json()];
    await opened.change("/data/people/remove", { login: BO });
    await opened.change("/data/people/remove", { login: opened.base.owner });

    expect(answers).toEqual([{ ok: true, login: BO, note: null }, { ok: true, login: BO, note: null }]);
    expect(follow.pushed).toEqual([[opened.base.owner, BO], [opened.base.owner]]);
  });

  // Drift: the change is stored whatever the provider says. A refusal that undid it, or that answered as a failure, would lose a user the admin just typed; one that said nothing would leave them waiting for a login that never comes.
  test("keeps a user the provider did not take, and its answer says what to do", async () => {
    const opened = await openConsole("", fakePlug(() => ({ ok: true, rows: LOGIN_STANDS, steps: [] })), { follow: fakeFollow(() => "unreachable") });
    await opened.change("/data/domain/repair", { token: "a-token" });
    const answer = await opened.change("/data/people/add", { login: BO });

    expect([answer.status, await answer.json()]).toEqual([200, { ok: true, login: BO, note: "The login list at Example Cloud was not reached; it is tried again by itself." }]);
    expect((await opened.base.install.database.readSettings())?.users).toEqual([opened.base.owner, BO]);
  });

  // Drift: a console with no door to the provider carries nothing, so its Domain screen is where a change is carried: the answer must go on pointing there, and say nothing where there is no such screen.
  test.each([
    ["a Domain screen", true, "Next, open Domain and press Repair."],
    ["no Domain screen", false, null],
  ] as const)("without the provider's side of the users, and with %s, a change answers the note %s", async (_name, domain, note) => {
    const opened = await openConsole("", domain ? fakePlug(() => ({ ok: true, rows: LOGIN_STANDS, steps: [] })) : undefined);

    expect(await (await opened.change("/data/people/add", { login: BO })).json()).toEqual({ ok: true, login: BO, note });
  });

  // Drift: "Users changed. Press Repair." is for a change nothing carries by itself. Said on an install that holds a key, it sends a person to paste a token for what the next scheduled run does; left unsaid on one with no key, the new user waits for good.
  test.each([
    ["holds a key", true, [false, "Nothing to repair", null]],
    ["holds no key", false, [true, "Users changed. Press Repair.", "Users changed. Open Domain and press Repair."]],
  ] as const)("Domain asks for a repair after a change the provider did not take only on an install that %s", async (_name, holdsKey, shown) => {
    const follow = fakeFollow(() => (holdsKey ? "unreachable" : "no_key"), holdsKey);
    const opened = await openConsole("", fakePlug(() => ({ ok: true, rows: LOGIN_STANDS, steps: [] })), { follow });
    await opened.change("/data/domain/repair", { token: "a-token" });
    await opened.change("/data/people/add", { login: BO });
    const { last } = (await (await opened.get("/data/domain")).json()) as { readonly last: { readonly waits: boolean; readonly summary: { readonly line: string } } };
    const { domainNote } = (await (await opened.get("/data/frame")).json()) as { readonly domainNote: { readonly sentence: string } | null };

    expect([last.waits, last.summary.line, domainNote?.sentence ?? null]).toEqual([...shown]);
    expect((await opened.base.install.database.readDomainCheck())?.users_changed_at).not.toBeNull();
  });
});
