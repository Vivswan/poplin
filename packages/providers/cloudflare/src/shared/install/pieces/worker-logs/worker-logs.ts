// The Worker's logs at Cloudflare, kept or not as the install's setting `provider_logs` says: the observability of the Worker, which Cloudflare holds for the script and not for a version of it.
//
//   GET    .../workers/scripts/{name}/script-settings      whether the lines the Worker writes are kept now
//   PATCH  .../workers/scripts/{name}/script-settings      only where that differs from the setting
//
// Cloudflare keeps a line when the observability and its logs are both on and the logs are stored. The setting switches both, stores the logs it keeps, and changes nothing else of the observability.
// Cloudflare's own record of each request stays off whatever the setting says: it holds the request's address.
// An upload replaces the observability, so every upload states the same value: `observabilityOf` is the one writer of it.

import { BaseSettings } from "cloudflare/resources/workers/scripts/settings";
import * as v from "valibot";
import { type Connection, callCloudflare } from "../../client";
import { INSTALL_OBJECTS } from "../../install-objects";
import { applySteps, type Mode, reportOf, type Synced } from "../../sync";

/** What the row of the logs names them by: kept, or not kept. */
export const LOGS_SUBJECTS = { kept: "kept", dropped: "not kept" } as const;

/** The status Cloudflare answers for a Worker that does not exist. */
const NO_WORKER = 404;

/** A value read as a record, or an empty one for anything else. */
const RECORD = v.fallback(v.record(v.string(), v.unknown()), {});

/** The Worker whose logs a run reads or writes. */
interface OwnWorker {
  /** The account the Worker runs in. */
  readonly accountId: string;

  /** The Worker's name. */
  readonly script: string;
}

/**
 * Say whether an observability keeps the lines the Worker writes.
 *
 * @param observability - the observability as Cloudflare answers it, unchecked
 * @returns `true` for one that is on and whose logs are neither switched off nor left unstored
 */
export function keepsLines(observability: unknown): boolean {
  const stated = v.parse(RECORD, observability);
  const logs = v.parse(RECORD, stated.logs);

  return stated.enabled === true && logs.enabled !== false && logs.persist !== false;
}

/** Whether an observability is already what the setting writes: its lines kept or not as `kept` says, and, where they are kept, Cloudflare's own record of each request as an install has it. */
function matches(observability: unknown, kept: boolean): boolean {
  if (keepsLines(observability) !== kept) return false;

  return !kept || v.parse(RECORD, v.parse(RECORD, observability).logs).invocation_logs === INSTALL_OBJECTS.requestRecords;
}

/**
 * Write the observability a Worker is given, from the one it has or a release states and the install's setting.
 *
 * @param base - the observability as a release states it or as Cloudflare answers it, unchecked; anything that is no record counts as none
 * @param kept - the setting: whether Cloudflare keeps the lines the Worker writes
 * @returns `base` with the observability and its logs switched as `kept` says, kept logs stored where `base` says they are not, every request sampled where `base` names no share, and Cloudflare's own record of each request off
 */
export function observabilityOf(base: unknown, kept: boolean): { readonly enabled: boolean; readonly logs: { readonly enabled: boolean; readonly invocation_logs: boolean } } & Readonly<Record<string, unknown>> {
  const stated = v.parse(RECORD, base);
  const logs = v.parse(RECORD, stated.logs);
  const stored = kept && logs.persist === false ? { persist: true } : {};

  return {
    ...stated,
    enabled: kept,
    head_sampling_rate: stated.head_sampling_rate ?? INSTALL_OBJECTS.logsShare,
    logs: { ...logs, ...stored, enabled: kept, invocation_logs: INSTALL_OBJECTS.requestRecords },
  };
}

/**
 * Make the Worker's logs match the setting.
 *
 * @param kept - the setting: whether Cloudflare keeps the lines the Worker writes
 * @param mode - `plan` reads whether they are kept and sends no change
 * @returns one step, named `kept` or `not kept` as the setting asks: left where Cloudflare already matches and keeps no record of each request beside kept lines, and on an account with no such Worker, else changed. A refusal by Cloudflare is a value
 */
export async function syncLogs(connection: Connection, worker: OwnWorker, kept: boolean, mode: Mode): Promise<Synced> {
  const subject = kept ? LOGS_SUBJECTS.kept : LOGS_SUBJECTS.dropped;
  const settings = await callCloudflare(connection, (api) => new BaseSettings(api).get(worker.script, { account_id: worker.accountId }));
  // A Worker that does not exist has no logs to change: the upload that makes it states them as the setting says.
  if (!settings.ok && settings.failure === "refused" && settings.status === NO_WORKER) return { ok: true, report: reportOf([{ kind: "leave", subject }]) };

  if (!settings.ok) return { ...settings, report: reportOf([]) };

  const kind = matches(settings.value.observability, kept) ? "leave" : "change";
  const observability = observabilityOf(settings.value.observability, kept);

  return applySteps([{ kind, subject } as const], () => callCloudflare(connection, (api) => new BaseSettings(api).edit(worker.script, { account_id: worker.accountId, observability })), mode);
}
