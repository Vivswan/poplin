// A notification policy of the account that poplin keeps: Cloudflare emails the install's first user when what the policy's type watches happens.
// An alert tells and stops nothing. Cloudflare keeps no mark on a notification policy, so poplin's is the one with its fixed name.
// The SDK sends an alert type and a filter as given: its types lack the budget alert's type and its filter.
// One list of the account's policies serves every alert of a run.
//
//   a repair, with a token that holds the right    makes the alert, or changes one that differs
//   the install, with the key it keeps             the same, at a change of the users and on the run that begins a UTC day
//
// The key holds "Notifications Write" on an install of either kind, so no token is pasted for an alert the account lacks.

import { BasePolicies, type PolicyCreateParams } from "cloudflare/resources/alerting/policies";
import type { KeyRefusal } from "@poplin/app/src/console/key/records";
import * as v from "valibot";
import { type CloudflareResult, type Connection, callCloudflare } from "../../client";
import { type KeptKey, keyed } from "../../key/kept-key";
import { applySteps, type Mode, reportOf, type Synced } from "../../sync";

/** Cloudflare's name of the right an alert is read and written under with the kept key. */
const KEY_RIGHT = "Notifications Write";

/** One alert poplin keeps in an account. */
export interface AccountAlert {
  /** The name of poplin's policy, which is also what its row names. */
  readonly name: string;

  /** Cloudflare's type of the alert. */
  readonly type: string;

  /** What the policy says of itself in Cloudflare's list. */
  readonly description: string;

  /** The filters the type takes, each with its one value, as text. Left out for a type that takes none, whose policy Cloudflare reads back with no filters at all. */
  readonly filters?: Readonly<Record<string, readonly [string]>>;
}

/** What keeping the alerts with the kept key came to: the name of each alert that was made or changed, and why the keeping stopped, where it did. One that stopped has kept what it wrote before. */
export interface KeptAlerts {
  readonly wrote: readonly string[];
  readonly refusal?: KeyRefusal;
}

/** A notification policy as the account has it now. Its filters and mechanisms are read as plain objects, since the SDK types the filters of poplin's alerts nowhere. */
interface AccountPolicy {
  readonly id?: string;
  readonly name?: string;
  readonly alert_type?: string;
  readonly enabled?: boolean;
  readonly filters?: object;
  readonly mechanisms?: object;
}

/** One step of an alert's plan; a `change` carries the id of the policy it rewrites. */
type AlertStep = { readonly kind: "create"; readonly subject: string } | { readonly kind: "leave"; readonly subject: string } | { readonly kind: "change"; readonly subject: string; readonly id: string };

/** Whether a policy is the alert as poplin writes it: switched on, with its filters and no other, and sent by email to that address alone. Cloudflare reads a policy back with empty lists for what it does not use. */
function matches(alert: AccountAlert, policy: AccountPolicy, email: string): boolean {
  const unused = v.optional(v.strictTuple([]));
  const wanted = Object.fromEntries(Object.entries(alert.filters ?? {}).map(([name, [value]]) => [name, v.strictTuple([v.literal(value)])]));
  const filters = v.objectWithRest(wanted, unused);
  const written = v.object({
    alert_type: v.literal(alert.type),
    enabled: v.literal(true),
    filters: alert.filters === undefined ? v.optional(filters) : filters,
    mechanisms: v.objectWithRest({ email: v.strictTuple([v.object({ id: v.literal(email) })]) }, unused),
  });

  return v.is(written, policy);
}

/**
 * Compute the change that gives the account one of poplin's alerts.
 *
 * @param policies - the account's notification policies as they are now
 * @param email - the address the alert goes to
 * @returns one step: a `leave` for a policy with the alert's name that is the alert as written, a `change` for one that is not, or a `create`; no step names another policy
 */
export function planAlert(alert: AccountAlert, policies: readonly AccountPolicy[], email: string): AlertStep[] {
  const own = policies.find((policy) => policy.name === alert.name && policy.id !== undefined);
  if (own?.id === undefined) return [{ kind: "create", subject: alert.name }];

  return [matches(alert, own, email) ? { kind: "leave", subject: alert.name } : { kind: "change", subject: alert.name, id: own.id }];
}

/** The alert as Cloudflare is sent it, for one address: a type that takes no filter is sent none. */
function alertBody(alert: AccountAlert, accountId: string, email: string): PolicyCreateParams {
  const filters = alert.filters === undefined ? {} : { filters: alert.filters };
  // @ts-expect-error An alert's type is any text here, and the SDK's types lack the budget alert's type and its filter.
  const policy: PolicyCreateParams = { account_id: accountId, name: alert.name, description: alert.description, alert_type: alert.type, enabled: true, ...filters, mechanisms: { email: [{ id: email }] } };

  return policy;
}

/**
 * List the account's notification policies, as every alert of one run is planned from.
 *
 * @returns the policies, or Cloudflare's refusal as a value
 */
export function listAlerts(connection: Connection, accountId: string): Promise<CloudflareResult<readonly AccountPolicy[]>> {
  return callCloudflare(connection, (api) => Array.fromAsync(new BasePolicies(api).list({ account_id: accountId })));
}

/**
 * Keep poplin's alerts with the key the install keeps: one the account lacks is made, and one that differs, or goes to another address, is written as poplin writes it.
 *
 * @param key - the kept key, or `undefined` on an install that holds none, which answers `no_key` and calls nothing
 * @param alerts - the alerts of the install's kind, kept in this order from one list of the account's policies
 * @param email - the install's first user, whom every alert goes to
 * @returns the name of each alert that was made or changed, none for one that stood, and the key's refusal where the keeping stopped. It throws for nothing Cloudflare answers, and no answer holds the key
 */
export async function keepAlerts(key: KeptKey | undefined, accountId: string, alerts: readonly AccountAlert[], email: string): Promise<KeptAlerts> {
  const wrote: string[] = [];
  const listed = await keyed(key, KEY_RIGHT, (connection) => listAlerts(connection, accountId));
  if (!listed.ok) return { wrote, refusal: listed.refusal };

  for (const alert of alerts) {
    const kept = await keyed(key, KEY_RIGHT, async (connection): Promise<CloudflareResult<readonly string[]>> => {
      const synced = await syncAlert(connection, accountId, alert, email, "apply", { ok: true, value: listed.value });

      return synced.ok ? { ok: true, value: [...synced.report.created, ...synced.report.changed] } : synced;
    });
    if (!kept.ok) return { wrote, refusal: kept.refusal };

    wrote.push(...kept.value);
  }

  return { wrote };
}

/**
 * Make sure the account has one of poplin's alerts, sent to one address.
 *
 * @param mode - `plan` sends no change
 * @param read - the account's notification policies as `listAlerts` answered them, where the run has read them for another alert; left out, they are read here
 * @returns what was created, changed, or left; a refusal by Cloudflare is a value, with the report of what was done before it
 */
export async function syncAlert(connection: Connection, accountId: string, alert: AccountAlert, email: string, mode: Mode, read?: CloudflareResult<readonly AccountPolicy[]>): Promise<Synced> {
  const listed = read ?? (await listAlerts(connection, accountId));
  if (!listed.ok) return { ...listed, report: reportOf([]) };

  const policy = alertBody(alert, accountId, email);

  return applySteps(
    planAlert(alert, listed.value, email),
    (step) => callCloudflare(connection, (api) => (step.kind === "create" ? new BasePolicies(api).create(policy) : new BasePolicies(api).update(step.id, policy))),
    mode,
  );
}
