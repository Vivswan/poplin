// The limits of the install that bound one another. A setting put above the one that bounds it is allowed: it earns a warning, never a refusal, as a value above a free limit does.
//
//   setting                       compared with
//   max_site_size                 max_total_size: one site cannot hold more than all sites together
//   visitor_requests_per_minute   site_requests_per_minute: one visitor of a site cannot be answered more often than the site is
//
// Each is answered as a mark on the setting's own value, as the free limits are, so a screen compares a value as it is typed.
// The mark names the setting that bounds, which a screen holds a field of too: it follows that field, and the stored value is the mark only until the field is changed.

import { type SettingValues, sizeBytes } from "@poplin/core/src/records/settings";

import type { FreeMark } from "./free-limits";

/** What a size of one site above the size of all sites says. */
const ABOVE_ALL_SITES = "More than all sites together may hold, so that limit is reached first.";

/** What a visitor's requests above a site's say. */
const ABOVE_ONE_SITE = "More than one site answers in a minute, so that limit is reached first.";

/** A mark that is the value of another setting, named as `bound`. */
export interface PairMark extends FreeMark {
  readonly bound: keyof SettingValues;
}

/**
 * Write the limits that bound another setting as marks on the setting they bound.
 *
 * @param values - the stored settings: a mark is the stored value of the bounding setting
 * @returns the mark of each bounded setting, by its key: a size's in bytes, any other as the setting's count
 */
export function pairMarks(values: SettingValues): Readonly<Partial<Record<keyof SettingValues, readonly PairMark[]>>> {
  return {
    max_site_size: [{ over: sizeBytes(values.max_total_size), warning: ABOVE_ALL_SITES, bound: "max_total_size" }],
    visitor_requests_per_minute: [{ over: values.site_requests_per_minute, warning: ABOVE_ONE_SITE, bound: "site_requests_per_minute" }],
  };
}
