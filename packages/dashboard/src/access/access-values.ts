// What the Access screen reads from its address and how it writes its values for a person: which tab is shown, what a token may change, a computer's name, and the order of the tokens.

import type { Sort } from "@/table/data-table";
import { firstSort, type Orders, sortIn, sortKeys } from "@/table/sort";

/** The path of the Access screen, which shows the people. */
export const PEOPLE_PATH = "/tokens";

/** The path of the tokens. A review is drawn over them. */
export const TOKENS_PATH = "/tokens/list";

/** What a token of each scope may change, as the screen says it. */
export const SCOPE_WORDS = { admin: "Everything", publisher: "Own sites only" } as const;

/** The most characters of a computer's name that are shown. */
const LONGEST_NAME = 40;

/** What marks a name that was cut. */
const CUT = "...";

/** What stands for the name of a computer that gave none. */
const NO_NAME = "A computer with no name";

/** The orders of the tokens: the token allowed last comes first in a table nobody sorted. */
export const TOKEN_ORDERS: Orders = { first: { name: "asc", allowed: "desc" }, unsorted: { key: "allowed", descending: true } };

/**
 * Write a computer's name, which the computer chose itself.
 *
 * @returns `shown` holds 40 characters at most, `whole` the name as given, and `given` is `false` for a computer that gave none
 */
export function computerName(computer: string): { readonly shown: string; readonly whole: string; readonly given: boolean } {
  if (computer.trim() === "") return { shown: NO_NAME, whole: NO_NAME, given: false };

  const shown = computer.length > LONGEST_NAME ? `${computer.slice(0, LONGEST_NAME - CUT.length)}${CUT}` : computer;

  return { shown, whole: computer, given: true };
}

/** Read the order of the tokens the address names; the default for a column the server does not order by. */
export function tokenSortOf(query: URLSearchParams): Sort {
  return sortIn(query, TOKEN_ORDERS);
}

/**
 * Write the query of the tokens in another order: the order alone, and no keys at all for the default order.
 *
 * @param next - the order a press on a heading leads to, or a column's key, which names its first order
 */
export function tokenSortQuery(next: Sort | string | undefined): URLSearchParams {
  const keys = sortKeys(typeof next === "string" ? firstSort(next, TOKEN_ORDERS) : next, TOKEN_ORDERS);

  return new URLSearchParams(Object.entries(keys).filter(([, value]) => value !== ""));
}
