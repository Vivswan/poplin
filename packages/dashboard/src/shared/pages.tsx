// The ways to the first and the following page of a list, under its last row, with which rows of the list the page shows.

import type { ReactNode } from "react";

import { Button } from "@/components/ui/button";
import { showCount } from "@/lib/sites";

/** The key of the address that holds the number of a page's first row. */
const FROM_KEY = "from";

/** What the ways are drawn from. */
interface PagesProps {
  /** The query of the address the list is at. */
  readonly query: URLSearchParams;

  /** How many rows the page shows. */
  readonly rows: number;

  /** The place the following page starts after; left out on the last page. */
  readonly next?: string | null;

  /** Goes to another page: the first one when no place is named. */
  readonly onMove: (place: Readonly<Record<string, string>>) => void;

  /** Whether the page shown is being replaced: the way on waits, and no rows are named, since the address is ahead of them. */
  readonly busy?: boolean;
}

/** Read the number of the first row of the page the address is at: 1 on the first page, and `undefined` on a later page whose address does not say. */
function firstRowOf(query: URLSearchParams): number | undefined {
  if (query.get("after") === null) return 1;

  const from = Number(query.get(FROM_KEY) ?? "");

  return Number.isSafeInteger(from) && from > 1 ? from : undefined;
}

/**
 * Write a list's query with some of it changed. A change that names no place of a page starts at the first one: a list that is narrowed or put in another order is read from its start.
 *
 * @param changes - the keys to set; an empty value takes a key away
 * @returns a new query
 */
export function queryWith(query: URLSearchParams, changes: Readonly<Record<string, string>>): URLSearchParams {
  const next = new URLSearchParams(query);
  if (!("after" in changes)) for (const key of ["after", FROM_KEY]) next.delete(key);

  for (const [key, value] of Object.entries(changes)) {
    if (value === "") next.delete(key);
    else next.set(key, value);
  }

  return next;
}

/** Draw the ways to the first and the following page, then where the page is in its list. Both ways keep their places on every page, and one that leads nowhere is dimmed. Nothing is drawn for a list that fits one page. */
export function Pages({ query, rows, next, onMove, busy = false }: PagesProps): ReactNode {
  const later = query.get("after") !== null;
  if (!later && next == null) return null;

  const from = firstRowOf(query);
  const to = from === undefined ? undefined : from + rows - 1;
  const onward: Readonly<Record<string, string>> = to === undefined ? {} : { [FROM_KEY]: String(to + 1) };

  return (
    <nav aria-label="Pages" className="flex items-center gap-2 px-6 py-3 max-md:px-4">
      <Button variant="outline" size="sm" disabled={!later} onClick={() => onMove({})}>
        First page
      </Button>
      <Button variant="outline" size="sm" disabled={busy || next == null} onClick={() => onMove({ after: next ?? "", ...onward })}>
        Next page
      </Button>
      {from === undefined || to === undefined || busy ? null : (
        <span className="ml-1 text-muted-foreground">
          {showCount(from)} to {showCount(to)}
          {next == null ? ` of ${showCount(to)}` : null}
        </span>
      )}
    </nav>
  );
}
