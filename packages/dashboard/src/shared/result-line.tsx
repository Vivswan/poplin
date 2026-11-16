// What a list says of itself to a screen reader each time it changes: how many rows it shows, or that it shows none. Nothing of it is seen.

import type { ReactNode } from "react";

import { showCount } from "@/lib/sites";
import { useShownPlace } from "@/shared/pages";

/** What a list's rows are called, what the list is narrowed to, and whether it goes on beyond the rows shown. */
interface Counted {
  /** What one row is called, such as "site". */
  readonly one: string;

  /** What several rows are called, such as "sites". */
  readonly many: string;

  /** Whether the rows are one page of a longer list. */
  readonly paged: boolean;

  /** What the list is narrowed to, each choice in its own words, such as `Private` and `"notes"`. Two lists of as many rows then differ in what is said, so the second is said too. */
  readonly narrowed: readonly string[];
}

/** Say how many rows a list shows and what it is narrowed to: "1 site", "25 sites on this page", "2 sites, Private". */
export function rowsSaid(rows: number, { one, many, paged, narrowed }: Counted): string {
  return [`${showCount(rows)} ${rows === 1 ? one : many}${paged ? " on this page" : ""}`, ...narrowed].join(", ");
}

/**
 * Draw the line a screen reader says when a list changes, without moving the focus.
 *
 * @param words - what the list shows now; `undefined` while it still shows the rows of the list before, when the line keeps what it said
 */
export function ResultLine({ words }: { readonly words: string | undefined }): ReactNode {
  const said = useShownPlace(words ?? "", words !== undefined);

  return <output className="sr-only">{said}</output>;
}
