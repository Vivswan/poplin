// Whether the test install is one this commit's install would have made, asked through Cloudflare's API before anything is changed.
//
//   the account holds                                       the run                                    the build that ran before, once this commit's Worker started
//   no database, or one with no schema step yet             goes on: the Worker makes the schema       refuses it as newer when it starts anew, where one stood
//   every step of this commit, and settings it reads        goes on                                    answers from it as before
//   fewer steps than this commit, and settings it reads     goes on: the Worker applies the rest       refuses it as newer when it starts anew
//   a step another build applied, a step this commit lacks,
//   or settings this commit does not read                   starts the install over                    is removed with the install
//   a Worker bound to another bucket than the product's     starts the install over                    is removed with the install
//   a Worker of an install that was never finished          starts the install over                    is removed with the install
//
// A schema step changed in place keeps its number, and a new setting changes no step at all, so the Worker of a later commit refuses the database an earlier one made.
// Nothing is kept between runs: each run reads the account as it is.

import type { SqlDriver } from "@poplin/core/src/database/driver";
import { OWN_SCHEMA, readOpening } from "@poplin/core/src/database/open";
import { SqlDatabase } from "@poplin/core/src/database/sql-database";
import * as v from "valibot";

import { ApiRefused, apiDriver } from "../../src/shared/database/api-driver";
import { boundInstall } from "../../src/shared/install/first/find";
import { INSTALL_OBJECTS } from "../../src/shared/install/install-objects";
import { readWorker } from "../../src/shared/install/pieces/variables/variables";
import { findDatabase } from "./tokens";
import { isStop, type Run, SCRIPT, type Stop, stopOf } from "./util";

/** The token permission the database calls need. */
const PERMISSION = "D1: Edit";

/** What a run found of the test install before it changes anything. */
interface Standing {
  /** Why this commit's install would not have made what stands, which is then started over; `undefined` for an install the run goes on with. */
  readonly drift: string | undefined;

  /** Whether the database holds every schema step of this commit: where it does not, an instance of the build that ran before fails when it starts anew, once this commit's Worker started. */
  readonly current: boolean;
}

/**
 * Say what of the database this commit's Worker would refuse, in words that quote nothing the database holds.
 *
 * @returns no `drift` for a database the Worker opens, and `current` for one that holds every schema step of this commit
 */
async function readDatabase(reader: SqlDriver): Promise<Standing> {
  const standing = await readOpening(reader);
  if (standing.kind === "newer") return { drift: "a schema step this commit does not have", current: false };

  if (standing.kind === "differs") return { drift: `schema step ${standing.step} as another build applied it`, current: false };

  const current = standing.version === OWN_SCHEMA;
  if (standing.version === 0) return { drift: undefined, current };

  try {
    await new SqlDatabase(reader).readSettings();

    return { drift: undefined, current };
  } catch (error) {
    if (v.isValiError(error)) return { drift: "settings this commit does not read", current: false };

    throw error;
  }
}

/** Read something of the database through Cloudflare's API, by the driver the product's own commands read it with. A call Cloudflare did not take, or a statement it did not run, is answered as the stop it is. */
export async function askDatabase<Read>(run: Run, databaseId: string, reading: (reader: SqlDriver) => Promise<Read>): Promise<Read | Stop> {
  try {
    return await reading(apiDriver(run.connection, { accountId: run.accountId, databaseId }));
  } catch (error) {
    if (error instanceof ApiRefused) return stopOf(error.failure, PERMISSION);

    throw error;
  }
}

/**
 * Read whether the database holds every schema step of this commit, as this commit applies them. A Worker that started on this database left it so: one of this commit's build, or of a build before with the same steps.
 *
 * @returns `false` for a database that is behind, or that this commit's Worker would refuse; or why Cloudflare did not answer
 */
export async function holdsOwnSchema(run: Run, databaseId: string): Promise<boolean | Stop> {
  const found = await askDatabase(run, databaseId, readDatabase);

  return isStop(found) ? found : found.drift === undefined && found.current;
}

/**
 * Read when the install last asked the project's website for a newer version, which its scheduled sweep does once a day and nothing else of a run does.
 *
 * @returns the moment, in milliseconds since the epoch; `undefined` for a database no sweep has asked from; or why Cloudflare did not answer
 */
export function lastAsked(run: Run, databaseId: string): Promise<number | undefined | Stop> {
  return askDatabase(run, databaseId, async (reader) => (await new SqlDatabase(reader).readUpdateCheck())?.checked_at);
}

/**
 * Say what of the Worker named as the install's this commit's install would not have made, in words that quote nothing it holds.
 *
 * `poplin install` leaves the code of a Worker that stands, so one of an install that was never finished would go on running another build's code.
 *
 * @returns `undefined` for an account with no Worker of the name, and for a Worker of a finished install on the product's bucket; or why Cloudflare did not answer
 */
async function workerDrift(run: Run): Promise<string | undefined | Stop> {
  const bindings = await readWorker(run.connection, { accountId: run.accountId, script: SCRIPT });
  if (!bindings.ok) return stopOf(bindings, "Workers Scripts: Edit");

  if (bindings.value === undefined) return undefined;

  if (boundInstall(bindings.value) === undefined) return "a Worker of an install that was never finished";

  const bucket = bindings.value.find((binding) => binding.name === INSTALL_OBJECTS.bucketBinding && binding.type === "r2_bucket");

  return bucket?.bucket_name === INSTALL_OBJECTS.bucket ? undefined : "a Worker bound to another bucket than the product's";
}

/**
 * Read what stands of the test install, and whether this commit's install would have made it.
 *
 * @returns what another build made of it, in words that quote nothing the account holds, and whether its database is at this commit's schema; or why Cloudflare did not answer
 */
export async function readStanding(run: Run): Promise<Standing | Stop> {
  const worker = await workerDrift(run);
  if (typeof worker === "object") return worker;

  if (worker !== undefined) return { drift: worker, current: false };

  const database = await findDatabase(run);
  if (database === undefined) return { drift: undefined, current: false };

  if (typeof database !== "string") return database;

  const found = await askDatabase(run, database, readDatabase);
  if (isStop(found)) return found;

  return found.drift === undefined ? found : { drift: `a database that held ${found.drift}`, current: false };
}
