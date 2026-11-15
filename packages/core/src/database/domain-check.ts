// The statements that keep and read the last check or repair of the domain: one row, replaced by each run.

import { eq, sql as fragment } from "drizzle-orm";
import { drizzle } from "drizzle-orm/sqlite-proxy";
import * as v from "valibot";

import { DOMAIN_CHECK, type DomainCheck } from "../records/domain-check";
import type { SqlValue, Statement, StatementResult } from "./driver";
import { domainCheck } from "./schema";

/** Where the statements are built from the declared schema. None is run here: each goes to the driver, in a batch. */
const BUILD = drizzle(() => Promise.reject(new Error("a statement is run by the driver, in a batch")));

/** The columns a new run replaces in the kept row. */
const REPLACED = [domainCheck.ran_at, domainCheck.ran_by, domainCheck.run, domainCheck.pieces] as const;

/** A built statement as the driver takes it. */
function built(query: { toSQL(): { sql: string; params: unknown[] } }): Statement {
  const { sql: text, params } = query.toSQL();

  return { sql: text, params: params as SqlValue[] };
}

/**
 * Build the statement that reads the kept run.
 *
 * @returns one `SELECT` of the one row, its pieces as JSON text
 */
export function domainCheckAsked(): Statement {
  const columns = { ran_at: domainCheck.ran_at, ran_by: domainCheck.ran_by, run: domainCheck.run, pieces: domainCheck.pieces };

  return built(BUILD.select(columns).from(domainCheck).where(eq(domainCheck.id, 1)));
}

/**
 * Build the statement that keeps a run in place of the one kept before. It changes exactly one row, which the audit entry written after it in the same batch relies on.
 *
 * @throws {Error} a value of the run breaks its rule
 */
export function domainCheckKept(check: DomainCheck): Statement {
  const { ran_at, by, run, pieces } = v.parse(DOMAIN_CHECK, check);
  const row = { id: 1, ran_at, ran_by: by, run, pieces: JSON.stringify(pieces) };
  const replaced = Object.fromEntries(REPLACED.map((column) => [column.name, fragment`excluded.${fragment.identifier(column.name)}`]));

  return built(BUILD.insert(domainCheck).values(row).onConflictDoUpdate({ target: domainCheck.id, set: replaced }));
}

/**
 * Read the kept run out of what `domainCheckAsked` answered.
 *
 * @returns the run, or `undefined` for no row and for a row that is no run
 */
export function domainCheckIn(result: StatementResult | undefined): DomainCheck | undefined {
  const row = result?.rows[0];
  if (row === undefined || typeof row.pieces !== "string") return undefined;

  const check = v.safeParse(DOMAIN_CHECK, { ran_at: row.ran_at, by: row.ran_by, run: row.run, pieces: JSON.parse(row.pieces) });

  return check.success ? check.output : undefined;
}
