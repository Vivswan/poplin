// The order of a table as its address carries it: `sort` names the column and `dir` the direction, and a table in its own first order carries neither. Which order a press on a heading leads to is the table library's own cycle.

import type { Sort } from "@/table/data-table";

/** The orders one table can be put in. */
export interface Orders {
  /** The columns the server orders by, each with the direction a first press on its heading asks for. */
  readonly first: Readonly<Record<string, "asc" | "desc">>;

  /** The order of a table nobody sorted. */
  readonly unsorted: Sort;
}

/** Read the order the address names; the table's own first order for a column the server does not order by. */
export function sortIn(query: URLSearchParams, orders: Orders): Sort {
  const key = query.get("sort") ?? "";
  if (!Object.hasOwn(orders.first, key)) return orders.unsorted;

  return { key, descending: (query.get("dir") ?? orders.first[key]) === "desc" };
}

/** The order a column is first put in, as a list with no headings to press chooses it. */
export function firstSort(key: string, orders: Orders): Sort {
  return { key, descending: orders.first[key] === "desc" };
}

/**
 * Say what an order puts into the address.
 *
 * @param next - the order asked for; `undefined` for none
 * @returns the column and its direction, and two empty values for the table's own first order, so a shared link of an unsorted table carries no keys
 */
export function sortKeys(next: Sort | undefined, orders: Orders): { readonly sort: string; readonly dir: string } {
  if (next === undefined || (next.key === orders.unsorted.key && next.descending === orders.unsorted.descending)) return { sort: "", dir: "" };

  return { sort: next.key, dir: next.descending ? "desc" : "asc" };
}
