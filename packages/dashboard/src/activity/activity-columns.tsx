// How an entry of the log is drawn in the table: when, who, what, and the site it was done to.

import { Link } from "@tanstack/react-router";
import type { ReactNode } from "react";

import type { Entry } from "@/activity/activity-queries";
import { whatOf } from "@/activity/activity-words";
import { wholeMoment } from "@/lib/sites";
import { type LoginNames, Who } from "@/shared/who";
import type { ColumnSpec } from "@/table/data-table";

/** When an entry was written, to the minute, in the time zone a person chose. */
export function When({ entry }: { readonly entry: Entry }): ReactNode {
  return (
    <time dateTime={new Date(entry.at).toISOString()} title={wholeMoment(entry.at)} className="text-muted-foreground tabular-nums">
      {wholeMoment(entry.at)}
    </time>
  );
}

/** The site an entry is about, by the name it had then: a link to the site while it is one, plain words once it is gone. */
export function SiteThen({ entry }: { readonly entry: Entry }): ReactNode {
  if (entry.site === null) return null;

  if (entry.site.label === null) {
    return (
      <span className="text-muted-foreground" title="This site is gone">
        {entry.site.name}
      </span>
    );
  }

  return (
    <Link
      to="/sites/$label"
      params={{ label: entry.site.label }}
      title={entry.site.name}
      className="-mx-1 rounded-sm px-1 py-0.5 text-link underline-offset-2 outline-none hover:underline focus-visible:ring-2 focus-visible:ring-ring"
    >
      {entry.site.name}
    </Link>
  );
}

/**
 * The columns of the Activity table.
 *
 * @param logins - the name of each login that has one, by the login's id
 */
export function activityColumns(logins: LoginNames): readonly ColumnSpec<Entry>[] {
  return [
    { id: "when", header: "When", fixed: true, sortable: "desc", cell: (entry) => <When entry={entry} /> },
    { id: "who", header: "Who", cell: (entry) => <Who by={entry.by} logins={logins} /> },
    { id: "what", header: "What", widest: 480, cell: (entry) => <span title={whatOf(entry)}>{whatOf(entry)}</span> },
    { id: "site", header: "Site", cell: (entry) => <SiteThen entry={entry} /> },
  ];
}
