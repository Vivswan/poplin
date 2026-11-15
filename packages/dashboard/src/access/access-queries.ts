// How the Access screen reads its data: the waiting logins, the people, the tokens, and the one login under review, each kept under a key that every change of the screen makes stale.

import { keepPreviousData, type UseQueryResult, useQuery } from "@tanstack/react-query";
import type { InferResponseType } from "hono/client";

import type { Asked } from "@/access/access-values";
import { answerOf, api } from "@/lib/api";
import type { Sort } from "@/table/data-table";

/** The first part of every key the screen's data is kept under: a change marks all of it stale, so every list reads again. */
export const ACCESS_KEY = ["access"] as const;

/** The waiting logins as the server answers them: the newest, without their codes, and how many more wait. */
export type Waiting = InferResponseType<typeof api.logins.$get, 200>;

/** One waiting login of the list. Times are milliseconds since the epoch. */
export type WaitingLogin = Waiting["logins"][number];

/** The login under review, with the code to hold against the terminal's. */
export type Review = InferResponseType<(typeof api.logins)[":login"]["$get"], 200>["login"];

/** The people who can log in, and which one is logged in here. */
export type People = InferResponseType<typeof api.people.$get, 200>;

/** The tokens as the server answers them: the ones that work, and the newest that ended. */
type Tokens = InferResponseType<typeof api.tokens.$get, 200>;

/** One token as the server answers it: never its value. */
export type Token = Tokens["tokens"][number];

/** One token that ended, with when and how: never its value. */
export type EndedToken = Tokens["ended"][number];

/** The tokens that ended, the one that ended last first, and whether more ended than are listed. */
export interface Ended {
  readonly tokens: readonly EndedToken[];
  readonly more: boolean;
}

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

/**
 * Read the people who can log in.
 *
 * @param shown - `false` reads nothing: the people are read where their tab is shown
 */
export function usePeople(shown: boolean): UseQueryResult<People> {
  return useQuery({ queryKey: [...ACCESS_KEY, "people"], queryFn: () => answerOf(api.people.$get()), enabled: shown });
}

/** The tokens that work, of the server's answer. */
function workingOf(answer: Tokens): readonly Token[] {
  return answer.tokens;
}

/** The tokens that ended, of the server's answer. */
function endedOf(answer: Tokens): Ended {
  return { tokens: answer.ended, more: answer.more };
}

/**
 * Read the tokens in the order the address asks for, and of what the server answers keep one part.
 *
 * The tokens before stay shown while the next order is on its way, so the table does not empty at a press on a heading. Two parts of one order are one read.
 *
 * @param shown - `false` reads nothing: the tokens are read where their tab is shown
 */
function useTokensPart<Part>(sort: Sort, shown: boolean, select: (answer: Tokens) => Part): UseQueryResult<Part> {
  const query = { sort: sort.key as "name" | "allowed", dir: sort.descending ? ("desc" as const) : ("asc" as const) };

  return useQuery({ queryKey: [...ACCESS_KEY, "tokens", query], queryFn: () => answerOf(api.tokens.$get({ query })), placeholderData: keepPreviousData, enabled: shown, select });
}

/** Read the tokens that work, in the order the address asks for. */
export function useTokens(sort: Sort, shown: boolean): UseQueryResult<readonly Token[]> {
  return useTokensPart(sort, shown, workingOf);
}

/** Read the tokens that ended, the one that ended last first. It is the same read as the tokens that work. */
export function useEndedTokens(sort: Sort, shown: boolean): UseQueryResult<Ended> {
  return useTokensPart(sort, shown, endedOf);
}
