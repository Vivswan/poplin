// The words of the Activity screen: the kinds the log is narrowed to, the order it is read in, and what an empty page says.

import { parseSiteId } from "@poplin/core/src/sites/ids";

import { queryWith } from "@/shared/pages";
import type { Sort } from "@/table/data-table";
import { type Orders, sortIn, sortKeys } from "@/table/sort";

/** The kinds of action the log is narrowed to. The first shows every entry. */
export const KINDS = [
  { value: "all", label: "All activity" },
  { value: "sites", label: "Sites" },
  { value: "access", label: "Access" },
  { value: "settings", label: "Settings" },
] as const;

/** The key of the address that holds the number of a page's first entry. */
export const FROM_KEY = "from";

/** The orders of the log: by when an entry was written, the newest first in a table nobody sorted. */
const ACTIVITY_ORDERS: Orders = { first: { when: "desc" }, unsorted: { key: "when", descending: true } };

/** A kind's value. */
export type Kind = (typeof KINDS)[number]["value"];

/** Read the kind the address names; every entry for a kind it does not know. */
export function kindOf(query: URLSearchParams): Kind {
  return KINDS.find((entry) => entry.value === query.get("kind"))?.value ?? "all";
}

/**
 * Read which site the address narrows the log to: the sites a text finds, or the one site of an id, never both.
 *
 * @returns `text` and `of`, each empty when the address names none; a text takes the place of an id, and an id of another form is none
 */
export function siteIn(query: URLSearchParams): { readonly text: string; readonly of: string } {
  const text = (query.get("site") ?? "").trim();
  const of = query.get("of") ?? "";

  return { text, of: text === "" && parseSiteId(of).ok ? of : "" };
}

/** Read the order the address names; the newest first for anything but the oldest first. */
export function sortOf(query: URLSearchParams): Sort {
  return sortIn(query, ACTIVITY_ORDERS);
}

/**
 * Write the log's query with some of it changed. A change that names no place of a page starts at the first one, and a page is reached from the one ahead of it or the one after it, never both.
 *
 * @param changes - the keys to set; an empty value takes a key away
 * @returns a new query
 */
export function logQuery(query: URLSearchParams, changes: Readonly<Record<string, string>>): URLSearchParams {
  return queryWith(query, "back" in changes ? changes : { back: "", ...changes });
}

/**
 * Write the query of the log from its first page, in another order.
 *
 * @param next - the order a press on a heading leads to; `undefined` for none, which is the newest first
 */
export function sortedQuery(query: URLSearchParams, next: Sort | undefined): URLSearchParams {
  return logQuery(query, sortKeys(next, ACTIVITY_ORDERS));
}

/**
 * The words of a page that holds no entry.
 *
 * @param site - what the page is narrowed to, as `siteIn` reads it
 */
export function emptyWords(kind: Kind, site: ReturnType<typeof siteIn>): { readonly title: string; readonly says: string } {
  if (site.text !== "")
    return {
      title: `No activity for "${site.text}"`,
      says: kind === "all" ? "Check the spelling, or clear the search." : "Clear the search, or choose All activity.",
    };

  if (site.of !== "") return { title: "No activity for this site", says: kind === "all" ? "Show all activity to see every entry." : "Choose All activity to see every entry of it." };

  if (kind === "all") return { title: "No activity yet", says: "Every change of a site, a token, or a setting is listed here." };

  return { title: "No activity of this kind", says: "Choose All activity to see every entry." };
}
