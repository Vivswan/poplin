// The install going back by itself, with the kept key: a step of the new code's schema failed as it started, so the code that ran before the update is put back.
//
//   GET   .../workers/scripts/{name}/deployments      the newest first: the first one runs now
//   GET   .../workers/scripts/{name}/versions/{id}    the version that runs, then each earlier one: an update tagged each with the release it took
//   POST  .../workers/scripts/{name}/deployments      the newest earlier version tagged as the version before, at 100%
//
// Core says whether to go back: the running code came in by the install's own update, and the database is still at the schema the version before reads.
// The version that runs must carry this code's tag. Another instance that went back first, or a deploy made since, leaves another one running, and nothing is changed.
// The version deployed must carry the tag of the version before: an upload sent twice leaves a second version of the failing release under the first.
// The bindings of the version before are the ones the update inherited minutes ago. Cloudflare serves it some ten seconds after the call.

import { backAfterFailedStep, noteWentBack } from "@poplin/core/src/actions/go-back";
import type { Database } from "@poplin/core/src/database/database";
import { BaseDeployments } from "cloudflare/resources/workers/scripts/deployments";
import { BaseVersions } from "cloudflare/resources/workers/scripts/versions";
import * as v from "valibot";
import { type KeptKey, keyed } from "../../install/key/kept-key";
import { callCloudflare } from "../../install/client";
import { readLastUpdate } from "./upload";

/** Cloudflare's name of the right every call here needs. */
const RIGHT = "Workers Scripts Write";

/** The whole of a deployment that runs one version. */
const WHOLE = 100;

/** The most earlier versions whose tag is read. */
const MOST_READ = 5;

/** Cloudflare's answer to the list of deployments: the newest first, each with the versions it runs. */
const DEPLOYMENTS = v.object({ result: v.object({ deployments: v.array(v.object({ versions: v.array(v.object({ version_id: v.string(), percentage: v.number() })) })) }) });

/** What is read of one version: the tag its upload gave it. */
const TAGGED = v.object({ annotations: v.optional(v.object({ "workers/tag": v.optional(v.string()) })) });

/** The Worker that goes back. */
interface OwnWorker {
  readonly accountId: string;
  readonly script: string;
}

/** A start whose schema step failed. */
interface FailedStart {
  /** The variable the upload of the running code stated, unchecked. */
  readonly last: unknown;

  /** The version that runs, and the schema the database was left at. */
  readonly failed: { readonly version: string; readonly stored: number };

  /** The kept key, or `undefined` on an install that holds none. */
  readonly key: KeptKey | undefined;

  /** The Worker's own place. */
  readonly worker: OwnWorker;

  /** The database as it stands, and the clock: the going back is noted there. */
  readonly noting: { readonly database: Database; readonly now: () => number };
}

/** The version a deployment runs whole, or `undefined` for one that splits its requests. */
function soleVersion(deployment: { readonly versions: readonly { readonly version_id: string; readonly percentage: number }[] }): string | undefined {
  const [only, ...others] = deployment.versions;

  return only !== undefined && others.length === 0 && only.percentage === WHOLE ? only.version_id : undefined;
}

/** The tag the upload of one version gave it, or `undefined` for a version with none, or one Cloudflare did not answer with. */
async function tagOf(key: KeptKey, worker: OwnWorker, id: string): Promise<string | undefined> {
  const read = await keyed(key, RIGHT, (connection) => callCloudflare(connection, (api) => new BaseVersions(api).get(id, { account_id: worker.accountId, script_name: worker.script })));
  const version = read.ok ? v.safeParse(TAGGED, read.value) : undefined;

  return version?.success === true ? version.output.annotations?.["workers/tag"] : undefined;
}

/**
 * Find the version to go back to: the newest one that ran before the one that runs now and is tagged as the version before.
 *
 * @param tags - the tag of the version that runs, and of the version before
 * @returns its id, or `undefined` where the one that runs is not this code's own upload, or none of the earlier versions read carries the tag
 */
async function versionBefore(key: KeptKey, worker: OwnWorker, tags: { readonly running: string; readonly before: string }): Promise<string | undefined> {
  // The SDK reads this list as pages of items, and Cloudflare answers one record that holds them: the answer is read as it came.
  const listed = await keyed(key, RIGHT, (connection) =>
    callCloudflare(connection, async (api): Promise<unknown> => (await new BaseDeployments(api).list(worker.script, { account_id: worker.accountId }).asResponse()).json()),
  );
  const deployments = listed.ok ? v.safeParse(DEPLOYMENTS, listed.value) : undefined;
  if (deployments?.success !== true) return undefined;

  const [running, ...earlier] = deployments.output.result.deployments.map(soleVersion);
  if (running === undefined) return undefined;

  if ((await tagOf(key, worker, running)) !== tags.running) return undefined;

  // A deployment that changes no code runs the same version again, so each version is read once.
  const others = [...new Set(earlier)].filter((id): id is string => id !== undefined && id !== running).slice(0, MOST_READ);
  for (const id of others) {
    if ((await tagOf(key, worker, id)) === tags.before) return id;
  }

  return undefined;
}

/**
 * Go back to the code that ran before the update, where core's rule says so and the key allows it, and note it.
 *
 * @returns the version whose step failed and the version that runs again, or `undefined` where nothing was changed: the rule does not hold, the install holds no key, no earlier version is tagged as the version before, or Cloudflare did not take a call
 */
export async function goBack(start: FailedStart): Promise<{ readonly from: string; readonly to: string } | undefined> {
  const { key, worker, failed } = start;
  const to = backAfterFailedStep(readLastUpdate(start.last), failed);
  if (to === undefined || key === undefined) return undefined;

  const before = await versionBefore(key, worker, { running: failed.version, before: to });
  if (before === undefined) return undefined;

  const went = { from: failed.version, to };
  const annotations = { "workers/message": `poplin ${to} again: ${failed.version} could not change the database` };
  const deployed = await keyed(key, RIGHT, (connection) =>
    callCloudflare(connection, (api) =>
      new BaseDeployments(api).create(worker.script, { account_id: worker.accountId, strategy: "percentage", versions: [{ version_id: before, percentage: WHOLE }], annotations }, { maxRetries: 0 }),
    ),
  );
  if (!deployed.ok) return undefined;

  await noteWentBack(start.noting, went);

  return went;
}
