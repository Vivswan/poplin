// The Activity screen: the audit log in one table, the newest entry first or the oldest, narrowed by the kind of action and by a site's name.

import { useNavigate } from "@tanstack/react-router";
import { ListFilterIcon } from "lucide-react";
import { type ReactNode, useMemo } from "react";

import { activityColumns, SiteThen, When, Who } from "@/activity/activity-columns";
import { type Entry, useActivityPage } from "@/activity/activity-queries";
import { activityQuery, emptyWords, KINDS, type Kind, kindOf, sortedQuery, sortOf, whatOf } from "@/activity/activity-words";
import { Button } from "@/components/ui/button";
import { Empty, EmptyContent, EmptyDescription, EmptyHeader, EmptyTitle } from "@/components/ui/empty";
import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { searchOf, useAddressQuery } from "@/lib/address";
import { IconButton } from "@/shared/icon-button";
import { Pages } from "@/shared/pages";
import { SearchBox } from "@/shared/search-box";
import { AppShell } from "@/shell/app-shell";
import { ColumnsMenu, DataTable } from "@/table/data-table";
import { useTableLayout } from "@/table/layout";

/** The screen's path. */
const PATH = "/activity";

/** The most characters a site's name holds. */
const MAX_SEARCH = 40;

/** The two orders of the log, as a phone's list names them. */
const ORDERS = [
  { value: "desc", label: "Newest first" },
  { value: "asc", label: "Oldest first" },
] as const;

/** One page of the log as the server answered it. */
type Page = NonNullable<ReturnType<typeof useActivityPage>["data"]>;

function KindSelect({ kind, onChoose }: { readonly kind: Kind; readonly onChoose: (kind: Kind) => void }): ReactNode {
  return (
    <Select items={KINDS} value={kind} onValueChange={(value) => onChoose(value as Kind)}>
      <SelectTrigger aria-label="Which activity" className="w-36">
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

/** The order of the list on a phone, where no heading can be pressed. */
function OrderSelect({ descending, onChoose }: { readonly descending: boolean; readonly onChoose: (descending: boolean) => void }): ReactNode {
  return (
    <Select items={ORDERS} value={descending ? "desc" : "asc"} onValueChange={(value) => onChoose(value === "desc")}>
      <SelectTrigger aria-label="Order" className="w-36 md:hidden">
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

/** The log on a phone: one row an entry, what was done and to which site over who did it and when. */
function PhoneList({ page }: { readonly page: Page }): ReactNode {
  return (
    <ul aria-label="Activity" className="min-h-0 flex-1 overflow-y-auto border-t md:hidden">
      {page.entries.map((entry) => (
        <li key={entry.seq} className="flex min-h-16 flex-col justify-center gap-0.5 border-b px-4 py-2">
          <span className="flex min-w-0 items-baseline gap-2">
            <span className="truncate">{whatOf(entry)}</span>
            <span className="min-w-0 shrink-0 truncate">
              <SiteThen entry={entry} />
            </span>
          </span>
          <span className="flex min-w-0 items-center gap-2 text-xs text-muted-foreground">
            <span className="min-w-0 truncate">
              <Who entry={entry} tokenNames={page.tokenNames} />
            </span>
            <span className="shrink-0">
              <When entry={entry} />
            </span>
          </span>
        </li>
      ))}
    </ul>
  );
}

/** What stands where the rows would: the refusal of the read, the rows being read, or the words of an empty page with the way back to every entry. `undefined` when there are rows to draw. */
function insteadOfRows(failure: string | undefined, page: Page | undefined, kind: Kind, site: string, onShowAll: () => void): ReactNode {
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

  if (page.entries.length > 0) return undefined;

  const words = emptyWords(kind, site);

  return (
    <Empty className="flex-none py-16">
      <EmptyHeader>
        <EmptyTitle>{words.title}</EmptyTitle>
        <EmptyDescription>{words.says}</EmptyDescription>
      </EmptyHeader>
      {kind === "all" && site === "" ? null : (
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
  const site = query.get("site") ?? "";
  const { data: page, error, isPlaceholderData } = useActivityPage(query);
  const tokenNames = page?.tokenNames;
  const next = page?.next;
  const columns = useMemo(() => activityColumns(tokenNames ?? {}), [tokenNames]);
  const layout = useTableLayout("activity", columns);
  const instead = insteadOfRows(error?.message, page, kind, site, () => void navigate({ to: PATH }));
  const move = (changes: Readonly<Record<string, string>>, replace = false): void =>
    void navigate({ to: PATH, search: searchOf(activityQuery(query, changes)), replace });

  const rowActions = (entry: Entry): ReactNode => {
    const name = entry.site?.name;
    if (name === undefined || name === site) return null;

    return (
      <span className="inline-flex opacity-0 group-focus-within/row:opacity-100 group-hover/row:opacity-100 pointer-coarse:opacity-100">
        <IconButton label="Only this site" onClick={() => move({ site: name })}>
          <ListFilterIcon />
        </IconButton>
      </span>
    );
  };

  return (
    <AppShell current="activity" heading="Activity">
      <section aria-label="Activity" className="flex min-h-0 min-w-0 flex-1 flex-col">
        <div className="flex shrink-0 flex-wrap items-center gap-2 px-6 pb-3 max-md:px-4">
          <div className="max-md:flex max-md:basis-full">
            <SearchBox
              sent={site}
              onSearch={(text) => move({ site: text }, true)}
              placeholder="Find by site"
              label="Find activity by a site's name"
              maxLength={MAX_SEARCH}
            />
          </div>
          <KindSelect kind={kind} onChoose={(chosen) => move({ kind: chosen === "all" ? "" : chosen })} />
          <div className="ml-auto flex items-center gap-2">
            <OrderSelect
              descending={sortOf(query).descending}
              onChoose={(descending) => void navigate({ to: PATH, search: searchOf(sortedQuery(query, { key: "when", descending })) })}
            />
            <span className="max-md:hidden">
              <ColumnsMenu columns={columns} layout={layout} />
            </span>
          </div>
        </div>
        {instead ?? (
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
              />
            </div>
            {page === undefined ? null : <PhoneList page={page} />}
            <Pages
              onFirst={query.get("after") === null ? undefined : () => move({})}
              onNext={next == null ? undefined : () => move({ after: next })}
              busy={isPlaceholderData}
            />
          </>
        )}
      </section>
    </AppShell>
  );
}
