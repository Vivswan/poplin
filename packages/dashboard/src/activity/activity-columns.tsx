// How an entry of the log is drawn in the table: when, who, what, and the site it was done to.

import { Link } from "@tanstack/react-router";
import type { ReactNode } from "react";

import type { Entry } from "@/activity/activity-queries";
import { shownName, wholeMoment } from "@/lib/sites";
import { type TimeZoneChoice, unnamedMomentIn } from "@/lib/timezone";
import { type LoginNames, Who } from "@/shared/who";
import type { ColumnSpec } from "@/table/data-table";

/** The least room what was done is cut down to: its first words. */
const LEAST_WHAT = "16ch";

/**
 * When an entry was written, to the minute, in the time zone a person chose.
 *
 * @param headed - `true` under a heading that names the time zone: the time then does not name it again
 */
export function When({ entry, headed = false }: { readonly entry: Entry; readonly headed?: boolean }): ReactNode {
  return (
    <time dateTime={new Date(entry.at).toISOString()} title={wholeMoment(entry.at)} className="text-muted-foreground tabular-nums">
      {headed ? unnamedMomentIn(entry.at) : wholeMoment(entry.at)}
    </time>
  );
}

/**
 * The site an entry is about: a link to the site while it is one, plain words once it is gone.
 *
 * It is called as the Sites list calls it, by the title it has now, and by the name it had then where it has none or is gone. The name it had then is what a pointer resting on it reads.
 */
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
      className="rounded-sm py-0.5 text-link underline-offset-2 outline-none hover:underline focus-visible:ring-2 focus-visible:ring-ring"
    >
      {shownName(entry.site)}
    </Link>
  );
}

/** What an entry says was done. Its end gives where the table is narrow, so the table stays as wide as its room: a pointer resting on it reads it whole. */
function WhatThen({ entry }: { readonly entry: Entry }): ReactNode {
  return (
    <span data-gives title={entry.what} className="block truncate" style={{ minWidth: LEAST_WHAT }}>
      {entry.what}
    </span>
  );
}

/**
 * The columns of the Activity table.
 *
 * @param logins - the name of each login that has one, by the login's id
 * @param timeZone - the time zone the times are written in: UTC is named once, in the heading of the times
 */
export function activityColumns(logins: LoginNames, timeZone: TimeZoneChoice): readonly ColumnSpec<Entry>[] {
  return [
    { id: "when", header: timeZone === "utc" ? "When (UTC)" : "When", fixed: true, sortable: "desc", cell: (entry) => <When entry={entry} headed /> },
    { id: "who", header: "Who", cell: (entry) => <Who by={entry.by} logins={logins} unnamed="a token" /> },
    { id: "what", header: "What", widest: 480, cell: (entry) => <WhatThen entry={entry} /> },
    { id: "site", header: "Site", grows: true, cell: (entry) => <SiteThen entry={entry} /> },
  ];
}
