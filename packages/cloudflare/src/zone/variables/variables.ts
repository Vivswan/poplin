// The variables setup writes onto the Worker itself: the values no deploy can know, such as the audience tag of the Access application setup made.
// A change names every other binding as inherited, so the bucket, the database, the limiter, and the variables a person set stay as they are.

import { BaseScriptAndVersionSettings } from "cloudflare/resources/workers/scripts/script-and-version-settings";
import { type Connection, callCloudflare } from "../client";
import { applySteps, type Mode, reportOf, type Synced } from "../sync";

/** A variable's whole value: every variable of an install is a record of texts. */
type Texts = Readonly<Record<string, string>>;

/** One variable an install wants on its Worker. */
interface DesiredVariable {
  readonly name: string;
  readonly json: Texts;
}

/** A binding as the Worker has it now. `json` is the value of a JSON variable, as text or already read. */
interface WorkerBinding {
  readonly name: string;
  readonly type: string;
  readonly json?: unknown;
}

/** One step of a variables plan; `subject` is the variable's name. */
type VariableStep = { readonly kind: "create" | "change"; readonly subject: string; readonly json: Texts } | { readonly kind: "leave"; readonly subject: string };

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

function holds(binding: WorkerBinding, wanted: Texts): boolean {
  const value = read(binding.json);
  if (binding.type !== "json" || typeof value !== "object" || value === null) return false;

  const written = (texts: object): string => JSON.stringify(Object.entries(texts).sort(([one], [other]) => (one < other ? -1 : 1)));

  return written(value) === written(wanted);
}

/**
 * Compute the changes that give the Worker its variables.
 *
 * @param bindings - every binding of the Worker as it is now
 * @returns one step per wanted variable, in the order given; no step names another binding
 */
export function planVariables(desired: readonly DesiredVariable[], bindings: readonly WorkerBinding[]): VariableStep[] {
  return desired.map(({ name, json }): VariableStep => {
    const current = bindings.find((binding) => binding.name === name);
    if (current === undefined) return { kind: "create", subject: name, json };

    if (holds(current, json)) return { kind: "leave", subject: name };

    return { kind: "change", subject: name, json };
  });
}

/**
 * Make the Worker's variables match.
 *
 * @param mode - `plan` reads the Worker's bindings and sends no change
 * @returns what was created, changed, and left; a change deploys the Worker anew with every other binding as it was
 */
export async function syncVariables(connection: Connection, worker: OwnWorker, desired: readonly DesiredVariable[], mode: Mode): Promise<Synced> {
  const settings = await callCloudflare(connection, (api) => new BaseScriptAndVersionSettings(api).get(worker.script, { account_id: worker.accountId }));
  if (!settings.ok) return { ...settings, report: reportOf([]) };

  const bindings: readonly WorkerBinding[] = settings.value.bindings ?? [];
  // A variable an earlier step of the run made is a binding to keep from then on.
  const names = new Set(bindings.map((binding) => binding.name));

  return applySteps(planVariables(desired, bindings), async (step) => {
    const kept = [...names].filter((name) => name !== step.subject).map((name) => ({ name, type: "inherit" }));
    const settings = JSON.stringify({ bindings: [...kept, { name: step.subject, type: "json", json: step.json }] });

    // Cloudflare reads the settings from one form field of JSON text, so the text is handed over as the request's body: given as an object, the SDK spreads it over a field per key.
    const changed = await callCloudflare(connection, (api) => new BaseScriptAndVersionSettings(api).edit(worker.script, { account_id: worker.accountId }, { body: { settings } }));
    if (changed.ok) names.add(step.subject);

    return changed;
  }, mode);
}
