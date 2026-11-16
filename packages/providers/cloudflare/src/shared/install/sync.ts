// The shape every zone piece shares: a plan is a list of steps, applying it runs the steps that change something, and the report says which ran.

import type { CloudflareFailure, CloudflareResult } from "./client";

/** What a step does to one thing: `leave` means it already matches, `skip` means poplin will not touch it and says why. */
type StepKind = "create" | "change" | "leave" | "remove" | "skip";

/** The part of a step the report reads. `subject` names the record, route, rule, or application. */
interface Step {
  readonly kind: StepKind;
  readonly subject: string;
  readonly reason?: string;
}

/** A step that changes something at Cloudflare. */
export type Acting<Planned extends Step> = Exclude<Planned, { readonly kind: "leave" | "skip" }>;

/** Whether a run changes Cloudflare: `plan` reads, computes the same steps, and sends no change, so its report says what `apply` would do. */
export type Mode = "plan" | "apply";

/** What a run did, by subject. `changedNothing` is true when Cloudflare already matched the desired state. */
export interface Report {
  readonly created: readonly string[];
  readonly changed: readonly string[];
  readonly left: readonly string[];
  readonly removed: readonly string[];
  readonly skipped: readonly { readonly subject: string; readonly reason: string }[];
  readonly changedNothing: boolean;
}

/** The failure that stopped a run, with the report of the steps done before it: `failed` is the step that failed and `unrun` the steps after it. Before a plan there is no `unrun`, and `failed` names the read the run stopped at where its plan needs two. */
export type SyncFailure = CloudflareFailure & { readonly report: Report; readonly failed?: string; readonly unrun?: readonly string[] };

/** A finished run, or the failure that stopped it with the report of the steps done before it. */
export type Synced = { readonly ok: true; readonly report: Report } | SyncFailure;

function acts<Planned extends Step>(step: Planned): step is Acting<Planned> {
  return step.kind !== "leave" && step.kind !== "skip";
}

/**
 * Sort a plan's steps into a report.
 *
 * @returns the subjects in plan order under what the step does to each
 */
export function reportOf(steps: readonly Step[]): Report {
  const subjects = (kind: StepKind): string[] => steps.filter((step) => step.kind === kind).map((step) => step.subject);
  const skipped = steps.filter((step) => step.kind === "skip").map((step) => ({ subject: step.subject, reason: step.reason ?? "" }));

  return {
    created: subjects("create"),
    changed: subjects("change"),
    left: subjects("leave"),
    removed: subjects("remove"),
    skipped,
    changedNothing: steps.every((step) => !acts(step)),
  };
}

/**
 * Run a plan in order, stopping at the first failure.
 *
 * @param perform - makes Cloudflare match one step; a `leave` or a `skip` never reaches it, and in `plan` mode no step does
 * @returns the report of the whole plan, or the failure with the report of the steps that finished, the step that failed, and the steps never reached
 */
export async function applySteps<Planned extends Step>(
  steps: readonly Planned[],
  perform: (step: Acting<Planned>) => Promise<CloudflareResult<unknown>>,
  mode: Mode,
): Promise<Synced> {
  if (mode === "plan") return { ok: true, report: reportOf(steps) };

  const done: Planned[] = [];

  for (const [index, step] of steps.entries()) {
    if (acts(step)) {
      const result = await perform(step);
      if (!result.ok) return { ...result, report: reportOf(done), failed: step.subject, unrun: steps.slice(index + 1).map((later) => later.subject) };
    }

    done.push(step);
  }

  return { ok: true, report: reportOf(done) };
}
