// Cloudflare's free limits that a setting can be put above, and what the Settings tab says beside a value above one.
//
//   part             free limit                      above it
//   totalBytes       R2: 10 GB stored                storage is billed
//   siteBytes        R2: 10 GB stored                storage is billed
//   requestsPerDay   Workers: 100,000 requests a day nothing more is served without the paid plan
//   logins           Access: 50 users                seats are billed

import type { FreeLimits } from "@poplin/app/src/dashboard/settings/free-limits";

/** The bytes R2 stores for free. */
const FREE_STORAGE_BYTES = 10_000_000_000;

/** The limits the dashboard of an install on Cloudflare warns against. */
export const FREE_LIMITS: FreeLimits = {
  totalBytes: { most: FREE_STORAGE_BYTES, warning: "above Cloudflare's free 10 GB; storage past that is billed by Cloudflare" },
  siteBytes: { most: FREE_STORAGE_BYTES, warning: "one site of this size is above Cloudflare's free 10 GB; storage past that is billed by Cloudflare" },
  requestsPerDay: { most: 100_000, warning: "above Cloudflare's free 100,000 requests a day; has no effect without the paid Workers plan" },
  logins: { most: 50, warning: "above the 50 users Cloudflare Access takes for free; users past that are billed by Cloudflare" },
};
