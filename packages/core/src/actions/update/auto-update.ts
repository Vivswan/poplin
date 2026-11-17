// The update an install starts by itself, once a person has switched `auto_update` on. It is asked on the one scheduled run of a UTC day that asked for the newest release.
//
//   `auto_update` is off                                      nothing is started
//   the website did not answer this run                       nothing is started: a release known from an earlier day may no longer be the newest
//   no release newer than the running version is known        nothing is started
//   the release's schema differs from this install's own      never started: it changes the database, so a person starts it
//   less than three days since the install first knew of it   nothing is started yet
//   a start that went in for that version or a newer one      never a second one
//   the host holds no key                                     nothing is started, and nothing is kept
//   all of the above passed                                   one start of that version, as `startUpdate` makes it for the sweep's own actor
//
// The version is kept as taken before anything is sent, and taken back only when nothing was sent or the host answered that it did not take it.
// A start taken back is tried again on the next UTC day, and no sooner. One with no answer may have been taken, so it is not tried again.
// Sent means the files were handed over to be put in place: a release that could not be fetched or checked sent nothing.

import gt from "semver/functions/gt";

import { SWEEPER } from "../../auth/scopes";
import type { Learned } from "./check-update";
import type { Install } from "../records";
import { DAY_MS } from "../sites/site-object";
import { type SelfUpdate, startUpdate, type Updating } from "../start-update";
import { changesDatabase, newerRelease } from "./update";

/** How long a release waits, from the moment the install first knew of its version, before the install starts it by itself, in milliseconds: three days. */
const AUTO_UPDATE_WAIT_MS = 3 * DAY_MS;

/** What the day's asking learned, and the version the install runs. */
interface Running extends Learned {
  readonly version: string;
}

/** The version to start now, or `undefined` while any rule of the table above holds it back. Nothing is read. */
function dueVersion(running: Running, now: number): string | undefined {
  const { check, settings, answered, version } = running;
  if (!settings.auto_update || !answered) return undefined;

  const newer = newerRelease(check, version);
  if (newer === undefined || changesDatabase(newer)) return undefined;

  if (check.seen_at === null || now - check.seen_at < AUTO_UPDATE_WAIT_MS) return undefined;

  const taken = check.auto?.taken ?? null;
  if (taken !== null && !gt(newer.version, taken)) return undefined;

  return newer.version;
}

/** Wrap what takes a release so that handing its files over to be put in place is seen as sent. */
function watched(self: SelfUpdate, asked: { sent: boolean }): SelfUpdate {
  return {
    holdsKey: self.holdsKey,
    last: self.last,
    async ready(wanted) {
      const ready = await self.ready(wanted);
      if (!ready.ok) return ready;

      const put: typeof ready.put = () => {
        asked.sent = true;

        return ready.put();
      };

      return { ...ready, put };
    },
  };
}

/**
 * Start the update that is due, if one is, and keep the try. It adds no call to the database while none is due, or while the host holds no key.
 *
 * A start costs four calls to the database, five when it is refused and noted, and what the host asks to fetch, check, and place the files.
 *
 * @param running - what `checkForUpdate` answered on this run, and the version the install runs
 * @throws {Error} the database failed; files that were handed over stay handed over, and their version stays kept as taken, so it is not started again by itself
 */
export async function startDueUpdate(install: Pick<Install, "database" | "now">, running: Running, updating: Updating): Promise<void> {
  const at = install.now();
  const version = dueVersion(running, at);
  if (version === undefined || !updating.self.holdsKey()) return;

  const asked = { sent: false };
  const self = watched(updating.self, asked);
  const takeBack = (): Promise<void> => install.database.keepAutoStart({ version, at, taken: running.check.auto?.taken ?? null });

  // Kept before the files are handed over: a start whose record could not be written after it would be sent again the next day.
  await install.database.keepAutoStart({ version, at, taken: version });
  const start = await startUpdate(install, SWEEPER, { version: running.version, automatic: true, to: version }, { ...updating, self }).catch(async (error: unknown) => {
    if (!asked.sent) await takeBack().catch(() => undefined);

    throw error;
  });
  if (start.ok || (asked.sent && start.code === "update_unreachable")) return;

  await takeBack();
}
