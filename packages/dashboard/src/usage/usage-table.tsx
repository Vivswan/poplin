// The table of the Usage screen: each number beside its limit, with words only once a number nears it, the way to the setting that holds the limit, and the way to the host's own page of the number.
//
// A number the install counted itself reads "about", since its count can read low. Once the host gave its own figures, the line over the table says when.
// A day's number is of a UTC day: its line says "today" where that is the reader's date too, and names the day where it is not.

import { showBytes } from "@poplin/core/src/records/settings";
import { Link } from "@tanstack/react-router";
import { cn } from "cn";
import { ArrowUpRightIcon, ExternalLinkIcon } from "lucide-react";
import { type ReactNode, useMemo } from "react";

import { Progress } from "@/components/ui/progress";
import { httpsLink } from "@/lib/https-link";
import { showCount } from "@/lib/sites";
import { momentIn, useChosenTimeZone, useTimeZoneChoice } from "@/lib/timezone";
import { settingAddress } from "@/settings/setting-address";
import { IconButton } from "@/shared/icon-button";
import { type ColumnSpec, DataTable } from "@/table/data-table";
import type { Line, Usage } from "@/usage/usage-queries";
import { spansOf } from "@/usage/usage-spans";
import { shareOf } from "@/usage/usage-values";

/** What each line counts, in the words of the screen. A line counted over a day or a month says which after them. */
const NAMES: Readonly<Record<Line["what"], string>> = {
  stored: "Storage, all sites",
  host_stored: "Account storage, highest in 24 hours",
  sites: "Sites, the trash included",
  trashed: "In the trash",
  files: "Files",
  requests: "Requests",
  host_requests: "Account requests",
  rows_read: "Database rows read",
  rows_written: "Database rows written",
  storage_writes: "Storage writes",
  storage_reads: "Storage reads",
};

/** The lines counted over a UTC day, and those over a UTC month. */
const OVER: Readonly<Partial<Record<Line["what"], "day" | "month">>> = {
  requests: "day",
  host_requests: "day",
  rows_read: "day",
  rows_written: "day",
  storage_writes: "month",
  storage_reads: "month",
};

/** The lines counted in bytes. */
const IN_BYTES: ReadonlySet<Line["what"]> = new Set(["stored", "host_stored"]);

/** What the line over the table ends with when the host gave no figures: the numbers under it are then the install's own. */
const OWN_COUNT = "The numbers here are poplin's own count.";

/** What gives an install a new key, said after a key that works no more or lacks a right. */
const NEW_KEY = "Open Domain and press Repair: it makes a new key.";

/** The width of the last column, wide enough for a row's two icons, in pixels. */
const ACTIONS_WIDTH = 88;

/** The order of the lines: the server's, which no heading changes. */
const AS_GIVEN = { key: "", descending: false } as const;

function amount(line: Line, value: number): string {
  return IN_BYTES.has(line.what) ? showBytes(value) : showCount(value);
}

/** What a line has used: the number, and "about" before one the install counted itself. */
function used(line: Line): string {
  return line.about ? `about ${amount(line, line.used)}` : amount(line, line.used);
}

/** What a line is called on the screen, by what it counts. */
type Names = (what: Line["what"]) => string;

/** A line of the screen with what it is called there. */
interface Named {
  readonly line: Line;
  readonly name: string;
}

/** What every line is called on the screen: what it counts, then the day or the month it is counted over, in the words given. */
function namesOf(spans: ReturnType<typeof spansOf>): Names {
  return (what) => {
    const over = OVER[what];

    return over === undefined ? NAMES[what] : `${NAMES[what]} ${spans[over]}`;
  };
}

/** How much of its limit a line has used: a thin bar, the percent, and words from near the limit on. Nothing for a line without a limit. */
function ShareCell({ line, name }: Named): ReactNode {
  const share = shareOf(line.used, line.limit);
  if (share === undefined) return null;

  const loud = share.state !== "fine";

  return (
    <span className="flex items-center gap-3">
      <Progress
        value={Math.min(share.percent, 100)}
        aria-label={`${name}: share of the limit`}
        className={cn("w-20 shrink-0 xl:w-40", loud && "**:data-[slot=progress-indicator]:bg-warn")}
      />
      <span className="w-10 shrink-0 text-right text-muted-foreground tabular-nums">{share.percent}%</span>
      {share.words === null ? null : <span className="truncate font-medium text-warn">{share.words}</span>}
    </span>
  );
}

/** The way from a line to the setting that holds its limit, also where that setting sets none; nothing for a line no setting bounds. */
function LimitLink({ line, name }: Named): ReactNode {
  if (line.setting === null) return null;

  return (
    <IconButton label="Change this limit" name={`Change the limit of ${name}`} link={<Link {...settingAddress(line.setting)} />}>
      <ArrowUpRightIcon />
    </IconButton>
  );
}

/** What a link to the host's page of a line is called: the line first, so a list of the links reads apart. */
function hostLinkName(name: string, host: string): string {
  return `${name}: see it at ${host}`;
}

/** The host's own page of a line's number; none for a line the host has no page of, or whose address is no https link. */
function hostPage(line: Line): string | undefined {
  return line.link === null ? undefined : httpsLink(line.link);
}

/** What a row of the table leads to: the host's own page of its number, in a new tab, then the setting that holds its limit. Whichever a row has, its last icon ends at the row's right edge. */
function RowLinks({ line, name, host }: Named & { readonly host: string }): ReactNode {
  const link = hostPage(line);

  return (
    <span className="flex items-center justify-end gap-1">
      {link === undefined ? null : (
        <IconButton label={hostLinkName(name, host)} link={<a href={link} target="_blank" rel="noreferrer" />}>
          <ExternalLinkIcon />
        </IconButton>
      )}
      <LimitLink line={line} name={name} />
    </span>
  );
}

/** The way from a line to the host's own page of its number, in words, for a phone: it has no pointer to show a hint to. */
function HostLink({ line, name, host }: Named & { readonly host: string }): ReactNode {
  const link = hostPage(line);
  if (link === undefined) return null;

  return (
    <a
      href={link}
      target="_blank"
      rel="noreferrer"
      aria-label={hostLinkName(name, host)}
      className="inline-flex items-center gap-1 self-start text-[13px] whitespace-nowrap text-link underline-offset-2 hover:underline"
    >
      See it at {host}
      <ExternalLinkIcon aria-hidden className="size-3.5" />
    </a>
  );
}

/** The columns of the Usage table. */
function usageColumns(names: Names): readonly ColumnSpec<Line>[] {
  return [
    { id: "what", header: "What", fixed: true, cell: (line) => names(line.what) },
    { id: "used", header: "Used", numeric: true, cell: (line) => <span className="tabular-nums">{used(line)}</span> },
    {
      id: "limit",
      header: "Limit",
      numeric: true,
      cell: (line) => <span className="text-muted-foreground tabular-nums">{line.limit === null ? "No limit" : amount(line, line.limit)}</span>,
    },
    { id: "share", header: "Share of the limit", grows: true, cell: (line) => <ShareCell line={line} name={names(line.what)} /> },
  ];
}

/** The lines on a phone: the name over the number and its limit, the share under them, and the way to the host's page last. */
function PhoneList({ usage, names }: { readonly usage: Usage; readonly names: Names }): ReactNode {
  const named = usage.lines.map((line) => ({ line, name: names(line.what) }));

  return (
    <ul aria-label="Usage" className="border-t md:hidden">
      {named.map(({ line, name }) => (
        <li key={line.what} className="flex min-h-16 flex-col justify-center gap-1 border-b px-4 py-2">
          <span className="flex items-center gap-2">
            <span className="min-w-0 flex-1">{name}</span>
            <span className="shrink-0 tabular-nums">{used(line)}</span>
            <span className="shrink-0 text-xs text-muted-foreground tabular-nums">{line.limit === null ? "No limit" : `of ${amount(line, line.limit)}`}</span>
            <span className="flex w-10 shrink-0 justify-end">
              <LimitLink line={line} name={name} />
            </span>
          </span>
          <ShareCell line={line} name={name} />
          <HostLink line={line} name={name} host={usage.host} />
        </li>
      ))}
    </ul>
  );
}

/** What the line over the table says: when the host's own figures were read, or why the kept key gave none. */
function officialWords(official: NonNullable<Usage["official"]>, host: string): string {
  if ("at" in official) return `${host}'s own figures, as of ${momentIn(official.at)}.`;

  if (official.refusal === "unreachable") return `${host} did not answer. ${OWN_COUNT}`;

  if (official.refusal === "key_refused") return `The kept key no longer works. ${NEW_KEY} ${OWN_COUNT}`;

  const lacks = `The kept key has no right to read usage${official.right === null ? "" : `: ${official.right}`}.`;

  return `${lacks} ${NEW_KEY} ${OWN_COUNT}`;
}

/** The line over the table about the host's own figures. Nothing for an install that keeps no key. */
function OfficialLine({ usage }: { readonly usage: Usage }): ReactNode {
  useChosenTimeZone();
  if (usage.official === null) return null;

  return <p className="shrink-0 px-6 pb-3 text-muted-foreground max-md:px-4">{officialWords(usage.official, usage.host)}</p>;
}

/**
 * Draw the table of the Usage screen.
 *
 * @param usage - the server's answer: the lines, the host's name, and what became of asking the host for its own figures
 * @param read - when the answer was read, in milliseconds since the epoch: a day's line says "today" where the reader's date was the day of its number then
 */
export function UsageTable({ usage, read }: { readonly usage: Usage; readonly read: number }): ReactNode {
  const [choice] = useTimeZoneChoice();
  const { day, month } = spansOf(usage.day, read, choice);
  const names = useMemo(() => namesOf({ day, month }), [day, month]);
  const columns = useMemo(() => usageColumns(names), [names]);

  return (
    <>
      <OfficialLine usage={usage} />
      <div className="shrink-0 max-md:hidden">
        <DataTable label="Usage" columns={columns} rows={usage.lines} rowId={(line) => line.what} sort={AS_GIVEN} actions={(line) => <RowLinks line={line} name={names(line.what)} host={usage.host} />} actionsWidth={ACTIONS_WIDTH} />
      </div>
      <PhoneList usage={usage} names={names} />
    </>
  );
}
