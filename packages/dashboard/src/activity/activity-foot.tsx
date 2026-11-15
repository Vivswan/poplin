// The foot of the Activity list: which entries the page shows of how many, how many a page holds, and the ways to the pages around it.

import type { ReactNode } from "react";

import type { Page, Total } from "@/activity/activity-queries";
import { FROM_KEY } from "@/activity/activity-words";
import { PAGE_SIZES, type PageSize } from "@/activity/page-size";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { showCount } from "@/lib/sites";

/** The sizes of a page, as the select names them. */
const SIZES = PAGE_SIZES.map((value) => ({ value, label: `${value} per page` }));

/** What the foot is drawn from. */
interface ActivityFootProps {
  /** The query of the address the log is at. */
  readonly query: URLSearchParams;

  /** The page shown. */
  readonly page: Page;

  /** How many entries the log holds under the address's narrowing; left out until it is read. */
  readonly total?: Total | undefined;

  /** How many entries a page holds. */
  readonly size: PageSize;

  /** Keeps another size of a page. */
  readonly onSize: (size: PageSize) => void;

  /** Goes to another page: the first one when no place is named. */
  readonly onMove: (place: Readonly<Record<string, string>>) => void;

  /** Whether the page shown is being replaced: the ways wait, and no entries are named, since the address is ahead of them. */
  readonly busy?: boolean;
}

/** Read the number of the first entry of the page: 1 on a page with none ahead of it, and `undefined` on a later page whose address does not say. */
function firstEntryOf(query: URLSearchParams, page: Page): number | undefined {
  if (page.previous === null) return 1;

  const from = Number(query.get(FROM_KEY) ?? "");

  return Number.isSafeInteger(from) && from > 1 ? from : undefined;
}

/** Say how many entries the list holds, as the words after "of": with a plus for a count that is the least it can be, and `undefined` while nobody knows or the count is older than the page. */
function totalWords(page: Page, to: number, total: Total | undefined): string | undefined {
  if (page.next === null) return showCount(to);
  if (total === undefined || total.total < to) return undefined;

  return total.whole ? showCount(total.total) : `${showCount(total.total)}+`;
}

/** Name the place of a page around the one shown: the entry it is reached from, and the number of its first entry where that is known. */
function placeOf(key: "after" | "back", entry: string | null, first: number | undefined): Readonly<Record<string, string>> {
  const place: Record<string, string> = { [key]: entry ?? "" };
  if (first !== undefined) place[FROM_KEY] = String(first);

  return place;
}

/** Draw where the page is in the log and of how many entries, the choice of a page's size, and the ways to the pages around it. A list that fits the smallest page shows the first alone. */
export function ActivityFoot({ query, page, total, size, onSize, onMove, busy = false }: ActivityFootProps): ReactNode {
  const rows = page.entries.length;
  if (rows === 0) return null;

  const step = Number(size);
  const from = firstEntryOf(query, page);
  const to = from === undefined ? undefined : from + rows - 1;
  const of = to === undefined ? undefined : totalWords(page, to, total);
  const paged = page.previous !== null || page.next !== null;
  // The page ahead is the first page for a page that starts within one page of the list's start: one way there is enough.
  const farther = page.previous !== null && (from === undefined || from > step + 1);
  const back = (): void => {
    const first = from === undefined ? undefined : from - step;
    // A page that would start at the list's first entry is the first page itself, read whole.
    if (first !== undefined && first <= 1) onMove({});
    else onMove(placeOf("back", page.previous, first));
  };

  return (
    <nav aria-label="Pages" className="flex flex-wrap items-center gap-x-2 gap-y-2 px-6 py-3 max-md:px-4">
      {from === undefined || to === undefined || busy ? null : (
        <span className="mr-1 text-muted-foreground tabular-nums">
          {showCount(from)} to {showCount(to)}
          {of === undefined ? null : ` of ${of}`}
        </span>
      )}
      {paged || rows > Number(PAGE_SIZES[0]) ? (
        <Select items={SIZES} value={size} onValueChange={(value) => onSize(value as PageSize)}>
          <SelectTrigger size="sm" aria-label="Entries per page">
            <SelectValue />
          </SelectTrigger>
          <SelectContent alignItemWithTrigger={false} align="start">
            <SelectGroup>
              {SIZES.map((entry) => (
                <SelectItem key={entry.value} value={entry.value}>
                  {entry.label}
                </SelectItem>
              ))}
            </SelectGroup>
          </SelectContent>
        </Select>
      ) : null}
      {farther ? (
        <Button variant="outline" size="sm" disabled={busy} onClick={() => onMove({})}>
          First page
        </Button>
      ) : null}
      {page.previous === null ? null : (
        <Button variant="outline" size="sm" disabled={busy} onClick={back}>
          Previous page
        </Button>
      )}
      {page.next === null ? null : (
        <Button variant="outline" size="sm" disabled={busy} onClick={() => onMove(placeOf("after", page.next, to === undefined ? undefined : to + 1))}>
          Next page
        </Button>
      )}
    </nav>
  );
}
