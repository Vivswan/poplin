// The users carried to Cloudflare with the kept key, against the answers Cloudflare documents for its Access policies and its notification policies.
// Without these a change of the users could rewrite an application, leave the alert mailing a person who was removed, leave an account with no alert, read as carried when Cloudflare refused it, or give the key away in an answer.

import { describe, expect, test } from "bun:test";
import type { UsersFollow } from "@poplin/app/src/console/access/users-follow";
import type { Login } from "@poplin/core/src/auth/logins";
import { readKeptKey } from "../../../../src/shared/install/key/kept-key";
import { createUsersFollow } from "../../../../src/shared/install/key/users-follow";
import { BUDGET_ALERT } from "../../../../src/shared/install/pieces/alerts/budget-alert";
import { CERTIFICATE_ALERT } from "../../../../src/with-domain/pieces/alerts/certificate-alert";
import { INSTALL_OBJECTS } from "../../../../src/shared/install/install-objects";
import { withFake } from "../support/fake-cloudflare";
import { type Asked, page, refusal, reply } from "../support/replies";

/** The account the policy and the alert are in. */
const ACCOUNT = "account-a";

/** A key in the form the reader takes, and nothing like one Cloudflare makes. */
const KEY = "kept-key-of-the-test";

/** The users after a change: the first is the one the alert is mailed to. */
const USERS = ["zoe@example.com", "ada@example.com"] as Login[];

/** Where the two kinds of policy are listed and written. */
const PATHS = { policies: `/accounts/${ACCOUNT}/access/policies`, alerts: `/accounts/${ACCOUNT}/alerting/v3/policies` } as const;

/** The policy of the users as the account holds it before the change: one user. */
const HELD_POLICY = { id: "policy-1", name: INSTALL_OBJECTS.accessPolicy, decision: "allow", include: [{ email: { email: "ada@example.com" } }] };

/** The alert as the account holds it before the change, mailed to the user who was first. */
const HELD_ALERT = { id: "alert-1", name: BUDGET_ALERT.name, alert_type: "billing_budget_alert", enabled: true, filters: { total_spend_dollars: ["1"] }, mechanisms: { email: [{ id: "ada@example.com" }] } };

/** What a fake account answers each call with. Left out, a list holds what the account held before the change and a write is taken. */
interface Account {
  readonly policies?: (asked: Asked) => Response;
  readonly policyWrite?: () => Response;
  readonly alerts?: (asked: Asked) => Response;
  readonly alertWrite?: () => Response;
}

/** Answer as the account does: the two lists, a write of the one policy or the one alert it holds, and the making of an alert. */
function account(answers: Account): (asked: Asked) => Response | undefined {
  const calls: Readonly<Record<string, (asked: Asked) => Response>> = {
    [`GET ${PATHS.policies}`]: answers.policies ?? ((asked) => page(asked, [HELD_POLICY])),
    [`GET ${PATHS.alerts}`]: answers.alerts ?? ((asked) => page(asked, [HELD_ALERT])),
    [`PUT ${PATHS.policies}/${HELD_POLICY.id}`]: answers.policyWrite ?? (() => reply({ ...HELD_POLICY })),
    [`PUT ${PATHS.alerts}/${HELD_ALERT.id}`]: answers.alertWrite ?? (() => reply({ id: HELD_ALERT.id })),
    [`POST ${PATHS.alerts}`]: answers.alertWrite ?? (() => reply({ id: HELD_ALERT.id })),
  };

  return (asked) => calls[`${asked.method} ${asked.path.split("?")[0]}`]?.(asked);
}

/** The writes among what was asked, each as its method, its path, and what it carried. */
function writes(asked: readonly Asked[]): unknown[] {
  return asked.filter((entry) => entry.method !== "GET").map((entry) => [entry.method, entry.path, entry.body]);
}

/** A failure of Cloudflare's own, which the SDK tries again at once. */
const DOWN = (): Response => refusal(503, 1, `Service unavailable ${KEY}`, { "retry-after-ms": "1" });

describe("createUsersFollow", () => {
  // Drift: the policy is the one thing of Access a change of the users writes, by its own id and with every email. An application read or rewritten here would cost calls and could undo a repair.
  test("a change writes the policy of the users with every user and sends the alert to the first, and touches no application", async () => {
    await withFake(account({}), async (connection, asked) => {
      const follow = createUsersFollow(readKeptKey(KEY, { baseUrl: connection.baseUrl }), ACCOUNT, [BUDGET_ALERT]);
      const pushed = await follow.push(USERS);

      const include = [{ email: { email: "ada@example.com" } }, { email: { email: "zoe@example.com" } }];

      expect(pushed).toEqual({ ok: true });
      expect(writes(asked)).toEqual([
        ["PUT", `${PATHS.policies}/policy-1`, { name: INSTALL_OBJECTS.accessPolicy, decision: "allow", include }],
        ["PUT", `${PATHS.alerts}/alert-1`, expect.objectContaining({ name: BUDGET_ALERT.name, mechanisms: { email: [{ id: "zoe@example.com" }] } })],
      ]);
      expect(asked.filter((entry) => entry.path.includes("/access/apps"))).toEqual([]);
      expect(new Set(asked.map((entry) => entry.key))).toEqual(new Set([`Bearer ${KEY}`]));
    });
  });

  // Drift: a list of the policies that trails a write still answers the users as they were. A carry that left out the write for a list that matches would lose a user removed just after being added, and Cloudflare's policy would go on naming that user.
  test("a user removed just after being added is written out of the policy, where the list still answers the users as they were before the first write; an alert that goes to the first user is left", async () => {
    const sent = { ...HELD_ALERT, mechanisms: { email: [{ id: "ada@example.com" }] } };

    await withFake(account({ alerts: (asked) => page(asked, [sent]) }), async (connection, asked) => {
      const follow = createUsersFollow(readKeptKey(KEY, { baseUrl: connection.baseUrl }), ACCOUNT, [BUDGET_ALERT]);
      const pushed = [await follow.push(["ada@example.com", "zoe@example.com"] as Login[]), await follow.push(["ada@example.com"] as Login[])];
      const body = (emails: readonly string[]): unknown => ({ name: INSTALL_OBJECTS.accessPolicy, decision: "allow", include: emails.map((email) => ({ email: { email } })) });

      expect([pushed, writes(asked)]).toEqual([
        [{ ok: true }, { ok: true }],
        [
          ["PUT", `${PATHS.policies}/policy-1`, body(["ada@example.com", "zoe@example.com"])],
          ["PUT", `${PATHS.policies}/policy-1`, body(["ada@example.com"])],
        ],
      ]);
    });
  });

  // Drift: the key holds the right to make the alert, and no token is pasted after install. An account left without one here would have no alert until a person added a right to a token and pressed Repair.
  test("an account with no alert gets one from a change of the users, mailed to the first of them, with the key and no token", async () => {
    await withFake(account({ alerts: (asked) => page(asked, []) }), async (connection, asked) => {
      const follow = createUsersFollow(readKeptKey(KEY, { baseUrl: connection.baseUrl }), ACCOUNT, [BUDGET_ALERT]);

      expect(await follow.push(USERS)).toEqual({ ok: true });
      expect(writes(asked).at(-1)).toEqual(["POST", PATHS.alerts, expect.objectContaining({ name: BUDGET_ALERT.name, alert_type: "billing_budget_alert", mechanisms: { email: [{ id: "zoe@example.com" }] } })]);
      expect(new Set(asked.map((entry) => entry.key))).toEqual(new Set([`Bearer ${KEY}`]));
    });
  });

  // Drift: an install with a domain keeps two alerts, and both go to the first user. A carry that kept the first alone would leave the certificate alert mailing a person who was removed.
  test("an install with a domain sends both its alerts to the first user in one carry: the budget alert it holds is written, and the certificate alert it lacks is made", async () => {
    await withFake(account({}), async (connection, asked) => {
      const follow = createUsersFollow(readKeptKey(KEY, { baseUrl: connection.baseUrl }), ACCOUNT, [BUDGET_ALERT, CERTIFICATE_ALERT]);
      const to = { mechanisms: { email: [{ id: "zoe@example.com" }] } };

      expect(await follow.push(USERS)).toEqual({ ok: true });
      expect(writes(asked).slice(1)).toEqual([
        ["PUT", `${PATHS.alerts}/alert-1`, expect.objectContaining({ name: BUDGET_ALERT.name, ...to })],
        ["POST", PATHS.alerts, expect.objectContaining({ name: CERTIFICATE_ALERT.name, alert_type: "universal_ssl_event_type", ...to })],
      ]);
    });
  });

  const refused: readonly { readonly name: string; readonly answers: Account; readonly ends: Awaited<ReturnType<UsersFollow["push"]>>; readonly written: number }[] = [
    { name: "a key Cloudflare no longer knows", answers: { policies: () => refusal(401, 10_000, `Authentication error ${KEY}`) }, ends: { ok: false, refusal: "key_refused" }, written: 0 },
    { name: "a key with no right for the policy", answers: { policyWrite: () => refusal(403, 10_000, "Authentication error") }, ends: { ok: false, refusal: "lacks_right" }, written: 1 },
    { name: "Cloudflare failing while the policy is read", answers: { policies: DOWN }, ends: { ok: false, refusal: "unreachable" }, written: 0 },
    { name: "an account with no policy of the users", answers: { policies: (asked) => page(asked, []) }, ends: { ok: false, refusal: "not_made" }, written: 0 },
    { name: "a key with no right for the alert, after the policy was written", answers: { alerts: () => refusal(403, 10_000, "Authentication error") }, ends: { ok: false, refusal: "lacks_right", written: true }, written: 1 },
    { name: "Cloudflare failing while the alert is written", answers: { alertWrite: DOWN }, ends: { ok: false, refusal: "unreachable", written: true }, written: 4 },
  ];

  // Drift: each answer is one of the refusals a screen has a sentence for. A try that stopped at the alert is no success, so the change goes on waiting and the alert is tried again.
  // It says that the policy was written, so no screen tells a person the login list is as it was.
  test.each(refused)("$name ends as $ends, and no text of the answer holds the key", async ({ answers, ends, written }) => {
    await withFake(account(answers), async (connection, asked) => {
      const follow = createUsersFollow(readKeptKey(KEY, { baseUrl: connection.baseUrl }), ACCOUNT, [BUDGET_ALERT]);
      const pushed = await follow.push(USERS);

      expect([pushed, writes(asked).length]).toEqual([ends, written]);
      expect([JSON.stringify([follow, pushed]), Bun.inspect(follow), Bun.inspect(pushed)].join("\n")).not.toContain(KEY);
    });
  });

  test("an install with no key answers so, says it holds none, and asks Cloudflare nothing", async () => {
    await withFake(account({}), async (connection, asked) => {
      const follow = createUsersFollow(readKeptKey(undefined, { baseUrl: connection.baseUrl }), ACCOUNT, [BUDGET_ALERT]);

      expect([follow.holdsKey(), await follow.push(USERS), asked, follow.where]).toEqual([false, { ok: false, refusal: "no_key" }, [], "Cloudflare"]);
    });
  });
});
