// The account's R2 bucket, which holds every site's files. R2 keeps no mark on a bucket, so poplin's is the one with its fixed name.
// Nothing here writes a file or a rule of the bucket: the Worker that is bound to it does.

import { BaseBuckets } from "cloudflare/resources/r2/buckets/buckets";
import { type CloudflareResult, type Connection, callCloudflare } from "../../client";
import { INSTALL_OBJECTS } from "../../install-objects";
import { applySteps, type Mode, reportOf, type Synced } from "../../sync";

/** The name of poplin's bucket, the same in every account. */
const NAME = INSTALL_OBJECTS.bucket;

/** The most buckets one page of the list holds: every bucket whose name holds poplin's is on the first. */
const MOST_LISTED = 1000;

/** A bucket as the account has it now. */
interface AccountBucket {
  readonly name?: string;
}

/** One step of a bucket plan. */
type BucketStep = { readonly kind: "create" | "leave"; readonly subject: typeof NAME };

/**
 * Compute the change that gives the account poplin's bucket.
 *
 * @param buckets - the account's buckets as they are now
 * @returns one step: a `leave` for the bucket with poplin's name, whatever it holds, or a `create`; no step names another bucket
 */
export function planBucket(buckets: readonly AccountBucket[]): BucketStep[] {
  return [{ kind: buckets.some((bucket) => bucket.name === NAME) ? "leave" : "create", subject: NAME }];
}

/**
 * List the account's buckets whose names hold poplin's bucket's name.
 *
 * @returns the buckets, in one page; a refusal by Cloudflare is a value
 */
export async function listBuckets(connection: Connection, accountId: string): Promise<CloudflareResult<readonly AccountBucket[]>> {
  // The `name_contains` filter is a search, so a plan still compares each name in full.
  const listed = await callCloudflare(connection, (api) => new BaseBuckets(api).list({ account_id: accountId, name_contains: NAME, per_page: MOST_LISTED }));

  return listed.ok ? { ok: true, value: listed.value.buckets ?? [] } : listed;
}

/**
 * Make sure the account has poplin's bucket.
 *
 * @param mode - `plan` reads the account's buckets and sends no change
 * @returns what was created or left; a bucket with poplin's name is taken as it is, and a refusal by Cloudflare is a value
 */
export async function syncBucket(connection: Connection, accountId: string, mode: Mode): Promise<Synced> {
  const listed = await listBuckets(connection, accountId);
  if (!listed.ok) return { ...listed, report: reportOf([]) };

  return applySteps(planBucket(listed.value), () => callCloudflare(connection, (api) => new BaseBuckets(api).create({ account_id: accountId, name: NAME })), mode);
}
