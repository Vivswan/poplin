// How the Sites screen reads its data: one page of the table and one site, each kept under a key that every change of a site makes stale.

import { keepPreviousData, type UseQueryResult, useQuery } from "@tanstack/react-query";
import type { InferResponseType } from "hono/client";

import { answerOf, api } from "@/lib/api";
import { filterOf, sortOf } from "@/sites/sites-query";

/** The first part of every key the sites' data is kept under: a change of a site marks all of it stale, so the table and the panel read again. */
export const SITES_KEY = ["sites"] as const;

/** One page of the table as the server answers it: the sites, the name of each login by its id, and the cursor of the following page or `null`. */
type Page = InferResponseType<typeof api.sites.$get, 200>;

/** One site as the server answers it: the site, and the name of each login by its id. */
export type Shown = InferResponseType<(typeof api.sites)[":site"]["$get"], 200>;

/** What the table's address asks of the server, with only the keys and values the server knows. */
function pageQueryOf(query: URLSearchParams): NonNullable<Parameters<typeof api.sites.$get>[0]>["query"] {
  const filter = filterOf(query);
  const sort = sortOf(query);
  const search = (query.get("q") ?? "").trim();
  const after = query.get("after");

  return {
    ...(filter === "trash" ? { view: "trash" as const } : {}),
    ...(filter === "trash" || filter === "all" ? {} : { access: filter }),
    ...(search === "" ? {} : { q: search }),
    ...(sort.key === "updated" && sort.descending
      ? {}
      : { sort: sort.key as "updated" | "title" | "name" | "access", dir: sort.descending ? ("desc" as const) : ("asc" as const) }),
    ...(after === null ? {} : { after }),
  };
}

/**
 * Read the page of the table the address asks for.
 *
 * The page before stays shown while the next one is on its way, so the table does not empty at every press.
 */
export function useSitesPage(query: URLSearchParams): UseQueryResult<Page> {
  const asked = pageQueryOf(query);

  return useQuery({ queryKey: [...SITES_KEY, "page", asked], queryFn: () => answerOf(api.sites.$get({ query: asked })), placeholderData: keepPreviousData });
}

/** The key one site's data is kept under, by the site's label. */
export function siteKey(label: string): readonly unknown[] {
  return [...SITES_KEY, "one", label];
}

/**
 * Read one site.
 *
 * @param label - the site's label, from the address
 */
export function useSite(label: string): UseQueryResult<Shown> {
  return useQuery({ queryKey: siteKey(label), queryFn: () => answerOf(api.sites[":site"].$get({ param: { site: label } })) });
}

/**
 * Read the address a site answers at once it is public under a name.
 *
 * A name no site may hold answers no address.
 *
 * @param name - the public name as it is typed; an empty one is not asked
 */
export function usePublicAddress(name: string): UseQueryResult<InferResponseType<(typeof api)["public-address"]["$get"], 200>> {
  return useQuery({
    queryKey: ["public-address", name],
    queryFn: () => answerOf(api["public-address"].$get({ query: { name } })),
    enabled: name !== "",
  });
}
