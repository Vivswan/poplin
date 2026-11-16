// Whether the test account pays for anything: the plan of the install's zone, where it has one, and every subscription of the account.
//
//   GET /zones/{id}                      needs Zone: Read       a plan with a price, or one named as a paid plan, stops the run
//   GET /accounts/{id}/subscriptions     needs Billing: Read    a subscription whose price is not 0 stops the run
//
// No name is matched. The list names R2 as a paid plan at a price of 0, and leaves the Workers plan out while it is Free: the price alone says what is paid.

import { BaseSubscriptions } from "cloudflare/resources/accounts/subscriptions/subscriptions";
import { BaseZones } from "cloudflare/resources/zones/zones";

import { callCloudflare, type Zone } from "../../src/shared/install/client";
import { type Run, type Stop, stopOf } from "./util";

/** The token permission each reading needs. */
const PERMISSIONS = { zone: "Zone: Read", subscriptions: "Billing: Read" } as const;

/** The states of a subscription that has ended and bills nothing more. */
const ENDED: ReadonlySet<string> = new Set(["Cancelled", "Failed", "Expired"]);

/** What stands for a rate plan Cloudflare gave no id. */
const UNNAMED = "unnamed";

/** What stands for the price of a subscription Cloudflare gave none. */
const NO_PRICE = "no price";

/** What the account's plans came to: how many subscriptions were read, how many of them stand at a price of 0, and how many have ended. No other kind passes. */
interface FreePlans {
  readonly subscriptions: number;
  readonly free: number;
  readonly ended: number;
}

/** Say why a zone is not on the Free plan; `undefined` for one that is. */
async function paidZone(run: Run, zone: Zone): Promise<Stop | undefined> {
  if (zone.plan !== "free") return { kind: "failed", what: `the zone is on the ${zone.plan} plan, not the Free plan` };

  // A plan Cloudflare names in no known way reads as Free above, so its price is asked for as well.
  const read = await callCloudflare(run.connection, (api) => new BaseZones(api).get({ zone_id: zone.id }));
  if (!read.ok) return stopOf(read, PERMISSIONS.zone);

  return (read.value.plan?.price ?? 0) > 0 ? { kind: "failed", what: "the zone's plan has a price, so it is not the Free plan" } : undefined;
}

/**
 * Check that the test account pays for nothing.
 *
 * @param zone - the install's zone, with the plan Cloudflare listed it under; `undefined` for an install without a domain, of which the subscriptions alone are read
 * @returns the counts of the subscriptions read; `failed` for a zone on a paid plan, or a subscription that has not ended and whose price is not 0, naming each rate plan's id and price; `skipped` for a token without the permission of a reading
 */
export async function readFreePlans(run: Run, zone: Zone | undefined): Promise<FreePlans | Stop> {
  const paid = zone === undefined ? undefined : await paidZone(run, zone);
  if (paid !== undefined) return paid;

  const listed = await callCloudflare(run.connection, (api) => Array.fromAsync(new BaseSubscriptions(api).get({ account_id: run.accountId })));
  if (!listed.ok) return stopOf(listed, PERMISSIONS.subscriptions);

  const running = listed.value.filter((subscription) => !ENDED.has(subscription.state ?? ""));
  // A subscription with no price is not known to be free, so it stops the run like one with a price.
  const notFree = running.filter((subscription) => subscription.price !== 0);
  if (notFree.length === 0) return { subscriptions: listed.value.length, free: running.length, ended: listed.value.length - running.length };

  const plans = notFree.map((subscription) => `${subscription.rate_plan?.id ?? UNNAMED} at ${subscription.price ?? NO_PRICE}`).join(", ");

  return { kind: "failed", what: `the account's subscriptions are not all at a price of 0: ${notFree.length} of ${listed.value.length} (${plans}), and the test account stays on the free plans` };
}
