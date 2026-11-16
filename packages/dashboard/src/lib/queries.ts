// Where every screen's data is kept, and how long a read stands before it is asked again.
// A read stands for a while, so a window that is looked at again does not ask for everything at once. A change a person makes ends that at once, for every read.

import { QueryClient, type QueryKey } from "@tanstack/react-query";

/** How long a read stands as it was made, in milliseconds. */
const FRESH_MS = 30_000;

/** How long the visits graph's days stand, in milliseconds: its read walks the most rows, and a day's count moves slowly. */
const VISITS_FRESH_MS = 5 * 60_000;

/** The key the visits graph's reads start with. */
const VISITS_KEY: QueryKey = ["usage", "visits"];

/**
 * Make the place every screen's data is kept in.
 *
 * A refused read is not asked again by itself: the refusal is shown. A read that still stands is not made again when its screen is drawn or the window is looked at again. A read that repeats by the clock rests while the page is hidden.
 */
function createQueries(): QueryClient {
  const queries = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: FRESH_MS, refetchIntervalInBackground: false } } });
  queries.setQueryDefaults(VISITS_KEY, { staleTime: VISITS_FRESH_MS });

  return queries;
}

/** Where every screen's data is kept. */
export const QUERIES = createQueries();

/** Note that a person changed something just now: every read made before is old from here on, and is made again when a screen next shows it. A screen that shows the changed thing reads it again itself, at once. */
export function noteChange(): void {
  void QUERIES.invalidateQueries({ refetchType: "none" });
}
