// The setting of the Worker's logs, carried to Cloudflare with the key poplin keeps: the Worker's observability is written as the setting says.
//
//   setting          at Cloudflare                                    written under
//   provider_logs    the Worker's observability, and its logs: on     "Workers Scripts Write"
//
//   after a change of the setting    written every time: a read just after a write may still answer the logs as they were
//   on the run that begins a day     written only where the read differs, by the code a repair runs
//
// Nothing else of the Worker is read or changed: no code, no binding, and no version of it. No answer carries the key or a text Cloudflare sent.

import type { LogsFollow } from "@poplin/app/src/console/settings/logs-follow";
import { type KeptKey, keyed } from "../../key/kept-key";
import { stateLogs, syncLogs } from "./worker-logs";

/** Cloudflare's name of the right the Worker's observability is read and written under. */
const RIGHT = "Workers Scripts Write";

/** The calls to Cloudflare one writing of the logs makes at most, before any the SDK sends again: the observability read, and written. */
export const LOGS_PUSH_CALLS = 2;

/**
 * Make the install's way to carry its setting of the logs to its own Worker.
 *
 * @param key - the kept key, or `undefined` on an install that holds none, which answers every try `no_key` and calls nothing
 * @param worker - the install's own Worker
 * @param writes - when a try writes: `every time` for the tries after a change of the setting, `where it differs` for the ones of the run that begins a day
 * @returns the logs' side at Cloudflare. A try is done once Cloudflare keeps the Worker's lines, or keeps none, as the setting asks
 */
export function createLogsFollow(key: KeptKey | undefined, worker: { readonly accountId: string; readonly script: string }, writes: "every time" | "where it differs"): LogsFollow {
  return {
    holdsKey: () => key !== undefined,

    async push(kept) {
      const written = await keyed(key, RIGHT, async (connection) => {
        if (writes === "every time") return stateLogs(connection, worker, kept);

        const synced = await syncLogs(connection, worker, kept, "apply");

        return synced.ok ? { ok: true, value: undefined } : synced;
      });

      return written.ok ? { ok: true } : { ok: false, refusal: written.refusal };
    },
  };
}
