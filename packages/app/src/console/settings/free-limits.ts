// The free plan's limits that a setting can be put above. A value above one is allowed: it earns a warning, never a refusal.
//
//   setting                      part                   compared with
//   max_total_size               totalBytes             the bytes all sites hold together
//   max_site_size                siteBytes              the bytes one site holds
//   max_files_per_publish        filesPerPublish        the files one publish holds
//   max_files_per_day            filesPerDay            the files the publishes of one day hold
//   max_storage_writes_per_day   storageWritesPerDay    the times a day the storage is written to or listed
//   requests_per_day             storageReadsPerMonth   the reads of the storage a month of such days can cost: three for every request, and one for every file copied
//   requests_per_day             requestsPerDay         the day's requests
//   logins                       logins                 how many emails may log in
//
// The numbers and the sentences are the host's: this file names no plan and no price.

import { COPY_CALLS } from "@poplin/core/src/actions/duplicate";
import { type SettingValues, sizeBytes } from "@poplin/core/src/records/settings";

import { MOST_STORE_CALLS } from "../../sites/serve";

/** The days of the longest month. */
const DAYS_A_MONTH = 31;

/** One limit of the free plan. */
interface FreeLimit {
  /** The most the free plan takes. A value at it earns no warning. */
  readonly most: number;

  /** The sentence shown for a value above it: the limit's number, and what happens past it. */
  readonly warning: string;
}

/** The free plan's limits of whoever hosts the install, one per thing a setting can raise. */
export interface FreeLimits {
  readonly totalBytes: FreeLimit;
  readonly siteBytes: FreeLimit;
  readonly filesPerPublish: FreeLimit;
  readonly filesPerDay: FreeLimit;
  readonly storageWritesPerDay: FreeLimit;
  readonly storageReadsPerMonth: FreeLimit;
  readonly requestsPerDay: FreeLimit;
  readonly logins: FreeLimit;
}

/** The most reads of the storage a month of days at these settings costs: every request of a day at the most calls one makes, and the read of every file a day's writes can copy. A host that takes more requests a day than the setting reads more. */
function readsAMonth(values: SettingValues): number {
  return DAYS_A_MONTH * (values.requests_per_day * MOST_STORE_CALLS + Math.floor(values.max_storage_writes_per_day / COPY_CALLS));
}

/**
 * Find the settings that are above a limit of the free plan.
 *
 * @returns the warnings of each such setting, by its key, one sentence for each limit it is above; empty when every value is within the limits
 */
export function freeLimitWarnings(values: SettingValues, limits: FreeLimits): ReadonlyMap<keyof SettingValues, readonly string[]> {
  const rows: readonly (readonly [keyof SettingValues, number, FreeLimit])[] = [
    ["max_total_size", sizeBytes(values.max_total_size), limits.totalBytes],
    ["max_site_size", sizeBytes(values.max_site_size), limits.siteBytes],
    ["max_files_per_publish", values.max_files_per_publish, limits.filesPerPublish],
    ["max_files_per_day", values.max_files_per_day, limits.filesPerDay],
    ["max_storage_writes_per_day", values.max_storage_writes_per_day, limits.storageWritesPerDay],
    ["requests_per_day", readsAMonth(values), limits.storageReadsPerMonth],
    ["requests_per_day", values.requests_per_day, limits.requestsPerDay],
    ["logins", values.logins.length, limits.logins],
  ];
  const warnings = new Map<keyof SettingValues, readonly string[]>();

  for (const [setting, value, limit] of rows) {
    if (value <= limit.most) continue;

    warnings.set(setting, [...(warnings.get(setting) ?? []), limit.warning]);
  }

  return warnings;
}
