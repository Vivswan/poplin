// One release's checked files, put in place of the Worker's own code with the kept key.
//
//   GET  .../workers/scripts/{name}/schedules                        the first call with the key, before any file is fetched
//   GET  .../workers/scripts/{name}/settings                         every binding the Worker has now, read as the last thing before the upload
//   PUT  .../workers/scripts/{name}?bindings_inherit=strict          the module, its map, and the metadata, in one request
//   PUT  .../workers/scripts/{name}/schedules                        only when the release's cron list differs from the Worker's
//
// Every binding the Worker has is named `inherit`, so its bucket, its database, its variables, and its key stay as they are; one the release states whole is sent by value.
// `strict` makes Cloudflare refuse the upload when it cannot keep a binding so named, in place of dropping it.
// Cloudflare keeps no observability setting across an upload, so every upload states it: the release's, or else the Worker's own.
// Every update states one variable of its own, `LAST_UPDATE`: the version the install ran, the version it takes, the schema its database is at, and when.
// It comes in with the code or not at all, so the new code reads which version it can go back to.
// A release never states the key's own binding, nor that variable: one that does is refused, as one that names a binding the Worker lacks.
// A read of the bindings that lacks the Worker's own name is a read in part, and an upload after it would drop every binding it did not list: nothing is sent, and the update can be asked for again.
// The upload is whole or not at all. Code that throws as it loads is refused by Cloudflare, and the Worker goes on running what it ran.
//
// An install is the first update: the same files and the same metadata, sent with a person's token to a Worker that does not exist yet.
//
//   PUT  .../workers/scripts/{name}                                  nothing to inherit, so each binding the release keeps by name is stated by its first value
//
// A first upload is no update, so it states no `LAST_UPDATE`: there is no version to go back to.

import type { Keyed } from "@poplin/app/src/console/key/records";
import { LAST_UPDATE, type LastUpdate } from "@poplin/core/src/records/update";
import { BaseSchedules } from "cloudflare/resources/workers/scripts/schedules";
import { BaseScriptAndVersionSettings } from "cloudflare/resources/workers/scripts/script-and-version-settings";
import { BaseScripts } from "cloudflare/resources/workers/scripts/scripts";
import { MAP_FILE, MODULE_FILE } from "../publish/bundle-manifest";
import { type KeptKey, keyed } from "../../install/key/kept-key";
import { type CloudflareResult, type Connection, callCloudflare } from "../../install/client";
import { INSTALL_OBJECTS } from "../../install/install-objects";
import * as v from "valibot";
import type { CheckedBundle } from "./bundle-files";

/** Cloudflare's name of the right every call here needs. */
const RIGHT = "Workers Scripts Write";

/** The variable every update states: the update it is. */
const LAST_UPDATE_BINDING = "LAST_UPDATE";

/** The error code of an upload whose code throws as it loads. */
const LOAD_ERROR = 10_021;

/** The statuses that say something of the key or of nothing at all, and nothing of the code: `keyed` reads them. */
const NOT_ABOUT_CODE: ReadonlySet<number> = new Set([401, 403, 408, 429]);

/** The first status that is a failure of Cloudflare's own. */
const SERVER_FAILURE = 500;

/** The bindings no release states: the key's, and the variable an update states itself. */
const OWN_BINDINGS: ReadonlySet<string> = new Set([INSTALL_OBJECTS.keyBinding, LAST_UPDATE_BINDING]);

/** What the version an upload makes says made it, after the release's version. */
const MADE_BY = { update: "by its own update", install: "by its install" } as const;

/** The observability of a first upload whose release states none. */
const FIRST_OBSERVABILITY = {
  enabled: INSTALL_OBJECTS.logsKept,
  head_sampling_rate: INSTALL_OBJECTS.logsShare,
  logs: { enabled: INSTALL_OBJECTS.logsKept, invocation_logs: INSTALL_OBJECTS.requestRecords },
};

/** The Worker that is replaced, or made. */
interface OwnWorker {
  readonly accountId: string;
  readonly script: string;
}

/** A call the key itself was refused for, or that got no answer. */
type KeyRefused = Extract<Keyed<never>, { readonly ok: false }>;

/** What Cloudflare said of the code it was sent. */
type Sent = { readonly taken: true } | { readonly taken: false; readonly status: number; readonly load: boolean };

/** How an upload ended: in place, with `unset` naming a schedule not taken; or nothing changed. `unread` is bindings Cloudflare answered in part or not at all, `needs_hand` a release no upload can place, and `load` code that throws as it loads. */
type Put =
  | { readonly ok: true; readonly unset?: "schedule" }
  | KeyRefused
  | { readonly ok: false; readonly refusal: "unread" }
  | { readonly ok: false; readonly refusal: "needs_hand" }
  | { readonly ok: false; readonly refusal: "version_refused"; readonly status: number; readonly load: boolean };

/** An opened way to the Worker: the key was taken for it. */
export interface Upload {
  /** Reads the Worker's bindings, then sends the one upload of a release's files with the update it is, then the schedule when the release's differs. */
  readonly put: (bundle: CheckedBundle, update: LastUpdate) => Promise<Put>;
}

/** What one update sends: the release's files, the update it is, and the Worker's cron list as it was read. */
interface Sending {
  readonly bundle: CheckedBundle;
  readonly update: LastUpdate;
  readonly crons: readonly string[];
}

/** One binding as an upload sends it. */
export type SentBinding = Readonly<Record<string, unknown>> & { readonly name: string };

/** What an upload says beside the release's own values: every binding the release does not state, the observability where the release states none, and which of the two ways made it. */
interface Beside {
  readonly kept: readonly SentBinding[];
  readonly observability: unknown;
  readonly by: keyof typeof MADE_BY;
}

/** The bindings a release states whole, or `undefined` for one that states the key's own or an update's own variable. */
function statedOf(bundle: CheckedBundle): readonly SentBinding[] | undefined {
  const stated = bundle.deploy.bindings.flatMap((binding) => (binding.kind === "stated" ? [{ ...binding.binding, name: binding.name }] : []));

  return stated.some((binding) => OWN_BINDINGS.has(binding.name)) ? undefined : stated;
}

/** The metadata of an upload, as JSON text: the one writer of an update and of an install. */
function metadataOf(bundle: CheckedBundle, stated: readonly SentBinding[], beside: Beside): string {
  const { deploy, version } = bundle;
  const observability = deploy.observability ?? beside.observability ?? undefined;

  return JSON.stringify({
    main_module: deploy.main_module,
    compatibility_date: deploy.compatibility_date,
    compatibility_flags: deploy.compatibility_flags,
    bindings: [...beside.kept, ...stated],
    ...(observability === undefined ? {} : { observability }),
    annotations: { "workers/tag": version, "workers/message": `poplin ${version}, ${MADE_BY[beside.by]}` },
  });
}

/** The metadata of an update, where every binding the Worker has is kept by name; `undefined` for a release that names a kept binding the Worker lacks, or states the key's own or the update's own variable. */
function updateMetadata(sending: Pick<Sending, "bundle" | "update">, current: { readonly bindings: readonly string[]; readonly observability: unknown }): string | undefined {
  const { bundle } = sending;
  const released = statedOf(bundle);
  const lacking = bundle.deploy.bindings.some((binding) => binding.kind === "kept" && !current.bindings.includes(binding.name));
  if (lacking || released === undefined) return undefined;

  const stated = [...released, { name: LAST_UPDATE_BINDING, type: "json", json: sending.update }];
  const inherited = current.bindings.filter((name) => !stated.some((binding) => binding.name === name)).map((name) => ({ name, type: "inherit" }));

  return metadataOf(bundle, stated, { kept: inherited, observability: current.observability, by: "update" });
}

/** Send the one request that carries a release's files and its metadata. With `inherit`, Cloudflare refuses it when it cannot keep a binding the metadata names as kept. */
function sendFiles(connection: Connection, worker: OwnWorker, bundle: CheckedBundle, sending: { readonly metadata: string; readonly inherit: boolean }): Promise<CloudflareResult<unknown>> {
  const map = bundle.map === undefined ? {} : { [MAP_FILE]: new File([bundle.map], MAP_FILE, { type: "application/source-map" }) };
  // Cloudflare reads the metadata from one form field of JSON text, and each file from a field of its own name. The SDK would spread a metadata object over a field per key, so the form's fields are handed over as the request's body.
  const body = { metadata: sending.metadata, [MODULE_FILE]: new File([bundle.module], MODULE_FILE, { type: "application/javascript+module" }), ...map };
  const inherit = sending.inherit ? ({ bindings_inherit: "strict" } as const) : {};

  // The SDK names a content type of its own for this call. Unset, the form's own type goes out, with the boundary its parts are read by.
  // The upload is sent once: a second try would name the bindings read before the first, and drop one added since.
  return callCloudflare(connection, (api) => new BaseScripts(api).update(worker.script, { account_id: worker.accountId, ...inherit, metadata: {} }, { body, headers: { "Content-Type": null }, maxRetries: 0 }));
}

/** Read Cloudflare's answer to an upload: a refusal that is about the code sent is a value, and every other failure stays one. */
function sentOf(answer: CloudflareResult<unknown>): CloudflareResult<Sent> {
  if (answer.ok) return { ok: true, value: { taken: true } };

  if (answer.failure !== "refused" || NOT_ABOUT_CODE.has(answer.status) || answer.status >= SERVER_FAILURE) return answer;

  return { ok: true, value: { taken: false, status: answer.status, load: answer.errors.some((error) => error.code === LOAD_ERROR) } };
}

/** Read the Worker's bindings, send the one upload, then the schedule when it differs. */
async function put(key: KeptKey | undefined, worker: OwnWorker, sending: Sending): Promise<Put> {
  const { bundle } = sending;
  const settings = await keyed(key, RIGHT, (connection) => callCloudflare(connection, (api) => new BaseScriptAndVersionSettings(api).get(worker.script, { account_id: worker.accountId })));
  // No answer here is told apart from no answer to the upload: nothing was sent yet, so nothing can be in.
  if (!settings.ok) return settings.refusal === "unreachable" ? { ok: false, refusal: "unread" } : settings;

  const bindings = (settings.value.bindings ?? []).map((binding) => binding.name);
  if (!bindings.includes(INSTALL_OBJECTS.workerBinding)) return { ok: false, refusal: "unread" };

  const metadata = updateMetadata(sending, { bindings, observability: settings.value.observability });
  if (metadata === undefined) return { ok: false, refusal: "needs_hand" };

  const sent = await keyed(key, RIGHT, async (connection) => sentOf(await sendFiles(connection, worker, bundle, { metadata, inherit: true })));
  if (!sent.ok) return sent;

  if (!sent.value.taken) return { ok: false, refusal: "version_refused", status: sent.value.status, load: sent.value.load };

  const [wanted, current] = [new Set(bundle.deploy.crons), new Set(sending.crons)];
  if (wanted.size === current.size && [...wanted].every((cron) => current.has(cron))) return { ok: true };

  const scheduled = await keyed(key, RIGHT, (connection) => putCrons(connection, worker, [...wanted]));

  return scheduled.ok ? { ok: true } : { ok: true, unset: "schedule" };
}

/**
 * Read the cron list of a Worker.
 *
 * @returns each cron as it is written; a Worker that does not exist is refused, as Cloudflare answers it
 */
export async function readCrons(connection: Connection, worker: OwnWorker): Promise<CloudflareResult<readonly string[]>> {
  const schedules = await callCloudflare(connection, (api) => new BaseSchedules(api).get(worker.script, { account_id: worker.accountId }));

  return schedules.ok ? { ok: true, value: schedules.value.schedules.map((schedule) => schedule.cron) } : schedules;
}

/** Give a Worker its whole cron list, in place of the one it has. */
export function putCrons(connection: Connection, worker: OwnWorker, crons: readonly string[]): Promise<CloudflareResult<unknown>> {
  return callCloudflare(connection, (api) => new BaseSchedules(api).update(worker.script, { account_id: worker.accountId, body: crons.map((cron) => ({ cron })) }));
}

/**
 * Send the first upload of a Worker that does not exist yet: a release's checked files, with every binding stated and none inherited.
 *
 * @param connection - a person's token
 * @param first - the first value of each binding the release keeps by name
 * @returns Cloudflare's answer to the one request; `needs-hand` for a release that states the key's own binding or an update's own variable, which is sent nowhere
 */
export async function putFirst(connection: Connection, worker: OwnWorker, bundle: CheckedBundle, first: readonly SentBinding[]): Promise<CloudflareResult<unknown> | { readonly ok: false; readonly failure: "needs-hand" }> {
  const stated = statedOf(bundle);
  if (stated === undefined) return { ok: false, failure: "needs-hand" };

  return sendFiles(connection, worker, bundle, { metadata: metadataOf(bundle, stated, { kept: first, observability: FIRST_OBSERVABILITY, by: "install" }), inherit: false });
}

/**
 * Open the way to the Worker's own code: one small read with the kept key, so a key that is absent, refused, or without the right is known before a file is fetched.
 *
 * @param key - the kept key, or `undefined` on an install that holds none
 * @returns what sends the upload, or the key's refusal: `lacks_right` names the right. Nothing is changed, and no answer holds the key or a text Cloudflare sent
 */
export async function openUpload(key: KeptKey | undefined, worker: OwnWorker): Promise<Keyed<Upload>> {
  const crons = await keyed(key, RIGHT, (connection) => readCrons(connection, worker));
  if (!crons.ok) return crons;

  return { ok: true, value: { put: (bundle, update) => put(key, worker, { bundle, update, crons: crons.value }) } };
}

/**
 * Read the variable an update states, as the Worker was handed it.
 *
 * @param raw - the variable, unchecked
 * @returns the update the running code came in with, or `undefined` for a Worker whose code no update of its own put in place, or whose variable is no such record
 */
export function readLastUpdate(raw: unknown): LastUpdate | undefined {
  const last = v.safeParse(LAST_UPDATE, raw);

  return last.success ? last.output : undefined;
}
