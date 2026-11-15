// How an entry of the log is drawn in the table: when, who, what, and the site it was done to.

import { Link } from "@tanstack/react-router";
import { KeyRoundIcon } from "lucide-react";
import type { ReactNode } from "react";

import type { Entry } from "@/activity/activity-queries";
import { whatOf } from "@/activity/activity-words";
import { wholeMoment } from "@/lib/sites";
import type { ColumnSpec } from "@/table/data-table";

/** The note of each token that has one, by the token's id. */
type TokenNames = Readonly<Record<string, string>>;

/** When an entry was written, to the minute, in UTC. */
export function When({ entry }: { readonly entry: Entry }): ReactNode {
  return (
    <time dateTime={new Date(entry.at).toISOString()} title={wholeMoment(entry.at)} className="text-muted-foreground tabular-nums">
      {wholeMoment(entry.at)}
    </time>
  );
}

/** Who did it: an admin's email, or a token by the note it was given. A token without a note is shown by its id, small. */
export function Who({ entry, tokenNames }: { readonly entry: Entry; readonly tokenNames: TokenNames }): ReactNode {
  if (entry.by.includes("@")) return <span title={entry.by}>{entry.by}</span>;

  const note = tokenNames[entry.by];

  return (
    <span className="inline-flex max-w-full items-center gap-1.5" title={`Token ${entry.by}`}>
      <KeyRoundIcon className="size-3.5 shrink-0 text-faint" aria-label="Token" />
      {note === undefined ? <span className="truncate font-mono text-xs text-muted-foreground">{entry.by}</span> : <span className="truncate">{note}</span>}
    </span>
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
 * @param tokenNames - the note of each token that has one, by the token's id
 */
export function activityColumns(tokenNames: TokenNames): readonly ColumnSpec<Entry>[] {
  return [
    { id: "when", header: "When", size: 220, minSize: 212, fixed: true, sortable: "desc", cell: (entry) => <When entry={entry} /> },
    { id: "who", header: "Who", size: 280, minSize: 156, cell: (entry) => <Who entry={entry} tokenNames={tokenNames} /> },
    { id: "what", header: "What", size: 380, minSize: 180, grows: true, cell: (entry) => <span title={whatOf(entry)}>{whatOf(entry)}</span> },
    { id: "site", header: "Site", size: 320, minSize: 124, cell: (entry) => <SiteThen entry={entry} /> },
  ];
}
