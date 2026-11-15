// How the Domain screen reads its data: what a token must hold and the last run the install remembers, in one read.

import { type UseQueryResult, useQuery } from "@tanstack/react-query";
import type { InferResponseType } from "hono/client";

import { answerOf, api } from "@/lib/api";

/** The key the screen's data is kept under: a run marks it stale, so it is read again. */
export const DOMAIN_KEY = ["domain"] as const;

/** What the screen opens with, as the server answers it. */
export type Domain = InferResponseType<typeof api.domain.$get, 200>;

/** A run that read its pieces, as the server answers it. */
export type Ran = InferResponseType<typeof api.domain.check.$post, 200>;

/** Which run it is: one that only reads the pieces, or one that also repairs them. */
export type DomainRun = NonNullable<Domain["last"]>["run"];

/** Read what the Domain screen opens with. */
export function useDomain(): UseQueryResult<Domain> {
  return useQuery({ queryKey: DOMAIN_KEY, queryFn: () => answerOf(api.domain.$get()) });
}
