// The foot of the Activity list: the ways to the pages around the one shown, how many entries a page holds, and which entries the page shows of how many. Under them, where a narrowed page stopped looking, the way to look further.
// The words of which entries are shown stand a second time over the list, where they are in sight before the last row is.

import { AUDIT_WINDOW } from "@poplin/core/src/database/database";
import { cn } from "cn";
import type { ReactNode } from "react";

import type { Page, Total } from "@/activity/activity-queries";
import { FROM_KEY, SEARCHED_KEY, sortOf } from "@/activity/activity-words";
import { PAGE_SIZES, type PageSize } from "@/activity/page-size";
import { Button } from "@/components/ui/button";
import { Empty, EmptyContent, EmptyDescription, EmptyHeader, EmptyTitle } from "@/components/ui/empty";
import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { showCount } from "@/lib/sites";
import { PAGE_WAY, useShownPlace } from "@/shared/pages";

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

  /** Shows every entry of the log: offered as the second way where a page stopped looking with none found. */
  readonly onShowAll?: () => void;
}

/** What the words of the entries shown are drawn from: the address, the total, and how many entries a page holds, as the foot takes them, and the page. */
interface ShownEntriesProps extends Pick<ActivityFootProps, "query" | "total" | "size" | "busy"> {
  /** The page shown; `undefined` until one is read. */
  readonly page: Page | undefined;

  /** Classes of the place the words stand at. */
  readonly className?: string;
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

/**
 * Read how many entries of the log were looked at ahead of a page: none ahead of the first page, and what the address carries on a page that Search further led to.
 *
 * @returns `undefined` where nobody counted: on a page reached by Next page or Previous page
 */
function searchedAhead(query: URLSearchParams): number | undefined {
  if (query.get("back") !== null) return undefined;
  if (query.get("after") === null) return 0;

  const carried = Number(query.get(SEARCHED_KEY) ?? "");

  return Number.isSafeInteger(carried) && carried > 0 ? carried : undefined;
}

/** Name the place a search goes on to from a page: the page after it, with the page's own share counted in where the way to the page was counted. */
function onwardFrom(next: Readonly<Record<string, string>>, ahead: number | undefined): Readonly<Record<string, string>> {
  return ahead === undefined ? next : { ...next, [SEARCHED_KEY]: String(ahead + AUDIT_WINDOW) };
}

/** Say how far a page that stopped looking has looked: from the log's end it started at where every entry on the way was counted, and by its own share otherwise. */
function searchedWords(query: URLSearchParams): string {
  const ahead = searchedAhead(query);
  if (ahead === undefined) return `${showCount(AUDIT_WINDOW)} more entries`;

  return `the ${sortOf(query).descending ? "newest" : "oldest"} ${showCount(ahead + AUDIT_WINDOW)} entries`;
}

/** Name the entries a page that stopped looking has not looked at: the ones behind it in the direction it was read. */
function unsearched(query: URLSearchParams): "Older" | "Newer" {
  return sortOf(query).descending === (query.get("back") === null) ? "Older" : "Newer";
}

/** Say that a narrowed page stopped looking before the log's end, with the way to look further. */
function SearchedSoFar({ searched, busy, onSearch }: { readonly searched: string; readonly busy: boolean; readonly onSearch: () => void }): ReactNode {
  return (
    <p className="flex flex-wrap items-center gap-2 px-6 pb-3 text-muted-foreground max-md:px-4">
      {`Searched ${searched}.`}
      <Button variant="outline" size="sm" disabled={busy} onClick={onSearch} {...PAGE_WAY}>
        Search further
      </Button>
    </p>
  );
}

/**
 * The words of a page that stopped looking with none found.
 *
 * @param query - the address the page was read at
 * @returns `nothing`, how far it looked, with no full stop, and `left`, the sentence of the entries it has not looked at
 */
export function nothingSoFarWords(query: URLSearchParams): { readonly nothing: string; readonly left: string } {
  return { nothing: `Nothing in ${searchedWords(query)}`, left: `${unsearched(query)} entries are not searched yet.` };
}

/** What the words of a page that stopped looking with none found are drawn from. */
interface NothingSoFarProps {
  /** How far the page has looked, and the entries it has not looked at, as `nothingSoFarWords` says them. */
  readonly words: ReturnType<typeof nothingSoFarWords>;

  /** Whether the page is being replaced. */
  readonly busy: boolean;

  /** Looks further. */
  readonly onSearch: () => void;

  /** Shows every entry of the log. */
  readonly onShowAll?: (() => void) | undefined;
}

/** Say that a narrowed page stopped looking with no entry found: this is what the page holds, with the way to look further first and the way to every entry beside it. */
function NothingSoFar({ words, busy, onSearch, onShowAll }: NothingSoFarProps): ReactNode {
  return (
    <Empty className="flex-none py-16">
      <EmptyHeader>
        <EmptyTitle>{`${words.nothing}.`}</EmptyTitle>
        <EmptyDescription>{words.left}</EmptyDescription>
      </EmptyHeader>
      <EmptyContent className="flex-row justify-center max-sm:flex-col">
        <Button disabled={busy} onClick={onSearch} {...PAGE_WAY}>
          Search further
        </Button>
        {onShowAll === undefined ? null : (
          <Button variant="outline" onClick={onShowAll}>
            Show all activity
          </Button>
        )}
      </EmptyContent>
    </Empty>
  );
}

/**
 * Say which entries the page shows of how many, in quiet words: "1 to 50 of 244".
 *
 * Nothing until a page is read, on a page with no entry, on one whose place nobody counted, and while the page is being replaced, since the address is ahead of the entries then.
 */
export function ShownEntries({ query, page, total, size, busy = false, className }: ShownEntriesProps): ReactNode {
  if (page === undefined || page.entries.length === 0 || busy) return null;

  const from = firstEntryOf(query, page, Number(size));
  if (from === undefined) return null;

  const to = from + page.entries.length - 1;
  const of = totalWords(page, to, total);

  return (
    <span className={cn("text-muted-foreground tabular-nums", className)}>
      {showCount(from)} to {showCount(to)}
      {of === undefined ? null : ` of ${of}`}
    </span>
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
export function ActivityFoot({ query, page, total, size, onSize, onMove, busy = false, onShowAll }: ActivityFootProps): ReactNode {
  const rows = page.entries.length;
  const step = Number(size);
  const from = firstEntryOf(query, page, step);
  const to = from === undefined ? undefined : from + rows - 1;
  const next = (): Readonly<Record<string, string>> => placeOf("after", page.next, to === undefined ? undefined : to + 1);
  const back = (): void => {
    const first = from === undefined ? undefined : from - step;
    // A page that would start at the list's first entry is the first page itself, read whole.
    if (first !== undefined && first <= 1) onMove({});
    else onMove(placeOf("back", page.previous, first));
  };
  // A page that stopped looking goes on in the direction it was read, by Search further alone: the page's own way there is dimmed.
  const stopped = stoppedWay(query, page);
  const further = stopped === "back" ? back : (): void => onMove(onwardFrom(next(), searchedAhead(query)));
  // While another page is on its way the address is ahead of the page: the words are those of the address the page shown was read at.
  const read = new URLSearchParams(useShownPlace(query.toString(), !busy));
  const words = searchedWords(read);
  if (rows === 0) return stopped === undefined ? null : <NothingSoFar words={nothingSoFarWords(read)} busy={busy} onSearch={further} onShowAll={onShowAll} />;

  const searched = stopped === undefined ? null : <SearchedSoFar searched={words} busy={busy} onSearch={further} />;

  const paged = page.previous !== null || page.next !== null;

  return (
    <>
      <nav aria-label="Pages" className="flex flex-wrap items-center gap-x-2 gap-y-2 px-6 py-3 max-md:px-4">
        {paged ? <Ways page={page} busy={busy} stopped={stopped} onFirst={() => onMove({})} onBack={back} onOn={() => onMove(next())} /> : null}
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
        <ShownEntries query={query} page={page} total={total} size={size} busy={busy} className="ml-1" />
      </nav>
      {searched}
    </>
  );
}
