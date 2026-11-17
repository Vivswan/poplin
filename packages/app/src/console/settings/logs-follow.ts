// The setting that says whether the provider keeps the install's logs, carried to the provider by the install itself after a change of it, with the key the install keeps.
//
//   the provider took the setting              carried   the logs are kept, or not, from then on
//   the install holds no key                   waits     the next update states the setting, and so does a repair
//   the key is refused, or lacks a right       waits     the check of the install's own objects says that the logs differ, and a repair writes them
//   the provider gave no usable answer         waits     the run that begins a day carries the setting again
//
// The change is stored before any of this, and stands whatever the provider answers. No mark says that a change waits: the stored setting is carried whole each time.
// A setting that changed while it was carried is carried once more, so the provider ends with the stored one.

import type { Install } from "@poplin/core/src/actions/records";
import type { Context } from "hono";

import type { KeyRefusal } from "../key/records";
import { runPastAnswer } from "../later";

/** The setting the provider's logs follow. */
const LOGS_SETTING = "provider_logs";

/** How often one change is carried: once, and once more for a setting that changed while the first was carried. */
const MOST_TRIES = 2;

/** Whether the provider holds the stored setting now, and why not where it does not. */
type Followed = { readonly carried: true } | { readonly carried: false; readonly why: KeyRefusal | "changed_again" };

/** The provider's side of the install's logs. */
export interface LogsFollow {
  /** Whether the install holds a key, so a change is carried with no person. No call to the provider. */
  holdsKey(): boolean;

  /** Make the provider keep the install's logs, or keep none, and change nothing else. It throws for nothing the provider answers, and no answer holds the key. */
  push(kept: boolean): Promise<{ readonly ok: true } | { readonly ok: false; readonly refusal: KeyRefusal }>;
}

/**
 * Say whether a change of the settings names the one the provider's logs follow.
 *
 * @param changes - the body of a change, unchecked
 */
export function namesLogs(changes: unknown): boolean {
  return typeof changes === "object" && changes !== null && LOGS_SETTING in changes;
}

/** The setting of the logs as it is stored now; `undefined` on an install with no settings. */
async function storedLogs(install: Pick<Install, "database">): Promise<boolean | undefined> {
  return (await install.database.readSettings())?.[LOGS_SETTING];
}

/**
 * Carry the stored setting of the logs to the provider.
 *
 * @param stored - the setting as the caller just stored or read it; left out, it is read
 * @returns whether the provider holds the stored setting now. An install with no key is asked nothing, and one with no settings has nothing to carry
 * @throws {Error} the database failed
 */
export async function followLogs(install: Pick<Install, "database">, follow: LogsFollow, stored?: boolean): Promise<Followed> {
  if (!follow.holdsKey()) return { carried: false, why: "no_key" };

  let kept = stored ?? (await storedLogs(install));

  for (let tries = 0; tries < MOST_TRIES && kept !== undefined; tries += 1) {
    const pushed = await follow.push(kept);
    if (!pushed.ok) return { carried: false, why: pushed.refusal };

    const after = await storedLogs(install);
    if (after === undefined || after === kept) return { carried: true };

    kept = after;
  }

  return kept === undefined ? { carried: true } : { carried: false, why: "changed_again" };
}

/**
 * Carry the setting of the logs after a change of it was stored, with no answer held for it where the host keeps a request alive past its answer.
 *
 * Nothing it does changes the answer. A try that fails leaves the provider as it was, for the run that begins a day to carry.
 *
 * @param context - the request the change came in
 * @param follow - the provider's side of the logs; without one, or with one that holds no key, nothing is read or asked
 * @param stored - the setting as the change left it
 */
export async function carryLogs(context: Context, install: Pick<Install, "database">, follow: LogsFollow | undefined, stored: boolean): Promise<void> {
  if (follow === undefined || !follow.holdsKey()) return;

  await runPastAnswer(
    context,
    followLogs(install, follow, stored).then(
      () => undefined,
      () => undefined,
    ),
  );
}
