// Whether the test install's database is one this commit's Worker reads, asked through Cloudflare's API before the Worker is deployed.
//
//   no schema step applied yet                              left: the Worker makes the schema
//   the steps this commit applies, and settings it reads    left: a step the commit has beyond them is the Worker's to apply
//   a step another build applied, a step this commit lacks,
//   or settings this commit does not read                   deleted and made anew, empty
//
// A schema step changed in place keeps its number, and a new setting changes no step at all, so the Worker of a later commit refuses the database an earlier one made.
// Nothing is kept between runs: each run reads the database as it is.

import type { SqlDriver } from "@poplin/core/src/database/driver";
import { readOpening } from "@poplin/core/src/database/open";
import { SqlDatabase } from "@poplin/core/src/database/sql-database";
import { BaseDatabase } from "cloudflare/resources/d1/database/database";
import * as v from "valibot";

import { callCloudflare } from "../../src/shared/install/client";
import { INSTALL_OBJECTS } from "../../src/shared/install/install-objects";
import { type Run, type Stop, stopOf } from "./util";

/** The token permission the database calls need. */
const PERMISSION = "D1: Edit";

/** The database the Worker is to be bound to, and what the run did to it. */
interface Settled {
  readonly id: string;
  readonly result: string;
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
 * @returns `undefined` for a database the Worker opens
 */
async function driftOf(reader: SqlDriver): Promise<string | undefined> {
  const standing = await readOpening(reader);
  if (standing.kind === "newer") return "a schema step this commit does not have";

  if (standing.kind === "differs") return `schema step ${standing.step} as another build applied it`;

  if (standing.version === 0) return undefined;

  try {
    await new SqlDatabase(reader).readSettings();

    return undefined;
  } catch (error) {
    if (v.isValiError(error)) return "settings this commit does not read";

    throw error;
  }
}

/**
 * Leave a database this commit's Worker opens, and make any other anew: the old one is deleted with everything in it, and an empty one takes its name.
 *
 * A run that stops between the two leaves the account without the database, and the next run makes it.
 *
 * @param databaseId - the test install's database as the account holds it now
 * @returns the database to bind, its id hidden, with `present` or why it was made anew; or why Cloudflare stopped the run
 */
export async function settleDatabase(run: Run, databaseId: string): Promise<Settled | Stop> {
  let drift: string | undefined;

  try {
    drift = await driftOf(readerOf(run, databaseId));
  } catch (error) {
    if (error instanceof Unasked) return error.stop;

    throw error;
  }

  if (drift === undefined) return { id: databaseId, result: "present" };

  const deleted = await callCloudflare(run.connection, (api) => new BaseDatabase(api).delete(databaseId, { account_id: run.accountId }));
  if (!deleted.ok) return stopOf(deleted, PERMISSION);

  // Made by name at once, with no look at the account's list, which may still hold the one just deleted.
  const made = await callCloudflare(run.connection, (api) => new BaseDatabase(api).create({ account_id: run.accountId, name: INSTALL_OBJECTS.database }));
  if (!made.ok) return stopOf(made, PERMISSION);

  if (made.value.uuid === undefined) return { kind: "failed", what: "Cloudflare named no database" };

  run.hide(made.value.uuid);

  return { id: made.value.uuid, result: `made anew: it held ${drift}` };
}
