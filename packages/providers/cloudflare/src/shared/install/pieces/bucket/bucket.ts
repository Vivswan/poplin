// The account's R2 bucket, which holds every site's files. R2 keeps no mark on a bucket, so poplin's is the one with its fixed name.
// Nothing here writes a file or a rule of the bucket: the Worker that is bound to it does.
//
// For a while after a bucket is removed, Cloudflare lists no bucket of its name and still refuses the name to a new one (409, code 10073). The list does not tell when that ends: the create's own answer does.
//
//   the list holds the name    -> the bucket is left, and no create is sent
//   the create is refused so   -> it is sent again 15 s later, 12 times at most: 180 s of waiting, then its last answer stands
//   any other 409              -> it stands at once: the SDK's own three tries of a conflict are off for this call
//   any other answer           -> as every call's: the SDK tries a failure of Cloudflare's own again, and a refusal stands

import { BaseBuckets } from "cloudflare/resources/r2/buckets/buckets";
import pRetry from "p-retry";
import { type CloudflareFailure, type CloudflareResult, type Connection, callCloudflare, clockOf, unretriedOn } from "../../client";
import { INSTALL_OBJECTS } from "../../install-objects";
import { applySteps, type Mode, reportOf, type Synced } from "../../sync";

/** The name of poplin's bucket, the same in every account. */
const NAME = INSTALL_OBJECTS.bucket;

/** The most buckets one page of the list holds: every bucket whose name holds poplin's is on the first. */
const MOST_LISTED = 1000;

/** What Cloudflare refuses a create with while it holds the name: the status, and the code its error table calls `BucketConflict`. */
const NAME_HELD = { status: 409, code: 10_073 } as const;

/** How often a create refused for a held name is sent again, and the wait before each, in milliseconds. A name was seen held 47 s after its bucket went, and free 110 s after. */
const AGAIN = { times: 12, everyMs: 15_000 } as const;

/** The milliseconds of a second, which the line a person reads counts in. */
const MS_PER_SECOND = 1000;

/** What a person is shown while a create waits to be sent again. */
const WAITING = `Cloudflare still holds the bucket name ${NAME} after a removal. Retrying in ${AGAIN.everyMs / MS_PER_SECOND} s`;

/** A bucket as the account has it now. */
interface AccountBucket {
  readonly name?: string;
}

/** One step of a bucket plan. */
type BucketStep = { readonly kind: "create" | "leave"; readonly subject: typeof NAME };

/** A create refused for a name Cloudflare still holds: what the creates after it go on from. */
class StillHeld extends Error {
  constructor(readonly refused: CloudflareFailure) {
    super("Cloudflare still holds the bucket's name");
  }
}

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
 * Make poplin's bucket in an account whose list holds none of its name, and again after a wait each time while Cloudflare still holds the name.
 *
 * The waits are on the connection's clock: the library waits none. A sleep that throws, as one the person stopped does, ends the creates with that error.
 *
 * @returns what the last create answered
 */
async function createBucket(connection: Connection, accountId: string): Promise<CloudflareResult<unknown>> {
  const sleep = clockOf(connection);
  // Every wait for a conflict is this file's, so the SDK sends a create that is answered 409 once.
  const unretried = unretriedOn(connection, NAME_HELD.status);
  const attempt = async (): Promise<CloudflareResult<unknown>> => {
    const created = await callCloudflare(unretried, (api) => new BaseBuckets(api).create({ account_id: accountId, name: NAME }));
    const held = !created.ok && created.failure === "refused" && created.status === NAME_HELD.status && created.errors.some((error) => error.code === NAME_HELD.code);
    if (held) throw new StillHeld(created);

    return created;
  };
  const again = async ({ error }: { readonly error: Error }): Promise<boolean> => {
    if (!(error instanceof StillHeld)) return false;

    await sleep(AGAIN.everyMs, WAITING);

    return true;
  };

  try {
    return await pRetry(attempt, { retries: AGAIN.times, minTimeout: 0, maxTimeout: 0, shouldRetry: again });
  } catch (error) {
    if (error instanceof StillHeld) return error.refused;

    throw error;
  }
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

  return applySteps(planBucket(listed.value), () => createBucket(connection, accountId), mode);
}
