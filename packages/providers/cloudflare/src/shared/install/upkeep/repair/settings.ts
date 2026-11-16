// The install's own records, reached with the account token through Cloudflare's API: a repair from a terminal reads the settings it mends to, and stores the one user it may add.
//
//   the Worker's `DB` binding -> the database's id -> core's own database on the API's driver -> the statements the Worker itself runs
//
// Nothing here brings a database to a schema: one that is not at this code's schema is left alone, and said to be another poplin's.

import type { Login } from "@poplin/core/src/auth/logins";
import type { Database } from "@poplin/core/src/database/database";
import { AllowanceSpent } from "@poplin/core/src/database/driver";
import { OWN_SCHEMA, readOpening } from "@poplin/core/src/database/open";
import { SqlDatabase } from "@poplin/core/src/database/sql-database";
import type { SettingValues } from "@poplin/core/src/records/settings";
import * as v from "valibot";
import { ApiRefused, apiDriver } from "../../../database/api-driver";
import type { CloudflareFailure, Connection } from "../../client";

/** Who signs the entry of a user a repair from a terminal added: no user, and no token of the install. */
const SIGNER = "doctor-repair@poplin.invalid" as Login;

/** A read or a write the database did not take: Cloudflare's own failure, or the day's free allowance of the database used up. */
export type Untaken = CloudflareFailure | { readonly ok: false; readonly failure: "allowance" };

/**
 * What an install's database holds for a repair.
 *
 * `stored` is an install that has answered a request: its settings, and the database to add a user in.
 * `none` is a database the install has stored no settings in yet. `another` is one at another schema than this code's, or with settings another build wrote.
 */
export type Stored =
  | { readonly state: "stored"; readonly settings: SettingValues; readonly database: Database }
  | { readonly state: "none" | "another" }
  | { readonly state: "unread"; readonly failure: Untaken };

/** What a call the database did not take is, as a value; anything else that was thrown is thrown on. */
function untaken(error: unknown): Untaken {
  if (error instanceof ApiRefused) return error.failure;

  if (error instanceof AllowanceSpent) return { ok: false, failure: "allowance" };

  throw error;
}

/**
 * Read the settings an install has stored, with the token.
 *
 * @param asked - the account the install is in, and the id of the database its Worker is bound to
 * @returns the settings as the Worker's own store reads them, or why there are none to read; nothing is written
 */
export async function readStored(connection: Connection, asked: { readonly accountId: string; readonly databaseId: string }): Promise<Stored> {
  const driver = apiDriver(connection, asked);

  try {
    const opening = await readOpening(driver);
    if (opening.kind === "at" && opening.version === 0) return { state: "none" };

    if (opening.kind !== "at" || opening.version !== OWN_SCHEMA) return { state: "another" };

    const database = new SqlDatabase(driver);
    const settings = await database.readSettings();

    return settings === undefined ? { state: "none" } : { state: "stored", settings, database };
  } catch (error) {
    // Settings this build cannot read are another build's.
    return v.isValiError(error) ? { state: "another" } : { state: "unread", failure: untaken(error) };
  }
}

/**
 * Store one more user, in the one step the Worker's own store adds a user in: the settings, the entry of the change, and the mark that the users changed.
 *
 * The caller has proven that the token may change who logs in: the login in front of the install already lets this email in.
 *
 * @param at - the moment of the change, in milliseconds since the epoch
 * @returns `added`; `already` for an email that is a user, which writes nothing; `none` for a database whose settings went since they were read; or the call the database did not take, which stored nothing
 */
export async function storeUser(database: Database, login: Login, at: number): Promise<"added" | "already" | "none" | Untaken> {
  try {
    const added = await database.addLogin(login, { as: "repair", by: SIGNER, at });
    if (added.kind === "done") return "added";

    // A repair is no signer that can be taken away, so a store that changed nothing found the email there, or no settings at all.
    return added.kind === "unchanged" ? "already" : "none";
  } catch (error) {
    return untaken(error);
  }
}
