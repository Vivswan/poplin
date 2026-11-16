// The install going back by itself, with the kept key: a step of the new code's schema failed as it started, so the code that ran before the update is put back.
//
//   GET   .../workers/scripts/{name}/deployments      the newest first: the first one runs now
//   GET   .../workers/scripts/{name}/versions/{id}    the version that runs, which an update tagged with the release it took
//   POST  .../workers/scripts/{name}/deployments      the version before it, at 100%
//
// Core says whether to go back: the running code came in by the install's own update, and the database is still at the schema the version before reads.
// The version that runs must carry this code's tag. Another instance that went back first, or a deploy made since, leaves another one running, and nothing is changed.
// The bindings of the version before are the ones the update inherited minutes ago. Cloudflare serves it some ten seconds after the call.

import { backAfterFailedStep, noteWentBack } from "@poplin/core/src/actions/go-back";
import type { Database } from "@poplin/core/src/database/database";
import { BaseDeployments } from "cloudflare/resources/workers/scripts/deployments";
import { BaseVersions } from "cloudflare/resources/workers/scripts/versions";
import * as v from "valibot";
import { type KeptKey, keyed } from "../key/kept-key";
import { callCloudflare } from "../zone/client";
import { readLastUpdate } from "./upload";

/** Cloudflare's name of the right every call here needs. */
const RIGHT = "Workers Scripts Write";

/** The whole of a deployment that runs one version. */
const WHOLE = 100;

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

  /** The Worker's own place, or `undefined` where its variables do not say it. */
  readonly worker: OwnWorker | undefined;

  /** The database as it stands, and the clock: the going back is noted there. */
  readonly noting: { readonly database: Database; readonly now: () => number };
}

/** The version a deployment runs whole, or `undefined` for one that splits its requests. */
function soleVersion(deployment: { readonly versions: readonly { readonly version_id: string; readonly percentage: number }[] }): string | undefined {
  const [only, ...others] = deployment.versions;

  return only !== undefined && others.length === 0 && only.percentage === WHOLE ? only.version_id : undefined;
}

/** The version that ran before the one that runs now, or `undefined` where the one that runs is not this code's own upload, or nothing ran before it. */
async function versionBefore(key: KeptKey, worker: OwnWorker, tag: string): Promise<string | undefined> {
  // The SDK reads this list as pages of items, and Cloudflare answers one record that holds them: the answer is read as it came.
  const listed = await keyed(key, RIGHT, (connection) =>
    callCloudflare(connection, async (api): Promise<unknown> => (await new BaseDeployments(api).list(worker.script, { account_id: worker.accountId }).asResponse()).json()),
  );
  const deployments = listed.ok ? v.safeParse(DEPLOYMENTS, listed.value) : undefined;
  if (deployments?.success !== true) return undefined;

  const [running, ...earlier] = deployments.output.result.deployments.map(soleVersion);
  if (running === undefined) return undefined;

  const read = await keyed(key, RIGHT, (connection) => callCloudflare(connection, (api) => new BaseVersions(api).get(running, { account_id: worker.accountId, script_name: worker.script })));
  const version = read.ok ? v.safeParse(TAGGED, read.value) : undefined;
  if (version?.success !== true || version.output.annotations?.["workers/tag"] !== tag) return undefined;

  // A deployment that changes no code runs the same version again, so the version before is the first other one.
  return earlier.find((id) => id !== running);
}

/**
 * Go back to the code that ran before the update, where core's rule says so and the key allows it, and note it.
 *
 * @returns the version whose step failed and the version that runs again, or `undefined` where nothing was changed: the rule does not hold, the install holds no key, or Cloudflare did not take a call
 */
export async function goBack(start: FailedStart): Promise<{ readonly from: string; readonly to: string } | undefined> {
  const { key, worker, failed } = start;
  const to = backAfterFailedStep(readLastUpdate(start.last), failed);
  if (to === undefined || key === undefined || worker === undefined) return undefined;

  const before = await versionBefore(key, worker, failed.version);
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
