// When a site deletes itself: what a person chooses between, how the moment is written, and what puts back the one before.

import { sentFor } from "@/dialog/expiry/expiry-moments";
import type { Site } from "@/lib/sites";
import { momentIn } from "@/lib/timezone";

/** The spans a person chooses between, in days from the moment the menu opened. */
export const SPANS = [1, 7, 30] as const;

/** Write when a site deletes itself: the day and the time, in the time zone a person chose. */
export function expiryMoment(expires: Site["expires"]): string {
  return expires === "never" ? "Never" : momentIn(expires);
}

/**
 * What puts back the moment a site had before a change.
 *
 * @param previous - when the site deleted itself before the change
 */
export function backTo(previous: Site["expires"]): string {
  return previous === "never" ? "never" : sentFor(previous);
}
