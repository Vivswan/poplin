// The daily question an install asks the project's website: which version of poplin is the newest.
//
//   asked today already, whatever came of it   nothing is fetched, nothing is written
//   `update_check` is off                      nothing is fetched, nothing is written
//   an answer that names a release, or none    kept, with the moment it was asked
//   no answer that can be read                 the release known before stays, and the moment is kept: the next try is the next UTC day
//
// The database keeps, beside the release, the moment the install first learned of its version: a later day that names the same version leaves that moment as it was.
//
// The request carries nothing of the install: no version, no id, and no address is put in its URL or its headers.
//
// An admin asks the same question at once, by a press in the dashboard, whether `update_check` is on or off:
//
//   an asking for a person in this minute already       too_many_requests about `check`: nothing is fetched
//   another version than the kept one, or none for it   kept as the daily asking keeps it, with the moment: that UTC day counts as asked
//   the kept version, or none where none is kept        nothing is written: the day's own asking is still to come
//   no answer that can be read                          website_unreachable: nothing is written
//
// A version first seen today is started by no install today. So a press takes the day's own asking only on a day that has nothing to start: it never holds back an update that is due.

import { homepage } from "../../../../cli/package.json";
import { textUpTo } from "../../api/text-up-to";
import type { Actor } from "../../auth/scopes";
import type { SettingValues } from "../../records/settings";
import { publishedRelease, type UpdateCheck, type UpdateNews } from "../../records/update";
import { type Install, type Refused, refuse, settingsOf } from "../records";
import { DAY_MS } from "../sites/site-object";
import { takeInstallMinute, type Updating } from "../start-update";

/** Where the newest release is published: one static file of the project's website. */
const LATEST_ADDRESS = new URL("latest.json", homepage).href;

/** The most askings a minute the whole install makes for a person, whoever presses. */
const ASKINGS_PER_MINUTE = 1;

/** What the count of those askings is kept under. */
const COUNT_KEY = "check_update";

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

/** What a call that asked knows afterwards. */
export interface Learned {
  /** The row it kept. */
  readonly check: UpdateCheck;

  /** The settings it read on the way. */
  readonly settings: SettingValues;

  /** Whether the website answered this call: `false` when the kept release is only the one known before. */
  readonly answered: boolean;
}

/**
 * Ask for the newest release once.
 *
 * @returns the release; `null` for a website that names none yet; `undefined` for no answer that can be read, for whatever reason
 */
export async function newestRelease(asking: Asking): Promise<UpdateNews | null | undefined> {
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
 * A caller that read the last asking or the settings already hands them in, and each saves its read. A website that is down, slow, or answers anything but the file is never an error: the day counts as asked.
 *
 * @param known - the last asking as the caller read it, `undefined` inside it for an install that never asked; left out, it is read here
 * @returns what the one call a day that asks kept, whether the website answered or not; `undefined` from every other call
 * @throws {Error} the database failed; nothing was kept, and the next call asks again
 */
export async function checkForUpdate(
  install: Pick<Install, "database" | "now" | "knownSettings">,
  asking: Asking,
  known?: { readonly last: UpdateCheck | undefined },
): Promise<Learned | undefined> {
  const now = install.now();
  const last = known === undefined ? await install.database.readUpdateCheck() : known.last;
  if (last !== undefined && Math.floor(last.checked_at / DAY_MS) === Math.floor(now / DAY_MS)) return undefined;

  const settings = await settingsOf(install);
  if (settings?.update_check !== true) return undefined;

  const newest = await newestRelease(asking);
  const check = await install.database.keepUpdateCheck({ checked_at: now, news: newest === undefined ? (last?.news ?? null) : newest });

  return { check, settings, answered: newest !== undefined };
}

/**
 * Ask for the newest release now, for an admin who pressed for it, and keep a version the install did not know of as the daily asking keeps it. It asks whether `update_check` is on or off, and at most once a minute, all callers together.
 *
 * It costs one count of the minute and one request, then one read of the database, and one row written where the website names another version than the kept one.
 * An answer that names the kept version, or none where none is kept, writes nothing, so the day's own asking is still made, and with it the update an install starts by itself right after.
 *
 * @param counters - where the askings of a minute are counted
 * @returns the release the install keeps after the asking, `null` where it keeps none, or `not_allowed`, `too_many_requests` about `check` for a second asking in a minute, or `website_unreachable` for no answer that can be read
 * @throws {Error} the database failed; nothing was kept
 */
export async function checkNow(
  install: Pick<Install, "database" | "now">,
  actor: Actor,
  asking: Asking,
  counters: Updating["counters"],
): Promise<{ readonly ok: true; readonly news: UpdateNews | null } | Refused<"not_allowed" | "too_many_requests" | "website_unreachable">> {
  if (actor.scope !== "admin") return refuse("not_allowed");

  // The asking is of the moment it starts, as the daily one is: an answer that comes after midnight still counts to the day it was asked on.
  const now = install.now();
  const taken = await takeInstallMinute(counters, { key: COUNT_KEY, limit: ASKINGS_PER_MINUTE }, now);
  if (!taken.ok) return refuse("too_many_requests", "check");

  const news = await newestRelease(asking);
  if (news === undefined) return refuse("website_unreachable");

  const known = (await install.database.readUpdateCheck())?.news ?? null;
  if (known?.version === news?.version) return { ok: true, news: known };

  await install.database.keepUpdateCheck({ checked_at: now, news });

  return { ok: true, news };
}
