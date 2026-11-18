// The three login methods against the fake API of an account.
// Without these a run could make a second method beside the owner's own, name a method by a name anyone may change, or stop at Cloudflare's refusal of a method that stands.

import { expect, test } from "bun:test";
import { offeredMethods, readLoginMethods, syncLoginMethods } from "../../../../../src/shared/install/pieces/access/login-method";
import { withFake } from "../../support/fake-cloudflare";
import { ACCOUNT, type Account, answer, emptyAccount, TOKEN } from "../../support/fake-install";
import type { Asked } from "../../support/replies";

/** A method of each of the two kinds poplin makes, as an owner made it, under a name of their own. */
const THEIRS = [
  { id: "their-code", name: "Email login", type: "onetimepin", config: {} },
  { id: "their-passkeys", name: "Keys", type: "passkeys", config: {} },
];

/** The method of the account's own members, as the fake account comes with it. */
const OWN = { Cloudflare: "method-cloudflare" };

function writes(asked: readonly Asked[]): string[] {
  return asked.filter((entry) => entry.method !== "GET").map((entry) => `${entry.method} ${entry.path} ${JSON.stringify(entry.body)}`);
}

async function withAccount(account: Account, run: (connection: Parameters<typeof syncLoginMethods>[0], asked: readonly Asked[]) => Promise<void>): Promise<void> {
  await withFake(
    (asked) => answer(account, asked),
    (connection, asked) => run({ ...connection, key: TOKEN }, asked),
  );
}

// Drift: Cloudflare's page on each method documents the type and the configuration. Sent another way, the method is refused or made as another kind.
test("an account with its own method alone keeps it and gets the other two, each as Cloudflare documents it; a plan before says the same and sends nothing, and a run after leaves all three", async () => {
  const account = emptyAccount();
  const path = `/accounts/${ACCOUNT}/access/identity_providers`;

  await withAccount(account, async (connection, asked) => {
    const planned = await syncLoginMethods(connection, ACCOUNT, "plan");
    const made = await syncLoginMethods(connection, ACCOUNT, "apply");
    const sent = asked.length;
    const again = await syncLoginMethods(connection, ACCOUNT, "apply");

    expect([planned.ok && planned.report.created, planned.held, made.ok && made.report.created, made.held]).toEqual([["One-time PIN", "Passkeys"], OWN, ["One-time PIN", "Passkeys"], { ...OWN, "One-time PIN": "made-1", Passkeys: "made-2" }]);
    expect(writes(asked)).toEqual([
      `POST ${path} {"name":"One-time PIN","type":"onetimepin","config":{}}`,
      `POST ${path} {"name":"Passkeys","type":"passkeys","config":{"login_page_auto_prompt":false}}`,
    ]);
    expect([again.ok && again.report.left, again.held, writes(asked.slice(sent))]).toEqual([["Cloudflare", "One-time PIN", "Passkeys"], made.held, []]);
  });
});

// Drift: the methods are the account's, and an owner may have made and named them. Found by name, theirs would be missed and a second one asked for, which Cloudflare refuses for the code.
test("methods an owner made under other names are found by their type and left: nothing is sent but the list", async () => {
  const account = { ...emptyAccount(), methods: [...emptyAccount().methods, ...THEIRS] };

  await withAccount(account, async (connection, asked) => {
    const synced = await syncLoginMethods(connection, ACCOUNT, "apply");

    expect([synced.ok && synced.report.left, synced.held, writes(asked), account.methods.length]).toEqual([["Cloudflare", "One-time PIN", "Passkeys"], { ...OWN, "One-time PIN": "their-code", Passkeys: "their-passkeys" }, [], 3]);
    expect(await readLoginMethods(connection, ACCOUNT)).toEqual({ ok: true, value: synced.held });
  });
});

// Drift: Cloudflare takes one method that mails a code an account. A list that trails the making of it shows none, and the refusal of a second would stop every run until the list caught up.
test("a code method the list did not show yet is refused as a second one: the run reads the list again, takes the one that stands, and goes on to the passkeys", async () => {
  const account = { ...emptyAccount(), methods: [...emptyAccount().methods, THEIRS[0] ?? {}] };
  account.trails = { [`/accounts/${ACCOUNT}/access/identity_providers`]: [emptyAccount().methods] };

  await withAccount(account, async (connection) => {
    const synced = await syncLoginMethods(connection, ACCOUNT, "apply");

    expect([synced.ok, synced.held, account.methods.map((method) => method.type)]).toEqual([true, { ...OWN, "One-time PIN": "their-code", Passkeys: "made-2" }, ["cloudflare", "onetimepin", "passkeys"]]);
  });
});

// Drift: Cloudflare answers a key with no right to the identity providers an empty list, with no refusal. Believed, a run would ask for a second code method on an account that has one, and a check would say both are missing.
test("an empty list from a key that may not read the team is a refusal, and nothing is made; an account that truly has no identity provider gets the two poplin makes, and its own is no step and never made", async () => {
  const unread = { ...emptyAccount(), methods: [], refuse: `GET /accounts/${ACCOUNT}/access/organizations` };
  const none: Account = { ...emptyAccount(), methods: [] };

  await withAccount(unread, async (connection, asked) => {
    expect([await syncLoginMethods(connection, ACCOUNT, "apply"), writes(asked)]).toMatchObject([{ ok: false, failure: "refused", status: 403, held: {} }, []]);
  });
  await withAccount(none, async (connection) => {
    const planned = await syncLoginMethods(connection, ACCOUNT, "plan");
    const made = await syncLoginMethods(connection, ACCOUNT, "apply");
    const both = ["One-time PIN", "Passkeys"];

    expect([planned.ok && planned.report.created, offeredMethods(planned.held, ""), made.ok && made.report.created, made.held, offeredMethods(made.held)]).toEqual([
      both,
      ["", ""],
      both,
      { "One-time PIN": "made-0", Passkeys: "made-1" },
      ["made-0", "made-1"],
    ]);
    expect(none.methods.map((method) => method.type)).toEqual(["onetimepin", "passkeys"]);
  });
});

// Drift: a refusal that lost the method made before it would leave the application offering every method of the account though the code stands.
test("a refusal of the passkeys is a value that still names the code method the run made, the step that failed, and nothing of the passkeys", async () => {
  const account = { ...emptyAccount(), noPasskeys: true };

  await withAccount(account, async (connection) => {
    const synced = await syncLoginMethods(connection, ACCOUNT, "apply");

    expect(synced).toMatchObject({ ok: false, failure: "refused", status: 400, failed: "Passkeys", report: { created: ["One-time PIN"] }, held: { "One-time PIN": "made-1" } });
  });
});
