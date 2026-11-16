// The database and the bucket bindings with every call told to a tally, counted the way Cloudflare counts them against a plan.
//
// D1's limits page: "a db.batch() call counts as a single query against it, not one query per statement." So a batch is one query here, whatever it holds.
// The rows are the ones D1 bills: `rows_read` and `rows_written` of every statement's `meta`, which is what a day's free allowance is counted in.
//
//   bucket call   R2 bills it as
//   get, head     Class B, a read; one that finds nothing is billed too
//   put, list     Class A, a write
//   delete        nothing

import type { Bindings } from "../../../src/worker/bindings";
import { BINDINGS } from "./install";

/** The tally each call of the bucket is added to, by the call's name. A call that is none of these is added to none: the product makes no other. */
const BUCKET_CALLS: Readonly<Record<string, "gets" | "heads" | "puts" | "lists" | "deletes">> = { get: "gets", head: "heads", put: "puts", list: "lists", delete: "deletes" };

/** What the database and the bucket were asked since a tally was last emptied. */
export interface Tally {
  /** The queries as D1 counts them against one invocation: a batch is one. */
  queries: number;

  /** The rows D1 read to answer them, an index's rows among them. */
  read: number;

  /** The rows D1 wrote, an index's rows among them. */
  written: number;

  /** The most values bound to one statement. */
  bound: number;

  /** The objects read from the bucket with their bytes. */
  gets: number;

  /** The objects the bucket was asked about without their bytes. */
  heads: number;

  /** The objects written to the bucket. */
  puts: number;

  /** The listings of the bucket, a page each. */
  lists: number;

  /** The removals from the bucket, up to a thousand keys each. */
  deletes: number;
}

/** A tally of nothing. */
export function emptyTally(): Tally {
  return { queries: 0, read: 0, written: 0, bound: 0, gets: 0, heads: 0, puts: 0, lists: 0, deletes: 0 };
}

/** Add what one answer of the database says of itself to a tally. An answer that is no list of results says nothing of its rows. */
function addRows(tally: Tally, answer: unknown): void {
  if (!Array.isArray(answer)) return;

  for (const result of answer as readonly D1Result[]) {
    tally.read += result.meta.rows_read;
    tally.written += result.meta.rows_written;
  }
}

/** A prepared statement that tells the tally how many values it is bound to. What `bind` answers is the binding's own statement, which a batch takes. */
function boundCounted(statement: D1PreparedStatement, tally: Tally): D1PreparedStatement {
  return new Proxy(statement, {
    get(inner, name) {
      const member: unknown = Reflect.get(inner, name, inner);
      if (name !== "bind" || typeof member !== "function") return member;

      return (...values: unknown[]): unknown => {
        tally.bound = Math.max(tally.bound, values.length);

        return Reflect.apply(member, inner, values);
      };
    },
  });
}

/** The database with every query added to a tally. Preparing a statement asks the database nothing. */
function talliedDatabase(tally: Tally): D1Database {
  return new Proxy(BINDINGS.DB, {
    get(inner, name) {
      const member: unknown = Reflect.get(inner, name, inner);
      if (typeof member !== "function") return member;

      if (name === "prepare") return (query: string): D1PreparedStatement => boundCounted(inner.prepare(query), tally);

      return async (...given: unknown[]): Promise<unknown> => {
        tally.queries += 1;
        const answer: unknown = await Reflect.apply(member, inner, given);
        addRows(tally, answer);

        return answer;
      };
    },
  });
}

/** The bucket with every call added to a tally under its name. */
function talliedBucket(tally: Tally): R2Bucket {
  return new Proxy(BINDINGS.SITES, {
    get(inner, name) {
      const member: unknown = Reflect.get(inner, name, inner);
      const under = typeof name === "string" ? BUCKET_CALLS[name] : undefined;
      if (typeof member !== "function" || under === undefined) return member;

      return (...given: unknown[]): unknown => {
        tally[under] += 1;

        return Reflect.apply(member, inner, given);
      };
    },
  });
}

/**
 * The bindings with every call to the database and the bucket added to a tally.
 *
 * An instance keeps the bindings of its first request, so one tally sees every request of the instance: empty it between two of them.
 */
export function talliedBindings(tally: Tally): Bindings {
  return { ...BINDINGS, DB: talliedDatabase(tally), SITES: talliedBucket(tally) };
}
