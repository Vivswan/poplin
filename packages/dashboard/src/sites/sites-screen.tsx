// The Sites screen: every site in one table, searched and narrowed by the server, with one site's panel beside it; or the trash.

import { useQueryClient } from "@tanstack/react-query";
import { Link, linkOptions, useNavigate, useParams } from "@tanstack/react-router";
import { cn } from "cn";
import { CopyIcon, PlusIcon } from "lucide-react";
import { type ReactNode, useCallback, useMemo, useState } from "react";

import { Button } from "@/components/ui/button";
import { Empty, EmptyContent, EmptyDescription, EmptyHeader, EmptyTitle } from "@/components/ui/empty";
import { Popover, PopoverContent, PopoverDescription, PopoverHeader, PopoverTitle, PopoverTrigger } from "@/components/ui/popover";
import { Select, SelectContent, SelectGroup, SelectItem, SelectSeparator, SelectTrigger, SelectValue } from "@/components/ui/select";
import { searchOf, useAddressQuery } from "@/lib/address";
import type { Site } from "@/lib/sites";
import { IconButton } from "@/shared/icon-button";
import { Pages, queryWith } from "@/shared/pages";
import { SearchBox } from "@/shared/search-box";
import { useStandsBeside } from "@/shared/side-panel";
import { AppShell } from "@/shell/app-shell";
import { siteActions } from "@/sites/site-actions";
import type { LoginNames } from "@/shared/who";
import { AccessMark, type Reveal, SiteLink, siteColumns, trashColumns } from "@/sites/site-columns";
import { SitePanel } from "@/sites/site-panel";
import { SITES_KEY, useSitesPage } from "@/sites/site-queries";
import { type Ask, type Asked, SiteQuestions } from "@/sites/site-questions";
import { SiteRowActions } from "@/sites/site-row-actions";
import { emptyWords, FILTERS, type Filter, filteredQuery, filterOf, SORTS, sortedQuery, sortOf } from "@/sites/sites-query";
import { ColumnsMenu, DataTable } from "@/table/data-table";
import { useTableLayout } from "@/table/layout";

/** The most characters a site's name holds. */
const MAX_SEARCH = 40;

/** How a site's name looks in its row. */
const NAME_LOOK = "-mx-1 rounded-sm px-1 py-0.5 font-medium outline-none hover:underline focus-visible:ring-2 focus-visible:ring-ring";

/** The width of the last column of the trash, whose rows end with a worded button. */
const RESTORE_WIDTH = 104;

/** The names of the logins while the page is being read. */
const NO_LOGINS: LoginNames = {};

/** The command that publishes a folder as a new site. */
const PUBLISH_COMMAND = "npx poplin ./my-folder";

function FilterSelect({ filter, onChoose }: { readonly filter: Filter; readonly onChoose: (filter: Filter) => void }): ReactNode {
  return (
    <Select items={FILTERS} value={filter} onValueChange={(value) => onChoose(value as Filter)}>
      <SelectTrigger aria-label="Which sites" className="w-36 shrink-0 max-md:w-32 @max-md:w-25">
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
  const items = SORTS.map((entry) => ({ value: entry.key, label: `By ${entry.label.toLowerCase()}` }));

  return (
    <Select items={items} value={sortOf(query).key} onValueChange={(value) => onChoose(String(value))}>
      <SelectTrigger aria-label="Order" className="w-32 md:hidden">
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
        <code className="rounded-md border bg-muted/40 px-2.5 py-1.5 font-mono text-xs">{PUBLISH_COMMAND}</code>
      </PopoverContent>
    </Popover>
  );
}

/** The sites on a phone: one row each, the name over who can open it and the link, and after the last row what follows the list. */
function PhoneList({
  sites,
  opened,
  nameCell,
  rowActions,
  onCopy,
  after,
}: {
  readonly sites: readonly Site[];
  readonly opened: string | undefined;
  readonly nameCell: (site: Site) => ReactNode;
  readonly rowActions: (site: Site) => ReactNode;
  readonly onCopy: (site: Site) => void;
  readonly after: ReactNode;
}): ReactNode {
  return (
    <div className="min-h-0 flex-1 overflow-y-auto md:hidden">
      <ul aria-label="Sites" className="border-t">
        {sites.map((site) => (
          <li
            key={site.label}
            data-state={site.label === opened ? "selected" : undefined}
            className="group/row flex min-h-16 items-center gap-2 border-b px-4 py-2 data-[state=selected]:bg-chosen"
          >
            <div className="flex min-w-0 flex-1 flex-col gap-0.5">
              <span className="truncate">{nameCell(site)}</span>
              <span className="flex min-w-0 items-center gap-2">
                <AccessMark access={site.access} className="shrink-0" />
                <SiteLink site={site} className="text-faint" />
                <IconButton label="Copy the link" onClick={() => onCopy(site)} className="-my-2 shrink-0">
                  <CopyIcon />
                </IconButton>
              </span>
            </div>
            {rowActions(site)}
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

/** The words and the one button of an empty place: a refused read is tried again, a later page that emptied leads to the first, a narrowed list to every site, and an empty install to the command. */
function noRowsOf({ failure, filter, search, later, onRetry, onShowAll, onFirst }: NoRowsProps): {
  readonly title: string;
  readonly says: string;
  readonly button?: readonly [string, () => void];
} {
  if (failure !== undefined) return { title: "The sites could not be read", says: failure, button: ["Try again", onRetry] };

  if (later) return { title: "No more sites on this page", says: "The sites that were here are gone.", button: ["First page", onFirst] };

  const words = emptyWords(filter, search);

  return filter !== "all" || search !== "" ? { ...words, button: ["Show all sites", onShowAll] } : words;
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
          <code className="rounded-md border bg-muted/40 px-2.5 py-1.5 font-mono text-xs">{PUBLISH_COMMAND}</code>
        ) : (
          <Button variant="outline" onClick={button[1]}>
            {button[0]}
          </Button>
        )}
      </EmptyContent>
    </Empty>
  );
}

/** What sits above the table: the search, the filter, the order on a phone, the columns' menu, and how a new site is made. Search and order keep an open panel open; another filter closes it. */
function Toolbar({
  query,
  filter,
  search,
  columns,
  onStay,
}: {
  readonly query: URLSearchParams;
  readonly filter: Filter;
  readonly search: string;
  readonly columns: ReactNode;
  readonly onStay: (query: URLSearchParams, replace?: boolean) => void;
}): ReactNode {
  const navigate = useNavigate();

  return (
    <div className="flex shrink-0 items-center gap-2 px-6 pb-3 max-md:px-4">
      <SearchBox
        sent={search}
        onSearch={(text) => onStay(queryWith(query, { q: text }), true)}
        placeholder="Find a site"
        label="Find a site by name"
        maxLength={MAX_SEARCH}
      />
      <FilterSelect filter={filter} onChoose={(chosen) => void navigate({ to: "/", search: searchOf(filteredQuery(query, chosen)) })} />
      <SortSelect query={query} onChoose={(key) => onStay(sortedQuery(query, key))} />
      <div className="ml-auto flex items-center gap-2">
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

/** How a site's name is drawn in its row: a link that opens the site's panel. */
function useNameCell(
  opened: string | undefined,
  toTable: ReturnType<typeof useSitePlaces>["toTable"],
  toSite: ReturnType<typeof useSitePlaces>["toSite"],
): (site: Site) => ReactNode {
  return useCallback(
    (site: Site): ReactNode => {
      const shown = { title: site.name, "aria-expanded": site.label === opened, className: NAME_LOOK };

      // The name of the site whose panel is open leads back to the table, which closes the panel.
      return site.label === opened ? (
        <Link {...toTable} {...shown}>
          {site.name}
        </Link>
      ) : (
        <Link {...toSite(site)} {...shown}>
          {site.name}
        </Link>
      );
    },
    [opened, toTable, toSite],
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
  /** Draws the Name column, which opens the site. */
  readonly nameCell: (site: Site) => ReactNode;

  /** Copies a site's whole link. */
  readonly onCopy: (site: Site) => void;

  /** Which sites show the id in their link. */
  readonly reveal: Reveal;

  /** The name of each login that has one, by the login's id. */
  readonly logins: LoginNames;
}

/** The table the filter shows: the sites, or the trash, each with its own columns, kept layout, and width for a row's actions. */
function useShownTable(filter: Filter, { nameCell, onCopy, reveal, logins }: ColumnParts) {
  const trash = filter === "trash";
  const columns = useMemo(
    () => (trash ? trashColumns(nameCell, logins) : siteColumns(nameCell, onCopy, reveal, logins)),
    [trash, nameCell, onCopy, reveal, logins],
  );
  const layout = useTableLayout(trash ? "trash" : "sites", columns);

  return { columns, layout, label: trash ? "Sites in the trash" : "Sites", actionsWidth: trash ? RESTORE_WIDTH : undefined };
}

/** Draw the Sites screen for the address: the table, and the panel of the site the path names. */
export function SitesScreen(): ReactNode {
  const navigate = useNavigate();
  const query = useAddressQuery();
  const { label: opened } = useParams({ strict: false });
  const filter = filterOf(query);
  const search = query.get("q") ?? "";
  const beside = useStandsBeside();
  const { data: page, error, isPending, isPlaceholderData, refetch } = useSitesPage(query);

  const { toTable, toSite, stay } = useSitePlaces(query);
  const follow = useCallback((site: Pick<Site, "label">): void => void navigate({ ...toSite(site), replace: true }), [navigate, toSite]);
  const actions = useSiteChanges(opened, follow);
  const open = useCallback((site: Site): void => void navigate(site.label === opened ? toTable : toSite(site)), [navigate, opened, toTable, toSite]);
  const nameCell = useNameCell(opened, toTable, toSite);
  const copy = useCallback((site: Site): void => void actions.copyLink(site), [actions]);
  const reveal = useReveal(opened);
  const logins = page?.logins ?? NO_LOGINS;
  const { columns, layout, label, actionsWidth } = useShownTable(filter, { nameCell, onCopy: copy, reveal, logins });
  const [asked, setAsked] = useState<Asked>();
  const ask = useCallback((site: Site, about: Ask): void => setAsked({ site, ask: about }), []);
  const rowActions = (site: Site): ReactNode => (
    <SiteRowActions site={site} actions={actions} onAsk={ask} onRemoved={(gone) => (gone.label === opened ? void navigate(toTable) : undefined)} />
  );
  const sites = page?.sites ?? [];
  const later = query.get("after") !== null;
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
  const toFirst = (): void => void navigate({ to: "/", search: searchOf(queryWith(query, {})) });

  return (
    <AppShell current="sites" heading="Sites">
      <div className={cn("grid min-h-0 flex-1 grid-cols-1", opened !== undefined && beside && "grid-cols-[minmax(0,1fr)_440px]")}>
        {/* Where the panel has the row to itself the list keeps its place under it, out of sight and out of reach, so it is found as it was left. */}
        <section
          aria-label="Sites"
          className={cn("@container col-start-1 row-start-1 flex min-h-0 min-w-0 flex-col", opened !== undefined && !beside && "invisible")}
        >
          <Toolbar query={query} filter={filter} search={search} columns={<ColumnsMenu columns={columns} layout={layout} />} onStay={stay} />
          {nothing ? (
            <NoRows
              failure={error?.message}
              filter={filter}
              search={search}
              later={later}
              onRetry={() => void refetch()}
              onShowAll={() => void navigate({ to: "/" })}
              onFirst={toFirst}
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
                  onOpen={open}
                  actions={rowActions}
                  actionsWidth={actionsWidth}
                  loading={isPending}
                  after={pages}
                />
              </div>
              <PhoneList sites={sites} opened={opened} nameCell={nameCell} rowActions={rowActions} onCopy={copy} after={pages} />
            </>
          )}
        </section>
        {opened === undefined ? null : (
          <SitePanel
            label={opened}
            actions={actions}
            reveal={reveal}
            onAsk={ask}
            closeLink={<Link {...toTable} />}
            onClose={() => void navigate(toTable)}
            onMoved={follow}
          />
        )}
      </div>
      {/* The questions stand outside the panel, so each dims the whole page as every other dialog does. */}
      <SiteQuestions asked={asked} actions={actions} onClose={() => setAsked(undefined)} />
    </AppShell>
  );
}
