import { describe, expect, test } from "bun:test";
import { BUDGET_ALERT, planBudgetAlert, syncBudgetAlert } from "../../../../../src/shared/install/pieces/alerts/budget-alert";
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
