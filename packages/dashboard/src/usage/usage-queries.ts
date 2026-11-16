// How the Usage screen reads its data: what the install has used, each line beside its limit.

import { type UseQueryResult, useQuery } from "@tanstack/react-query";
import type { InferResponseType } from "hono/client";

import { answerOf, api } from "@/lib/api";

/** How long an open screen shows an answer before it reads again, in milliseconds: what a line says of its day is as old as its number at most. */
const READ_AGAIN_MS = 300_000;

/** What the server answers: the UTC day the day's numbers are counted over, the host's name, what became of asking it for its own figures, and the lines. */
export type Usage = InferResponseType<typeof api.usage.$get, 200>;

/** One thing the install or its account has used. The storage is counted in bytes; `limit` is `null` where nothing bounds it. */
export type Line = Usage["lines"][number];

/** Read what the install has used, and again every few minutes while the screen is open. */
export function useUsage(): UseQueryResult<Usage> {
  return useQuery({ queryKey: ["usage"], queryFn: () => answerOf(api.usage.$get()), refetchInterval: READ_AGAIN_MS });
}
