// The Sites screen: every site in one table, searched and narrowed by the server, with one site's panel over its end; or the trash.

import { useQueryClient } from "@tanstack/react-query";
import { Link, linkOptions, useNavigate, useParams } from "@tanstack/react-router";
import { cn } from "cn";
import { CopyIcon, PlusIcon } from "lucide-react";
import { type ReactNode, type RefObject, useCallback, useMemo, useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import { Empty, EmptyContent, EmptyDescription, EmptyHeader, EmptyTitle } from "@/components/ui/empty";
import { Popover, PopoverContent, PopoverDescription, PopoverHeader, PopoverTitle, PopoverTrigger } from "@/components/ui/popover";
import { Select, SelectContent, SelectGroup, SelectItem, SelectSeparator, SelectTrigger, SelectValue } from "@/components/ui/select";
import { searchOf, useAddressQuery } from "@/lib/address";
import { copy } from "@/lib/notify";
import { addressParts, expiryOf, type Site, shownName } from "@/lib/sites";
import { useChosenTimeZone } from "@/lib/timezone";
import { IconButton, RefreshButton } from "@/shared/icon-button";
import { PAGE_WAY, Pages, queryWith, useFirstRowFocus, useShownPlace, useTopOfPlace } from "@/shared/pages";
import { ResultLine, rowsSaid } from "@/shared/result-line";
import { SearchBox } from "@/shared/search-box";
import { openerOf, useKeptFocus, useLiesOver } from "@/shared/side-panel";
import type { LoginNames } from "@/shared/who";
import { AppShell } from "@/shell/app-shell";
import { siteActions } from "@/sites/site-actions";
import { AccessMark, LinkButtons, Moment, type Reveal, RevealButton, SiteLink, siteColumns, trashColumns } from "@/sites/site-columns";
import { SitePanel } from "@/sites/site-panel";
import { SITES_KEY, useSitesPage } from "@/sites/site-queries";
import { type Ask, type Asked, SiteQuestions } from "@/sites/site-questions";
import { emptyWords, FILTERS, type Filter, filteredQuery, filterOf, SORTS, sortedQuery, sortOf } from "@/sites/sites-query";
import { ColumnsMenu, DataTable } from "@/table/data-table";
import { useTableLayout } from "@/table/layout";

/** The most characters the search takes: as many as the server reads, so a pasted link or address is sent whole. */
const MAX_SEARCH = 2048;

/** How a site's name looks in its row. */
const NAME_LOOK = "rounded-sm py-0.5 font-medium outline-none hover:underline focus-visible:ring-2 focus-visible:ring-ring";

/** The width of the last column of the trash, whose rows end with a worded button. */
const RESTORE_WIDTH = 104;

/** The names of the logins while the page is being read. */
const NO_LOGINS: LoginNames = {};

/** The command that publishes a folder as a new site. */
const PUBLISH_COMMAND = "npx poplin ./my-folder";

function FilterSelect({ filter, onChoose }: { readonly filter: Filter; readonly onChoose: (filter: Filter) => void }): ReactNode {
  return (
    <Select items={FILTERS} value={filter} onValueChange={(value) => onChoose(value as Filter)}>
      <SelectTrigger aria-label="Which sites" className="w-36 shrink-0 max-md:w-32">
        <SelectValue />
      </SelectTrigger>
      <SelectContent alignItemWithTrigger={false} align="start">
        <SelectGroup>
          {FILTERS.filter((entry) => entry.value !== "trash").map((entry) => (
            <SelectItem key={entry.value} value={entry.value}>
              {entry.label}
            </SelectItem>
          ))}
        </SelectGroup>
        <SelectSeparator />
        <SelectGroup>
          <SelectItem value="trash">Trash</SelectItem>
        </SelectGroup>
      </SelectContent>
    </Select>
  );
}

/** The order of the list on a phone, where no heading can be pressed. */
function SortSelect({ query, onChoose }: { readonly query: URLSearchParams; readonly onChoose: (key: string) => void }): ReactNode {
  const items = SORTS.map((entry) => ({ value: entry.key, label: entry.label }));

  return (
    <Select items={items} value={sortOf(query).key} onValueChange={(value) => onChoose(String(value))}>
      <SelectTrigger aria-label="Order" className="min-w-0 flex-1 md:hidden">
        <SelectValue />
      </SelectTrigger>
      <SelectContent alignItemWithTrigger={false} align="end">
        <SelectGroup>
          {items.map((entry) => (
            <SelectItem key={entry.value} value={entry.value}>
              {entry.label}
            </SelectItem>
          ))}
        </SelectGroup>
      </SelectContent>
    </Select>
  );
}

/** The command that publishes a folder, with the way to copy it right after it. */
function PublishCommand(): ReactNode {
  return (
    <span className="flex w-fit max-w-full items-center gap-1 rounded-md border bg-muted/40 py-0.5 pr-0.5 pl-2.5">
      <code className="min-w-0 truncate text-left font-mono text-xs">{PUBLISH_COMMAND}</code>
      <IconButton
        label="Copy the command"
        onClick={() => void copy(PUBLISH_COMMAND, { done: "Copied.", failed: "Not copied. Select the command and copy it." })}
      >
        <CopyIcon />
      </IconButton>
    </span>
  );
}

/** How a new site is made: said behind a button, since nothing on this screen makes one. */
function NewSite(): ReactNode {
  return (
    <Popover>
      <PopoverTrigger render={<Button variant="outline" />}>
        <PlusIcon data-icon="inline-start" />
        <span className="max-md:sr-only @max-xl:sr-only">New site</span>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-72">
        <PopoverHeader>
          <PopoverTitle>Publish a folder</PopoverTitle>
          <PopoverDescription>An agent publishes a site for you, or run this where the folder is:</PopoverDescription>
        </PopoverHeader>
        <PublishCommand />
      </PopoverContent>
    </Popover>
  );
}

/** The way back from the trash, at the end of a trashed site's row. A row that still shows a site of the list before, while the trash is read, has none. */
function RestoreButton({ site, onRestore }: { readonly site: Site; readonly onRestore: () => void }): ReactNode {
  if (site.state !== "trash") return null;

  return (
    <Button variant="outline" size="sm" aria-label={`Restore ${shownName(site)}`} onClick={onRestore}>
      Restore
    </Button>
  );
}

/** The sites on a phone, one row each: the title, who can open the site and when it was updated, over its link and the ways to show, copy and open it. A row of the trash has the way back and the day its site leaves. Then comes what follows the list. */
function PhoneList({
  sites,
  opened,
  onOpen,
  restore,
  onCopy,
  reveal,
  place,
  after,
}: {
  readonly sites: readonly Site[];
  readonly opened: string | undefined;
  readonly onOpen: (site: Site) => void;
  readonly restore: ((site: Site) => ReactNode) | undefined;
  readonly onCopy: (site: Site) => void;
  readonly reveal: Reveal;
  readonly place: string;
  readonly after: ReactNode;
}): ReactNode {
  const list = useTopOfPlace(place);

  return (
    <div ref={list} className="line-room min-h-0 flex-1 overflow-y-auto md:hidden">
      <ul aria-label="Sites" className="border-t">
        {sites.map((site) => (
          <li
            key={site.label}
            tabIndex={-1}
            data-state={site.label === opened ? "selected" : undefined}
            className="group/row relative flex min-h-16 items-center gap-2 border-b px-4 py-2 focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring data-[state=selected]:bg-chosen"
          >
            {/* The row's own button lies under everything else in it: a press beside the title and the row's controls lands on it and opens the panel. */}
            {/* It eases nothing: a closed panel gives it the focus back at once, while an eased change would still keep it out of sight. */}
            <Button
              variant="ghost"
              aria-label={detailsOf(site)}
              data-opens={site.label}
              className="absolute inset-0 h-auto rounded-none transition-none hover:bg-transparent focus-visible:ring-inset"
              onClick={() => onOpen(site)}
            />
            <div className="flex min-w-0 flex-1 flex-col gap-0.5">
              <span className="flex min-w-0 items-center gap-2">
                {/* A title that is a link lies over the row's button; plain words let a press through to it. */}
                <span className={cn("min-w-0 truncate", site.state !== "trash" && "relative")}>{nameCell(site)}</span>
                <AccessMark access={site.access} className="shrink-0" />
                {site.state === "trash" ? null : <Moment moment={site.updated} className="ml-auto shrink-0 text-xs" />}
              </span>
              {/* The buttons end at the row's right edge in every row, however long the row's link is and whether or not it has an eye. */}
              <span className="flex min-w-0 items-center gap-2">
                <span className="flex min-w-0 flex-1">
                  <SiteLink site={site} whole={reveal.shows(site)} wraps={reveal.shows(site)} gives={!reveal.shows(site)} className="text-muted-foreground" />
                </span>
                {/* A button's mark ends where the time over it ends: the button itself reaches into the row's side room, which a row of the trash keeps clear for its Restore. */}
                <span className={cn("flex shrink-0 items-center", restore === undefined && "-mr-3")}>
                  {addressParts(site.url, site.id).hidden === "" ? null : <RevealButton site={site} reveal={reveal} inList className="relative -my-2 shrink-0" />}
                  <LinkButtons site={site} onCopy={onCopy} className="relative -my-2 shrink-0" />
                </span>
              </span>
              {site.state === "trash" && site.gone_on !== undefined ? <span className="text-xs text-muted-foreground">Leaves the trash on {expiryOf(site.gone_on)}</span> : null}
            </div>
            {restore === undefined ? null : <span className="relative">{restore(site)}</span>}
          </li>
        ))}
      </ul>
      {after}
    </div>
  );
}

/** What the empty place says, and which one button it offers. */
interface NoRowsProps {
  /** The sentence of a read that was refused. */
  readonly failure: string | undefined;

  /** The filter the table is under. */
  readonly filter: Filter;

  /** The text the table is searched for. */
  readonly search: string;

  /** Whether the address asks for a page after the first. */
  readonly later: boolean;

  /** Reads the page again. */
  readonly onRetry: () => void;

  /** Shows every site: no filter, no search. */
  readonly onShowAll: () => void;

  /** Goes to the first page of the same list. */
  readonly onFirst: () => void;
}

/** The words of an empty place: of a read that was refused, of a later page that emptied, or of a list that holds no site. */
function noRowsWords({ failure, filter, search, later }: Pick<NoRowsProps, "failure" | "filter" | "search" | "later">): { readonly title: string; readonly says: string } {
  if (failure !== undefined) return { title: "The sites could not be read", says: failure };

  if (later) return { title: "No more sites on this page", says: "The sites that were here are gone." };

  return emptyWords(filter, search);
}

/** The words and the one button of an empty place: a refused read is tried again, a later page that emptied leads to the first, a narrowed list to every site, and an empty install to the command. */
function noRowsOf(props: NoRowsProps): {
  readonly title: string;
  readonly says: string;
  readonly button?: readonly [string, () => void];
} {
  const words = noRowsWords(props);
  if (props.failure !== undefined) return { ...words, button: ["Try again", props.onRetry] };

  if (props.later) return { ...words, button: ["First page", props.onFirst] };

  return props.filter !== "all" || props.search !== "" ? { ...words, button: ["Show all sites", props.onShowAll] } : words;
}

/** What the list says of itself to a screen reader once the rows the address asks for are there: how many sites it shows, or the words of its empty place. */
function SitesSaid({ query, filter, search }: { readonly query: URLSearchParams; readonly filter: Filter; readonly search: string }): ReactNode {
  const { data: page, error, isPending, isPlaceholderData } = useSitesPage(query);
  const later = query.get("after") !== null;
  const rows = page?.sites.length ?? 0;
  const empty = error !== null || rows === 0;
  // The filter and the search are said with the count: two lists of as many sites are then two different lines.
  const narrowed = [...FILTERS.filter((entry) => entry.value === filter && filter !== "all").map((entry) => entry.label), ...(search === "" ? [] : [`"${search}"`])];
  const shown = empty ? noRowsWords({ failure: error?.message, filter, search, later }).title : rowsSaid(rows, { one: "site", many: "sites", paged: later || page?.next != null, narrowed });

  return <ResultLine words={isPending || isPlaceholderData ? undefined : shown} />;
}

/** What stands where the rows would when there are none. */
function NoRows(props: NoRowsProps): ReactNode {
  const { title, says, button } = noRowsOf(props);

  return (
    <Empty className="flex-none py-16">
      <EmptyHeader>
        <EmptyTitle>{title}</EmptyTitle>
        <EmptyDescription>{says}</EmptyDescription>
      </EmptyHeader>
      <EmptyContent>
        {button === undefined ? (
          <PublishCommand />
        ) : (
          <Button variant="outline" onClick={button[1]} {...PAGE_WAY}>
            {button[0]}
          </Button>
        )}
      </EmptyContent>
    </Empty>
  );
}

/** What sits above the table: the search, the filter, the order on a phone, the button that reads the list again, the columns' menu, and how a new site is made. */
function Toolbar({
  query,
  filter,
  search,
  columns,
  refresh,
  onStay,
}: {
  readonly query: URLSearchParams;
  readonly filter: Filter;
  readonly search: string;
  readonly columns: ReactNode;
  readonly refresh: ReactNode;
  readonly onStay: (query: URLSearchParams, replace?: boolean) => void;
}): ReactNode {
  const navigate = useNavigate();

  return (
    <div className="flex shrink-0 items-center gap-2 px-6 pb-3 max-md:flex-wrap max-md:px-4">
      <SearchBox
        sent={search}
        onSearch={(text) => onStay(queryWith(query, { q: text }), true)}
        placeholder="Find a site"
        label="Find a site"
        className="max-md:basis-full"
        maxLength={MAX_SEARCH}
      />
      <SitesSaid query={query} filter={filter} search={search} />
      <FilterSelect filter={filter} onChoose={(chosen) => void navigate({ to: "/", search: searchOf(filteredQuery(query, chosen)) })} />
      <SortSelect query={query} onChoose={(key) => onStay(sortedQuery(query, key))} />
      <div className="ml-auto flex items-center gap-2">
        {refresh}
        <div className="max-md:hidden">{columns}</div>
        <NewSite />
      </div>
    </div>
  );
}

/**
 * The changes of a site, wired to this screen: after each, the table and the panel read again, and a site that got another label is followed to its new address.
 *
 * @param opened - the label of the site whose panel is open
 * @param follow - moves the panel to the address of the site as it then is
 */
function useSiteChanges(opened: string | undefined, follow: (site: Pick<Site, "label">) => void): ReturnType<typeof siteActions> {
  const client = useQueryClient();

  return useMemo(
    () =>
      siteActions((before, after) => {
        const moved = after !== null && after.label !== before.label;
        if (moved && before.label === opened) follow(after);

        // What was read under a label the site has left is not read again: its panel is at the new address by now.
        void client.invalidateQueries({
          queryKey: SITES_KEY,
          predicate: (query) => !(moved && query.queryKey[1] === "one" && query.queryKey[2] === before.label),
        });
      }),
    [client, opened, follow],
  );
}

/**
 * Where the screen leads, each place with the table kept as it is shown.
 *
 * @returns `toTable` and `toSite` for a link or a move, and `stay`, which moves to another query of the address the screen is at, so an open panel stays open
 */
function useSitePlaces(query: URLSearchParams) {
  const navigate = useNavigate();
  const kept = useMemo(() => searchOf(query), [query]);
  const toTable = useMemo(() => linkOptions({ to: "/", search: kept }), [kept]);
  const toSite = useCallback((site: Pick<Site, "label">) => linkOptions({ to: "/sites/$label", params: { label: site.label }, search: kept }), [kept]);
  const stay = (next: URLSearchParams, replace = false): void => void navigate({ to: ".", search: searchOf(next), replace });

  return { toTable, toSite, stay };
}

/** How a site's title is drawn in its row: a link that opens the site in a tab of its own. A site in the trash is not served, so its title is plain. */
function nameCell(site: Site): ReactNode {
  const name = shownName(site);

  return site.state === "trash" ? (
    <span data-slot="site-name" title={name} className="font-medium">
      {name}
    </span>
  ) : (
    <a data-slot="site-name" href={site.url} target="_blank" rel="noreferrer" title={name} className={NAME_LOOK}>
      {name}
    </a>
  );
}

/**
 * Which sites show the id in their link. Nothing of it is kept: a site shows its id until its eye is pressed again, the panel closes or opens for another site, or the screen is left.
 *
 * @param opened - the label of the site whose panel is open
 */
function useReveal(opened: string | undefined): Reveal {
  const [held, setHeld] = useState<{ readonly beside: string | undefined; readonly ids: readonly string[] }>({ beside: opened, ids: [] });
  // What was shown beside another panel, or beside none, is forgotten: it stays hidden when that panel opens again.
  if (held.beside !== opened) setHeld({ beside: opened, ids: [] });

  return useMemo(() => {
    const ids = held.beside === opened ? held.ids : [];

    return {
      shows: (site) => ids.includes(site.id),
      toggle: (site) => setHeld({ beside: opened, ids: ids.includes(site.id) ? ids.filter((id) => id !== site.id) : [...ids, site.id] }),
    };
  }, [held, opened]);
}

/** What the table's columns are drawn with. */
interface ColumnParts {
  /** Copies a site's whole link. */
  readonly onCopy: (site: Site) => void;

  /** Which sites show the id in their link. */
  readonly reveal: Reveal;

  /** The name of each login that has one, by the login's id. */
  readonly logins: LoginNames;
}

/** The table the filter shows: the sites, or the trash, each with its own columns, kept layout, and width for a row's actions. */
function useShownTable(filter: Filter, { onCopy, reveal, logins }: ColumnParts) {
  const trash = filter === "trash";
  const columns = useMemo(() => (trash ? trashColumns(nameCell, logins) : siteColumns(nameCell, onCopy, reveal, logins)), [trash, onCopy, reveal, logins]);
  const layout = useTableLayout(trash ? "trashed-sites" : "site-list", columns);

  return { columns, layout, label: trash ? "Sites in the trash" : "Sites", actionsWidth: trash ? RESTORE_WIDTH : undefined };
}

/** Read the page of sites the address asks for, with the place of the page that is shown: the address is ahead of the rows while the next page is read. */
function useShownSites(query: URLSearchParams) {
  const read = useSitesPage(query);

  return { ...read, place: useShownPlace(query.toString(), read.data !== undefined && !read.isPlaceholderData) };
}

/**
 * Hold the question that is open about a site.
 *
 * A question is drawn anew at each asking and knows no control that opened it: the one with the focus at the asking is kept for it.
 */
function useQuestion(): {
  readonly asked: Asked | undefined;
  readonly asker: RefObject<HTMLElement | null>;
  readonly ask: (site: Site, about: Ask) => void;
  readonly leave: () => void;
} {
  const [asked, setAsked] = useState<Asked>();
  const asker = useRef<HTMLElement | null>(null);
  const ask = useCallback((site: Site, about: Ask): void => {
    asker.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    setAsked({ site, ask: about });
  }, []);
  const leave = useCallback((): void => setAsked(undefined), []);

  return { asked, asker, ask, leave };
}

/** The name of the button that opens a site's panel. */
function detailsOf(site: Site): string {
  return `Details of ${shownName(site)}`;
}

/** Draw the Sites screen for the address: the table, and the panel of the site the path names. */
export function SitesScreen(): ReactNode {
  useChosenTimeZone();
  const navigate = useNavigate();
  const query = useAddressQuery();
  const { label: opened } = useParams({ strict: false });
  const filter = filterOf(query);
  const search = query.get("q") ?? "";
  const over = useLiesOver();
  const shownSites = useShownSites(query);
  const { data: page, error, isPending, isPlaceholderData, refetch, place } = shownSites;

  const { toTable, toSite, stay } = useSitePlaces(query);
  const follow = useCallback((site: Pick<Site, "label">): void => void navigate({ ...toSite(site), replace: true }), [navigate, toSite]);
  const actions = useSiteChanges(opened, follow);
  const kept = useKeptFocus(opened);
  const opens = useMemo(() => ({ name: detailsOf, open: (site: Site): void => void navigate(site.label === opened ? toTable : toSite(site)) }), [navigate, opened, toTable, toSite]);
  const copy = useCallback((site: Site): void => void actions.copyLink(site), [actions]);
  const reveal = useReveal(opened);
  const logins = page?.logins ?? NO_LOGINS;
  const { columns, layout, label, actionsWidth } = useShownTable(filter, { onCopy: copy, reveal, logins });
  const { asked, asker, ask, leave } = useQuestion();
  // Every change of a site is made in its panel. A row of the trash alone ends with a button: the way back, at one press.
  const restore = filter === "trash" ? (site: Site): ReactNode => <RestoreButton site={site} onRestore={() => void actions.restore(site)} /> : undefined;
  const sites = page?.sites ?? [];
  const pages = (
    <Pages
      query={query}
      rows={sites.length}
      next={page?.next}
      onMove={(place) => void navigate({ to: "/", search: searchOf(queryWith(query, place)) })}
      busy={isPlaceholderData}
    />
  );
  const nothing = error !== null || (!isPending && sites.length === 0);
  const firstRow = useFirstRowFocus(place);

  return (
    <AppShell current="sites" heading="Sites">
      <div {...kept} className="relative grid min-h-0 flex-1 grid-cols-1">
        {/* The list keeps its width under an open panel. Where the panel has the row to itself the list is out of sight and out of reach, and is found as it was left. */}
        <section
          aria-label="Sites"
          className={cn("@container col-start-1 row-start-1 flex min-h-0 min-w-0 flex-col", opened !== undefined && !over && "invisible")}
          {...firstRow}
        >
          <Toolbar query={query} filter={filter} search={search} columns={<ColumnsMenu columns={columns} layout={layout} />} refresh={<RefreshButton label="Refresh the list" read={shownSites} />} onStay={stay} />
          {nothing ? (
            <NoRows
              failure={error?.message}
              filter={filter}
              search={search}
              later={query.get("after") !== null}
              onRetry={() => void refetch()}
              onShowAll={() => void navigate({ to: "/" })}
              onFirst={() => void navigate({ to: "/", search: searchOf(queryWith(query, {})) })}
            />
          ) : (
            <>
              <div className="flex min-h-0 flex-1 flex-col max-md:hidden">
                <DataTable
                  label={label}
                  columns={columns}
                  rows={sites}
                  rowId={(site) => site.label}
                  layout={layout}
                  sort={sortOf(query)}
                  onSort={(next) => stay(sortedQuery(query, next))}
                  selected={opened}
                  opens={opens}
                  actions={restore}
                  actionsWidth={actionsWidth}
                  loading={isPending}
                  page={place}
                  after={pages}
                />
              </div>
              <PhoneList sites={sites} opened={opened} onOpen={opens.open} restore={restore} onCopy={copy} reveal={reveal} place={place} after={pages} />
            </>
          )}
        </section>
        {opened === undefined ? null : (
          <SitePanel
            key={opened}
            label={opened}
            actions={actions}
            reveal={reveal}
            onAsk={ask}
            closeLink={<Link {...toTable} />}
            onClose={() => void navigate(toTable)}
            opener={() => openerOf(opened)}
            onMoved={follow}
          />
        )}
      </div>
      {/* The questions stand outside the panel, so each dims the whole page as every other dialog does. */}
      <SiteQuestions asked={asked} actions={actions} onClose={leave} returnTo={asker} />
    </AppShell>
  );
}
