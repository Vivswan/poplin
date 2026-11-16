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
// A release never states the key's own binding: one that does is refused, as one that names a binding the Worker lacks.
// The upload is whole or not at all. Code that throws as it loads is refused by Cloudflare, and the Worker goes on running what it ran.

import type { Keyed } from "@poplin/app/src/console/key/records";
import { BaseSchedules } from "cloudflare/resources/workers/scripts/schedules";
import { BaseScriptAndVersionSettings } from "cloudflare/resources/workers/scripts/script-and-version-settings";
import { BaseScripts } from "cloudflare/resources/workers/scripts/scripts";
import { MAP_FILE, MODULE_FILE } from "../deploy/bundle-manifest";
import { type KeptKey, keyed } from "../key/kept-key";
import { type CloudflareResult, callCloudflare } from "../zone/client";
import { INSTALL_OBJECTS } from "../zone/install-objects";
import type { CheckedBundle } from "./bundle-files";

/** Cloudflare's name of the right every call here needs. */
const RIGHT = "Workers Scripts Write";

/** The error code of an upload whose code throws as it loads. */
const LOAD_ERROR = 10_021;

/** The statuses that say something of the key or of nothing at all, and nothing of the code: `keyed` reads them. */
const NOT_ABOUT_CODE: ReadonlySet<number> = new Set([401, 403, 408, 429]);

/** The first status that is a failure of Cloudflare's own. */
const SERVER_FAILURE = 500;

/** The Worker that is replaced. */
interface OwnWorker {
  readonly accountId: string;
  readonly script: string;
}

/** A call the key itself was refused for, or that got no answer. */
type KeyRefused = Extract<Keyed<never>, { readonly ok: false }>;

/** What Cloudflare said of the code it was sent. */
type Sent = { readonly taken: true } | { readonly taken: false; readonly status: number; readonly load: boolean };

/** How an upload ended: in place, with `unset` naming a schedule that was not taken; or nothing changed. `unread` is bindings Cloudflare did not answer with, `needs_hand` a release no upload can place, and `load` code that throws as it loads. */
type Put =
  | { readonly ok: true; readonly unset?: "schedule" }
  | KeyRefused
  | { readonly ok: false; readonly refusal: "unread" }
  | { readonly ok: false; readonly refusal: "needs_hand" }
  | { readonly ok: false; readonly refusal: "version_refused"; readonly status: number; readonly load: boolean };

/** An opened way to the Worker: the key was taken for it. */
export interface Upload {
  /** Reads the Worker's bindings, then sends the one upload of a release's files, then the schedule when the release's differs. */
  readonly put: (bundle: CheckedBundle) => Promise<Put>;
}

/** The metadata of an upload, as JSON text, or `undefined` for a release that names a kept binding the Worker lacks, or states the key's own. */
function metadataOf(bundle: CheckedBundle, current: { readonly bindings: readonly string[]; readonly observability: unknown }): string | undefined {
  const { deploy, version } = bundle;
  const stated = deploy.bindings.flatMap((binding) => (binding.kind === "stated" ? [{ ...binding.binding, name: binding.name }] : []));
  const lacking = deploy.bindings.some((binding) => binding.kind === "kept" && !current.bindings.includes(binding.name));
  if (lacking || stated.some((binding) => binding.name === INSTALL_OBJECTS.keyBinding)) return undefined;

  const inherited = current.bindings.filter((name) => !stated.some((binding) => binding.name === name)).map((name) => ({ name, type: "inherit" }));
  const observability = deploy.observability ?? current.observability ?? undefined;

  return JSON.stringify({
    main_module: deploy.main_module,
    compatibility_date: deploy.compatibility_date,
    compatibility_flags: deploy.compatibility_flags,
    bindings: [...inherited, ...stated],
    ...(observability === undefined ? {} : { observability }),
    annotations: { "workers/tag": version, "workers/message": `poplin ${version}, by its own update` },
  });
}

/** Read Cloudflare's answer to an upload: a refusal that is about the code sent is a value, and every other failure stays one. */
function sentOf(answer: CloudflareResult<unknown>): CloudflareResult<Sent> {
  if (answer.ok) return { ok: true, value: { taken: true } };

  if (answer.failure !== "refused" || NOT_ABOUT_CODE.has(answer.status) || answer.status >= SERVER_FAILURE) return answer;

  return { ok: true, value: { taken: false, status: answer.status, load: answer.errors.some((error) => error.code === LOAD_ERROR) } };
}

/** Read the Worker's bindings, send the one upload, then the schedule when it differs. */
async function put(key: KeptKey | undefined, worker: OwnWorker, sending: { readonly bundle: CheckedBundle; readonly crons: readonly string[] }): Promise<Put> {
  const { bundle } = sending;
  const settings = await keyed(key, RIGHT, (connection) => callCloudflare(connection, (api) => new BaseScriptAndVersionSettings(api).get(worker.script, { account_id: worker.accountId })));
  // No answer here is told apart from no answer to the upload: nothing was sent yet, so nothing can be in.
  if (!settings.ok) return settings.refusal === "unreachable" ? { ok: false, refusal: "unread" } : settings;

  const bindings = (settings.value.bindings ?? []).map((binding) => binding.name);
  const metadata = metadataOf(bundle, { bindings, observability: settings.value.observability });
  if (metadata === undefined) return { ok: false, refusal: "needs_hand" };

  const map = bundle.map === undefined ? {} : { [MAP_FILE]: new File([bundle.map], MAP_FILE, { type: "application/source-map" }) };
  // Cloudflare reads the metadata from one form field of JSON text, and each file from a field of its own name. The SDK would spread a metadata object over a field per key, so the form's fields are handed over as the request's body.
  const body = { metadata, [MODULE_FILE]: new File([bundle.module], MODULE_FILE, { type: "application/javascript+module" }), ...map };
  const sent = await keyed(key, RIGHT, async (connection) =>
    sentOf(
      await callCloudflare(connection, (api) =>
        // The SDK names a content type of its own for this call. Unset, the form's own type goes out, with the boundary its parts are read by.
        // The upload is sent once: a second try would name the bindings read before the first, and drop one added since.
        new BaseScripts(api).update(worker.script, { account_id: worker.accountId, bindings_inherit: "strict", metadata: {} }, { body, headers: { "Content-Type": null }, maxRetries: 0 }),
      ),
    ),
  );
  if (!sent.ok) return sent;

  if (!sent.value.taken) return { ok: false, refusal: "version_refused", status: sent.value.status, load: sent.value.load };

  const [wanted, current] = [new Set(bundle.deploy.crons), new Set(sending.crons)];
  if (wanted.size === current.size && [...wanted].every((cron) => current.has(cron))) return { ok: true };

  const scheduled = await keyed(key, RIGHT, (connection) =>
    callCloudflare(connection, (api) => new BaseSchedules(api).update(worker.script, { account_id: worker.accountId, body: [...wanted].map((cron) => ({ cron })) })),
  );

  return scheduled.ok ? { ok: true } : { ok: true, unset: "schedule" };
}

/**
 * Open the way to the Worker's own code: one small read with the kept key, so a key that is absent, refused, or without the right is known before a file is fetched.
 *
 * @param key - the kept key, or `undefined` on an install that holds none
 * @returns what sends the upload, or the key's refusal: `lacks_right` names the right. Nothing is changed, and no answer holds the key or a text Cloudflare sent
 */
export async function openUpload(key: KeptKey | undefined, worker: OwnWorker): Promise<Keyed<Upload>> {
  const schedules = await keyed(key, RIGHT, (connection) => callCloudflare(connection, (api) => new BaseSchedules(api).get(worker.script, { account_id: worker.accountId })));
  if (!schedules.ok) return schedules;

  const crons = schedules.value.schedules.map((schedule) => schedule.cron);

  return { ok: true, value: { put: (bundle) => put(key, worker, { bundle, crons }) } };
}
