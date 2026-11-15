// How the Activity screen reads its data: one page of the audit log, under the narrowing and in the order its address names.

import { keepPreviousData, type UseQueryResult, useQuery } from "@tanstack/react-query";
import type { InferResponseType } from "hono/client";

import { kindOf, sortOf } from "@/activity/activity-words";
import { answerOf, api } from "@/lib/api";

/** One page of the log as the server answers it: the entries, the name of each login by its id, and the place the next page goes on from or `null`. */
type Page = InferResponseType<typeof api.activity.$get, 200>;

/** One entry of the log. `site.name` is the name the site had then; `site.label` is the one it has now, `null` once it is no site. */
export type Entry = Page["entries"][number];

/** What the log's address asks of the server, with only the keys and values the server knows. */
function pageQueryOf(query: URLSearchParams): NonNullable<Parameters<typeof api.activity.$get>[0]>["query"] {
  const kind = kindOf(query);
  const site = (query.get("site") ?? "").trim();
  const after = query.get("after");

  return {
    ...(kind === "all" ? {} : { kind }),
    ...(site === "" ? {} : { site }),
    ...(sortOf(query).descending ? {} : { dir: "asc" as const }),
    ...(after === null ? {} : { after }),
  };
}

/**
 * Read the page of the log the address asks for.
 *
 * The page before stays shown while the next one is on its way, so the table does not empty at every press.
 */
export function useActivityPage(query: URLSearchParams): UseQueryResult<Page> {
  const asked = pageQueryOf(query);

  return useQuery({ queryKey: ["activity", asked], queryFn: () => answerOf(api.activity.$get({ query: asked })), placeholderData: keepPreviousData });
}
