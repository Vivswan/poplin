// Cloudflare's free limits that a setting can be put above, and what the Settings tab says beside a value above one.
//
//   part              free limit                                  above it
//   totalBytes        R2: 10 GB stored                            storage is billed
//   siteBytes         R2: 10 GB stored                            storage is billed
//   filesPerPublish   Workers: 10 ms of processing a request      a publish of more files may not start
//   filesPerDay       R2: 1,000,000 write operations a month      operations are billed
//   requestsPerDay    Workers: 100,000 requests a day             nothing more is served without the paid plan
//   logins            Access: 50 users                            seats are billed

// A free limit no setting moves, and the fixed budget of core's that stays inside it:
//
//   budget in core                                           free limit
//   one removal of a folder's files: 30 calls to the store   Workers: 1,000 subrequests to Cloudflare's own services an invocation, R2 among them

import type { FreeLimits } from "@poplin/app/src/dashboard/settings/free-limits";

/** The bytes R2 stores for free. */
const FREE_STORAGE_BYTES = 10_000_000_000;

/** The write operations R2 takes for free in a month: every file a publish stores is one. */
const FREE_WRITES_A_MONTH = 1_000_000;

/** The days of the longest month. */
const DAYS_A_MONTH = 31;

/** The most files a publish declares and still starts within the processing time a Worker gets on the Free plan. */
const FREE_FILES_PER_PUBLISH = 5000;

/** The limits the dashboard of an install on Cloudflare warns against. */
export const FREE_LIMITS: FreeLimits = {
  totalBytes: { most: FREE_STORAGE_BYTES, warning: "above Cloudflare's free 10 GB; storage past that is billed by Cloudflare" },
  siteBytes: { most: FREE_STORAGE_BYTES, warning: "one site of this size is above Cloudflare's free 10 GB; storage past that is billed by Cloudflare" },
  filesPerPublish: { most: FREE_FILES_PER_PUBLISH, warning: "a publish this large may not start within the free plan's processing time" },
  filesPerDay: {
    most: Math.floor(FREE_WRITES_A_MONTH / DAYS_A_MONTH),
    warning: "a month of such days is above Cloudflare's free 1,000,000 R2 write operations; operations past that are billed by Cloudflare",
  },
  requestsPerDay: { most: 100_000, warning: "above Cloudflare's free 100,000 requests a day; has no effect without the paid Workers plan" },
  logins: { most: 50, warning: "above the 50 users Cloudflare Access takes for free; users past that are billed by Cloudflare" },
};
