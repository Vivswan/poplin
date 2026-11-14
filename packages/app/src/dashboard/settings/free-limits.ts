// Cloudflare's free limits that a setting can be put above. A value above one is allowed: it earns a warning, never a refusal.
//
//   setting            free limit                      above it
//   max_total_size     R2: 10 GB stored                storage is billed
//   max_site_size      R2: 10 GB stored                storage is billed
//   requests_per_day   Workers: 100,000 requests a day nothing more is served without the paid plan
//   logins             Access: 50 users                seats are billed

import { type SettingValues, sizeBytes } from "@poplin/core/src/records/settings";

/** The bytes R2 stores for free. */
const FREE_STORAGE_BYTES = 10_000_000_000;

/** The requests a day the free Workers plan answers. */
const FREE_REQUESTS_PER_DAY = 100_000;

/** The users Cloudflare Access takes for free. */
const FREE_LOGINS = 50;

/** Every setting with a free limit: whether the values are above it, and what to say then. */
const FREE_LIMITS: readonly FreeLimit[] = [
  {
    setting: "max_total_size",
    isAbove: (values) => sizeBytes(values.max_total_size) > FREE_STORAGE_BYTES,
    warning: "above Cloudflare's free 10 GB; storage past that is billed by Cloudflare",
  },
  {
    setting: "max_site_size",
    isAbove: (values) => sizeBytes(values.max_site_size) > FREE_STORAGE_BYTES,
    warning: "one site of this size is above Cloudflare's free 10 GB; storage past that is billed by Cloudflare",
  },
  {
    setting: "requests_per_day",
    isAbove: (values) => values.requests_per_day > FREE_REQUESTS_PER_DAY,
    warning: "above Cloudflare's free 100,000 requests a day; has no effect without the paid Workers plan",
  },
  {
    setting: "logins",
    isAbove: (values) => values.logins.length > FREE_LOGINS,
    warning: "above the 50 users Cloudflare Access takes for free; users past that are billed by Cloudflare",
  },
];

/** One row of the table. */
interface FreeLimit {
  readonly setting: keyof SettingValues;
  readonly isAbove: (values: SettingValues) => boolean;
  readonly warning: string;
}

/**
 * Find the settings that are above a free limit of Cloudflare.
 *
 * @returns one warning sentence per such setting, by its key; empty when every value is within the free limits
 */
export function freeLimitWarnings(values: SettingValues): ReadonlyMap<keyof SettingValues, string> {
  const above = FREE_LIMITS.filter((limit) => limit.isAbove(values));

  return new Map(above.map((limit) => [limit.setting, limit.warning]));
}
