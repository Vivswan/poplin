// How a site's values are drawn in the table and the panel: who can open it, who published it, and its link with the site's id left out until it is asked for.

import { showBytes } from "@poplin/core/src/records/settings";
import { cn } from "cn";
import { CopyIcon, ExternalLinkIcon, EyeIcon, EyeOffIcon, GlobeIcon, LinkIcon, LockIcon } from "lucide-react";
import { Fragment, type ReactNode } from "react";

import { ACCESSES, type Access, type AddressParts, addressParts, expiryOf, type Site, shortMoment, showCount, shownName, wholeMoment } from "@/lib/sites";
import { IconButton } from "@/shared/icon-button";
import { type LoginNames, Who } from "@/shared/who";
import { expiryMoment } from "@/sites/expiry/expiry";
import { SITE_ORDERS } from "@/sites/sites-query";
import type { ColumnSpec } from "@/table/data-table";

/** The mark of each access. */
const ACCESS_ICONS = { private: LockIcon, unlisted: LinkIcon, public: GlobeIcon } as const;

/** The look of a button after a link in the table: quiet at rest, and whole when the row is pointed at or holds the focus. */
const AFTER_LINK_LOOK = "size-6 shrink-0 opacity-60 group-hover/row:opacity-100 group-focus-within/row:opacity-100 pointer-coarse:opacity-100";

/** The fewest letters of a site's name its link is cut to for a table's sake, where the name has as many. */
const LEAST_NAME_LETTERS = 8;

/** The fewest dots that stand for a hidden id in a table short of room. */
const LEAST_DOTS = 3;

/** How much sooner the dots of a hidden id give than the name before them, as the weight a row of boxes shares its lack of room by. */
const DOTS_GIVE_FIRST = 1_000_000;

/** Where a part of a link may go on in the next line: after a run of dashes, but not after a single letter that stands alone between dashes, which stays with what follows it. */
const BREAK_AFTER_DASHES = /(?<=-)(?!-)(?<!(?:^|-)[^-]-)/;

/** A dash with a letter at both sides, where a browser would break a line by itself. */
const DASH_INSIDE = /[^-]-[^-]/;

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
 * The dots are drawn, not typed: a typed dot is taken from another font in some browsers, and comes out heavier there. In a room too narrow for all of them, whole dots stand side by side in its middle.
 */
function HiddenId({ length }: { readonly length: number }): ReactNode {
  return (
    <span role="img" aria-label="part hidden" className="inline-flex h-[1em] max-w-full flex-wrap justify-center overflow-hidden align-middle text-faint">
      {Array.from({ length }, (_, at) => at).map((at) => (
        <span key={at} className="flex h-[1em] w-[1ch] shrink-0 items-center justify-center">
          <span className="size-[3px] rounded-full bg-current" />
        </span>
      ))}
    </span>
  );
}

/** A part of a link that may go on in the next line after its dashes, and nowhere else while a dash is in reach. The letter an address says who can open the site with is not left alone at a line's end: "p-poplin" stays whole. */
function AtDashes({ text }: { readonly text: string }): ReactNode {
  const pieces = text.split(BREAK_AFTER_DASHES);

  return pieces.map((piece, at) => (
    // The pieces of one text never change places: the place is the key.
    // biome-ignore lint/suspicious/noArrayIndexKey: see above.
    <Fragment key={at}>
      {at === 0 ? null : <wbr />}
      {/* A browser goes on in the next line after any dash between letters by itself: a piece that holds one is a box of its own, which moves to the next line whole while it fits one. */}
      {DASH_INSIDE.test(piece) ? <span className="inline-block max-w-full">{piece}</span> : piece}
    </Fragment>
  ));
}

/** A link that goes on in the next line where it is too long: after a dash while one is in reach, with the dots of a hidden id kept whole. */
function WrappedLink({ parts, masked, title, className }: { readonly parts: AddressParts; readonly masked: boolean; readonly title: string; readonly className?: string }): ReactNode {
  const { before, hidden, after } = parts;

  return (
    <span className={cn("min-w-0 font-mono text-xs wrap-anywhere", className)} title={title}>
      <AtDashes text={before} />
      {before.endsWith("-") ? <wbr /> : null}
      {masked ? <HiddenId length={hidden.length} /> : hidden}
      <AtDashes text={after} />
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
 * @param wraps - `true` goes on in the next line where the text is too long, after a dash, and cuts nothing
 * @param gives - `true` lets the text give for the room's sake, and tells a table what may: the dots of a hidden id, down to a few, and then the end of the name, down to its first letters and the mark that it is cut
 */
export function SiteLink({
  site,
  address = site.url,
  whole = false,
  wraps = false,
  gives = false,
  className,
}: {
  readonly site: Pick<Site, "url" | "id">;
  readonly address?: string;
  readonly whole?: boolean;
  readonly wraps?: boolean;
  readonly gives?: boolean;
  readonly className?: string;
}): ReactNode {
  const parts = addressParts(address, site.id);
  const { shared, before, hidden, after } = parts;
  const masked = hidden !== "" && !whole;
  const title = masked ? "Part of the link is hidden here. Copy gives the whole link." : `${shared}${before}${hidden}${after}`;
  if (wraps) return <WrappedLink parts={parts} masked={masked} title={title} className={className} />;

  // The least is as wide as the letters that stay and the mark: a table reads it from the part's style.
  const giving = gives ? { "data-gives": true, style: { minWidth: `${Math.min(before.length, LEAST_NAME_LETTERS + 1)}ch` } } : {};

  return (
    <span className={cn("inline-flex max-w-full min-w-0 overflow-hidden align-bottom font-mono text-xs", className)} title={title}>
      <span className="truncate" {...giving}>
        {before}
      </span>
      {masked && gives ? (
        // The least is as wide as the dots that stay. The dots give long before the name does: the name is cut only once they are at their fewest.
        <span data-gives className="overflow-hidden" style={{ minWidth: `${Math.min(hidden.length, LEAST_DOTS)}ch`, flexShrink: DOTS_GIVE_FIRST }}>
          <HiddenId length={hidden.length} />
        </span>
      ) : null}
      {hidden === "" ? null : (
        <span className="shrink-0">
          {masked && !gives ? <HiddenId length={hidden.length} /> : null}
          {masked ? null : hidden}
          {after}
        </span>
      )}
    </span>
  );
}

/**
 * The eye after a link: it shows that one site's id, and leaves it out again.
 *
 * @param inList - `true` where every row of a list has one: its name then says which site's
 */
export function RevealButton({
  site,
  reveal,
  inList = false,
  className,
}: {
  readonly site: Pick<Site, "id" | "name" | "title">;
  readonly reveal: Reveal;
  readonly inList?: boolean;
  readonly className?: string;
}): ReactNode {
  const label = reveal.shows(site) ? "Hide link" : "Show link";

  return (
    <IconButton label={label} name={inList ? `${label} of ${shownName(site)}` : undefined} onClick={() => reveal.toggle(site)} className={className}>
      {reveal.shows(site) ? <EyeOffIcon /> : <EyeIcon />}
    </IconButton>
  );
}

/** The two buttons after a site's link in a list: one copies the whole link, one opens the site, which a site in the trash has not. Each is named for its site, since every row has them. */
export function LinkButtons({ site, onCopy, className }: { readonly site: Site; readonly onCopy: (site: Site) => void; readonly className?: string }): ReactNode {
  return (
    <>
      <IconButton label="Copy the link" name={`Copy the link of ${shownName(site)}`} onClick={() => onCopy(site)} className={className}>
        <CopyIcon />
      </IconButton>
      {site.state === "trash" ? null : (
        <IconButton label="Open the site" name={`Open the site ${shownName(site)}`} link={<a href={site.url} target="_blank" rel="noreferrer" />} className={className}>
          <ExternalLinkIcon />
        </IconButton>
      )}
    </>
  );
}

/** Who published the version of a site that is live. */
function PublishedBy({ site, logins }: { readonly site: Site; readonly logins: LoginNames }): ReactNode {
  const live = site.versions.find((version) => version.number === site.live_version);

  return live === undefined ? null : <Who by={live.published_by} logins={logins} className="text-muted-foreground" />;
}

/** A moment in few words, quiet, with the whole moment as its hint. */
export function Moment({ moment, className }: { readonly moment: number; readonly className?: string }): ReactNode {
  return (
    <time dateTime={new Date(moment).toISOString()} title={wholeMoment(moment)} className={cn("text-muted-foreground", className)}>
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
    // The buttons end at the column's right edge in every row, however long the row's link is and whether or not it has an eye, and the longest link ends clear of them.
    <span className="flex min-w-0 items-center gap-3">
      <span className="flex min-w-0 flex-1">
        <SiteLink site={site} whole={reveal.shows(site)} gives className="text-muted-foreground" />
      </span>
      <span className="flex shrink-0 items-center">
        {addressParts(site.url, site.id).hidden === "" ? null : <RevealButton site={site} reveal={reveal} inList className={AFTER_LINK_LOOK} />}
        <LinkButtons site={site} onCopy={onCopy} className={AFTER_LINK_LOOK} />
      </span>
    </span>
  );

  return [
    { id: "title", header: "Site", sortable: SITE_ORDERS.first.title, fixed: true, grows: true, cell: nameCell },
    {
      id: "access",
      header: "Who can open it",
      sortable: SITE_ORDERS.first.access,
      cell: (site) => <AccessMark access={site.access} />,
    },
    { id: "link", header: "Link", widest: 380, cell: linkCell },
    { id: "updated", header: "Updated", sortable: SITE_ORDERS.first.updated, cell: (site) => <Moment moment={site.updated} /> },
    { id: "name", header: "Name", hidden: true, sortable: SITE_ORDERS.first.name, cell: (site) => <span className="text-muted-foreground">{site.name}</span> },
    { id: "by", header: "Published by", hidden: true, cell: (site) => <PublishedBy site={site} logins={logins} /> },
    {
      id: "views",
      header: "Visits, 7 days",
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
      cell: (site) => <span className="text-muted-foreground">{expiryMoment(site.expires)}</span>,
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
    { id: "site", header: "Site", fixed: true, grows: true, cell: nameCell },
    {
      id: "gone",
      header: "Leaves the trash",
      cell: (site) => (site.gone_on === undefined ? null : <span className="text-muted-foreground">{expiryOf(site.gone_on)}</span>),
    },
    { id: "by", header: "Published by", hidden: true, cell: (site) => <PublishedBy site={site} logins={logins} /> },
    { id: "size", header: "Size", numeric: true, cell: (site) => <span className="text-muted-foreground">{showBytes(site.bytes)}</span> },
  ];
}
