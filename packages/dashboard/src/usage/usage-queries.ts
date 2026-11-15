// How the Usage screen reads its data: what the install has used, each line beside its limit.

import { type UseQueryResult, useQuery } from "@tanstack/react-query";
import type { InferResponseType } from "hono/client";

import { answerOf, api } from "@/lib/api";

/** What the server answers: the UTC day the requests are counted over, and the lines. */
type Usage = InferResponseType<typeof api.usage.$get, 200>;

/** One thing the install has used. `stored` is counted in bytes; `limit` is `null` where no setting bounds it. */
export type Line = Usage["lines"][number];

/** Read what the install has used. */
export function useUsage(): UseQueryResult<Usage> {
  return useQuery({ queryKey: ["usage"], queryFn: () => answerOf(api.usage.$get()) });
}
