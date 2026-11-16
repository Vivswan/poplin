// The two forwarders of an install without a domain: tiny Workers on the account's free address that hand every request to the one Worker over a service binding, so the open sites and the private sites each answer on a host of their own.
//
//   <worker>-sites     the open sites      service binding POPLIN -> <worker>, free address on, preview addresses off
//   <worker>-private   the private sites   the same
//
// A forwarder is poplin's by its tag. A Worker of a forwarder's name without the tag is somebody's own, and is never changed or removed.
// The one Worker sees the forwarder's hostname and the visitor's own address, so it routes and counts as it does on its own address.

import { BaseScriptAndVersionSettings } from "cloudflare/resources/workers/scripts/script-and-version-settings";
import { BaseScripts } from "cloudflare/resources/workers/scripts/scripts";
import { BaseSubdomain } from "cloudflare/resources/workers/scripts/subdomain";
import type { AccountAddresses } from "../address-layout";
import { type CloudflareResult, type Connection, callCloudflare } from "../client";
import { applySteps, type Mode, reportOf, type Synced } from "../sync";

/** The tag that marks a Worker as a forwarder of poplin's. */
const TAG = "poplin-forwarder";

/** The name of the service binding a forwarder reaches the one Worker through. */
const BINDING = "POPLIN";

/** The name of the one module a forwarder is made of. */
const MODULE = "forwarder.js";

/** The whole code of a forwarder. */
const CODE = "export default { fetch: (request, env) => env.POPLIN.fetch(request) };\n";

/** What Cloudflare takes an ES module by. */
const MODULE_TYPE = "application/javascript+module";

/** The day of the runtime a forwarder is uploaded for. */
const COMPATIBILITY_DATE = "2026-11-01";

/** What a Worker of a forwarder's name that poplin did not make is left out for. */
const NOT_OWN = "a Worker of this name is not poplin's: rename or delete it";

/** A Worker of the account as it is now. Its bindings and its two switches are read for a forwarder of poplin's alone. */
interface AccountWorker {
  /** The Worker's name. */
  readonly id?: string | undefined;

  /** The Worker's tags. */
  readonly tags?: readonly string[] | null | undefined;

  /** Every binding of the Worker. */
  readonly bindings?: readonly { readonly name: string; readonly type: string; readonly service?: string }[] | undefined;

  /** Whether the Worker answers on its free address. */
  readonly enabled?: boolean | undefined;

  /** Whether each version of the Worker answers on a preview address, which no login guards. */
  readonly previews_enabled?: boolean | undefined;
}

/** One step of a forwarders plan; `subject` is the forwarder's name. A `change` uploads the forwarder anew only where its binding differs, and sets its addresses either way. */
type ForwarderStep =
  | { readonly kind: "create"; readonly subject: string; readonly service: string }
  | { readonly kind: "change"; readonly subject: string; readonly service: string; readonly upload: boolean }
  | { readonly kind: "leave"; readonly subject: string }
  | { readonly kind: "skip"; readonly subject: string; readonly reason: string };

/** One step of taking the forwarders away; `subject` is the forwarder's name. */
type RemovalStep = { readonly kind: "remove"; readonly subject: string } | { readonly kind: "skip"; readonly subject: string; readonly reason: string };

function isOwn(worker: AccountWorker): boolean {
  return worker.tags?.includes(TAG) ?? false;
}

function forwards(worker: AccountWorker, service: string): boolean {
  const [binding, ...others] = worker.bindings ?? [];

  return others.length === 0 && binding?.type === "service" && binding.name === BINDING && binding.service === service;
}

function planForwarder(name: string, service: string, workers: readonly AccountWorker[]): ForwarderStep {
  const current = workers.find((worker) => worker.id === name);
  if (current === undefined) return { kind: "create", subject: name, service };

  if (!isOwn(current)) return { kind: "skip", subject: name, reason: NOT_OWN };

  const bound = forwards(current, service);
  if (bound && current.enabled === true && current.previews_enabled === false) return { kind: "leave", subject: name };

  return { kind: "change", subject: name, service, upload: !bound };
}

/** One step per forwarder, the open sites' first; no step names another Worker. */
function planForwarders(layout: AccountAddresses, workers: readonly AccountWorker[]): ForwarderStep[] {
  return [layout.sitesWorker, layout.privateWorker].map((name) => planForwarder(name, layout.worker, workers));
}

/** A step per Worker of a forwarder's name: a `remove` for one of poplin's and a `skip` for one that is not; none for a name the account has no Worker of. */
function planRemoval(layout: AccountAddresses, workers: readonly AccountWorker[]): RemovalStep[] {
  return [layout.sitesWorker, layout.privateWorker].flatMap((name): RemovalStep[] => {
    const current = workers.find((worker) => worker.id === name);
    if (current === undefined) return [];

    return [isOwn(current) ? { kind: "remove", subject: name } : { kind: "skip", subject: name, reason: NOT_OWN }];
  });
}

/** The account's Workers of the two forwarders' names; with `compared`, each of poplin's carries its bindings and its two switches. */
async function readForwarders(connection: Connection, accountId: string, layout: AccountAddresses, compared: boolean): Promise<CloudflareResult<AccountWorker[]>> {
  const listed = await callCloudflare(connection, (api) => Array.fromAsync(new BaseScripts(api).list({ account_id: accountId })));
  if (!listed.ok) return listed;

  const found: AccountWorker[] = [];

  for (const { id: name, tags } of listed.value) {
    if (name !== layout.sitesWorker && name !== layout.privateWorker) continue;

    if (!compared || !isOwn({ tags })) {
      found.push({ id: name, tags });
      continue;
    }

    const settings = await callCloudflare(connection, (api) => new BaseScriptAndVersionSettings(api).get(name, { account_id: accountId }));
    if (!settings.ok) return settings;

    const addresses = await callCloudflare(connection, (api) => new BaseSubdomain(api).get(name, { account_id: accountId }));
    if (!addresses.ok) return addresses;

    found.push({ id: name, tags, bindings: settings.value.bindings, ...addresses.value });
  }

  return { ok: true, value: found };
}

/** Upload a forwarder whole: its one module, its one binding, and its tag. */
function upload(connection: Connection, accountId: string, name: string, service: string): Promise<CloudflareResult<unknown>> {
  const metadata = { main_module: MODULE, compatibility_date: COMPATIBILITY_DATE, bindings: [{ type: "service", name: BINDING, service }], tags: [TAG] };
  const body = { metadata: JSON.stringify(metadata), [MODULE]: new File([CODE], MODULE, { type: MODULE_TYPE }) };

  // Cloudflare reads the metadata from one form field of JSON text, and a form names its own content type.
  // Given as an object, the SDK spreads the metadata over a field per key, and the content type it fixes for this call hides the form's.
  return callCloudflare(connection, (api) => new BaseScripts(api).update(name, { account_id: accountId, metadata: {} }, { body, headers: { "Content-Type": null } }));
}

/**
 * Make the account's two forwarders match an install without a domain.
 *
 * @param mode - `plan` reads the account's Workers and sends no change
 * @returns what was created, changed, and left; a Worker of a forwarder's name that is not poplin's is skipped with the reason.
 *   A forwarder is uploaded and then given its free address, so one whose second call failed is finished by the next run
 */
export async function syncForwarders(connection: Connection, accountId: string, layout: AccountAddresses, mode: Mode): Promise<Synced> {
  const workers = await readForwarders(connection, accountId, layout, true);
  if (!workers.ok) return { ...workers, report: reportOf([]) };

  return applySteps(planForwarders(layout, workers.value), async (step): Promise<CloudflareResult<unknown>> => {
    if (step.kind === "create" || step.upload) {
      const uploaded = await upload(connection, accountId, step.subject, step.service);
      if (!uploaded.ok) return uploaded;
    }

    return callCloudflare(connection, (api) => new BaseSubdomain(api).create(step.subject, { account_id: accountId, enabled: true, previews_enabled: false }));
  }, mode);
}

/**
 * Take the account's two forwarders away, as starting an install over does.
 *
 * @param mode - `plan` reads the account's Workers and sends no change
 * @returns what was removed; a Worker of a forwarder's name that is not poplin's is skipped with the reason, and an account with neither changes nothing
 */
export async function removeForwarders(connection: Connection, accountId: string, layout: AccountAddresses, mode: Mode): Promise<Synced> {
  const workers = await readForwarders(connection, accountId, layout, false);
  if (!workers.ok) return { ...workers, report: reportOf([]) };

  const steps = planRemoval(layout, workers.value);

  // Asked for as the bare response: an answer with no body is a removal too.
  return applySteps(steps, (step) => callCloudflare(connection, (api) => new BaseScripts(api).delete(step.subject, { account_id: accountId }).asResponse()), mode);
}
