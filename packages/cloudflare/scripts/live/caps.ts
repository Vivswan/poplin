// The caps of the test install: far under what R2 stores and takes for free, and wide enough for the checks, the samples, and the demo.
//
//   setting                 test install   default   R2's free allowance
//   max_total_size          200MB          9GB       10 GB stored
//   max_site_size           20MB           200MB
//   max_sites               100            none
//   max_files_per_publish   2500           5000
//   max_files_per_day       5000           25000     1,000,000 writes and lists a month: 5,000 x 31 = 155,000
//
// The publish of two thousand files, which a person switches on, fits one publish and one day.

import type { SettingValues } from "@poplin/core/src/records/settings";

import { createClient, type Fetch } from "../../../cli/src/client/client";
import type { Stop } from "./util";

/** The settings every run gives the test install. */
export const LIVE_CAPS = {
  max_total_size: { count: 200, unit: "MB" },
  max_site_size: { count: 20, unit: "MB" },
  max_sites: 100,
  max_files_per_publish: 2500,
  max_files_per_day: 5000,
} as const satisfies Partial<SettingValues>;

/** An install as an admin's token reaches it. */
interface Reached {
  /** The origin the install's API answers on. */
  readonly server: string;

  /** An admin's token of the install. */
  readonly token: string;

  /** What sends the request. */
  readonly fetch: Fetch;
}

/**
 * Give an install the caps of the test install. Every other setting stays.
 *
 * @returns why the install did not take them, in words that quote nothing it said, or `undefined` once it did
 */
export async function capInstall(reached: Reached): Promise<Stop | undefined> {
  const changed = await createClient(reached).call("changeConfig", undefined, LIVE_CAPS);
  if (changed.ok) return undefined;

  const { failure } = changed;
  const status = "status" in failure ? ` with status ${failure.status}` : "";

  return { kind: "failed", what: `the install did not take its caps (${failure.kind}${status})` };
}
