// One alert of the account against the answers Cloudflare gives for its notification policies: the plan, the body as sent, and the keeping with the key.
// Without these an alert could be made twice, left mailing the wrong person, sent in a body every real account refuses, or kept in words that give the key away.

import { describe, expect, test } from "bun:test";
import { readKeptKey } from "../../../../../src/shared/install/key/kept-key";
import { type AccountAlert, keepAlerts, planAlert, syncAlert } from "../../../../../src/shared/install/pieces/alerts/account-alert";
import { BUDGET_ALERT } from "../../../../../src/shared/install/pieces/alerts/budget-alert";
import { CERTIFICATE_ALERT } from "../../../../../src/with-domain/pieces/alerts/certificate-alert";
import { withFake } from "../../support/fake-cloudflare";
import { type Asked, page, refusal, reply } from "../../support/replies";

/** The install's first user. */
const EMAIL = "owner@example.com";

/** The budget alert as poplin writes it, as the account's list reads it back. */
const OWN = { id: "p1", name: BUDGET_ALERT.name, alert_type: "billing_budget_alert", enabled: true, filters: { total_spend_dollars: ["1"] }, mechanisms: { email: [{ id: EMAIL }] } };

/** The certificate alert as the account's list reads it back: Cloudflare answers a policy made with no filter with no `filters` at all. */
const CERTIFICATES = { id: "c1", name: CERTIFICATE_ALERT.name, alert_type: "universal_ssl_event_type", enabled: true, mechanisms: { email: [{ id: EMAIL }] } };

/** A key in the form the reader takes, and nothing like one Cloudflare makes. */
const KEY = "kept-key-of-the-test";

/** A fake account that holds notification policies: a list answers them, and a write makes or replaces one by its name. */
function holding(policies: Record<string, unknown>[]): (asked: Asked) => Response {
  return (asked) => {
    if (asked.method === "GET") return page(asked, policies);

    const sent = asked.body as { readonly name: string };
    const at = policies.findIndex((policy) => policy.name === sent.name);
    const id = at < 0 ? `made-${policies.length}` : String(policies[at]?.id);
    policies.splice(at < 0 ? policies.length : at, 1, { id, ...sent });

    return reply({ id });
  };
}

describe("planAlert", () => {
  const steps = (alert: AccountAlert, id: string): Record<"create" | "leave" | "change", object[]> => ({
    create: [{ kind: "create", subject: alert.name }],
    leave: [{ kind: "leave", subject: alert.name }],
    change: [{ kind: "change", subject: alert.name, id }],
  });
  const budget = steps(BUDGET_ALERT, "p1");
  const certificates = steps(CERTIFICATE_ALERT, "c1");
  const cases: readonly { readonly name: string; readonly alert: AccountAlert; readonly policies: readonly object[]; readonly steps: readonly object[] }[] = [
    { name: "an account with no policy", alert: BUDGET_ALERT, policies: [], steps: budget.create },
    { name: "an account with a budget alert of its owner's, under another name", alert: BUDGET_ALERT, policies: [{ ...OWN, id: "theirs", name: "my budget", filters: { total_spend_dollars: ["50"] } }], steps: budget.create },
    { name: "the alert as written, beside the owner's", alert: BUDGET_ALERT, policies: [{ ...OWN, id: "theirs", name: "my budget" }, OWN], steps: budget.leave },
    {
      name: "the alert as written, read back with the empty lists Cloudflare adds",
      alert: BUDGET_ALERT,
      policies: [{ ...OWN, filters: { ...OWN.filters, limit: [] }, mechanisms: { ...OWN.mechanisms, webhooks: [], pagerduty: [] } }],
      steps: budget.leave,
    },
    { name: "the alert switched off", alert: BUDGET_ALERT, policies: [{ ...OWN, enabled: false }], steps: budget.change },
    { name: "the alert moved to a higher sum", alert: BUDGET_ALERT, policies: [{ ...OWN, filters: { total_spend_dollars: ["100"] } }], steps: budget.change },
    { name: "the alert with no filter at all", alert: BUDGET_ALERT, policies: [{ ...OWN, filters: undefined }], steps: budget.change },
    { name: "the alert sent to a user who is no longer the first", alert: BUDGET_ALERT, policies: [{ ...OWN, mechanisms: { email: [{ id: "second@example.com" }] } }], steps: budget.change },
    { name: "the alert sent to a second address as well", alert: BUDGET_ALERT, policies: [{ ...OWN, mechanisms: { email: [{ id: EMAIL }, { id: "second@example.com" }] } }], steps: budget.change },
    { name: "a policy of another type under poplin's name", alert: BUDGET_ALERT, policies: [{ ...OWN, alert_type: "billing_usage_alert", filters: { product: ["r2_storage"], limit: ["1"] } }], steps: budget.change },
    { name: "an account with the budget alert alone, asked for the certificate alert", alert: CERTIFICATE_ALERT, policies: [OWN], steps: certificates.create },
    { name: "the certificate alert as written, which Cloudflare reads back with no filters", alert: CERTIFICATE_ALERT, policies: [OWN, CERTIFICATES], steps: certificates.leave },
    { name: "the certificate alert read back with an empty set of filters", alert: CERTIFICATE_ALERT, policies: [{ ...CERTIFICATES, filters: {} }], steps: certificates.leave },
    { name: "the certificate alert narrowed by hand to something else", alert: CERTIFICATE_ALERT, policies: [{ ...CERTIFICATES, filters: { status: ["failed"] } }], steps: certificates.change },
    { name: "the certificate alert sent to a user who is no longer the first", alert: CERTIFICATE_ALERT, policies: [{ ...CERTIFICATES, mechanisms: { email: [{ id: "second@example.com" }] } }], steps: certificates.change },
  ];

  // Drift: the alerts go to the users the settings choose, and Cloudflare may list them in any order. Compared in order, an alert that stands would be written again at every run and named in Activity each day.
  test("an alert that goes to several chosen users is left in any order of them, and changed where one is missing or one more is there", () => {
    const [second, third] = ["second@example.com", "third@example.com"];
    const sent = (...ids: readonly string[]): typeof OWN => ({ ...OWN, mechanisms: { email: ids.map((id) => ({ id })) } });
    const planned = [sent(second, EMAIL), sent(EMAIL), sent(EMAIL, second, third), sent(EMAIL, EMAIL)].map((policy) => planAlert(BUDGET_ALERT, [policy], [EMAIL, second])[0]?.kind);

    expect(planned).toEqual(["leave", "change", "change", "change"]);
  });

  test.each(cases)("$name: the one step names poplin's policy and no other, and leaves it only as written, or the email would go nowhere, late, or to the wrong person unseen", ({ alert, policies, steps: planned }) => {
    expect<unknown>(planAlert(alert, policies, [EMAIL])).toEqual(planned);
  });
});

describe("syncAlert", () => {
  // Drift: the SDK's types lack the budget alert's type and its filter, and an alert's type is any text here, so the body is the one place a wrong name would pass every type check and be refused by every real account.
  // Cloudflare refuses a filter of zones on the certificate alert: its body must carry no filters at all.
  test("three runs against one account: the first creates the budget alert at one dollar to the one address, the second sends no change, and one changed by hand is written back whole; the certificate alert is sent with no filters", async () => {
    const policies: Record<string, unknown>[] = [{ id: "theirs", name: "my budget", alert_type: "billing_budget_alert" }];
    const to = { enabled: true, mechanisms: { email: [{ id: EMAIL }] } };
    const body = { name: BUDGET_ALERT.name, description: "The account's usage charges for the billing period reached 1 US dollar.", alert_type: "billing_budget_alert", filters: { total_spend_dollars: ["1"] }, ...to };
    const certificates = {
      name: "poplin: certificates of every domain of the account",
      description: "A certificate Cloudflare issues for a domain of the account failed to validate, was issued, was renewed, or ran out.",
      alert_type: "universal_ssl_event_type",
      ...to,
    };

    await withFake(holding(policies), async (connection, asked) => {
      expect(await syncAlert(connection, "account-a", BUDGET_ALERT, [EMAIL], "plan")).toMatchObject({ ok: true, report: { created: [BUDGET_ALERT.name] } });
      expect(asked.map((entry) => entry.method)).toEqual(["GET"]);
      expect(await syncAlert(connection, "account-a", BUDGET_ALERT, [EMAIL], "apply")).toMatchObject({ ok: true, report: { created: [BUDGET_ALERT.name], changedNothing: false } });
      expect(await syncAlert(connection, "account-a", BUDGET_ALERT, [EMAIL], "apply")).toMatchObject({ ok: true, report: { left: [BUDGET_ALERT.name], changedNothing: true } });

      policies[1] = { ...policies[1], enabled: false };

      expect(await syncAlert(connection, "account-a", BUDGET_ALERT, [EMAIL], "apply")).toMatchObject({ ok: true, report: { changed: [BUDGET_ALERT.name] } });
      expect(await syncAlert(connection, "account-a", CERTIFICATE_ALERT, [EMAIL], "apply")).toMatchObject({ ok: true, report: { created: [CERTIFICATE_ALERT.name] } });
      expect(asked.filter((entry) => entry.method !== "GET").map((entry) => [entry.method, entry.path, entry.body])).toEqual([
        ["POST", "/accounts/account-a/alerting/v3/policies", body],
        ["PUT", "/accounts/account-a/alerting/v3/policies/made-1", body],
        ["POST", "/accounts/account-a/alerting/v3/policies", certificates],
      ]);
      expect(policies[0]).toEqual({ id: "theirs", name: "my budget", alert_type: "billing_budget_alert" });
    });
  });

  test("a key without the Notifications permission: the run fails with Cloudflare's refusal before it changed anything, which is what lets a repair call the piece optional", async () => {
    await withFake(
      () => refusal(403, 10000, "Authentication error"),
      async (connection, asked) => {
        expect(await syncAlert(connection, "account-a", BUDGET_ALERT, [EMAIL], "apply")).toMatchObject({ ok: false, failure: "refused", status: 403, report: { changedNothing: true } });
        expect(asked.map((entry) => entry.method)).toEqual(["GET"]);
      },
    );
  });
});

describe("keepAlerts", () => {
  // Drift: where the scheduled run asks for the alerts itself, it writes into Activity what this names, and nothing for an alert that stood. One named on every day's run would fill Activity with a change nobody made.
  test("an account with no alert gets each alert of the install's kind with the key, named as made, from one list of its policies; the next keeping names nothing and sends no change; and an install with no key asks nothing", async () => {
    const policies: Record<string, unknown>[] = [];

    await withFake(holding(policies), async (connection, asked) => {
      const key = readKeptKey(KEY, { baseUrl: connection.baseUrl });
      const both = [BUDGET_ALERT, CERTIFICATE_ALERT];

      expect([await keepAlerts(key, "account-a", both, [EMAIL]), await keepAlerts(key, "account-a", both, [EMAIL]), await keepAlerts(key, "account-a", [BUDGET_ALERT], [EMAIL])]).toEqual([
        { wrote: [BUDGET_ALERT.name, CERTIFICATE_ALERT.name] },
        { wrote: [] },
        { wrote: [] },
      ]);
      expect([asked.map((entry) => entry.method), new Set(asked.map((entry) => entry.key)), policies.map((policy) => policy.name)]).toEqual([
        ["GET", "POST", "POST", "GET", "GET"],
        new Set([`Bearer ${KEY}`]),
        [BUDGET_ALERT.name, CERTIFICATE_ALERT.name],
      ]);

      const before = asked.length;

      expect([await keepAlerts(undefined, "account-a", both, [EMAIL]), asked.length - before]).toEqual([{ wrote: [], refusal: "no_key" }, 0]);
    });
  });

  // Drift: each answer is one of the refusals every screen knows, and none holds what Cloudflare said: its words may name the account, and the key travels in the request.
  test.each([
    ["a key that lacks the right", 403, { wrote: [], refusal: "lacks_right" }],
    ["a key Cloudflare no longer knows", 401, { wrote: [], refusal: "key_refused" }],
  ] as const)("%s ends as the key's own refusal at the list, and nothing is written", async (_name, status, ends) => {
    await withFake(
      () => refusal(status, 10000, `Authentication error ${KEY}`),
      async (connection, asked) => {
        const kept = await keepAlerts(readKeptKey(KEY, { baseUrl: connection.baseUrl }), "account-a", [BUDGET_ALERT, CERTIFICATE_ALERT], [EMAIL]);

        expect([kept, asked.map((entry) => entry.method), JSON.stringify(kept).includes(KEY)]).toEqual([ends, ["GET"], false]);
      },
    );
  });

  // Drift: the scheduled run tells Activity what was written. A keeping that stopped at the second alert and named nothing would leave the first alert it made out of Activity for good, since the next run finds it standing.
  test("a keeping that is refused at the second alert names the first it made, beside the refusal", async () => {
    const policies: Record<string, unknown>[] = [];
    const account = holding(policies);

    await withFake(
      (asked) => ((asked.body as { readonly name?: string } | undefined)?.name === CERTIFICATE_ALERT.name ? refusal(403, 10000, "Authentication error") : account(asked)),
      async (connection) => {
        const kept = await keepAlerts(readKeptKey(KEY, { baseUrl: connection.baseUrl }), "account-a", [BUDGET_ALERT, CERTIFICATE_ALERT], [EMAIL]);

        expect([kept, policies.map((policy) => policy.name)]).toEqual([{ wrote: [BUDGET_ALERT.name], refusal: "lacks_right" }, [BUDGET_ALERT.name]]);
      },
    );
  });
});
