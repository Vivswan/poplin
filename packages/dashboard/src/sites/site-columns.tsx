// How a site's values are drawn in the table and the panel: who can open it, who published it, and its link with the site's id left out until it is asked for.

import { showBytes } from "@poplin/core/src/records/settings";
import { cn } from "cn";
import { CopyIcon, ExternalLinkIcon, EyeIcon, EyeOffIcon, GlobeIcon, LinkIcon, LockIcon } from "lucide-react";
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

/** The narrowest the Link column is drawn to stay in sight beside the columns before it, in pixels: the start of a site's name, its hidden id and what follows, and the three buttons. */
const LINK_GIVES = 284;

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
 * What stands where a site's id is left out: one dot for each character, each as wide as a character, so nothing moves when the id is shown.
 *
 * The dots are drawn, not typed: a typed dot is taken from another font in some browsers, and comes out heavier there.
 */
function HiddenId({ length }: { readonly length: number }): ReactNode {
  return (
    <span aria-hidden="true" className="inline-flex h-[1em] align-middle text-faint">
      {Array.from({ length }, (_, at) => at).map((at) => (
        <span key={at} className="flex w-[1ch] items-center justify-center">
          <span className="size-[3px] rounded-full bg-current" />
        </span>
      ))}
    </span>
  );
}

/**
 * An address of a site as text: the site's own part, which tells it from every other row, with its id left out. What every address starts with is not drawn.
 *
 * A text too long is cut once: at the end of the site's name where an id follows it, which stays whole with what comes after it while there is room for it at all.
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
      className={cn("inline-flex max-w-full min-w-0 overflow-hidden align-bottom font-mono text-xs", className)}
      title={masked ? "Part of the link is hidden here. Copy gives the whole link." : `${shared}${before}${hidden}${after}`}
    >
      <span className="truncate">{before}</span>
      {hidden === "" ? null : (
        <span className="shrink-0">
          {masked ? <HiddenId length={hidden.length} /> : hidden}
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
 * @param nameCell - draws the first column, which shows the site's title and opens the site
 * @param onCopy - copies a site's whole link; its button stays in sight however short the link is cut
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
      <span className="flex shrink-0 items-center">
        {addressParts(site.url, site.id).hidden === "" ? null : <RevealButton site={site} reveal={reveal} className={AFTER_LINK_LOOK} />}
        <IconButton label="Copy the link" onClick={() => onCopy(site)} className={AFTER_LINK_LOOK}>
          <CopyIcon />
        </IconButton>
        <IconButton label="Open the site" link={<a href={site.url} target="_blank" rel="noreferrer" />} className={AFTER_LINK_LOOK}>
          <ExternalLinkIcon />
        </IconButton>
      </span>
    </span>
  );

  return [
    { id: "title", header: "Site", sortable: SITE_ORDERS.first.title, fixed: true, cell: nameCell },
    {
      id: "access",
      header: "Who can open it",
      sortable: SITE_ORDERS.first.access,
      cell: (site) => <AccessMark access={site.access} />,
    },
    { id: "link", header: "Link", widest: 380, gives: LINK_GIVES, cell: linkCell },
    { id: "updated", header: "Updated", sortable: SITE_ORDERS.first.updated, cell: (site) => <Moment moment={site.updated} /> },
    { id: "name", header: "Name", hidden: true, sortable: SITE_ORDERS.first.name, cell: (site) => <span className="text-muted-foreground">{site.name}</span> },
    { id: "by", header: "Published by", hidden: true, cell: (site) => <PublishedBy site={site} logins={logins} /> },
    {
      id: "views",
      header: "Views, 7 days",
      hidden: true,
      numeric: true,
      cell: (site) => <span className="text-muted-foreground">{site.views === null ? "Not known" : showCount(site.views.week)}</span>,
    },
    {
      id: "size",
      header: "Size",
      hidden: true,
      numeric: true,
      cell: (site) => <span className="text-muted-foreground">{showBytes(site.bytes)}</span>,
    },
    {
      id: "versions",
      header: "Versions",
      hidden: true,
      numeric: true,
      cell: (site) => <span className="text-muted-foreground">{site.versions.length}</span>,
    },
    {
      id: "expires",
      header: "Deletes itself",
      hidden: true,
      cell: (site) => <span className="text-muted-foreground">{expiryOf(site.expires)}</span>,
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
    { id: "site", header: "Site", fixed: true, cell: nameCell },
    {
      id: "gone",
      header: "Leaves the trash",
      cell: (site) => (site.gone_on === undefined ? null : <span className="text-muted-foreground">{expiryOf(site.gone_on)}</span>),
    },
    { id: "by", header: "Published by", hidden: true, cell: (site) => <PublishedBy site={site} logins={logins} /> },
    { id: "size", header: "Size", numeric: true, cell: (site) => <span className="text-muted-foreground">{showBytes(site.bytes)}</span> },
  ];
}
