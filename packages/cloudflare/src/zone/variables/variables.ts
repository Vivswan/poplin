// The variables setup writes onto the Worker itself: the values no deploy can know, such as the audience tag of the Access application setup made, and on an install with nothing set its domain, its first login, and its account.
// A change names every other binding as inherited, so the bucket, the database, the limiter, and the variables a person set stay as they are.
// Every variable a run changes goes in one change: the Worker is deployed anew once, and never starts with half of them.

import { BaseScriptAndVersionSettings } from "cloudflare/resources/workers/scripts/script-and-version-settings";
import { type Connection, callCloudflare } from "../client";
import { type Mode, reportOf, type Synced } from "../sync";

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

/** One step of a variables plan; `subject` is the variable's name. */
type VariableStep = { readonly kind: "create" | "change"; readonly subject: string; readonly value: Value } | { readonly kind: "leave"; readonly subject: string };

/** The Worker a run writes to. */
interface OwnWorker {
  /** The account the Worker runs in. */
  readonly accountId: string;

  /** The Worker's name. */
  readonly script: string;
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
 * @param mode - `plan` reads the Worker's bindings and sends no change
 * @returns what was created, changed, and left. Every changed variable is sent in one change, which deploys the Worker anew with every other binding as it was; when it is refused none was written, and the failure names the first as the step that failed
 */
export async function syncVariables(connection: Connection, worker: OwnWorker, desired: readonly DesiredVariable[], mode: Mode): Promise<Synced> {
  const settings = await callCloudflare(connection, (api) => new BaseScriptAndVersionSettings(api).get(worker.script, { account_id: worker.accountId }));
  if (!settings.ok) return { ...settings, report: reportOf([]) };

  const bindings: readonly WorkerBinding[] = settings.value.bindings ?? [];
  const steps = planVariables(desired, bindings);
  const written = steps.flatMap((step) => (step.kind === "leave" ? [] : [step]));
  if (mode === "plan" || written.length === 0) return { ok: true, report: reportOf(steps) };

  const kept = bindings.filter((binding) => !written.some((step) => step.subject === binding.name)).map((binding) => ({ name: binding.name, type: "inherit" }));
  const text = JSON.stringify({ bindings: [...kept, ...written.map(bindingOf)] });

  // Cloudflare reads the settings from one form field of JSON text, so the text is handed over as the request's body: given as an object, the SDK spreads it over a field per key.
  const changed = await callCloudflare(connection, (api) => new BaseScriptAndVersionSettings(api).edit(worker.script, { account_id: worker.accountId }, { body: { settings: text } }));
  if (changed.ok) return { ok: true, report: reportOf(steps) };

  const subjects = written.map((step) => step.subject);

  return { ...changed, report: reportOf(steps.filter((step) => step.kind === "leave")), failed: subjects[0] ?? "", unrun: subjects.slice(1) };
}
