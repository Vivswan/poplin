// What the address asks of the Sites table: its filter, its search, its order, and its page.

import { queryWith } from "@/shared/pages";
import type { Sort } from "@/table/data-table";
import { firstSort, type Orders, sortIn, sortKeys } from "@/table/sort";

/** What the filter narrows the table to. The last shows the trash. */
export const FILTERS = [
  { value: "all", label: "All sites" },
  { value: "private", label: "Private" },
  { value: "unlisted", label: "Unlisted" },
  { value: "public", label: "Public" },
  { value: "trash", label: "Trash" },
] as const;

/** The columns the server orders by, with the words of each and the direction a first press asks for. */
export const SORTS = [
  { key: "updated", label: "Updated", first: "desc" },
  { key: "title", label: "Title", first: "asc" },
  { key: "name", label: "Name", first: "asc" },
  { key: "access", label: "Access", first: "asc" },
] as const;

/** The orders of the table: the site whose content changed last comes first in a table nobody sorted. */
export const SITE_ORDERS: Orders = {
  first: Object.fromEntries(SORTS.map((entry) => [entry.key, entry.first])),
  unsorted: { key: "updated", descending: true },
};

/** A filter's value. */
export type Filter = (typeof FILTERS)[number]["value"];

/** Read the filter the address names. */
export function filterOf(query: URLSearchParams): Filter {
  if (query.get("view") === "trash") return "trash";

  return FILTERS.find((entry) => entry.value === query.get("access"))?.value ?? "all";
}

/** Read the order the address names; the default for a column the server does not order by. */
export function sortOf(query: URLSearchParams): Sort {
  return sortIn(query, SITE_ORDERS);
}

/**
 * Write the query of the table from its first page, in another order.
 *
 * @param next - the order a press on a heading leads to, or a column's key, which names its first order
 */
export function sortedQuery(query: URLSearchParams, next: Sort | string | undefined): URLSearchParams {
  return queryWith(query, sortKeys(typeof next === "string" ? firstSort(next, SITE_ORDERS) : next, SITE_ORDERS));
}

/** Write the query of the table under another filter. */
export function filteredQuery(query: URLSearchParams, filter: Filter): URLSearchParams {
  const access = filter === "trash" || filter === "all" ? "" : filter;

  return queryWith(query, { view: filter === "trash" ? "trash" : "", access });
}

/** The words of a table that holds no site. */
export function emptyWords(filter: Filter, search: string): { readonly title: string; readonly says: string } {
  const kind = filter === "all" || filter === "trash" ? "" : `${filter} `;
  if (search !== "")
    return { title: `No ${kind}sites${filter === "trash" ? " in the trash" : ""} match "${search}"`, says: "Check the spelling, or show all sites." };

  if (filter === "trash") return { title: "The trash is empty", says: "A deleted site waits here before it is gone for good." };

  if (filter === "all") return { title: "No sites yet", says: "An agent publishes the first, or run this where the folder is:" };

  return { title: `No ${filter} sites`, says: "Other sites are open to someone else." };
}
