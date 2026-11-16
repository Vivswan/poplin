// Cloudflare's free limits that a setting can be put above, and what the Settings tab says beside a value above one.
//
//   part              free limit                                  above it
//   totalBytes        R2: 10 GB stored                            storage is billed
//   siteBytes         R2: 10 GB stored                            storage is billed
//   filesPerPublish   Workers: 10 ms of processing a request      a publish of more files may not start
//   filesPerDay            R2: 1,000,000 Class A operations a month    operations are billed
//   storageWritesPerDay    R2: 1,000,000 Class A operations a month    operations are billed
//   storageReadsPerMonth   R2: 10,000,000 Class B operations a month   operations are billed
//   requestsPerDay         Workers: 100,000 requests a day             nothing more is served without the paid plan
//   logins                 Access: 50 users                            seats are billed
//
// R2 counts every put, list, and copy as Class A and every get and head as Class B, the ones that fail included; a delete is free. https://developers.cloudflare.com/r2/pricing/
//
//   the default settings              a day                                             the worst month of 31 days
//   Class A, writes and listings      30,000 by the setting, 1,000 more by the sweep    31 x 31,000 = 961,000, and 30,000 counted the day before the month began: 991,000
//   Class B, reads                    100,000 requests x 3, and 15,000 copied files     31 x 315,000 = 9,765,000
//
// The bound on reads holds on the free Workers plan alone: its 100,000 requests a day are a site's and the API's together, and an API request reads the bucket once at most, but for a copy, whose reads are counted with its writes.
// On the paid Workers plan no setting bounds the API's reads.

// A free limit no setting moves, and the fixed budget of core's that stays inside it:
//
//   budget in core                                           free limit
//   one removal of a folder's files: 30 calls to the store   Workers: 1,000 subrequests to Cloudflare's own services an invocation, R2 among them

import type { FreeLimits } from "@poplin/app/src/console/settings/free-limits";
import { SWEEP_SPARE_WRITES } from "@poplin/core/src/actions/sweep";

/** The bytes R2 stores for free. */
const FREE_STORAGE_BYTES = 10_000_000_000;

/** The Class A operations R2 takes for free in a month: every file stored and every listing is one. */
const FREE_WRITES_A_MONTH = 1_000_000;

/** The Class B operations R2 takes for free in a month: every read of a file, and every look at one, is one. */
const FREE_READS_A_MONTH = 10_000_000;

/** The days of the longest month. */
const DAYS_A_MONTH = 31;

/** The most writes and listings a day whose month stays free: a month spends at most 31 days of the setting and of the sweep's own listings, and one more day of the setting, for the writes an upload counted the day before the month began. */
const FREE_WRITES_A_DAY = Math.floor((FREE_WRITES_A_MONTH - DAYS_A_MONTH * SWEEP_SPARE_WRITES) / (DAYS_A_MONTH + 1));

/** The most files a publish declares and still starts within the processing time a Worker gets on the Free plan. */
const FREE_FILES_PER_PUBLISH = 5000;

/** The limits the dashboard of an install on Cloudflare warns against. */
export const FREE_LIMITS: FreeLimits = {
  totalBytes: { most: FREE_STORAGE_BYTES, warning: "Cloudflare bills storage past 10 GB." },
  siteBytes: { most: FREE_STORAGE_BYTES, warning: "Cloudflare bills storage past 10 GB." },
  filesPerPublish: { most: FREE_FILES_PER_PUBLISH, warning: "A publish over 5,000 files may not start on the free plan." },
  filesPerDay: {
    most: Math.floor(FREE_WRITES_A_MONTH / DAYS_A_MONTH),
    warning: "Past 1,000,000 writes a month, Cloudflare bills the rest.",
  },
  storageWritesPerDay: {
    most: FREE_WRITES_A_DAY,
    warning: "Past 1,000,000 writes a month, Cloudflare bills the rest.",
  },
  storageReadsPerMonth: {
    most: FREE_READS_A_MONTH,
    warning: "Requests read the storage. Past 10,000,000 reads a month, Cloudflare bills the rest.",
  },
  requestsPerDay: { most: 100_000, warning: "Past 100,000 requests a day you need Cloudflare's paid plan." },
  logins: { most: 50, warning: "Past 50 users, Cloudflare bills each login." },
};
