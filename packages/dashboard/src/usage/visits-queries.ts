// How the Usage screen's graph reads its data and keeps its choice: the page opens of each day, the sites that can be picked, and what one person last picked.

import { keepPreviousData, type UseQueryResult, useQuery } from "@tanstack/react-query";
import type { InferResponseType } from "hono/client";
import useLocalStorageState from "use-local-storage-state";
import * as v from "valibot";

import { answerOf, api } from "@/lib/api";

/** The stretches of days the graph offers, the shortest first, with the words of each. */
export const RANGES = [
  { value: "30", label: "30 days" },
  { value: "60", label: "60 days" },
  { value: "90", label: "90 days" },
  { value: "180", label: "180 days" },
  { value: "365", label: "1 year" },
] as const;

/** The places a picked site's line can take, one for each of the theme's colours: as many as the server reads sites at once. */
export const SLOTS = [0, 1, 2, 3, 4] as const;

/** The most sites drawn beside all sites together. */
export const MOST_PICKED = SLOTS.length;

/** A picked site as the browser keeps it. */
const PICKED = v.object({ id: v.string(), title: v.string(), slot: v.picklist(SLOTS) });

/** A choice as the browser keeps it. The lines switched off are at most all sites and every picked site. */
const CHOICE = v.object({
  range: v.picklist(RANGES.map((entry) => entry.value)),
  sites: v.pipe(v.array(PICKED), v.readonly(), v.maxLength(MOST_PICKED)),
  hidden: v.pipe(v.array(v.string()), v.readonly(), v.maxLength(MOST_PICKED + 1)),
});

/** The key the choice is kept under in the browser. */
const CHOICE_KEY = "poplin.usage.visits";

/** The choice the graph starts with: thirty days of all sites alone. */
const FIRST_CHOICE: Choice = { range: "30", sites: [], hidden: [] };

/** What the server answers: the UTC day each step starts on, the earliest first, whether a step is a day or a week, and a count for each step of all sites together and of each site asked for. */
export type Visits = InferResponseType<(typeof api.usage.visits)["$get"], 200>;

/** A stretch of days. */
export type Range = (typeof RANGES)[number]["value"];

/** A site drawn beside all sites: its id, the words it is named with, and which of the theme's colours it keeps while it is picked. */
export type Picked = Readonly<v.InferOutput<typeof PICKED>>;

/** What one person chose to see: the stretch of days, the sites picked, and the lines switched off, each by its key. */
export type Choice = Readonly<v.InferOutput<typeof CHOICE>>;

/** A site that can be picked: its id, its title, and its name. */
export interface Option {
  readonly id: string;
  readonly title: string;
  readonly name: string;
}

/** The choice kept in the browser, and the way to keep another. A kept value of another shape is read as the first choice. */
export function useChoice(): readonly [Choice, (choice: Choice) => void] {
  const [kept, setKept] = useLocalStorageState<unknown>(CHOICE_KEY, { defaultValue: FIRST_CHOICE });

  return [v.is(CHOICE, kept) ? kept : FIRST_CHOICE, setKept];
}

/** Read the page opens of the days a choice names. While another choice is read, the answer to the one before stays. */
export function useVisits(choice: Choice): UseQueryResult<Visits> {
  const sites = choice.sites.map((site) => site.id).join(",");

  return useQuery({
    queryKey: ["usage", "visits", choice.range, sites],
    queryFn: () => answerOf(api.usage.visits.$get({ query: { range: choice.range, ...(sites === "" ? {} : { sites }) } })),
    placeholderData: keepPreviousData,
  });
}

/**
 * Read the sites whose name holds a typed text, by name: the first page of them.
 *
 * @param wanted - whether the list is open; nothing is read while it is not
 */
export function useOptions(typed: string, wanted: boolean): UseQueryResult<readonly Option[]> {
  return useQuery({
    queryKey: ["sites", "options", typed],
    enabled: wanted,
    queryFn: async () => {
      const page = await answerOf(api.sites.$get({ query: { q: typed, sort: "name" } }));

      return page.sites.map((site) => ({ id: site.id, title: site.title ?? site.name, name: site.name }));
    },
    placeholderData: keepPreviousData,
  });
}
