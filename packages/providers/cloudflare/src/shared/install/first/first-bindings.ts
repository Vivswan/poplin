// The first value of each binding a release keeps by name, for a Worker that does not exist yet: an update names such a binding `inherit`, and a first upload has nothing to inherit.
//
//   SITES         the bucket poplin made
//   DB            the database poplin made, by its id
//   JOBS          the Workflow named after the Worker, which is registered right after the upload
//   WORKER_NAME   the Worker's own name
//
// Every other value of an install is written by the repair that follows the upload: where it answers, its first login, its account, its login, and its keys.
// A release that keeps a binding with no row here was built after this code: no first upload of it is sent.

import { workflowNameOf } from "../../jobs/workflow-name";
import type { SentBinding } from "../../release/update/upload";
import { INSTALL_OBJECTS } from "../install-objects";

/** What each kept binding is first bound to, by its name. */
const FIRST: Readonly<Record<string, (made: Made) => Readonly<Record<string, unknown>>>> = {
  [INSTALL_OBJECTS.bucketBinding]: (made) => ({ type: "r2_bucket", bucket_name: made.bucket }),
  [INSTALL_OBJECTS.databaseBinding]: (made) => ({ type: "d1", id: made.databaseId }),
  [INSTALL_OBJECTS.jobsBinding]: (made) => ({ type: "workflow", workflow_name: workflowNameOf(made.script), class_name: INSTALL_OBJECTS.jobsClass }),
  [INSTALL_OBJECTS.workerBinding]: (made) => ({ type: "plain_text", text: made.script }),
};

/** What an install made before its first upload. */
interface Made {
  /** The Worker's name. */
  readonly script: string;

  /** The name of the bucket. */
  readonly bucket: string;

  /** The id of the database. */
  readonly databaseId: string;
}

/**
 * Find what writes the first value of every binding a release keeps by name.
 *
 * @param kept - the names of those bindings, as the release's manifest lists them
 * @returns what states each one once the bucket and the database are made, in the manifest's order; `undefined` when one of them has no first value here
 */
export function firstBindings(kept: readonly string[]): ((made: Made) => SentBinding[]) | undefined {
  const writers = kept.flatMap((name) => (Object.hasOwn(FIRST, name) && FIRST[name] !== undefined ? [{ name, first: FIRST[name] }] : []));
  if (writers.length !== kept.length) return undefined;

  return (made) => writers.map(({ name, first }) => ({ ...first(made), name }));
}
