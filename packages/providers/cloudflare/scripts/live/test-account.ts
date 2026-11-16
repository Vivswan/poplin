// Whether an account is a test account: one that pays for nothing and holds the bucket that marks it, of a name no install of a person has.
//
// The test install's own bucket is the product's, as every install's is, so it marks nothing. The marking bucket holds nothing the install reads.
// The step that makes the install match the commit asks this before its first command, and the removal of the files no record names before its first call, so neither acts on the account of a person.

import { BaseBuckets } from "cloudflare/resources/r2/buckets/buckets";

import { callCloudflare, type Zone } from "../../src/shared/install/client";
import { readFreePlans } from "./plan";
import { isStop, type Run, type Stop, stopOf, TEST_MARK } from "./util";

/**
 * Refuse any account that is not the test account.
 *
 * @param zone - the install's zone, with the plan Cloudflare listed it under; `undefined` for an install without a domain, of which the subscriptions alone are read
 * @returns why nothing may be changed: an account that pays for something, or one without the marking bucket; `undefined` for a test account, and for a token that cannot read the subscriptions
 */
export async function refuseOtherAccount(run: Run, zone: Zone | undefined): Promise<Stop | undefined> {
  const plans = await readFreePlans(run, zone);
  if (isStop(plans) && plans.kind === "failed") return plans;

  const buckets = await callCloudflare(run.connection, (api) => new BaseBuckets(api).list({ account_id: run.accountId, name_contains: TEST_MARK }));
  if (!buckets.ok) return stopOf(buckets, "Workers R2 Storage: Edit");

  const held = buckets.value.buckets?.some((bucket) => bucket.name === TEST_MARK) === true;

  return held ? undefined : { kind: "failed", what: "the account holds no bucket that marks a test account, so nothing in it is changed" };
}
