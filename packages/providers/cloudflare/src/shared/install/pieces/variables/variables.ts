// The variables a repair writes onto the Worker itself: the values no release can know, such as the audience tag of the Access application it made, and on an install with nothing set its domain, its first login, and its account.
// A change names every other binding as inherited, so the bucket, the database, the limiter, and the variables a person set stay as they are.
// Every variable a run changes goes in one change: the Worker is deployed anew once, and never starts with half of them.
// A read of the bindings that lacks the Worker's own name is a read in part: a change after it would drop every binding it did not list, so none is sent.
// For about a second after an upload, Cloudflare's settings can list a Worker without the bindings its new version holds. So a read in part is read again, three times over 4.5 seconds, and only one still in part then is a failure.
// Cloudflare makes a version of the Worker for each change, with no annotation the change does not state: so a change states the tag again, from the release the bindings name.
// Secrets go in that same change. Cloudflare reads none back, so one is written whenever it is handed over and is never compared.

import { BaseScriptAndVersionSettings } from "cloudflare/resources/workers/scripts/script-and-version-settings";
import pRetry from "p-retry";
import { type CloudflareFailure, type CloudflareResult, type Connection, callCloudflare } from "../../client";
import { INSTALL_OBJECTS } from "../../install-objects";
import { readRelease, taggedAs } from "../../../release/update/release-mark";
import { type Mode, reportOf, type Synced } from "../../sync";

/** A variable's whole value: a record of texts, kept as a JSON variable, or one text, kept as a plain one. */
type Value = Readonly<Record<string, string>> | string;

/** One variable an install wants on its Worker. */
interface DesiredVariable {
  readonly name: string;
  readonly value: Value;
}

/** A binding as the Worker has it now. `json` is the value of a JSON variable, as text or already read, and `text` the value of a plain one. */
interface WorkerBinding {
  readonly name: string;
  readonly type: string;
  readonly json?: unknown;
  readonly text?: unknown;
}

/** A binding as Cloudflare lists it: a bucket's names its bucket, and a database's its id. */
export interface ListedBinding extends WorkerBinding {
  readonly bucket_name?: string;
  readonly jurisdiction?: string;
  readonly id?: string;
}

/** One step of a variables plan; `subject` is the variable's name. */
type VariableStep = { readonly kind: "create" | "change"; readonly subject: string; readonly value: Value } | { readonly kind: "leave"; readonly subject: string };

/** A secret a change also writes: the binding's name and its whole text. */
interface Secret {
  readonly name: string;
  readonly text: string;
}

/** The Worker a run writes to. */
interface OwnWorker {
  /** The account the Worker runs in. */
  readonly accountId: string;

  /** The Worker's name. */
  readonly script: string;
}

/** What the version a change makes says made it, after the release of its code. */
const MADE = "with its settings changed";

/** The status Cloudflare answers for a Worker that does not exist. */
const NO_WORKER = 404;

/** The failure of a read that listed the Worker's bindings in part, at every try. */
const READ_IN_PART: CloudflareFailure = { ok: false, failure: "network", message: "the Worker's settings were not read whole" };

/** How often settings that read in part are read again, and the wait before each read, in milliseconds: the settings trail an upload by about a second. */
const AGAIN = { times: 3, everyMs: 1_500 } as const;

/** What a read of a Worker answers: its bindings, `undefined` for no Worker, or why Cloudflare gave none. */
type WorkerRead = CloudflareResult<readonly ListedBinding[] | undefined>;

/** A read of a Worker that is there and not settled yet: what the reads again go on from. */
class Trailing extends Error {
  constructor(readonly read: WorkerRead) {
    super("the Worker's settings trail its upload");
  }
}

/**
 * Read a Worker as the account has it.
 *
 * @returns every binding of the Worker, or `undefined` for a Worker that does not exist
 */
export async function readWorker(connection: Connection, worker: OwnWorker): Promise<WorkerRead> {
  const settings = await callCloudflare(connection, (api) => new BaseScriptAndVersionSettings(api).get(worker.script, { account_id: worker.accountId }));
  if (settings.ok) return { ok: true, value: settings.value.bindings ?? [] };

  return settings.failure === "refused" && settings.status === NO_WORKER ? { ok: true, value: undefined } : settings;
}

/** Whether a Worker's bindings were read whole: its own name is among them, which every upload of an install states. */
function isWhole(bindings: readonly ListedBinding[]): boolean {
  return bindings.some((binding) => binding.name === INSTALL_OBJECTS.workerBinding);
}

/**
 * Read a Worker, and one whose settings are not settled again after a wait each time, until they are, the Worker is gone, or Cloudflare gives no answer.
 *
 * The waits are on the connection's clock: the library waits none. A sleep that throws, as one the person stopped does, ends the reads with that error.
 *
 * @param settled - whether a read is one to go on from; a read whose bindings lack the Worker's own name is none, unless told otherwise
 * @returns the last read where no read settled
 */
export async function readSettled(connection: Connection, worker: OwnWorker, settled: (bindings: readonly ListedBinding[]) => boolean = isWhole): Promise<WorkerRead> {
  const sleep = connection.sleep ?? ((milliseconds: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, milliseconds)));
  const attempt = async (): Promise<WorkerRead> => {
    const read = await readWorker(connection, worker);
    if (read.ok && read.value !== undefined && !settled(read.value)) throw new Trailing(read);

    return read;
  };
  const again = async ({ error }: { readonly error: Error }): Promise<boolean> => {
    if (!(error instanceof Trailing)) return false;

    await sleep(AGAIN.everyMs);

    return true;
  };

  try {
    return await pRetry(attempt, { retries: AGAIN.times, minTimeout: 0, maxTimeout: 0, shouldRetry: again });
  } catch (error) {
    if (error instanceof Trailing) return error.read;

    throw error;
  }
}

/**
 * Read every binding of a Worker, once its settings have settled.
 *
 * @returns the bindings; a Worker that does not exist yet has none. Bindings still listed in part after every try are a failure: nothing is planned or written from them
 */
export async function readBindings(connection: Connection, worker: OwnWorker): Promise<CloudflareResult<readonly ListedBinding[]>> {
  const read = await readSettled(connection, worker);
  if (!read.ok) return read;

  if (read.value === undefined) return { ok: true, value: [] };

  return isWhole(read.value) ? { ok: true, value: read.value } : READ_IN_PART;
}

function read(json: unknown): unknown {
  if (typeof json !== "string") return json;

  try {
    return JSON.parse(json);
  } catch {
    return undefined;
  }
}

function holds(binding: WorkerBinding, wanted: Value): boolean {
  if (typeof wanted === "string") return binding.type === "plain_text" && binding.text === wanted;

  const value = read(binding.json);
  if (binding.type !== "json" || typeof value !== "object" || value === null) return false;

  const written = (texts: object): string => JSON.stringify(Object.entries(texts).sort(([one], [other]) => (one < other ? -1 : 1)));

  return written(value) === written(wanted);
}

/** A variable as a change of the Worker's settings writes it. */
function bindingOf(step: Extract<VariableStep, { readonly value: Value }>): Readonly<Record<string, unknown>> {
  if (typeof step.value === "string") return { name: step.subject, type: "plain_text", text: step.value };

  return { name: step.subject, type: "json", json: step.value };
}

/**
 * Compute the changes that give the Worker its variables.
 *
 * @param bindings - every binding of the Worker as it is now
 * @returns one step per wanted variable, in the order given; no step names another binding
 */
export function planVariables(desired: readonly DesiredVariable[], bindings: readonly WorkerBinding[]): VariableStep[] {
  return desired.map(({ name, value }): VariableStep => {
    const current = bindings.find((binding) => binding.name === name);
    if (current === undefined) return { kind: "create", subject: name, value };

    if (holds(current, value)) return { kind: "leave", subject: name };

    return { kind: "change", subject: name, value };
  });
}

/**
 * Make the Worker's variables match.
 *
 * @param mode - `plan` reads the Worker's bindings and sends no change; a Worker that does not exist yet reads as one with no binding
 * @param secrets - secrets to write in the same change, in `apply` mode alone; the report never names one
 * @returns what was created, changed, and left. Every changed variable is sent in one change, which deploys the Worker anew with every other binding as it was.
 *   When it is refused, nothing was written, and the failure names the first variable as the step that failed. Bindings read in part at every try plan nothing, and nothing is written
 */
export async function syncVariables(connection: Connection, worker: OwnWorker, desired: readonly DesiredVariable[], mode: Mode, secrets: readonly Secret[] = []): Promise<Synced> {
  const settings = await readBindings(connection, worker);
  if (!settings.ok) return { ...settings, report: reportOf([]) };

  const bindings = settings.value;
  const steps = planVariables(desired, bindings);
  const written = steps.flatMap((step) => (step.kind === "leave" ? [] : [step]));
  if (mode === "plan" || written.length + secrets.length === 0) return { ok: true, report: reportOf(steps) };

  const subjects = written.map((step) => step.subject);
  const unsent = { report: reportOf(steps.filter((step) => step.kind === "leave")), failed: subjects[0] ?? "", unrun: subjects.slice(1) };

  const sent = [...written.map(bindingOf), ...secrets.map(({ name, text }) => ({ name, type: "secret_text", text }))];
  const kept = bindings.filter((binding) => !sent.some((changed) => changed.name === binding.name)).map((binding) => ({ name: binding.name, type: "inherit" }));
  const release = readRelease(bindings);
  const text = JSON.stringify({ bindings: [...kept, ...sent], ...(release === undefined ? {} : { annotations: taggedAs(release, MADE) }) });

  // Cloudflare reads the settings from one form field of JSON text, so the text is handed over as the request's body: given as an object, the SDK spreads it over a field per key.
  // The change names every binding as it was read, so a connection's rider does not make it again after a wait: a binding added meanwhile would go.
  const unridden: Connection = { ...connection, ride: undefined };
  const changed = await callCloudflare(unridden, (api) => new BaseScriptAndVersionSettings(api).edit(worker.script, { account_id: worker.accountId }, { body: { settings: text } }));
  return changed.ok ? { ok: true, report: reportOf(steps) } : { ...changed, ...unsent };
}
