// The driver a command asks the database through, with a token, held to the contract every driver of core passes.
// The stand-in for the API's query route runs each call on the pool's own D1, split back into the statements the driver joined.

import { reset } from "cloudflare:test";
import { env } from "cloudflare:workers";
import type { SqlDriver, SqlValue } from "@poplin/core/src/database/driver";
import { describeDatabase } from "@poplin/core/tests/database/support/database-contract";
import { describeSqlDriver, sqlDatabaseOver } from "@poplin/core/tests/database/support/sql-driver-contract";

import { apiDriver } from "../../../src/shared/database/api-driver";
import type { Bindings } from "../../../src/shared/worker/bindings";
import { refusal, reply } from "../install/support/replies";
import { statementsOf } from "./support/query-statements";

/** The bindings of wrangler.jsonc, simulated. */
const BINDINGS: Bindings = env;

/** The database the driver asks. */
const ASKED = { accountId: "account-1", databaseId: "database-1" };

/** The one path of the API that answers for it. */
const QUERY_PATH = `/client/v4/accounts/${ASKED.accountId}/d1/database/${ASKED.databaseId}/query`;

/** Answer a request to the API as its query route does: one result a statement, or a refusal with the database's own words and nothing of the call kept. */
async function queryRoute(input: string | URL | Request, init?: RequestInit): Promise<Response> {
  const request = new Request(input, init);
  // The SDK asks its `fetch` once what a form is sent as.
  if (request.url.startsWith("data:")) return new Response("");

  if (request.method !== "POST" || new URL(request.url).pathname !== QUERY_PATH) return refusal(404, 7404, "The database was not found");

  const { sql, params } = await request.json<{ readonly sql: string; readonly params?: readonly SqlValue[] }>();
  const statements = statementsOf(sql, params ?? []).map((statement) => BINDINGS.DB.prepare(statement.sql).bind(...statement.params));

  try {
    const results = await BINDINGS.DB.batch(statements);

    return reply(results.map((result) => ({ results: result.results, success: true, meta: { changes: result.meta.changes } })));
  } catch (error) {
    return refusal(400, 7500, error instanceof Error ? error.message : "the statement failed");
  }
}

async function emptyDatabase(): Promise<SqlDriver> {
  await reset();

  return apiDriver({ key: "token-1", fetch: queryRoute }, ASKED);
}

describeDatabase("the API's driver", sqlDatabaseOver(emptyDatabase));
describeSqlDriver("the API's driver", emptyDatabase);
