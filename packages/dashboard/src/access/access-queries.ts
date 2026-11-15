// How the Access screen reads its data: the waiting logins, the people, the tokens, and the one login under review, each kept under a key that every change of the screen makes stale.

import { keepPreviousData, type UseQueryResult, useQuery } from "@tanstack/react-query";
import type { InferResponseType } from "hono/client";

import type { Asked } from "@/access/access-values";
import { answerOf, api } from "@/lib/api";
import type { Sort } from "@/table/data-table";

/** The first part of every key the screen's data is kept under: a change marks all of it stale, so every list reads again. */
export const ACCESS_KEY = ["access"] as const;

/** The waiting logins as the server answers them: the newest, without their codes, and how many more wait. */
type Waiting = InferResponseType<typeof api.logins.$get, 200>;

/** One waiting login of the list. Times are milliseconds since the epoch. */
export type WaitingLogin = Waiting["logins"][number];

/** The login under review, with the code to hold against the terminal's. */
export type Review = InferResponseType<(typeof api.logins)[":login"]["$get"], 200>["login"];

/** The people who can log in, and which one is logged in here. */
type People = InferResponseType<typeof api.people.$get, 200>;

/** One token as the server answers it: never its value. */
export type Token = InferResponseType<typeof api.tokens.$get, 200>["tokens"][number];

/**
 * Read the logins that wait to be allowed.
 *
 * @param shown - `false` reads nothing: a code that names no login must tell nothing of the logins that do wait
 */
export function useWaiting(shown: boolean): UseQueryResult<Waiting> {
  return useQuery({ queryKey: [...ACCESS_KEY, "waiting"], queryFn: () => answerOf(api.logins.$get()), enabled: shown });
}

/**
 * Read the login under review.
 *
 * It is read once and not kept: a read by code counts as a try at a code, so it is never asked again behind the person's back, and a review opened again reads the login as it is then.
 *
 * @param asked - which login; `undefined` reads nothing
 */
export function useReview(asked: Asked | undefined): UseQueryResult<Review> {
  const read = async (): Promise<Review> => {
    if (asked?.by === "code") return (await answerOf(api.logins.find.$get({ query: { code: asked.code } }))).login;

    return (await answerOf(api.logins[":login"].$get({ param: { login: asked?.id ?? "" } }))).login;
  };

  return useQuery({
    queryKey: [...ACCESS_KEY, "review", asked],
    queryFn: read,
    enabled: asked !== undefined,
    staleTime: Number.POSITIVE_INFINITY,
    gcTime: 0,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
  });
}

/** Read the people who can log in. */
export function usePeople(): UseQueryResult<People> {
  return useQuery({ queryKey: [...ACCESS_KEY, "people"], queryFn: () => answerOf(api.people.$get()) });
}

/**
 * Read the tokens in the order the address asks for.
 *
 * The tokens before stay shown while the next order is on its way, so the table does not empty at a press on a heading.
 */
export function useTokens(sort: Sort): UseQueryResult<readonly Token[]> {
  const query = { sort: sort.key as "name" | "allowed", dir: sort.descending ? ("desc" as const) : ("asc" as const) };

  return useQuery({
    queryKey: [...ACCESS_KEY, "tokens", query],
    queryFn: async () => (await answerOf(api.tokens.$get({ query }))).tokens,
    placeholderData: keepPreviousData,
  });
}
