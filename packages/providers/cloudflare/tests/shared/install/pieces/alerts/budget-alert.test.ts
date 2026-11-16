import { describe, expect, test } from "bun:test";
import { readKeptKey } from "../../../../../src/shared/install/key/kept-key";
import { BUDGET_ALERT, keepBudgetAlert, planBudgetAlert, syncBudgetAlert } from "../../../../../src/shared/install/pieces/alerts/budget-alert";
import { withFake } from "../../support/fake-cloudflare";
import { page, refusal, reply } from "../../support/replies";

/** The install's first user. */
const EMAIL = "owner@example.com";

/** The alert as poplin writes it, as the account's list reads it back. */
const OWN = { id: "p1", name: BUDGET_ALERT, alert_type: "billing_budget_alert", enabled: true, filters: { total_spend_dollars: ["1"] }, mechanisms: { email: [{ id: EMAIL }] } };

describe("planBudgetAlert", () => {
  const create = [{ kind: "create", subject: BUDGET_ALERT }];
  const leave = [{ kind: "leave", subject: BUDGET_ALERT }];
  const change = [{ kind: "change", subject: BUDGET_ALERT, id: "p1" }];
  const cases: readonly { readonly name: string; readonly policies: readonly object[]; readonly steps: readonly object[] }[] = [
    { name: "an account with no policy", policies: [], steps: create },
    { name: "an account with a budget alert of its owner's, under another name", policies: [{ ...OWN, id: "theirs", name: "my budget", filters: { total_spend_dollars: ["50"] } }], steps: create },
    { name: "the alert as written, beside the owner's", policies: [{ ...OWN, id: "theirs", name: "my budget" }, OWN], steps: leave },
    { name: "the alert as written, read back with the empty lists Cloudflare adds", policies: [{ ...OWN, filters: { ...OWN.filters, limit: [] }, mechanisms: { ...OWN.mechanisms, webhooks: [], pagerduty: [] } }], steps: leave },
    { name: "the alert switched off", policies: [{ ...OWN, enabled: false }], steps: change },
    { name: "the alert moved to a higher sum", policies: [{ ...OWN, filters: { total_spend_dollars: ["100"] } }], steps: change },
    { name: "the alert sent to a user who is no longer the first", policies: [{ ...OWN, mechanisms: { email: [{ id: "second@example.com" }] } }], steps: change },
    { name: "the alert sent to a second address as well", policies: [{ ...OWN, mechanisms: { email: [{ id: EMAIL }, { id: "second@example.com" }] } }], steps: change },
    { name: "a policy of another type under poplin's name", policies: [{ ...OWN, alert_type: "billing_usage_alert", filters: { product: ["r2_storage"], limit: ["1"] } }], steps: change },
  ];

  test.each(cases)("$name: the one step names poplin's policy and no other, and leaves it only as written, or the email would go nowhere, late, or to the wrong person unseen", ({ policies, steps }) => {
    expect<unknown>(planBudgetAlert(policies, EMAIL)).toEqual(steps);
  });
});

describe("keepBudgetAlert", () => {
  /** A key in the form the reader takes, and nothing like one Cloudflare makes. */
  const KEY = "kept-key-of-the-test";

  // Drift: where the scheduled run asks for the alert itself, it writes into Activity what this names, and nothing for an alert that stood. One named on every day's run would fill Activity with a change nobody made.
  test("an account with no alert gets one with the key, named as made; the next keeping names nothing and sends no change; and an install with no key asks nothing", async () => {
    const policies: Record<string, unknown>[] = [];

    await withFake(
      (asked) => {
        if (asked.method === "GET") return page(asked, policies);

        policies.push({ id: "p1", ...(asked.body as object) });

        return reply({ id: "p1" });
      },
      async (connection, asked) => {
        const key = readKeptKey(KEY, { baseUrl: connection.baseUrl });

        expect([await keepBudgetAlert(key, "account-a", EMAIL), await keepBudgetAlert(key, "account-a", EMAIL)]).toEqual([
          { ok: true, value: [BUDGET_ALERT] },
          { ok: true, value: [] },
        ]);
        expect(asked.map((entry) => `${entry.method} ${entry.key}`)).toEqual([`GET Bearer ${KEY}`, `POST Bearer ${KEY}`, `GET Bearer ${KEY}`]);

        const before = asked.length;

        expect([await keepBudgetAlert(undefined, "account-a", EMAIL), asked.length - before]).toEqual([{ ok: false, refusal: "no_key" }, 0]);
      },
    );
  });

  // Drift: each answer is one of the refusals every screen knows, and none holds what Cloudflare said: its words may name the account, and the key travels in the request.
  test.each([
    ["a key that lacks the right", 403, { ok: false, refusal: "lacks_right", right: "Notifications Write" }],
    ["a key Cloudflare no longer knows", 401, { ok: false, refusal: "key_refused" }],
  ] as const)("%s ends as the key's own refusal, with the right it lacks, and nothing is written", async (_name, status, ends) => {
    await withFake(
      () => refusal(status, 10000, `Authentication error ${KEY}`),
      async (connection, asked) => {
        const kept = await keepBudgetAlert(readKeptKey(KEY, { baseUrl: connection.baseUrl }), "account-a", EMAIL);

        expect([kept, asked.map((entry) => entry.method), JSON.stringify(kept).includes(KEY)]).toEqual([ends, ["GET"], false]);
      },
    );
  });
});

describe("syncBudgetAlert", () => {
  // Drift: the SDK types neither the alert type nor its filter, so the body is the one place a wrong name would pass every type check and be refused by every real account.
  test("three runs against one account: the first creates the alert at one dollar to the one address, the second sends no change, and one changed by hand is written back whole", async () => {
    const policies: Record<string, unknown>[] = [{ id: "theirs", name: "my budget", alert_type: "billing_budget_alert" }];
    const description = "The account's usage charges for the billing period reached 1 US dollar.";
    const body = { name: BUDGET_ALERT, description, alert_type: "billing_budget_alert", enabled: true, filters: { total_spend_dollars: ["1"] }, mechanisms: { email: [{ id: EMAIL }] } };

    await withFake(
      (asked) => {
        if (asked.method === "GET") return page(asked, policies);

        const made = { id: "p1", ...(asked.body as object) };
        policies.splice(1, 1, made);

        return reply({ id: "p1" });
      },
      async (connection, asked) => {
        expect(await syncBudgetAlert(connection, "account-a", EMAIL, "plan")).toMatchObject({ ok: true, report: { created: [BUDGET_ALERT] } });
        expect(asked.map((entry) => entry.method)).toEqual(["GET"]);
        expect(await syncBudgetAlert(connection, "account-a", EMAIL, "apply")).toMatchObject({ ok: true, report: { created: [BUDGET_ALERT], changedNothing: false } });
        expect(await syncBudgetAlert(connection, "account-a", EMAIL, "apply")).toMatchObject({ ok: true, report: { left: [BUDGET_ALERT], changedNothing: true } });

        policies[1] = { ...policies[1], enabled: false };

        expect(await syncBudgetAlert(connection, "account-a", EMAIL, "apply")).toMatchObject({ ok: true, report: { changed: [BUDGET_ALERT] } });
        expect(asked.filter((entry) => entry.method !== "GET").map((entry) => [entry.method, entry.path, entry.body])).toEqual([
          ["POST", "/accounts/account-a/alerting/v3/policies", body],
          ["PUT", "/accounts/account-a/alerting/v3/policies/p1", body],
        ]);
        expect(policies[0]).toEqual({ id: "theirs", name: "my budget", alert_type: "billing_budget_alert" });
      },
    );
  });

  test("a key without the Notifications permission: the run fails with Cloudflare's refusal before it changed anything, which is what lets a repair call the piece optional", async () => {
    await withFake(
      () => refusal(403, 10000, "Authentication error"),
      async (connection, asked) => {
        expect(await syncBudgetAlert(connection, "account-a", EMAIL, "apply")).toMatchObject({ ok: false, failure: "refused", status: 403, report: { changedNothing: true } });
        expect(asked.map((entry) => entry.method)).toEqual(["GET"]);
      },
    );
  });
});
