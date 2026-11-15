// How many entries one page of the log holds: a person's choice, kept in the browser.

import useLocalStorageState from "use-local-storage-state";

/** The key the choice is kept under in the browser. */
const KEY = "poplin.activity.page-size";

/** The sizes a page of the log is chosen from; the first until a person chooses. */
export const PAGE_SIZES = ["50", "100", "200"] as const;

/** A size of a page, as the address of the log's data names it. */
export type PageSize = (typeof PAGE_SIZES)[number];

/** The size a person chose for a page of the log, and the way to choose another. A browser that kept none, or something else, has the first. */
export function usePageSize(): readonly [PageSize, (size: PageSize) => void] {
  const [stored, keep] = useLocalStorageState<unknown>(KEY);

  return [PAGE_SIZES.find((size) => size === stored) ?? PAGE_SIZES[0], keep];
}
