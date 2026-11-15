// How the Domain screen reads its data: what a token must hold, the three settings a repair carries, and the last run the install remembers, all in one read.

import { type UseQueryResult, useQuery, useQueryClient } from "@tanstack/react-query";
import type { InferResponseType } from "hono/client";

import { answerOf, api } from "@/lib/api";

/** The key the screen's data is kept under: a run and a saved setting mark it stale, so it is read again. */
export const DOMAIN_KEY = ["domain"] as const;

/** The key the saves of the domain's settings are counted under, so it is known whether one is on its way, and which is the last of a run of them. */
export const DOMAIN_SAVES_KEY = [...DOMAIN_KEY, "guards"] as const;

/** What the screen opens with, as the server answers it. */
export type Domain = InferResponseType<typeof api.domain.$get, 200>;

/** A run that read its pieces, as the server answers it. */
export type Ran = InferResponseType<typeof api.domain.check.$post, 200>;

/** Read what the Domain screen opens with. A window that gets the focus back reads again only while no save is on its way: such a read would show, for a moment, the value from before the save. */
export function useDomain(): UseQueryResult<Domain> {
  const client = useQueryClient();

  return useQuery({
    queryKey: DOMAIN_KEY,
    queryFn: () => answerOf(api.domain.$get()),
    refetchOnWindowFocus: () => client.isMutating({ mutationKey: DOMAIN_SAVES_KEY }) === 0,
  });
}
