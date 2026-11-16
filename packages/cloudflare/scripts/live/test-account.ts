// Whether an account is the test account: one that pays for nothing and holds the test install's bucket, a name no install of a person has.
//
// Every script that removes something by Cloudflare's API asks this first, so none of them acts on the account of a person.

import { BaseBuckets } from "cloudflare/resources/r2/buckets/buckets";

import { callCloudflare, type Zone } from "../../src/zone/client";
import { readFreePlans } from "./plan";
import { BUCKET, isStop, type Run, type Stop, stopOf } from "./util";

/**
 * Refuse any account that is not the test account.
 *
 * @param zone - the install's zone, with the plan Cloudflare listed it under; `undefined` for an install without a domain, of which the subscriptions alone are read
 * @returns why nothing may be removed: an account that pays for something, or one without the test install's bucket; `undefined` for the test account, and for a token that cannot read the subscriptions
 */
export async function refuseOtherAccount(run: Run, zone: Zone | undefined): Promise<Stop | undefined> {
  const plans = await readFreePlans(run, zone);
  if (isStop(plans) && plans.kind === "failed") return plans;

  const buckets = await callCloudflare(run.connection, (api) => new BaseBuckets(api).list({ account_id: run.accountId, name_contains: BUCKET }));
  if (!buckets.ok) return stopOf(buckets, "Workers R2 Storage: Edit");

  const held = buckets.value.buckets?.some((bucket) => bucket.name === BUCKET) === true;

  return held ? undefined : { kind: "failed", what: "the account holds no bucket of the test install, so nothing in it is removed" };
}
