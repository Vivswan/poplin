// The daily question an install asks the project's website: which version of poplin is the newest.
//
//   asked today already, whatever came of it   nothing is fetched, nothing is written
//   `update_check` is off                      nothing is fetched, nothing is written
//   an answer that names a release, or none    kept, with the moment it was asked
//   no answer that can be read                 the release known before stays, and the moment is kept: the next try is the next UTC day
//
// The request carries nothing of the install: no version, no id, and no address is put in its URL or its headers.

import { homepage } from "../../../cli/package.json";
import { textUpTo } from "../api/text-up-to";
import { publishedRelease, type UpdateNews } from "../records/update";
import type { Install } from "./records";
import { DAY_MS } from "./site-object";

/** Where the newest release is published: one static file of the project's website. */
const LATEST_ADDRESS = new URL("latest.json", homepage).href;

/** How long the website has to answer, in milliseconds. */
const PATIENCE_MS = 5000;

/** The most bytes of an answer that are read. */
const MOST_BYTES = 16_384;

/** Fetches an address: the platform's own `fetch`, or a stand-in. */
type Fetch = (address: string, init: { readonly signal: AbortSignal }) => Promise<Response>;

/** What the check is given besides the install. */
export interface Asking {
  /** What sends the one request. */
  readonly fetch: Fetch;

  /** The address of the file; the project's website when left out. */
  readonly address?: string;

  /** How long the answer may take, in milliseconds; five seconds when left out. */
  readonly patienceMs?: number;
}

/** Ask for the newest release once. `null` is a website that names none yet; `undefined` is no answer that can be read, for whatever reason. */
async function newestRelease(asking: Asking): Promise<UpdateNews | null | undefined> {
  try {
    const response = await asking.fetch(asking.address ?? LATEST_ADDRESS, { signal: AbortSignal.timeout(asking.patienceMs ?? PATIENCE_MS) });
    if (response.status !== 200 || response.body === null) {
      await response.body?.cancel();

      return undefined;
    }

    const text = await textUpTo(response.body, MOST_BYTES);
    if (text === undefined) return undefined;

    return publishedRelease(text);
  } catch {
    return undefined;
  }
}

/**
 * Learn the newest released version, at most once a UTC day, and keep it for `updateOf`.
 *
 * It costs one read of the database when today's question was asked, two when `update_check` is off, and two reads, one request, and one row written on the one call a day that asks.
 * A website that is down, slow, or answers anything but the file is never an error: the day counts as asked.
 *
 * @throws {Error} the database failed; nothing was kept, and the next call asks again
 */
export async function checkForUpdate(install: Pick<Install, "database" | "now">, asking: Asking): Promise<void> {
  const now = install.now();
  const last = await install.database.readUpdateCheck();
  if (last !== undefined && Math.floor(last.checked_at / DAY_MS) === Math.floor(now / DAY_MS)) return;

  const settings = await install.database.readSettings();
  if (settings?.update_check !== true) return;

  const newest = await newestRelease(asking);

  await install.database.keepUpdateCheck({ checked_at: now, news: newest === undefined ? (last?.news ?? null) : newest });
}
