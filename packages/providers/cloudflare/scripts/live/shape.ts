// Whether the test install's database is one this commit's Worker reads, asked through Cloudflare's API before the Worker is deployed.
//
//   the database holds                                      the run                                   the build deployed before, once this commit's Worker started
//   no schema step yet                                      leaves it: the Worker makes the schema    refuses it as newer when it starts anew, where one stood
//   every step of this commit, and settings it reads        leaves it                                 answers from it as before
//   fewer steps than this commit, and settings it reads     leaves it: the Worker applies the rest    refuses it as newer when it starts anew
//   a step another build applied, a step this commit lacks,
//   or settings this commit does not read                   deletes it and makes it anew, empty       is bound to the deleted one, and fails
//
// A schema step changed in place keeps its number, and a new setting changes no step at all, so the Worker of a later commit refuses the database an earlier one made.
// Nothing is kept between runs: each run reads the database as it is.

import type { SqlDriver } from "@poplin/core/src/database/driver";
import { OWN_SCHEMA, readOpening } from "@poplin/core/src/database/open";
import { SqlDatabase } from "@poplin/core/src/database/sql-database";
import { BaseDatabase } from "cloudflare/resources/d1/database/database";
import * as v from "valibot";

import { callCloudflare } from "../../src/shared/install/client";
import { INSTALL_OBJECTS } from "../../src/shared/install/install-objects";
import { isStop, type Run, type Stop, stopOf } from "./util";

/** The token permission the database calls need. */
const PERMISSION = "D1: Edit";

/** The database the Worker is to be bound to, and what the run did to it. */
interface Settled {
  /** The id of the database, hidden. */
  readonly id: string;

  /** `present`, or why the database was made anew. */
  readonly result: string;

  /** Whether an instance of the build deployed before this run fails when it starts anew, once this commit's Worker started: the database was made anew, or holds fewer schema steps than this commit applies. */
  readonly strandsOlder: boolean;
}

/** What a reading found of a database: why this commit's Worker would refuse it, and whether it holds every schema step of this commit. */
interface Reading {
  readonly drift: string | undefined;
  readonly current: boolean;
}

/** A statement Cloudflare did not run, with why. */
class Unasked extends Error {
  readonly stop: Stop;

  constructor(stop: Stop) {
    super("Cloudflare did not run a statement");
    this.stop = stop;
  }
}

/** The database as core reads it: one statement a batch, which is all a reading sends. */
function readerOf(run: Run, databaseId: string): SqlDriver {
  return {
    batch: async (statements) => {
      const [statement, ...others] = statements;
      if (statement === undefined || others.length > 0) throw new Error("the reader runs one statement a batch");

      const { sql, params } = statement;
      const done = await callCloudflare(run.connection, (api) => Array.fromAsync(new BaseDatabase(api).query(databaseId, { account_id: run.accountId, sql, params: params.map(String) })));
      if (!done.ok) throw new Unasked(stopOf(done, PERMISSION));

      if (done.value.some((result) => result.success === false)) throw new Unasked({ kind: "failed", what: "the database did not run a statement" });

      return [{ rows: done.value.flatMap((result) => (result.results ?? []) as Record<string, unknown>[]), changes: 0 }];
    },
  };
}

/**
 * Say what of the database this commit's Worker would refuse, in words that quote nothing the database holds.
 *
 * @returns no `drift` for a database the Worker opens, and `current` for one that holds every schema step of this commit
 */
async function readDatabase(reader: SqlDriver): Promise<Reading> {
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

/** Read the database through Cloudflare's API. A statement Cloudflare did not run is answered as the stop it is. */
async function read(run: Run, databaseId: string): Promise<Reading | Stop> {
  try {
    return await readDatabase(readerOf(run, databaseId));
  } catch (error) {
    if (error instanceof Unasked) return error.stop;

    throw error;
  }
}

/**
 * Read whether the database holds every schema step of this commit, as this commit applies them. A Worker that started on this database left it so: one of this commit's build, or of a build before with the same steps.
 *
 * @returns `false` for a database that is behind, or that this commit's Worker would refuse; or why Cloudflare did not answer
 */
export async function holdsOwnSchema(run: Run, databaseId: string): Promise<boolean | Stop> {
  const found = await read(run, databaseId);

  return isStop(found) ? found : found.drift === undefined && found.current;
}

/**
 * Leave a database this commit's Worker opens, and make any other anew: the old one is deleted with everything in it, and an empty one takes its name.
 *
 * A run that stops between the two leaves the account without the database, and the next run makes it.
 *
 * @param databaseId - the test install's database as the account holds it now
 * @returns the database to bind, its id hidden, with `present` or why it was made anew, and whether the build before is left unable to answer; or why Cloudflare stopped the run
 */
export async function settleDatabase(run: Run, databaseId: string): Promise<Settled | Stop> {
  const found = await read(run, databaseId);
  if (isStop(found)) return found;

  const { drift } = found;
  if (drift === undefined) return { id: databaseId, result: "present", strandsOlder: !found.current };

  const deleted = await callCloudflare(run.connection, (api) => new BaseDatabase(api).delete(databaseId, { account_id: run.accountId }));
  if (!deleted.ok) return stopOf(deleted, PERMISSION);

  // Made by name at once, with no look at the account's list, which may still hold the one just deleted.
  const made = await callCloudflare(run.connection, (api) => new BaseDatabase(api).create({ account_id: run.accountId, name: INSTALL_OBJECTS.database }));
  if (!made.ok) return stopOf(made, PERMISSION);

  if (made.value.uuid === undefined) return { kind: "failed", what: "Cloudflare named no database" };

  run.hide(made.value.uuid);

  return { id: made.value.uuid, result: `made anew: it held ${drift}`, strandsOlder: true };
}
