// The Workflow that runs the install's jobs, as an object of the account. An account names each Workflow once, so poplin's is the one named after the install's Worker.
// A deploy makes it right after it uploads the Worker. A repair makes it again where it is gone, and points it back at the Worker where it names another class.
// A Workflow of that name which runs another Worker's code is somebody else's: it is left as it is, and the row says so.

import { BaseWorkflows } from "cloudflare/resources/workflows/workflows";
import { workflowNameOf } from "../../jobs/workflow-name";
import { type Connection, callCloudflare } from "../client";
import { INSTALL_OBJECTS } from "../install-objects";
import { applySteps, type Mode, reportOf, type Synced } from "../sync";

/** Why a Workflow of the name is left as it is. */
const ANOTHER_WORKERS = "a Workflow of this name runs another Worker's code, so none is made: a copy too large for one request cannot be made until that Workflow has another name";

/** A Workflow as the account has it now. `script_deleted` is on one whose Worker was deleted since. */
interface AccountWorkflow {
  readonly name?: string;
  readonly script_name?: string;
  readonly class_name?: string;
  readonly script_deleted?: boolean;
}

/** One step of a jobs plan; `subject` is the Workflow's name. */
type JobsStep = { readonly kind: "create" | "change" | "leave"; readonly subject: string } | { readonly kind: "skip"; readonly subject: string; readonly reason: string };

/** The Worker a run acts for. */
interface OwnWorker {
  /** The account the Worker runs in. */
  readonly accountId: string;

  /** The Worker's name. */
  readonly script: string;
}

/**
 * Compute the change that gives the account the Workflow of one Worker.
 *
 * @param workflows - the account's Workflows as they are now
 * @param script - the Worker's name
 * @returns one step: a `leave` for the Workflow that runs the Worker's class, a `change` for one that names another class or lost its Worker, a `skip` for one of another Worker, or a `create`; no step names another Workflow
 */
export function planJobs(workflows: readonly AccountWorkflow[], script: string): JobsStep[] {
  const subject = workflowNameOf(script);
  const own = workflows.find((workflow) => workflow.name === subject);
  if (own === undefined) return [{ kind: "create", subject }];

  if (own.script_name !== script && own.script_deleted !== true) return [{ kind: "skip", subject, reason: ANOTHER_WORKERS }];

  const asWritten = own.script_name === script && own.class_name === INSTALL_OBJECTS.jobsClass && own.script_deleted !== true;

  return [{ kind: asWritten ? "leave" : "change", subject }];
}

/**
 * Make sure the account has the Workflow of the install's Worker.
 *
 * @param mode - `plan` reads the account's Workflows and sends no change
 * @returns what was created, changed, left, or skipped; a refusal by Cloudflare is a value, with the report of what was done before it
 */
export async function syncJobs(connection: Connection, worker: OwnWorker, mode: Mode): Promise<Synced> {
  const name = workflowNameOf(worker.script);
  // The `search` filter matches a part of a name, so the plan still compares each name in full.
  const listed = await callCloudflare(connection, (api) => Array.fromAsync(new BaseWorkflows(api).list({ account_id: worker.accountId, search: name })));
  if (!listed.ok) return { ...listed, report: reportOf([]) };

  const made = { account_id: worker.accountId, script_name: worker.script, class_name: INSTALL_OBJECTS.jobsClass };

  return applySteps(planJobs(listed.value, worker.script), () => callCloudflare(connection, (api) => new BaseWorkflows(api).update(name, made)), mode);
}
