// The poplin token of one live run: made in memory, its hash stored in the test install's database, and the row removed when the run ends.
//
// The token is never written to a file or a step output. Its row runs out after an hour, so a row a killed run left behind dies by itself.

import { mintToken } from "@poplin/core/src/auth/tokens";
import { BaseDatabase } from "cloudflare/resources/d1/database/database";

import { callCloudflare } from "../../src/zone/client";
import { syncDatabase } from "../../src/zone/database/database";
import { type Run, type Stop, stopOf } from "./util";

/** What the note of every live run's token starts with. */
const NOTE_PREFIX = "live check ";

/** How long a live run's token is good for, in milliseconds. */
const LIFETIME_MS = 60 * 60 * 1000;

/** How old the row of another run must be before a sweep removes it, in milliseconds. */
const STALE_MS = 24 * 60 * 60 * 1000;

/** The token permission the database calls need. */
const PERMISSION = "D1: Edit";

/** Run one statement on the install's database. */
async function query(run: Run, databaseId: string, sql: string, params: readonly string[]): Promise<Stop | undefined> {
  const done = await callCloudflare(run.connection, (api) =>
    Array.fromAsync(new BaseDatabase(api).query(databaseId, { account_id: run.accountId, sql, params: [...params] })),
  );

  return done.ok ? undefined : stopOf(done, PERMISSION);
}

/**
 * Find the id of the install's database.
 *
 * @returns the id, hidden, or why there is none
 */
export async function findDatabase(run: Run): Promise<string | Stop> {
  const found = await syncDatabase(run.connection, run.accountId, "plan");
  if (!found.ok) return found.failure === "no-id" ? { kind: "failed", what: "Cloudflare named no database" } : stopOf(found, PERMISSION);

  if (found.id === undefined) return { kind: "skipped", needs: "the install's database, which the converge step makes" };

  run.hide(found.id);

  return found.id;
}

/**
 * Remove this run's token row, and the row of any other live run older than a day.
 *
 * @returns why the rows could not be removed, or `undefined` once they are
 */
export function removeTokens(run: Run, databaseId: string, now: number): Promise<Stop | undefined> {
  const sql = `DELETE FROM tokens WHERE note = ? OR (note LIKE ? AND created_at < ${now - STALE_MS})`;

  return query(run, databaseId, sql, [`${NOTE_PREFIX}${run.id}`, `${NOTE_PREFIX}%`]);
}

/**
 * Make an admin token for this run and store its hash in the install's database.
 *
 * @returns the token, hidden before it is handed back, or why it could not be stored
 */
export async function seedToken(run: Run, databaseId: string, now: number): Promise<string | Stop> {
  const { token, record } = await mintToken({ scope: "admin", note: `${NOTE_PREFIX}${run.id}`, now });
  run.hide(token);

  const sql = `INSERT INTO tokens (id, hash, scope, note, created_at, expires_at) VALUES (?, ?, 'admin', ?, ${now}, ${now + LIFETIME_MS})`;
  const stopped = await query(run, databaseId, sql, [record.id, record.hash, record.note]);

  return stopped ?? token;
}
