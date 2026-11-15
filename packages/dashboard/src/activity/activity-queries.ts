// How the Activity screen reads its data: one page of the audit log, under the narrowing and in the order its address names, and how many entries that narrowing keeps.

import { keepPreviousData, type UseQueryResult, useQuery, useQueryClient } from "@tanstack/react-query";
import type { InferResponseType } from "hono/client";
import { useEffect } from "react";

import { kindOf, sortOf } from "@/activity/activity-words";
import { PAGE_SIZES, type PageSize } from "@/activity/page-size";
import { answerOf, api } from "@/lib/api";

/** The first part of the key every count of the log is kept under. */
const TOTAL_KEY = ["activity", "total"] as const;

/** One page of the log as the server answers it: the entries, the name of each login by its id, and the places the page after it and the page ahead of it are reached from, each `null` where there is none. */
export type Page = InferResponseType<typeof api.activity.$get, 200>;

/** How many entries the log holds under a narrowing: `total` is exact when `whole`, and otherwise the least it can be. */
export type Total = InferResponseType<typeof api.activity.total.$get, 200>;

/** One entry of the log. `site.name` is the name the site had then; `site.label` is the one it has now, `null` once it is no site. */
export type Entry = Page["entries"][number];

/** What the address narrows the log to, with only the keys and values the server knows. */
export function narrowingOf(query: URLSearchParams): NonNullable<Parameters<typeof api.activity.total.$get>[0]>["query"] {
  const kind = kindOf(query);
  const site = (query.get("site") ?? "").trim();

  return { ...(kind === "all" ? {} : { kind }), ...(site === "" ? {} : { site }) };
}

/** What the log's address asks of the server for a page of a size. */
function pageQueryOf(query: URLSearchParams, size: PageSize): NonNullable<Parameters<typeof api.activity.$get>[0]>["query"] {
  const after = query.get("after");
  const back = query.get("back");

  return {
    ...narrowingOf(query),
    ...(sortOf(query).descending ? {} : { dir: "asc" as const }),
    ...(after === null ? {} : { after }),
    ...(back === null ? {} : { back }),
    ...(size === PAGE_SIZES[0] ? {} : { size }),
  };
}

/**
 * Read the page of the log the address asks for.
 *
 * The page before stays shown while the next one is on its way, so the table does not empty at every press.
 */
export function useActivityPage(query: URLSearchParams, size: PageSize): UseQueryResult<Page> {
  const asked = pageQueryOf(query, size);

  return useQuery({ queryKey: ["activity", asked], queryFn: () => answerOf(api.activity.$get({ query: asked })), placeholderData: keepPreviousData });
}

/**
 * Read how many entries the log holds under the address's narrowing.
 *
 * The count reads up to 10,000 rows, so it is read once for a narrowing while the screen is open, and not again at a page's turn or when the window is looked at again. Every count is forgotten when the screen closes.
 *
 * @param wanted - whether the screen shows a total it cannot tell from the page itself
 */
export function useActivityTotal(query: URLSearchParams, wanted: boolean): UseQueryResult<Total> {
  const client = useQueryClient();
  const asked = narrowingOf(query);

  useEffect(() => () => client.removeQueries({ queryKey: TOTAL_KEY }), [client]);

  return useQuery({
    queryKey: [...TOTAL_KEY, asked],
    queryFn: () => answerOf(api.activity.total.$get({ query: asked })),
    enabled: wanted,
    staleTime: Number.POSITIVE_INFINITY,
    gcTime: Number.POSITIVE_INFINITY,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
  });
}
