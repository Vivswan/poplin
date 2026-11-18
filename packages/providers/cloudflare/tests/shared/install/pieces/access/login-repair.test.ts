// The login put back with the kept key, against a whole account at the fake Cloudflare API.
// Without these a repair could write a login that stands, pass its count of calls, write the Worker's variable for an application that was never made, read as done when Cloudflare refused it, or give the key away in an answer.

import { describe, expect, test } from "bun:test";
import type { Login } from "@poplin/core/src/auth/logins";
import type { Hostname } from "@poplin/core/src/names/hostname";
import { readKeptKey } from "../../../../../src/shared/install/key/kept-key";
import { createLoginRepair, type LoginRepair } from "../../../../../src/shared/install/pieces/access/login-repair";
import { INSTALL_OBJECTS } from "../../../../../src/shared/install/install-objects";
import { withFake } from "../../support/fake-cloudflare";
import { ACCOUNT, type Account, answer, emptyAccount, TEAM, TOKEN } from "../../support/fake-install";
import { type Asked, reply } from "../../support/replies";

/** The users the login is made to let through. */
const USERS = ["zoe@example.com", "ada@example.com"] as Login[];

/** Where the login stands: the dashboard's hostname and the private sites' pattern of an install under example.com. */
const PLACE = { accountId: ACCOUNT, script: "poplin", adminHost: "poplin.example.com" as Hostname, privateSites: "*-p-poplin.example.com" };

/** The requests the sweep's table says a repair sends at the most, where each list of the account fits one page. */
const MOST_CALLS = 16;

/** The account's two login methods a repair with a token makes, as it leaves them. */
const METHODS = [
  { id: "code-1", name: "One-time PIN", type: "onetimepin", config: {} },
  { id: "passkeys-1", name: "Passkeys", type: "passkeys", config: {} },
];

/** Every piece a repair writes, in the order it writes them where it makes them all or changes them all. */
const PIECES = [INSTALL_OBJECTS.accessOpenPolicy, INSTALL_OBJECTS.accessOpenApplication, INSTALL_OBJECTS.accessPolicy, INSTALL_OBJECTS.accessApplication, INSTALL_OBJECTS.accessBinding];

/** The ways a repair stops, each with what the account answers, the refusal, and what the repair wrote before it stopped. */
const stopped: readonly { readonly name: string; readonly change: (account: Account) => void; readonly refusal: string; readonly wrote: readonly string[] }[] = [
  {
    name: "Access switched off for the account",
    change: (account) => {
      account.accessOff = true;
    },
    refusal: "access_off",
    wrote: [],
  },
  {
    name: "a key Cloudflare no longer takes",
    change: (account) => {
      account.refuse = `GET /accounts/${ACCOUNT}/access/policies`;
      account.refuseAs = { status: 401, code: 10_000 };
    },
    refusal: "key_refused",
    wrote: [],
  },
  {
    name: "a key with no right to write an application",
    change: (account) => {
      account.refuse = `POST /accounts/${ACCOUNT}/access/apps`;
    },
    refusal: "lacks_right",
    wrote: [INSTALL_OBJECTS.accessOpenPolicy],
  },
  {
    name: "a key with no right to write the Worker",
    change: (account) => {
      account.refuse = `PATCH /accounts/${ACCOUNT}/workers/scripts/poplin/settings`;
    },
    refusal: "lacks_right",
    wrote: PIECES.slice(0, 4),
  },
];

/** The login method of the account's own members, which every account comes with. */
const OWN_METHOD = emptyAccount().methods;

/** An account with nothing of poplin's in it but its own login method and those two, which the key reads and may not make. */
function withMethods(): Account {
  const account = emptyAccount();

  return { ...account, methods: [...account.methods, ...METHODS] };
}

/** The writes among what was asked, each as its method and its path. */
function writes(asked: readonly Asked[]): string[] {
  return asked.filter((entry) => entry.method !== "GET").map((entry) => `${entry.method} ${entry.path.split("?")[0]}`);
}

/** Run a test with a repair that holds a key of the account, over the fake API answering as `respond` says. */
async function withRepair(respond: (asked: Asked) => Response, run: (login: LoginRepair, asked: readonly Asked[]) => Promise<void>): Promise<void> {
  await withFake(respond, async (connection, asked) => run(createLoginRepair(readKeptKey(TOKEN, { baseUrl: connection.baseUrl }), PLACE), asked));
}

describe("createLoginRepair", () => {
  // Drift: the sweep fits its steps around the calls a repair says it sent, and its table states 16 for an account whose lists fit a page each.
  // A repair that sent more, counted fewer than it sent, or wrote a login that stands would pass what one invocation may send.
  test("writes every piece of a login the account holds none of, nothing of one that stands, and every piece of one that differs throughout, and counts every request it sent, 16 at the most", async () => {
    const account = withMethods();

    await withRepair(
      (asked) => answer(account, asked),
      async (login, asked) => {
        const first = await login.repair(USERS);
        const made = asked.length;
        const second = await login.repair(USERS);

        expect<unknown>([first, second]).toEqual([
          { wrote: PIECES, users: true, calls: first.calls },
          { wrote: [], users: false, calls: asked.length - made },
        ]);
        // The SDK asks its `fetch` once, with no request to Cloudflare, how a form is sent: the first repair counts that one too.
        expect([first.calls - made, first.calls <= MOST_CALLS, writes(asked).length]).toEqual([1, true, 5]);

        // The costliest repair: every list holds a page, and each of the five pieces differs.
        for (const held of [...account.policies, ...account.applications]) Object.assign(held, { decision: "deny", session_duration: "1h" });
        account.bindings = account.bindings.filter((binding) => binding.name !== INSTALL_OBJECTS.accessBinding);
        const third = await login.repair(USERS);

        expect<unknown>([third.wrote, third.users, third.calls <= MOST_CALLS]).toEqual([PIECES, true, true]);
        expect(account.policies.find((policy) => policy.name === INSTALL_OBJECTS.accessPolicy)?.include).toEqual([{ email: { email: "ada@example.com" } }, { email: { email: "zoe@example.com" } }]);
        expect(account.bindings.find((binding) => binding.name === INSTALL_OBJECTS.accessBinding)?.json).toEqual({ team_domain: TEAM, audience: account.applications.find((application) => application.name === INSTALL_OBJECTS.accessApplication)?.aud });
      },
    );
  });

  // Drift: a policy somebody edited at Cloudflare lets the wrong people through, and the stored users get Cloudflare's own refusal with no word of poplin's: only a repair that writes the stored users over it lets them in again.
  test("writes the stored users over a policy that lets another email through, and leaves the pieces that stand", async () => {
    const account = withMethods();

    await withRepair(
      (asked) => answer(account, asked),
      async (login) => {
        await login.repair(USERS);
        const held = (): Account["policies"][number] | undefined => account.policies.find((policy) => policy.name === INSTALL_OBJECTS.accessPolicy);
        Object.assign(held() ?? {}, { include: [{ email: { email: "stranger@example.com" } }] });
        const repaired = await login.repair(USERS);

        expect<unknown>([repaired.wrote, repaired.users, held()?.include]).toEqual([[INSTALL_OBJECTS.accessPolicy], true, [{ email: { email: "ada@example.com" } }, { email: { email: "zoe@example.com" } }]]);
      },
    );
  });

  // Drift: a refusal read as done would leave a broken login with nobody told, and one that hid what was written before it would keep those writes out of Activity.
  // One that carried Cloudflare's words would put the key, which a refusal can quote, into a stored problem.
  test.each(stopped)("stops at $name with its own refusal beside what it wrote before, and nothing of the key", async ({ change, refusal, wrote }) => {
    const account = withMethods();
    change(account);

    await withRepair(
      (asked) => answer(account, asked),
      async (login) => {
        const repaired = await login.repair(USERS);

        expect<unknown>([repaired.refusal, repaired.wrote]).toEqual([refusal, wrote]);
        expect(JSON.stringify(repaired)).not.toContain(TOKEN);
      },
    );
  });

  // Drift: the Worker checks a login's token against the team's domain. Written with none, the variable would make the Worker refuse every login of an Access that works.
  // Drift: the key reads the account's login methods and may make none. A repair that named no method would leave the page offering every method of the account.
  // One that said nothing of a missing code would leave users shut out with nobody told.
  test.each([
    { name: "all three methods", held: [...OWN_METHOD, ...METHODS], offered: ["method-cloudflare", "code-1", "passkeys-1"], refusal: undefined },
    { name: "no method of its own members", held: METHODS, offered: ["code-1", "passkeys-1"], refusal: undefined },
    { name: "its own method and the code alone", held: [...OWN_METHOD, ...METHODS.slice(0, 1)], offered: ["method-cloudflare", "code-1"], refusal: undefined },
    { name: "no method that mails a code", held: [...OWN_METHOD, ...METHODS.slice(1)], offered: ["method-cloudflare", "passkeys-1"], refusal: "no_login_method" },
  ])("on an account with $name the guarded application offers the methods that stand, never one that is gone, and only a missing code is a refusal, after the rest was written", async ({ held, offered, refusal }) => {
    const account = { ...emptyAccount(), methods: [...held] };

    await withRepair(
      (asked) => answer(account, asked),
      async (login, asked) => {
        await login.repair(USERS);
        const guarded = account.applications.find((application) => application.name === INSTALL_OBJECTS.accessApplication);
        Object.assign(guarded ?? {}, { allowed_idps: ["their-login"] });
        const again = await login.repair(USERS);

        const now = account.applications.find((application) => application.name === INSTALL_OBJECTS.accessApplication)?.allowed_idps;

        expect<unknown>([guarded === undefined, again.refusal, again.wrote.includes(INSTALL_OBJECTS.accessBinding), now]).toEqual([false, refusal, false, offered]);
        expect(writes(asked).filter((call) => call.includes("identity_providers"))).toEqual([]);
      },
    );
  });

  test("leaves the Worker's variable as it was when Cloudflare names no team for the login", async () => {
    const account = withMethods();
    const before = JSON.stringify(account.bindings);

    await withRepair(
      (asked) => (asked.path.split("?")[0] === `/accounts/${ACCOUNT}/access/organizations` ? reply({}) : answer(account, asked)),
      async (login) => {
        expect<unknown>([(await login.repair(USERS)).refusal, JSON.stringify(account.bindings)]).toEqual(["no_team", before]);
      },
    );
  });
});
