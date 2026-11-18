// The install's records read and written with a token, through the fake API's query route onto SQLite at core's own schema.
// Without these a repair could mend to settings the Worker does not hold, write to a database of another poplin, or store a user in more than one step.

import { describe, expect, test } from "bun:test";
import { type Login, parseLogin } from "@poplin/core/src/auth/logins";
import { readStored, storeUser } from "../../../../../src/shared/install/upkeep/repair/settings";
import { ACCOUNT, type Account, emptyAccount, TOKEN } from "../../support/fake-install";
import { worldOf } from "../../support/fake-reach";
import { type Store, storeOf } from "../../support/fake-store";

/** The first login of the install, and one more. */
const [OWNER, LOST] = [loginOf("owner@example.com"), loginOf("lost@example.com")];

/** The database the Worker is bound to. */
const ASKED = { accountId: ACCOUNT, databaseId: "database-1" };

/** A step of a later poplin, stamped into the ledger of steps. */
const LATER_STEP = "INSERT INTO schema_steps (step, version, name, description, applied_at, fingerprint) VALUES (?1, '9.9.9', 'later', ?2, ?3, ?4)";

function loginOf(text: string): Login {
  const login = parseLogin(text);
  if (!login.ok) throw new Error(`the test's login was refused: ${login.refusal}`);

  return login.value;
}

/** An account whose database holds what a test gives it, and the world to reach it through. */
async function reached(store: Store, changes: Partial<Account> = {}): Promise<{ readonly account: Account; readonly world: Awaited<ReturnType<typeof worldOf>> }> {
  const account: Account = { ...emptyAccount(), store, ...changes };
  const world = await worldOf(account);

  return { account, world };
}

describe("the settings an install has stored, read with the token", () => {
  // Drift: a repair mends the login and the rules to these settings. Read another way than the Worker's own store reads them, the two would disagree on who may log in.
  test("the settings of an install that has answered are the ones its own store reads, in two calls that write nothing", async () => {
    const store = await storeOf(OWNER);
    const { world } = await reached(store);
    const stored = await readStored({ key: TOKEN, fetch: world.reach.fetch }, ASKED);

    expect<unknown>(stored.state === "stored" ? stored.settings : stored).toEqual(await store.database.readSettings());
    expect(world.asked.map((entry) => `${entry.method} ${entry.path}`)).toEqual(Array(2).fill(`POST /accounts/${ACCOUNT}/d1/database/database-1/query`));
  });

  // Drift: a schema is brought up by the Worker alone. A command that read or wrote a database at another schema would run this poplin's statements on another poplin's tables.
  test.each([
    ["no step has run on: the Worker never answered", async () => storeOf(undefined), {}, { state: "none" }],
    [
      "a later poplin's step is stamped on",
      async () => {
        const store = await storeOf(OWNER);
        await store.call(LATER_STEP, [99, "a later step", 0, "0".repeat(64)]);

        return store;
      },
      {},
      { state: "another" },
    ],
    ["the token may not ask", async () => storeOf(OWNER), { refuse: `POST /accounts/${ACCOUNT}/d1/database/database-1/query`, refuseMessage: "Authentication error" }, { state: "unread", failure: { failure: "refused", status: 403 } }],
    [
      "answers a statement as failed",
      async () => ({ ...(await storeOf(OWNER)), call: async () => [{ results: [], success: false, meta: { changes: 0 } }] }),
      {},
      { state: "unread", failure: { failure: "network" } },
    ],
  ] as const)("a database that %s is not read as settings", async (_, make, changes, state) => {
    const { world } = await reached(await make(), changes);

    expect(await readStored({ key: TOKEN, fetch: world.reach.fetch }, ASKED)).toMatchObject(state);
    expect(world.asked.filter((entry) => /\b(insert|update|delete|create)\b/i.test(JSON.stringify(entry.body)))).toEqual([]);
  });
});

describe("one more user, stored with the token", () => {
  // Drift: D1's API numbers the values over a whole call and runs the call as one transaction. Statements sent one by one, or with each one's own numbers, would store a user without its entry, or bind the wrong value.
  test("the user, the entry of the change, and the mark are one call, whose placeholders are numbered once over all of its statements", async () => {
    const store = await storeOf(OWNER);
    const { world } = await reached(store);
    const stored = await readStored({ key: TOKEN, fetch: world.reach.fetch }, ASKED);
    const before = world.asked.length;
    const kept = stored.state === "stored" ? await storeUser(stored.database, LOST, 1_700_000_000_000) : "unread";
    const sent = world.asked.slice(before).map((entry) => entry.body as { readonly sql: string; readonly params: readonly unknown[] });
    const numbers = [...(sent[0]?.sql.matchAll(/\?(\d+)/g) ?? [])].map((found) => Number(found[1]));
    const [entry] = await store.database.listAudit({ limit: 1 });

    expect([kept, sent.length, sent[0]?.sql.split("; ").length]).toEqual(["added", 1, 4]);
    expect<unknown>(numbers).toEqual(sent[0]?.params.map((_, at) => at + 1));
    expect([(await store.database.readSettings())?.users, entry]).toMatchObject([[OWNER, LOST], { at: 1_700_000_000_000, by: "doctor-repair@poplin.invalid", action: "settings_changed" }]);
  });

  // Drift: an email that is a user already must change nothing: a second entry, or a second mark, would say that the users changed when they did not.
  test("an email that is a user already is answered so, and writes no entry", async () => {
    const store = await storeOf(OWNER);
    const { world } = await reached(store);
    const stored = await readStored({ key: TOKEN, fetch: world.reach.fetch }, ASKED);

    expect(stored.state === "stored" ? await storeUser(stored.database, OWNER, 5) : "unread").toBe("already");
    expect((await store.database.listAudit({ limit: 10 })).map((entry) => entry.action)).toEqual(["settings_set"]);
  });
});
