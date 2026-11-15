// How the screens read what went wrong: the list of the last days, and the stretch of days a person chose for it, which the address holds.

import { type UseQueryResult, useQuery } from "@tanstack/react-query";
import type { InferResponseType } from "hono/client";

import { useAddressQuery } from "@/lib/address";
import { answerOf, api } from "@/lib/api";

/** The stretches of days the list offers, the first the one shown until another is chosen. */
export const RANGES = [
  { value: "7", label: "Last 7 days" },
  { value: "30", label: "Last 30 days" },
] as const;

/** The key of the address that holds the chosen stretch. */
export const DAYS_KEY = "days";

/** What the server answers. */
type Problems = InferResponseType<typeof api.problems.$get, 200>;

/** A stretch of days the list offers. */
export type Range = (typeof RANGES)[number]["value"];

/** One kind of problem on one UTC day, with its words and the screen where it is acted on. */
export type Problem = Problems["problems"][number];

/**
 * The stretch of days the address names: the first one offered for an address that names none, or one that is not offered.
 */
export function useRange(): Range {
  const asked = useAddressQuery().get(DAYS_KEY);

  return RANGES.find((range) => range.value === asked)?.value ?? RANGES[0].value;
}

/** Read the problems of a stretch of days, the newest first. */
export function useProblems(days: Range): UseQueryResult<Problems> {
  return useQuery({ queryKey: ["problems", days], queryFn: () => answerOf(api.problems.$get({ query: { days } })) });
}
