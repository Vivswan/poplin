// The free plan's limits that a setting can be put above. A value above one is allowed: it earns a warning, never a refusal.
//
// Each limit is answered as a mark on the setting's own value, so a screen can compare a value as it is typed.
//
//   setting                      part                   compared with
//   max_total_size               totalBytes             the bytes all sites hold together
//   max_site_size                siteBytes              the bytes one site holds
//   max_files_per_publish        filesPerPublish        the files one publish holds
//   max_files_per_day            filesPerDay            the files the publishes of one day hold
//   max_storage_writes_per_day   storageWritesPerDay    the times a day the storage is written to or listed
//   requests_per_day             storageReadsPerMonth   the reads of the storage a month of such days can cost: three for every request, and one for every file copied
//   requests_per_day             requestsPerDay         the day's requests
//   users                       users                 how many emails may log in
//
// The numbers and the sentences are the host's: this file names no plan and no price.

import { COPY_CALLS } from "@poplin/core/src/actions/sites/duplicate";
import type { SettingValues } from "@poplin/core/src/records/settings";

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

/** One limit as a mark on a setting's own value: the bytes of a size, the count of anything else. */
export interface FreeMark {
  /** The largest value that earns no warning. */
  readonly over: number;

  /** The sentence shown for a value above it. */
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
  readonly users: FreeLimit;
}

/**
 * The most requests a day whose month of reads stays within a limit. A month of days reads the storage for every request of a day, at the most calls one makes, and for every file a day's writes can copy.
 *
 * A host that takes more requests a day than the setting reads more.
 */
function requestsWithin(readsAMonth: number, values: SettingValues): number {
  return Math.floor((readsAMonth / DAYS_A_MONTH - Math.floor(values.max_storage_writes_per_day / COPY_CALLS)) / MOST_STORE_CALLS);
}

/**
 * Write the free plan's limits as marks on the settings they bound.
 *
 * @param values - the stored settings: the mark of the month's reads on the day's requests depends on the day's writes
 * @returns the marks of each bounded setting, by its key, one for each limit: a size's in bytes, the users' as how many there are, any other as the setting's count
 */
export function freeLimitMarks(values: SettingValues, limits: FreeLimits): Readonly<Partial<Record<keyof SettingValues, readonly FreeMark[]>>> {
  const mark = (limit: FreeLimit, over = limit.most): FreeMark => ({ over, warning: limit.warning });

  return {
    max_total_size: [mark(limits.totalBytes)],
    max_site_size: [mark(limits.siteBytes)],
    max_files_per_publish: [mark(limits.filesPerPublish)],
    max_files_per_day: [mark(limits.filesPerDay)],
    max_storage_writes_per_day: [mark(limits.storageWritesPerDay)],
    requests_per_day: [mark(limits.storageReadsPerMonth, requestsWithin(limits.storageReadsPerMonth.most, values)), mark(limits.requestsPerDay)],
    users: [mark(limits.users)],
  };
}
