// The Activity screen: the audit log in one table, the newest entry first or the oldest, narrowed by the kind of action and by a site.

import { MOST_IN_FILE } from "@poplin/app/src/console/activity-file";
import { whatOf } from "@poplin/app/src/console/activity-what";
import { useNavigate } from "@tanstack/react-router";
import { ListFilterIcon } from "lucide-react";
import { type ReactNode, useMemo } from "react";

import { activityColumns, SiteThen, When } from "@/activity/activity-columns";
import { ActivityFoot } from "@/activity/activity-foot";
import { type Entry, type Page, useActivityPage, useActivityTotal } from "@/activity/activity-queries";
import { emptyWords, KINDS, type Kind, kindOf, logQuery, siteIn, sortedQuery, sortOf } from "@/activity/activity-words";
import { DownloadMenu } from "@/activity/download-menu";
import { OnlySite } from "@/activity/only-site";
import { usePageSize } from "@/activity/page-size";
import { Button } from "@/components/ui/button";
import { Empty, EmptyContent, EmptyDescription, EmptyHeader, EmptyTitle } from "@/components/ui/empty";
import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { searchOf, useAddressQuery } from "@/lib/address";
import { useFocusHome } from "@/lib/focus";
import { ownTimeZoneName, useTimeZoneChoice, TIMEZONES, type TimeZoneChoice } from "@/lib/timezone";
import { IconButton } from "@/shared/icon-button";
import { useFirstRowFocus, useShownPlace, useTopOfPlace } from "@/shared/pages";
import { SearchBox } from "@/shared/search-box";
import { Who } from "@/shared/who";
import { AppShell } from "@/shell/app-shell";
import { DataTable } from "@/table/data-table";
import { useTableLayout } from "@/table/layout";

/** The screen's path. */
const PATH = "/activity";

/** The most characters a site's name holds. */
const MAX_SEARCH = 40;

/** The two orders of the log, as a phone's list names them. */
const ORDERS = [
  { value: "desc", label: "Newest" },
  { value: "asc", label: "Oldest" },
] as const;

function KindSelect({ kind, onChoose }: { readonly kind: Kind; readonly onChoose: (kind: Kind) => void }): ReactNode {
  return (
    <Select items={KINDS} value={kind} onValueChange={(value) => onChoose(value as Kind)}>
      <SelectTrigger aria-label="Which activity" className="w-36 max-md:w-auto max-md:min-w-0 max-md:flex-1">
        <SelectValue />
      </SelectTrigger>
      <SelectContent alignItemWithTrigger={false} align="start">
        <SelectGroup>
          {KINDS.map((entry) => (
            <SelectItem key={entry.value} value={entry.value}>
              {entry.label}
            </SelectItem>
          ))}
        </SelectGroup>
      </SelectContent>
    </Select>
  );
}

/** The words of the browser's own time zone: "Your time" with the time zone's short name. A phone shows the short name alone, unless that is UTC itself, which the other choice is called. */
function OwnTimeZoneLabel({ name }: { readonly name: string }): ReactNode {
  if (name === "UTC") return "Your time";

  return (
    <span>
      <span className="max-md:hidden">Your time (</span>
      {name}
      <span className="max-md:hidden">)</span>
    </span>
  );
}

/** The time zone the times are written in: the browser's own, named, or UTC. The choice holds on every screen. */
function TimeZoneToggle({ choice, onChoose: choose }: { readonly choice: TimeZoneChoice; readonly onChoose: (choice: TimeZoneChoice) => void }): ReactNode {
  const own = ownTimeZoneName();

  return (
    <ToggleGroup
      aria-label="Time zone"
      value={[choice]}
      onValueChange={(value) => (value[0] === undefined ? undefined : choose(value[0] as TimeZoneChoice))}
      variant="outline"
      spacing={0}
    >
      {TIMEZONES.map((timeZone) => (
        <ToggleGroupItem key={timeZone} value={timeZone} className="px-3 aria-pressed:bg-chosen aria-pressed:font-bold">
          {timeZone === "utc" ? "UTC" : <OwnTimeZoneLabel name={own} />}
        </ToggleGroupItem>
      ))}
    </ToggleGroup>
  );
}

/** The order of the list on a phone, where no heading can be pressed. */
function OrderSelect({ descending, onChoose }: { readonly descending: boolean; readonly onChoose: (descending: boolean) => void }): ReactNode {
  return (
    <Select items={ORDERS} value={descending ? "desc" : "asc"} onValueChange={(value) => onChoose(value === "desc")}>
      <SelectTrigger aria-label="Order" className="min-w-0 flex-1 md:hidden">
        <SelectValue />
      </SelectTrigger>
      <SelectContent alignItemWithTrigger={false} align="end">
        <SelectGroup>
          {ORDERS.map((entry) => (
            <SelectItem key={entry.value} value={entry.value}>
              {entry.label}
            </SelectItem>
          ))}
        </SelectGroup>
      </SelectContent>
    </Select>
  );
}

/** The log on a phone: one row an entry, what was done and to which site over who did it and when, and after the last row what follows the list. */
function PhoneList({ page, place, after }: { readonly page: Page; readonly place: string; readonly after: ReactNode }): ReactNode {
  const list = useTopOfPlace(place);

  return (
    <div ref={list} className="line-room min-h-0 flex-1 overflow-y-auto md:hidden">
      <ul aria-label="Activity" className="border-t">
        {page.entries.map((entry) => (
          <li key={entry.seq} tabIndex={-1} className="flex min-h-16 flex-col justify-center gap-0.5 border-b px-4 py-2 outline-none focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring">
            <span className="flex min-w-0 items-baseline gap-2">
              <span className="truncate">{whatOf(entry)}</span>
              <span className="min-w-0 shrink-0 truncate">
                <SiteThen entry={entry} />
              </span>
            </span>
            <span className="flex min-w-0 items-center gap-2 text-xs text-muted-foreground">
              <span className="min-w-0 truncate">
                <Who by={entry.by} logins={page.logins} unnamed="a token" />
              </span>
              <span className="shrink-0">
                <When entry={entry} />
              </span>
            </span>
          </li>
        ))}
      </ul>
      {after}
    </div>
  );
}

/** What stands where the rows would: the refusal of the read, the rows being read, or the words of an empty page with the way back to every entry. `undefined` when there are rows to draw. */
function insteadOfRows(failure: string | undefined, page: Page | undefined, kind: Kind, site: ReturnType<typeof siteIn>, onShowAll: () => void): ReactNode {
  if (failure !== undefined) return <p className="px-6 py-8 text-muted-foreground max-md:px-4">{failure}</p>;

  if (page === undefined) {
    return (
      <div className="flex flex-col border-t" aria-busy="true">
        {[0, 1, 2, 3, 4, 5].map((row) => (
          <div key={row} className="flex h-11 items-center border-b px-6 max-md:px-4">
            <Skeleton className="h-4 w-full max-w-3xl" />
          </div>
        ))}
      </div>
    );
  }

  // A page that stopped looking with none found is not the log's end: no words of an empty log stand for it.
  if (page.entries.length > 0 || page.stopped) return undefined;

  const words = emptyWords(kind, site);

  return (
    <Empty className="flex-none py-16">
      <EmptyHeader>
        <EmptyTitle>{words.title}</EmptyTitle>
        <EmptyDescription>{words.says}</EmptyDescription>
      </EmptyHeader>
      {kind === "all" && site.text === "" && site.of === "" ? null : (
        <EmptyContent>
          <Button variant="outline" onClick={onShowAll}>
            Show all activity
          </Button>
        </EmptyContent>
      )}
    </Empty>
  );
}

/** Draw the Activity screen for the address: the log narrowed, ordered, and paged as its query says. */
export function ActivityScreen(): ReactNode {
  const navigate = useNavigate();
  const query = useAddressQuery();
  const kind = kindOf(query);
  const site = siteIn(query);
  const [size, keepSize] = usePageSize();
  const { data: page, error, isPlaceholderData } = useActivityPage(query, size);
  // The last page tells the total by itself; before it, the total is read.
  const { data: total } = useActivityTotal(query, page !== undefined && page.next !== null);
  const place = useShownPlace(`${size} ${query.toString()}`, page !== undefined && !isPlaceholderData);
  const logins = page?.logins;
  // The screen reads the choice of time zone itself, so its rows are drawn again, in the new time zone, when the choice changes.
  const [timeZone, chooseTimeZone] = useTimeZoneChoice();
  const columns = useMemo(() => activityColumns(logins ?? {}), [logins]);
  const layout = useTableLayout("activity", columns);
  const showAll = (): void => void navigate({ to: PATH });
  const instead = insteadOfRows(error?.message, page, kind, site, showAll);
  const move = (changes: Readonly<Record<string, string>>, replace = false): void =>
    void navigate({ to: PATH, search: searchOf(logQuery(query, changes)), replace });
  // A page of another size is read from the list's start: the place of the page before is a place among pages of the old size.
  const chooseSize = (chosen: typeof size): void => {
    keepSize(chosen);
    move({});
  };

  const pages =
    page === undefined ? null : <ActivityFoot query={query} page={page} total={total} size={size} onSize={chooseSize} onMove={move} busy={isPlaceholderData} onShowAll={showAll} />;

  // A page that stopped looking with none found is its foot alone, which says so and leads on.
  const nothingSoFar = page?.stopped === true && page.entries.length === 0 ? pages : undefined;
  // A page with no entry says the log is empty only when it is the log's first page.
  const paged = query.get("after") !== null || query.get("back") !== null;
  // A page still shown from the address before says nothing of the log the address now asks for.
  const whole = page !== undefined && !isPlaceholderData && page.next === null && page.previous === null;
  const fitsOne = whole || (!isPlaceholderData && total?.whole === true && total.total <= MOST_IN_FILE);

  // A log narrowed to one site already shows that site alone. The id finds the site's entries; a text is not kept beside it.
  const rowActions = (entry: Entry): ReactNode => {
    const id = entry.site?.id;
    if (id === undefined || site.of !== "") return null;

    return (
      <span className="inline-flex opacity-60 group-focus-within/row:opacity-100 group-hover/row:opacity-100 pointer-coarse:opacity-100">
        <IconButton label="Only this site" onClick={() => move({ of: id, site: "" })}>
          <ListFilterIcon />
        </IconButton>
      </span>
    );
  };

  // A row's button that narrowed the log to its site, and the mark's button that widened it again, leave with the press: the focus goes home, after the first row of another page had its turn.
  const firstRow = useFirstRowFocus(place);
  const kept = useFocusHome();

  return (
    <AppShell current="activity" heading="Activity">
      <section aria-label="Activity" className="flex min-h-0 min-w-0 flex-1 flex-col" {...kept} {...firstRow}>
        <div className="flex shrink-0 flex-wrap items-center gap-2 px-6 pb-3 max-md:px-4">
          <div className="max-md:order-1 max-md:flex max-md:min-w-0 max-md:flex-1">
            <SearchBox
              sent={site.text}
              onSearch={(text) => move({ site: text, of: "" }, true)}
              placeholder="Find by site"
              label="Find activity by a site's title or name"
              maxLength={MAX_SEARCH}
            />
          </div>
          {site.of === "" ? null : <OnlySite of={site.of} page={page} current={!isPlaceholderData} onShowEvery={() => move({ of: "" })} />}
          <div className="flex min-w-0 flex-1 items-center gap-2 max-md:order-4 max-md:basis-full">
            <KindSelect kind={kind} onChoose={(chosen) => move({ kind: chosen === "all" ? "" : chosen })} />
            <div className="ml-auto flex items-center gap-2 max-md:ml-0 max-md:min-w-0 max-md:flex-[2]">
              <OrderSelect
                descending={sortOf(query).descending}
                onChoose={(descending) => void navigate({ to: PATH, search: searchOf(sortedQuery(query, { key: "when", descending })) })}
              />
              <TimeZoneToggle choice={timeZone} onChoose={chooseTimeZone} />
            </div>
          </div>
          {/* One menu at both widths, so the file after a file is offered wherever the first was saved: at the toolbar's end, which a phone draws beside the search. */}
          <span className="max-md:order-2">
            <DownloadMenu query={query} fitsOne={fitsOne} empty={page === undefined || (!paged && page.entries.length === 0 && !page.stopped)} />
          </span>
        </div>
        {instead ?? nothingSoFar ?? (
          <>
            <div className="flex min-h-0 flex-1 flex-col max-md:hidden">
              <DataTable
                label="Activity"
                columns={columns}
                rows={page?.entries ?? []}
                rowId={(entry) => String(entry.seq)}
                layout={layout}
                sort={sortOf(query)}
                onSort={(order) => void navigate({ to: PATH, search: searchOf(sortedQuery(query, order)) })}
                actions={rowActions}
                after={pages}
                page={place}
              />
            </div>
            {page === undefined ? null : <PhoneList page={page} place={place} after={pages} />}
          </>
        )}
      </section>
    </AppShell>
  );
}
