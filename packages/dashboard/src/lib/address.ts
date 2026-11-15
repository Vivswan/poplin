// How the console's addresses are read and written through the router: under the page's base, with the query as plain text, so a link written once keeps working.

import { type SearchParser, type SearchSerializer, useSearch } from "@tanstack/react-router";
import { useMemo } from "react";

import { BOOT } from "@/lib/boot";

/** The query as the router hands it on: every value is the text the address holds, and a key named twice keeps its first value. */
const readSearch: SearchParser = (text) => {
  const search: Record<string, string> = {};
  for (const [key, value] of new URLSearchParams(text)) search[key] ??= value;

  return search;
};

/** The query as the address holds it: no quoting beyond the address's own, and a key with no value is left out. */
const writeSearch: SearchSerializer = (search) => {
  const text = new URLSearchParams(Object.entries(search).flatMap(([key, value]) => (value == null || value === "" ? [] : [[key, String(value)]]))).toString();

  return text === "" ? "" : `?${text}`;
};

/** What every router of the console is made with: the base the page is served under, paths matched by their own case, and the query read and written as plain text. */
export const ADDRESS_RULES = { basepath: BOOT.base, caseSensitive: true, parseSearch: readSearch, stringifySearch: writeSearch } as const;

/**
 * Write a query as the `search` of a link or a move.
 *
 * @returns one text value a key; a key with an empty value is left out of the address
 */
export function searchOf(query: URLSearchParams): Record<string, string> {
  return Object.fromEntries(query);
}

/**
 * Read the query of the screen that is drawn, and read it again whenever it changes.
 *
 * It changes together with the screen: a screen that is being left never sees the query of the next one.
 */
export function useAddressQuery(): URLSearchParams {
  const search: Readonly<Record<string, string>> = useSearch({ strict: false });

  return useMemo(() => new URLSearchParams(search), [search]);
}
