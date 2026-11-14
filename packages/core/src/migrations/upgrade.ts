// Bringing a record of an older shape up to the current one: which steps are due, and running them in order.

/** A stored record as parsed JSON, in whatever shape it was written. */
export type StoredFields = Readonly<Record<string, unknown>>;

/** One change of shape for one record kind: it takes a record stamped `from` to the next shape. */
export interface Step {
  /** The shape the step reads. It leaves the record at `from + 1`. */
  readonly from: number;

  /** What the step changes, in a few words; reports quote it. */
  readonly description: string;

  /** The change itself, on one parsed record. It is pure and returns a new record; the runner sets the stamp. */
  readonly run: (old: StoredFields) => StoredFields;
}

/** The steps of every record kind, by the kind's name, each list in ascending order of `from`. */
export type Registry = Readonly<Record<string, readonly Step[]>>;

/** The stored shape and the shape to reach. */
interface Span {
  readonly from: number;
  readonly to: number;
}

/** The steps to run, or the first shape in the span that no step reads. */
type Due = { readonly ok: true; readonly steps: readonly Step[] } | { readonly ok: false; readonly missing: number };

/** Why a record could not be brought up: no step reads a shape on the way, or a step threw. */
export type UpgradeRefusal =
  | { readonly reason: "no-step"; readonly missing: number }
  | { readonly reason: "step-failed"; readonly from: number; readonly description: string; readonly message: string };

/** The record at the shape asked for with the descriptions of the steps that ran, or why it is not. */
type Upgraded = { readonly ok: true; readonly fields: StoredFields; readonly applied: readonly string[] } | { readonly ok: false; readonly refusal: UpgradeRefusal };

/**
 * Choose the steps that take a record from one shape to another.
 *
 * @param steps - every step of the record's kind
 * @returns one step per shape from `span.from` up to, not including, `span.to`, in order; none when the span is empty
 */
export function dueSteps(steps: readonly Step[], span: Span): Due {
  const byShape = new Map(steps.map((step) => [step.from, step]));
  const due: Step[] = [];

  for (let shape = span.from; shape < span.to; shape += 1) {
    const step = byShape.get(shape);
    if (step === undefined) return { ok: false, missing: shape };

    due.push(step);
  }

  return { ok: true, steps: due };
}

/**
 * Run the due steps over a parsed record. Nothing is read or written here.
 *
 * @returns the fields stamped `span.to`, or the first step that is missing or threw; the input is never changed
 */
export function upgrade(old: StoredFields, span: Span, steps: readonly Step[]): Upgraded {
  const due = dueSteps(steps, span);
  if (!due.ok) return { ok: false, refusal: { reason: "no-step", missing: due.missing } };

  let fields = old;

  for (const step of due.steps) {
    try {
      fields = { ...step.run(fields), shape: step.from + 1 };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);

      return { ok: false, refusal: { reason: "step-failed", from: step.from, description: step.description, message } };
    }
  }

  return { ok: true, fields, applied: due.steps.map((step) => step.description) };
}
