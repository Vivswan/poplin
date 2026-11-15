// The foot of the Activity list: the ways to the pages around the one shown, how many entries a page holds, and which entries the page shows of how many. Under them, where a narrowed page stopped looking, the way to look further.

import { AUDIT_WINDOW } from "@poplin/core/src/database/database";
import type { ReactNode } from "react";

import type { Page, Total } from "@/activity/activity-queries";
import { FROM_KEY } from "@/activity/activity-words";
import { PAGE_SIZES, type PageSize } from "@/activity/page-size";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { showCount } from "@/lib/sites";
import { PAGE_WAY } from "@/shared/pages";

/** The sizes of a page, as the select names them. */
const SIZES = PAGE_SIZES.map((value) => ({ value, label: `${value} per page` }));

/** How many entries of the log a narrowed page looks at before it stops, as the screen writes it. */
const SEARCHED = showCount(AUDIT_WINDOW);

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

/** What the three ways are drawn from: the page, whether it is being replaced, which way a page that stopped looking goes on, and where each press leads. */
interface WaysProps {
  readonly page: Page;
  readonly busy: boolean;
  readonly stopped: "after" | "back" | undefined;
  readonly onFirst: () => void;
  readonly onBack: () => void;
  readonly onOn: () => void;
}

/**
 * Read the number of the first entry of the page: 1 on a page with none ahead of it, and `undefined` on a later page whose address does not say.
 *
 * @param step - how many entries a page holds: a page gone back to is counted from a full page ahead of the one it came from, so one that holds fewer starts that many later
 */
function firstEntryOf(query: URLSearchParams, page: Page, step: number): number | undefined {
  if (page.previous === null) return 1;

  const from = Number(query.get(FROM_KEY) ?? "");
  if (!Number.isSafeInteger(from) || from < 1) return undefined;

  return query.get("back") === null ? from : from + step - page.entries.length;
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

/** Read which way a page that stopped looking goes on: the direction it was read in. `undefined` for a page that did not stop. */
function stoppedWay(query: URLSearchParams, page: Page): "after" | "back" | undefined {
  if (!page.stopped) return undefined;

  return query.get("back") === null ? "after" : "back";
}

/** Say that a narrowed page stopped looking before the log's end, with the way to look further. */
function SearchedSoFar({ busy, onSearch }: { readonly busy: boolean; readonly onSearch: () => void }): ReactNode {
  return (
    <p className="flex flex-wrap items-center gap-2 px-6 pb-3 text-muted-foreground max-md:px-4">
      {`Searched the newest ${SEARCHED} entries.`}
      <Button variant="outline" size="sm" disabled={busy} onClick={onSearch} {...PAGE_WAY}>
        Search further
      </Button>
    </p>
  );
}

/** Draw the three ways to the pages around the one shown. One that leads nowhere is dimmed, and so is the one a page that stopped looking leaves to Search further. */
function Ways({ page, busy, stopped, onFirst, onBack, onOn }: WaysProps): ReactNode {
  return (
    <>
      <Button variant="outline" size="sm" disabled={busy || page.previous === null} onClick={onFirst} {...PAGE_WAY}>
        First page
      </Button>
      <Button variant="outline" size="sm" disabled={busy || page.previous === null || stopped === "back"} onClick={onBack} {...PAGE_WAY}>
        Previous page
      </Button>
      <Button variant="outline" size="sm" disabled={busy || page.next === null || stopped === "after"} onClick={onOn} {...PAGE_WAY}>
        Next page
      </Button>
    </>
  );
}

/** Draw the foot. The three ways stand first and keep their places on every page, so a pointer that rests on one stays on it; a way that leads nowhere is dimmed. */
export function ActivityFoot({ query, page, total, size, onSize, onMove, busy = false }: ActivityFootProps): ReactNode {
  const rows = page.entries.length;
  const step = Number(size);
  const from = firstEntryOf(query, page, step);
  const to = from === undefined ? undefined : from + rows - 1;
  const on = (): void => onMove(placeOf("after", page.next, to === undefined ? undefined : to + 1));
  const back = (): void => {
    const first = from === undefined ? undefined : from - step;
    // A page that would start at the list's first entry is the first page itself, read whole.
    if (first !== undefined && first <= 1) onMove({});
    else onMove(placeOf("back", page.previous, first));
  };
  // A page that stopped looking goes on in the direction it was read, by Search further alone: the page's own way there is dimmed.
  const stopped = stoppedWay(query, page);
  const searched = stopped === undefined ? null : <SearchedSoFar busy={busy} onSearch={stopped === "back" ? back : on} />;
  if (rows === 0) return searched;

  const of = to === undefined ? undefined : totalWords(page, to, total);
  const paged = page.previous !== null || page.next !== null;

  return (
    <>
      <nav aria-label="Pages" className="flex flex-wrap items-center gap-x-2 gap-y-2 px-6 py-3 max-md:px-4">
        {paged ? <Ways page={page} busy={busy} stopped={stopped} onFirst={() => onMove({})} onBack={back} onOn={on} /> : null}
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
        {from === undefined || to === undefined || busy ? null : (
          <span className="ml-1 text-muted-foreground tabular-nums">
            {showCount(from)} to {showCount(to)}
            {of === undefined ? null : ` of ${of}`}
          </span>
        )}
      </nav>
      {searched}
    </>
  );
}
