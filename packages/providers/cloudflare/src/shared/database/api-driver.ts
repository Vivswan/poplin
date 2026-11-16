// Core's SQL driver on a D1 database reached through Cloudflare's API with a token, for a command that runs outside the Worker.
//
//   a batch of statements -> one call: the statements joined by semicolons, their parameters in one list
//
// D1 runs such a call as one transaction, and its parameters are numbered over the whole call: each statement's placeholders are renumbered to where its values stand in that list.
// A number is bound as a real one. Every number core binds here is stored into a column of whole numbers, which takes it as one.

import type { SqlDriver, SqlValue, Statement, StatementResult } from "@poplin/core/src/database/driver";
import { BaseDatabase } from "cloudflare/resources/d1/database/database";
import { type CloudflareFailure, type Connection, callCloudflare } from "../install/client";
import { allowanceSpent } from "./allowance";

/** A quoted text or name, which is passed over, or a placeholder: bare, or with its number. */
const QUOTED_OR_PLACEHOLDER = /'(?:[^']|'')*'|"(?:[^"]|"")*"|\?(\d*)/g;

/** What stands between two statements of one call. */
const JOINT = "; ";

/** What a call is said to have failed with when it was taken and a statement of it is answered as failed. */
const UNANSWERED: CloudflareFailure = { ok: false, failure: "network", message: "a statement was answered as failed" };

/** Which database a driver asks: the account it is in, and its id. */
interface Asked {
  readonly accountId: string;
  readonly databaseId: string;
}

/** A call the API did not take: Cloudflare's own failure, kept whole, so the caller can say which permission the token lacks. */
export class ApiRefused extends Error {
  readonly failure: CloudflareFailure;

  constructor(failure: CloudflareFailure) {
    super(`the database's API did not take the call: ${failure.failure}`);
    this.name = "ApiRefused";
    this.failure = failure;
  }
}

/**
 * Renumber one statement's placeholders to where its values stand in the call's one list.
 *
 * A bare `?` is the one after the highest so far, as SQLite counts it.
 *
 * @param before - how many values the statements before it hold
 */
function renumbered(sql: string, before: number): string {
  let highest = 0;

  return sql.replace(QUOTED_OR_PLACEHOLDER, (found, digits: string | undefined) => {
    if (digits === undefined) return found;

    const number = digits === "" ? highest + 1 : Number(digits);
    highest = Math.max(highest, number);

    return `?${before + number}`;
  });
}

/** The statements as one text and one list of values. */
function joined(statements: readonly Statement[]): { readonly sql: string; readonly params: SqlValue[] } {
  const params: SqlValue[] = [];
  const texts = statements.map((statement) => {
    const text = renumbered(statement.sql, params.length);
    params.push(...statement.params);

    return text;
  });

  return { sql: texts.join(JOINT), params };
}

/**
 * Build core's driver on one D1 database, asked through the API with the connection's token.
 *
 * @returns a driver whose batch is one call and one transaction
 * @throws {AllowanceSpent} the day's free allowance of the database is used up, as the Worker's driver says it
 * @throws {ApiRefused} any other failure of the call, and a statement the answer says failed
 * @throws {Error} the answer holds another count of results than the batch has statements
 */
export function apiDriver(connection: Connection, asked: Asked): SqlDriver {
  return {
    async batch(statements): Promise<readonly StatementResult[]> {
      if (statements.length === 0) return [];

      const { sql, params } = joined(statements);
      // The API takes each value as JSON sends it, text, number, or null: the SDK's type names text alone.
      const body = { account_id: asked.accountId, sql, params: params as string[] };
      const answered = await callCloudflare(connection, (api) => Array.fromAsync(new BaseDatabase(api).query(asked.databaseId, body)));
      if (!answered.ok) {
        const said = answered.failure === "refused" ? answered.errors.map((error) => error.message).join("\n") : "";

        throw allowanceSpent(new Error(said)) ?? new ApiRefused(answered);
      }

      if (answered.value.length !== statements.length) throw new Error(`the database answered ${answered.value.length} results for ${statements.length} statements`);

      // A statement the database says failed has no rows to read as "none".
      if (answered.value.some((result) => result.success === false)) throw new ApiRefused(UNANSWERED);

      return answered.value.map((result) => ({ rows: (result.results ?? []) as Readonly<Record<string, unknown>>[], changes: result.meta?.changes ?? 0 }));
    },
  };
}
