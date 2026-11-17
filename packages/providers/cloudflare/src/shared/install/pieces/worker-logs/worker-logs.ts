// The Worker's logs at Cloudflare, kept or not as the install's setting `provider_logs` says: the observability of the Worker, which Cloudflare holds for the script and not for a version of it.
//
//   GET    .../workers/scripts/{name}/script-settings      whether the lines the Worker writes are kept now
//   PATCH  .../workers/scripts/{name}/script-settings      after a change of the setting; by a repair and the run that begins a day only where that differs from the setting; a check sends none
//
// Cloudflare keeps a line when the observability and its logs are both on and the logs are stored. The setting switches both, stores the logs it keeps, and changes nothing else of the observability.
// Cloudflare's own record of each request stays off whatever the setting says: it holds the request's address.
// An upload replaces the observability, so every upload states the same value: `observabilityOf` is the one writer of it.

import { BaseSettings } from "cloudflare/resources/workers/scripts/settings";
import * as v from "valibot";
import { type CloudflareResult, type Connection, callCloudflare } from "../../client";
import { INSTALL_OBJECTS } from "../../install-objects";
import { applySteps, type Mode, reportOf, type Synced } from "../../sync";

/** What the row of the logs names them by: the state of the setting, as the row of the workers.dev route words its own. */
const LOGS_SUBJECTS = { kept: "enabled", dropped: "disabled" } as const;

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

/** Read the Worker's observability as Cloudflare answers it now; `undefined` on an account with no such Worker. */
async function readObservability(connection: Connection, worker: OwnWorker): Promise<CloudflareResult<{ readonly observability: unknown } | undefined>> {
  const settings = await callCloudflare(connection, (api) => new BaseSettings(api).get(worker.script, { account_id: worker.accountId }));
  if (settings.ok) return { ok: true, value: { observability: settings.value.observability } };

  return settings.failure === "refused" && settings.status === NO_WORKER ? { ok: true, value: undefined } : settings;
}

/** Write a Worker's observability as the setting asks, from the one it was read with. */
function writeObservability(connection: Connection, worker: OwnWorker, base: unknown, kept: boolean): Promise<CloudflareResult<unknown>> {
  const observability = observabilityOf(base, kept);

  return callCloudflare(connection, (api) => new BaseSettings(api).edit(worker.script, { account_id: worker.accountId, observability }));
}

/**
 * Make the Worker's logs match the setting.
 *
 * @param kept - the setting: whether Cloudflare keeps the lines the Worker writes
 * @param mode - `plan` reads whether they are kept and sends no change
 * @returns one step, named `enabled` or `disabled` as the setting asks: left where Cloudflare already matches and keeps no record of each request beside kept lines, and on an account with no such Worker, else changed. A refusal by Cloudflare is a value
 */
export async function syncLogs(connection: Connection, worker: OwnWorker, kept: boolean, mode: Mode): Promise<Synced> {
  const subject = kept ? LOGS_SUBJECTS.kept : LOGS_SUBJECTS.dropped;
  const read = await readObservability(connection, worker);
  if (!read.ok) return { ...read, report: reportOf([]) };

  // A Worker that does not exist has no logs to change: the upload that makes it states them as the setting says.
  if (read.value === undefined) return { ok: true, report: reportOf([{ kind: "leave", subject }]) };

  const { observability } = read.value;
  const kind = matches(observability, kept) ? "leave" : "change";

  return applySteps([{ kind, subject } as const], () => writeObservability(connection, worker, observability, kept), mode);
}

/**
 * Write the setting to the Worker's logs whatever Cloudflare answers they are now, for a setting that just changed.
 *
 * Cloudflare's reads of a Worker's settings trail its writes: a setting put back just after it was switched over reads as already there, and a write left out for that would leave Cloudflare with the other state.
 *
 * @param kept - the setting: whether Cloudflare keeps the lines the Worker writes
 * @returns nothing, once Cloudflare took the write or the account has no such Worker. The read gives only the parts of the observability the setting does not name. A refusal by Cloudflare is a value
 */
export async function stateLogs(connection: Connection, worker: OwnWorker, kept: boolean): Promise<CloudflareResult<undefined>> {
  const read = await readObservability(connection, worker);
  if (!read.ok) return read;

  if (read.value === undefined) return { ok: true, value: undefined };

  const written = await writeObservability(connection, worker, read.value.observability, kept);

  return written.ok ? { ok: true, value: undefined } : written;
}
