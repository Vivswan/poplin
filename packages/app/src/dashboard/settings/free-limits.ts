// The free plan's limits that a setting can be put above. A value above one is allowed: it earns a warning, never a refusal.
//
//   setting            part             compared with
//   max_total_size     totalBytes       the bytes all sites hold together
//   max_site_size      siteBytes        the bytes one site holds
//   requests_per_day   requestsPerDay   the day's requests
//   logins             logins           how many emails may log in
//
// The numbers and the sentences are the host's: this file names no plan and no price.

import { type SettingValues, sizeBytes } from "@poplin/core/src/records/settings";

/** One limit of the free plan. */
interface FreeLimit {
  /** The most the free plan takes. A value at it earns no warning. */
  readonly most: number;

  /** The sentence shown beside a value above it: what the limit is, and what going over costs. */
  readonly warning: string;
}

/** The free plan's limits of whoever hosts the install, one per thing a setting can raise. */
export interface FreeLimits {
  readonly totalBytes: FreeLimit;
  readonly siteBytes: FreeLimit;
  readonly requestsPerDay: FreeLimit;
  readonly logins: FreeLimit;
}

/**
 * Find the settings that are above a limit of the free plan.
 *
 * @returns one warning sentence per such setting, by its key; empty when every value is within the limits
 */
export function freeLimitWarnings(values: SettingValues, limits: FreeLimits): ReadonlyMap<keyof SettingValues, string> {
  const rows: readonly (readonly [keyof SettingValues, number, FreeLimit])[] = [
    ["max_total_size", sizeBytes(values.max_total_size), limits.totalBytes],
    ["max_site_size", sizeBytes(values.max_site_size), limits.siteBytes],
    ["requests_per_day", values.requests_per_day, limits.requestsPerDay],
    ["logins", values.logins.length, limits.logins],
  ];
  const above = rows.filter(([, value, limit]) => value > limit.most);

  return new Map(above.map(([setting, , limit]) => [setting, limit.warning]));
}
