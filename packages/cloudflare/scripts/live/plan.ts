// Whether the test account pays for anything: the plan of the install's zone, and every subscription of the account.
//
//   GET /zones/{id}                      needs Zone: Read       a plan with a price, or one named as a paid plan, stops the run
//   GET /accounts/{id}/subscriptions     needs Billing: Read    a subscription with a price stops the run
//
// Cloudflare documents no name for a Workers plan in that list, so no name is matched: a subscription is paid when its price is above zero.

import { BaseSubscriptions } from "cloudflare/resources/accounts/subscriptions/subscriptions";
import { BaseZones } from "cloudflare/resources/zones/zones";

import { callCloudflare, type Zone } from "../../src/zone/client";
import { type Run, type Stop, stopOf } from "./util";

/** The token permission each reading needs. */
const PERMISSIONS = { zone: "Zone: Read", subscriptions: "Billing: Read" } as const;

/** The states of a subscription that has ended and bills nothing more. */
const ENDED: ReadonlySet<string> = new Set(["Cancelled", "Failed", "Expired"]);

/** What stands for a rate plan Cloudflare gave no id. */
const UNNAMED = "unnamed";

/** What the account's plans came to: how many subscriptions were read, all of them at no price. */
interface FreePlans {
  readonly subscriptions: number;
}

/**
 * Check that the test account pays for nothing.
 *
 * @param zone - the install's zone, with the plan Cloudflare listed it under
 * @returns how many subscriptions were read; `failed` for a zone on a paid plan or a subscription with a price, naming each rate plan's id; `skipped` for a token without the permission of a reading
 */
export async function readFreePlans(run: Run, zone: Zone): Promise<FreePlans | Stop> {
  if (zone.plan !== "free") return { kind: "failed", what: `the zone is on the ${zone.plan} plan, not the Free plan` };

  // A plan Cloudflare names in no known way reads as Free above, so its price is asked for as well.
  const read = await callCloudflare(run.connection, (api) => new BaseZones(api).get({ zone_id: zone.id }));
  if (!read.ok) return stopOf(read, PERMISSIONS.zone);

  if ((read.value.plan?.price ?? 0) > 0) return { kind: "failed", what: "the zone's plan has a price, so it is not the Free plan" };

  const listed = await callCloudflare(run.connection, (api) => Array.fromAsync(new BaseSubscriptions(api).get({ account_id: run.accountId })));
  if (!listed.ok) return stopOf(listed, PERMISSIONS.subscriptions);

  const paid = listed.value.filter((subscription) => (subscription.price ?? 0) > 0 && !ENDED.has(subscription.state ?? ""));
  if (paid.length === 0) return { subscriptions: listed.value.length };

  const plans = paid.map((subscription) => subscription.rate_plan?.id ?? UNNAMED).join(", ");

  return { kind: "failed", what: `the account pays for ${paid.length} of its ${listed.value.length} subscriptions (${plans}), and the test account stays on the free plans` };
}
