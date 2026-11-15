// How a site's values are drawn in the table and the panel: who can open it, who published it, and its link with the site's id left out until it is asked for.

import { showBytes } from "@poplin/core/src/records/settings";
import { cn } from "cn";
import { CopyIcon, EyeIcon, EyeOffIcon, GlobeIcon, LinkIcon, LockIcon } from "lucide-react";
import type { ReactNode } from "react";

import { ACCESSES, type Access, addressParts, expiryOf, shortMoment, showCount, type Site, wholeMoment } from "@/lib/sites";
import { IconButton } from "@/shared/icon-button";
import { type LoginNames, Who } from "@/shared/who";
import { SITE_ORDERS } from "@/sites/sites-query";
import type { ColumnSpec } from "@/table/data-table";

/** The mark of each access. */
const ACCESS_ICONS = { private: LockIcon, unlisted: LinkIcon, public: GlobeIcon } as const;

/** The look of a button after a link in the table: quiet at rest, as a row's menu is, and whole when the row is pointed at or holds the focus. */
const AFTER_LINK_LOOK = "size-6 shrink-0 opacity-60 group-hover/row:opacity-100 group-focus-within/row:opacity-100 pointer-coarse:opacity-100";

/** What stands for each character of a site's id that is left out: the dots are as wide as the id, so nothing moves when it is shown. */
const MASK_MARK = String.fromCharCode(0x2022);

/** Which sites show the id in their link, and the switch of one. */
export interface Reveal {
  /** Whether the site's id is shown. */
  readonly shows: (site: Pick<Site, "id">) => boolean;

  /** Shows the site's id, or leaves it out again. */
  readonly toggle: (site: Pick<Site, "id">) => void;
}

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
 * An address of a site as text: the site's own part, which tells it from every other row, with its id left out. What every address starts with is not drawn.
 *
 * A text too long is cut once: at the end of the site's name where an id follows it, which stays whole with what comes after it.
 *
 * @param address - the address to write; the site's link when left out
 * @param whole - `true` shows the id too; otherwise as many dots stand where it is, and Copy still gives the whole address
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
      className={cn("inline-flex max-w-full min-w-0 align-bottom font-mono text-xs", className)}
      title={masked ? "Part of the link is hidden here. Copy gives the whole link." : `${shared}${before}${hidden}${after}`}
    >
      <span className="truncate">{before}</span>
      {hidden === "" ? null : (
        <span className="shrink-0">
          {masked ? <span className="text-faint select-none">{MASK_MARK.repeat(hidden.length)}</span> : hidden}
          {after}
        </span>
      )}
    </span>
  );
}

/** The eye after a link: it shows that one site's id, and leaves it out again. */
export function RevealButton({
  site,
  reveal,
  className,
}: {
  readonly site: Pick<Site, "id">;
  readonly reveal: Reveal;
  readonly className?: string;
}): ReactNode {
  const shown = reveal.shows(site);

  return (
    <IconButton label={shown ? "Hide link" : "Show link"} onClick={() => reveal.toggle(site)} className={className}>
      {shown ? <EyeOffIcon /> : <EyeIcon />}
    </IconButton>
  );
}

/** Who published the version of a site that is live. */
function PublishedBy({ site, logins }: { readonly site: Site; readonly logins: LoginNames }): ReactNode {
  const live = site.versions.find((version) => version.number === site.live_version);

  return live === undefined ? null : <Who by={live.published_by} logins={logins} className="text-muted-foreground" />;
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
 * @param reveal - which sites show the id in their link
 * @param logins - the name of each login that has one, by the login's id
 */
export function siteColumns(
  nameCell: (site: Site) => ReactNode,
  onCopy: (site: Site) => void,
  reveal: Reveal,
  logins: LoginNames,
): readonly ColumnSpec<Site>[] {
  const linkCell = (site: Site): ReactNode => (
    <span className="flex min-w-0 items-center gap-1">
      <SiteLink site={site} whole={reveal.shows(site)} className="text-muted-foreground" />
      <IconButton label="Copy the link" onClick={() => onCopy(site)} className={AFTER_LINK_LOOK}>
        <CopyIcon />
      </IconButton>
      {addressParts(site.url, site.id).hidden === "" ? null : <RevealButton site={site} reveal={reveal} className={AFTER_LINK_LOOK} />}
    </span>
  );

  return [
    { id: "name", header: "Name", size: 240, minSize: 160, sortable: SITE_ORDERS.first.name, fixed: true, cell: nameCell },
    {
      id: "access",
      header: "Who can open it",
      size: 160,
      minSize: 156,
      sortable: SITE_ORDERS.first.access,
      cell: (site) => <AccessMark access={site.access} />,
    },
    { id: "link", header: "Link", size: 344, minSize: 344, grows: true, cell: linkCell },
    { id: "updated", header: "Updated", size: 140, minSize: 120, sortable: SITE_ORDERS.first.updated, cell: (site) => <Moment moment={site.updated} /> },
    { id: "by", header: "Published by", size: 200, minSize: 168, hidden: true, cell: (site) => <PublishedBy site={site} logins={logins} /> },
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

/**
 * The columns of the trash.
 *
 * @param logins - the name of each login that has one, by the login's id
 */
export function trashColumns(nameCell: (site: Site) => ReactNode, logins: LoginNames): readonly ColumnSpec<Site>[] {
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
    { id: "by", header: "Published by", size: 200, minSize: 168, hidden: true, cell: (site) => <PublishedBy site={site} logins={logins} /> },
    { id: "size", header: "Size", size: 100, numeric: true, cell: (site) => <span className="text-muted-foreground">{showBytes(site.bytes)}</span> },
  ];
}
