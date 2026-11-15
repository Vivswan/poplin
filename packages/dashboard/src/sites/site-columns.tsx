// How a site's values are drawn in the table and the panel: who can open it, and its link with an unlisted site's key left out.

import { showBytes } from "@poplin/core/src/records/settings";
import { cn } from "cn";
import { CopyIcon, GlobeIcon, LinkIcon, LockIcon } from "lucide-react";
import type { ReactNode } from "react";

import { ACCESSES, type Access, addressParts, expiryOf, shortMoment, showCount, type Site, wholeMoment } from "@/lib/sites";
import { IconButton } from "@/shared/icon-button";
import { SITE_ORDERS } from "@/sites/sites-query";
import type { ColumnSpec } from "@/table/data-table";

/** The mark of each access. */
const ACCESS_ICONS = { private: LockIcon, unlisted: LinkIcon, public: GlobeIcon } as const;

/** The look of Copy after a link in the table: quiet at rest, as a row's menu is, and whole when the row is pointed at or holds the focus. */
const COPY_LOOK = "size-6 shrink-0 opacity-60 group-hover/row:opacity-100 group-focus-within/row:opacity-100 pointer-coarse:opacity-100";

/** What stands where a site's id is. */
const MASK = String.fromCharCode(0x2022).repeat(6);

/** Who can open a site, as a small mark and quiet words. */
export function AccessMark({ access, className }: { readonly access: Access; readonly className?: string }): ReactNode {
  const Icon = ACCESS_ICONS[access];

  return (
    <span className={cn("inline-flex items-center gap-1.5 text-muted-foreground", className)}>
      <Icon className="size-3.5 shrink-0" aria-hidden="true" />
      {ACCESSES.find((entry) => entry.access === access)?.label}
    </span>
  );
}

/**
 * An address of a site as text: the site's own part, which tells it from every other row, with its id left out. What every address starts with is not drawn, and a text too long is cut once, at its end.
 *
 * @param address - the address to write; the site's link when left out
 * @param whole - `true` shows the id too; otherwise dots stand where it is, and Copy still gives the whole address
 */
export function SiteLink({
  site,
  address = site.url,
  whole = false,
  className,
}: {
  readonly site: Pick<Site, "url" | "id">;
  readonly address?: string;
  readonly whole?: boolean;
  readonly className?: string;
}): ReactNode {
  const { shared, before, hidden, after } = addressParts(address, site.id);
  const masked = hidden !== "" && !whole;

  return (
    <span
      className={cn("inline-block max-w-full min-w-0 truncate align-bottom font-mono text-xs", className)}
      title={masked ? "Part of the link is hidden here. Copy gives the whole link." : `${shared}${before}${hidden}${after}`}
    >
      {before}
      {masked ? <span className="text-faint select-none">{MASK}</span> : hidden}
      {after}
    </span>
  );
}

function Moment({ moment }: { readonly moment: number }): ReactNode {
  return (
    <time dateTime={new Date(moment).toISOString()} title={wholeMoment(moment)} className="text-muted-foreground">
      {shortMoment(moment)}
    </time>
  );
}

/**
 * The columns of the Sites table.
 *
 * @param nameCell - draws the Name column, which opens the site
 * @param onCopy - copies a site's whole link; its button stands right after the link, however short the link is cut
 */
export function siteColumns(nameCell: (site: Site) => ReactNode, onCopy: (site: Site) => void): readonly ColumnSpec<Site>[] {
  const linkCell = (site: Site): ReactNode => (
    <span className="flex min-w-0 items-center gap-1">
      <SiteLink site={site} className="text-muted-foreground" />
      <IconButton label="Copy the link" onClick={() => onCopy(site)} className={COPY_LOOK}>
        <CopyIcon />
      </IconButton>
    </span>
  );

  return [
    { id: "name", header: "Name", size: 240, minSize: 160, sortable: SITE_ORDERS.first.name, fixed: true, cell: nameCell },
    {
      id: "access",
      header: "Who can open it",
      size: 160,
      minSize: 132,
      sortable: SITE_ORDERS.first.access,
      cell: (site) => <AccessMark access={site.access} />,
    },
    { id: "link", header: "Link", size: 320, minSize: 140, grows: true, cell: linkCell },
    { id: "updated", header: "Updated", size: 140, minSize: 120, sortable: SITE_ORDERS.first.updated, cell: (site) => <Moment moment={site.updated} /> },
    {
      id: "views",
      header: "Views, 7 days",
      size: 136,
      minSize: 128,
      hidden: true,
      numeric: true,
      cell: (site) => <span className="text-muted-foreground">{site.views === null ? "Not known" : showCount(site.views.week)}</span>,
    },
    {
      id: "size",
      header: "Size",
      size: 100,
      minSize: 96,
      hidden: true,
      numeric: true,
      cell: (site) => <span className="text-muted-foreground">{showBytes(site.bytes)}</span>,
    },
    {
      id: "versions",
      header: "Versions",
      size: 100,
      minSize: 112,
      hidden: true,
      numeric: true,
      cell: (site) => <span className="text-muted-foreground">{site.versions.length}</span>,
    },
    {
      id: "expires",
      header: "Deletes itself",
      size: 140,
      minSize: 124,
      hidden: true,
      cell: (site) => <span className="text-muted-foreground">{expiryOf(site.expires)}</span>,
    },
    {
      id: "title",
      header: "Title",
      size: 220,
      minSize: 160,
      hidden: true,
      cell: (site) => <span className="text-muted-foreground">{site.title ?? "None"}</span>,
    },
  ];
}

/** The columns of the trash. */
export function trashColumns(nameCell: (site: Site) => ReactNode): readonly ColumnSpec<Site>[] {
  return [
    { id: "name", header: "Name", size: 280, minSize: 160, fixed: true, cell: nameCell },
    {
      id: "gone",
      header: "Leaves the trash",
      size: 180,
      minSize: 136,
      grows: true,
      cell: (site) => (site.gone_on === undefined ? null : <Moment moment={site.gone_on} />),
    },
    { id: "size", header: "Size", size: 100, numeric: true, cell: (site) => <span className="text-muted-foreground">{showBytes(site.bytes)}</span> },
  ];
}
