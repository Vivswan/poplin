// The account's budget alert: Cloudflare emails the install's first user once the account's usage charges for the billing period reach one dollar.
// An alert tells and stops nothing. Cloudflare keeps no mark on a notification policy, so poplin's is the one with its fixed name.
// The SDK sends this alert type and its filter as given, and its types name neither yet.
//
//   a repair, with a token that holds the right    makes the alert, or changes one that differs
//   the install, with the key it keeps             the same, at a change of the users and on the run that begins a UTC day
//
// The key holds "Notifications Write" on an install of either kind, so no token is pasted for an alert the account lacks.

import { BasePolicies, type PolicyCreateParams } from "cloudflare/resources/alerting/policies";
import type { Keyed } from "@poplin/app/src/console/key/records";
import * as v from "valibot";
import { type CloudflareResult, type Connection, callCloudflare } from "../../client";
import { type KeptKey, keyed } from "../../key/kept-key";
import { applySteps, type Mode, reportOf, type Synced } from "../../sync";

/** The name of poplin's policy, which is also what its row names. */
export const BUDGET_ALERT = "poplin: usage charges reached 1 dollar";

/** Cloudflare's type for an alert on the account's usage charges of a billing period. */
const ALERT_TYPE = "billing_budget_alert";

/** The charges, in whole US dollars, at which the alert is sent: the filter takes exactly one value, as text. */
const DOLLARS = "1";

/** Cloudflare's name of the right the alert is read and written under with the kept key. */
const KEY_RIGHT = "Notifications Write";

/** What the policy says of itself in Cloudflare's list. */
const DESCRIPTION = "The account's usage charges for the billing period reached 1 US dollar.";

/** A notification policy as the account has it now. Its filters and mechanisms are read as plain objects, since the SDK types this alert's filter nowhere. */
interface AccountPolicy {
  readonly id?: string;
  readonly name?: string;
  readonly alert_type?: string;
  readonly enabled?: boolean;
  readonly filters?: object;
  readonly mechanisms?: object;
}

/** One step of a budget alert plan; a `change` carries the id of the policy it rewrites. */
type AlertStep =
  | { readonly kind: "create"; readonly subject: typeof BUDGET_ALERT }
  | { readonly kind: "leave"; readonly subject: typeof BUDGET_ALERT }
  | { readonly kind: "change"; readonly subject: typeof BUDGET_ALERT; readonly id: string };

/** Whether a policy is the alert as poplin writes it: switched on, at one dollar, and sent by email to that address alone. Cloudflare reads a policy back with empty lists for what it does not use. */
function matches(policy: AccountPolicy, email: string): boolean {
  const unused = v.optional(v.strictTuple([]));
  const written = v.object({
    alert_type: v.literal(ALERT_TYPE),
    enabled: v.literal(true),
    filters: v.objectWithRest({ total_spend_dollars: v.strictTuple([v.literal(DOLLARS)]) }, unused),
    mechanisms: v.objectWithRest({ email: v.strictTuple([v.object({ id: v.literal(email) })]) }, unused),
  });

  return v.is(written, policy);
}

/**
 * Compute the change that gives the account poplin's budget alert.
 *
 * @param policies - the account's notification policies as they are now
 * @param email - the address the alert goes to
 * @returns one step: a `leave` for a policy with poplin's name that is the alert as written, a `change` for one that is not, or a `create`; no step names another policy
 */
export function planBudgetAlert(policies: readonly AccountPolicy[], email: string): AlertStep[] {
  const own = policies.find((policy) => policy.name === BUDGET_ALERT && policy.id !== undefined);
  if (own?.id === undefined) return [{ kind: "create", subject: BUDGET_ALERT }];

  return [matches(own, email) ? { kind: "leave", subject: BUDGET_ALERT } : { kind: "change", subject: BUDGET_ALERT, id: own.id }];
}

/** The alert as Cloudflare is sent it, for one address. */
function alertBody(accountId: string, email: string): PolicyCreateParams {
  // @ts-expect-error The SDK's types lack the alert type `billing_budget_alert` and the filter `total_spend_dollars`.
  const policy: PolicyCreateParams = { account_id: accountId, name: BUDGET_ALERT, description: DESCRIPTION, alert_type: ALERT_TYPE, enabled: true, filters: { total_spend_dollars: [DOLLARS] }, mechanisms: { email: [{ id: email }] } };

  return policy;
}

/**
 * Keep poplin's budget alert with the key the install keeps: one the account lacks is made, and one that differs, or goes to another address, is written as poplin writes it.
 *
 * @param key - the kept key, or `undefined` on an install that holds none, which answers `no_key` and calls nothing
 * @param email - the install's first user, whom the alert goes to
 * @returns the alert's name where it was made or changed, and nothing for one that stood; or the key's refusal. It throws for nothing Cloudflare answers, and no answer holds the key
 */
export function keepBudgetAlert(key: KeptKey | undefined, accountId: string, email: string): Promise<Keyed<readonly string[]>> {
  return keyed(key, KEY_RIGHT, async (connection): Promise<CloudflareResult<readonly string[]>> => {
    const synced = await syncBudgetAlert(connection, accountId, email, "apply");

    return synced.ok ? { ok: true, value: [...synced.report.created, ...synced.report.changed] } : synced;
  });
}

/**
 * Make sure the account has poplin's budget alert, sent to one address.
 *
 * @param mode - `plan` reads the account's notification policies and sends no change
 * @returns what was created, changed, or left; a refusal by Cloudflare is a value, with the report of what was done before it
 */
export async function syncBudgetAlert(connection: Connection, accountId: string, email: string, mode: Mode): Promise<Synced> {
  const listed = await callCloudflare(connection, (api) => Array.fromAsync(new BasePolicies(api).list({ account_id: accountId })));
  if (!listed.ok) return { ...listed, report: reportOf([]) };

  const policy = alertBody(accountId, email);

  return applySteps(
    planBudgetAlert(listed.value, email),
    (step) => callCloudflare(connection, (api) => (step.kind === "create" ? new BasePolicies(api).create(policy) : new BasePolicies(api).update(step.id, policy))),
    mode,
  );
}
