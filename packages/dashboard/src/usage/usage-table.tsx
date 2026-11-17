// The table of the Usage screen: each number beside its limit, with words only once a number nears it, the way to the setting that holds the limit, and the way to the host's own page of the number.
//
// A number the install counted itself reads "about", since its count can read low. What the account holds reads "at most", since the host's figure of it can read high.
// Once the host gave its own figures, the line over the table says when, and how far behind they run.
// A figure the host gave none of reads "Not read". The processing time stands beside a limit that stops nothing by itself, so above it the line says "Slow" beside a quiet sign with a hint, and never the words of a limit passed.
// A day's number is of a UTC day: its line says "today" where that is the reader's date too, and names the day where it is not.

import { showBytes } from "@poplin/core/src/records/settings";
import { useMediaQuery } from "@base-ui/react/unstable-use-media-query";
import { Link } from "@tanstack/react-router";
import { cn } from "cn";
import { ArrowUpRightIcon, ExternalLinkIcon, TriangleAlertIcon } from "lucide-react";
import { type ReactNode, useMemo } from "react";

import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { httpsLink } from "@/lib/https-link";
import { IN_BROWSER, ROOMY } from "@/lib/media";
import { showCount } from "@/lib/sites";
import { momentIn, useChosenTimeZone, useTimeZoneChoice } from "@/lib/timezone";
import { settingAddress } from "@/settings/setting-address";
import { IconButton } from "@/shared/icon-button";
import { type ColumnSpec, DataTable } from "@/table/data-table";
import type { Line, Usage } from "@/usage/usage-queries";
import { spansOf } from "@/usage/usage-spans";
import { raisedBytes, shareOf } from "@/usage/usage-values";

/** What each line counts, in the words of the screen. A line counted over a day or a month says which after them. */
const NAMES: Readonly<Record<Line["what"], string>> = {
  stored: "Storage, all sites",
  host_stored: "Account storage, last 24 hours",
  database_size: "Database size",
  host_database_size: "Account database size",
  sites: "Sites, the trash included",
  trashed: "In the trash",
  files: "Files",
  host_files: "Account files stored",
  host_uploads: "Uploads left unfinished",
  requests: "Requests",
  host_requests: "Account requests",
  host_errors: "Account errors",
  host_stopped: "Requests stopped by a limit",
  host_slowest: "Processing time, slowest 1 in 100,",
  rows_read: "Database rows read",
  rows_written: "Database rows written",
  storage_writes: "Storage writes",
  storage_reads: "Storage reads",
  jobs_started: "Background jobs started",
  jobs_done: "Background jobs done",
  jobs_failed: "Background jobs failed",
  jobs_running: "Background jobs running now",
};

/** The lines counted over a UTC day, and those counted from the first day of a UTC month. */
const OVER: Readonly<Partial<Record<Line["what"], "day" | "month">>> = {
  requests: "day",
  host_requests: "day",
  host_errors: "day",
  host_stopped: "day",
  host_slowest: "day",
  rows_read: "day",
  rows_written: "day",
  storage_writes: "month",
  storage_reads: "month",
  jobs_started: "day",
  jobs_done: "day",
  jobs_failed: "day",
};

/** The lines counted in bytes. */
const IN_BYTES: ReadonlySet<Line["what"]> = new Set(["stored", "host_stored", "database_size", "host_database_size"]);

/** The lines counted in milliseconds. */
const IN_MILLISECONDS: ReadonlySet<Line["what"]> = new Set(["host_slowest"]);

/** The lines whose number the account never passed and may not have reached: the host's figure adds up the most each part of the account held, and the parts need not have held that at one time. */
const AT_MOST: ReadonlySet<Line["what"]> = new Set(["host_stored", "host_database_size", "host_files", "host_uploads"]);

/** The lines whose limit stops nothing by itself: a number above it is a sign to look, never a limit passed. */
const GUIDES: ReadonlySet<Line["what"]> = new Set(["host_slowest"]);

/** What a line above its guide says, in the look of a number near its limit. */
const SLOW = "Slow";

/** What the line over the table says of the lines named "Account", after when the host's figures were read. */
const ACCOUNT_LINES = '"Account" lines count the whole account, not only poplin.';

/** The look of a way in words that a line of a phone ends in: to the setting of its limit, and to the host's page. */
const WORD_LINK = "h-auto gap-1 border-0 px-0 text-[13px] font-normal text-link underline-offset-2";

/** What a line says in place of a number the host gave none of. */
const NOT_READ = "Not read";

/** A minute in milliseconds. */
const MINUTE_MS = 60_000;

/** What the line over the table ends with when the host gave no figures: the numbers under it are then the install's own. */
const OWN_COUNT = "The numbers here are poplin's own count.";

/** What gives an install a new key, said after a key that works no more or lacks a right. */
const NEW_KEY = "Open Domain and press Repair: it makes a new key.";

/** The width of the last column, wide enough for a row's two icons, in pixels. */
const ACTIONS_WIDTH = 88;

/** The width of a share's bar: in the table, and in the list of a narrow screen, where a long limit beside it makes it shorter. */
const BARS = { table: "w-40 shrink-0", list: "w-20 min-w-8 shrink" } as const;

/** The widest the column of names is drawn for the names' sake, in pixels: room for the longest name with a day in it. */
const WIDEST_NAME = 400;

/** The least room a line's name keeps where the columns need more than the table has: the end of a longer name is then cut, with dots. */
const LEAST_NAME = "12rem";

/** The order of the lines: the server's, which no heading changes. */
const AS_GIVEN = { key: "", descending: false } as const;

function amount(line: Line, value: number): string {
  if (IN_BYTES.has(line.what)) return showBytes(value);

  return IN_MILLISECONDS.has(line.what) ? `${showCount(value)} ms` : showCount(value);
}

/** What a line has used: the number, "about" before one the install counted itself, and "at most" before one the account never passed. A number the host gave none of says so. */
function used(line: Line): string {
  if (line.used === null) return NOT_READ;

  if (AT_MOST.has(line.what)) return `at most ${amount(line, IN_BYTES.has(line.what) ? raisedBytes(line.used) : line.used)}`;

  return line.about ? `about ${amount(line, line.used)}` : amount(line, line.used);
}

/** What a number above a guide says: who stops a request, and the line that counts the stopped ones. Nothing for any other line, and for a number at or under its guide. */
function guideHint(line: Line, host: string): string | undefined {
  if (!GUIDES.has(line.what) || line.used === null || line.limit === null || line.used <= line.limit) return undefined;

  return `Requests are stopped only when ${host} says so: see ${NAMES.host_stopped}.`;
}

/** What a line is called on the screen, by what it counts. */
type Names = (what: Line["what"]) => string;

/** A line of the screen with what it is called there. */
interface Named {
  readonly line: Line;
  readonly name: string;
}

/** A named line with the name of the host whose figures and pages it shows. */
interface Hosted extends Named {
  readonly host: string;
}

/** What every line is called on the screen: what it counts, then the day or the month it is counted over, in the words given. */
function namesOf(spans: ReturnType<typeof spansOf>): Names {
  return (what) => {
    const over = OVER[what];

    return over === undefined ? NAMES[what] : `${NAMES[what]} ${spans[over]}`;
  };
}

/** What a number above its guide shows: a quiet sign, a button whose hint a pointer and the keyboard are shown and whose press does nothing, and the word beside it. Nothing for a line that has no such hint. */
function GuideSign({ line, name, host }: Hosted): ReactNode {
  const hint = guideHint(line, host);
  if (hint === undefined) return null;

  return (
    <span className="flex items-center gap-1">
      <IconButton label={hint} name={`${name}: ${hint}`} className="text-warn hover:text-warn">
        <TriangleAlertIcon />
      </IconButton>
      <span className="font-medium text-warn">{SLOW}</span>
    </span>
  );
}

/** A number above its guide on a phone, which has no pointer to show a hint to: the word, and the hint in words on a line of its own, under the limit. */
function GuideWords({ line, host }: Pick<Hosted, "line" | "host">): ReactNode {
  const hint = guideHint(line, host);

  return hint === undefined ? null : (
    <span className="flex flex-col gap-0.5 text-[13px]">
      <span className="font-medium text-warn">{SLOW}</span>
      <span className="text-muted-foreground">{hint}</span>
    </span>
  );
}

/** How much of its limit a line has used: a thin bar where there is room for one, the percent, and words from near the limit on. Nothing for a line without a limit or without a number, and for a guide the sign alone. */
function ShareCell({ line, name, host, bar }: Hosted & { readonly bar: keyof typeof BARS | null }): ReactNode {
  if (GUIDES.has(line.what)) return <GuideSign line={line} name={name} host={host} />;

  const share = line.used === null ? undefined : shareOf(line.used, line.limit);
  if (share === undefined) return null;

  const loud = share.state !== "fine";

  return (
    <span className="flex items-center gap-3">
      {bar === null ? null : <Progress value={Math.min(share.percent, 100)} aria-label={`${name}: share of the limit`} className={cn(BARS[bar], loud && "**:data-[slot=progress-indicator]:bg-warn")} />}
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
function RowLinks({ line, name, host }: Hosted): ReactNode {
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

/** Where a line of a phone leads, in words, since a phone has no pointer to show a hint to: the setting that holds its limit, then the host's own page of its number, side by side and in one look. Nothing for a line that leads nowhere. */
function WordLinks({ line, name, host }: Hosted): ReactNode {
  const link = hostPage(line);
  if (link === undefined && line.setting === null) return null;

  return (
    <span className="flex flex-wrap items-center gap-x-5">
      {line.setting === null ? null : (
        <Button variant="link" nativeButton={false} render={<Link {...settingAddress(line.setting)} aria-label={`Change the limit of ${name}`} />} className={WORD_LINK}>
          Change the limit
        </Button>
      )}
      {link === undefined ? null : (
        <Button variant="link" nativeButton={false} render={<a href={link} target="_blank" rel="noreferrer" aria-label={hostLinkName(name, host)} />} className={WORD_LINK}>
          See it at {host}
          <ExternalLinkIcon aria-hidden className="size-3.5" />
        </Button>
      )}
    </span>
  );
}

/** The columns of the Usage table. */
function usageColumns(names: Names, host: string, bar: boolean): readonly ColumnSpec<Line>[] {
  return [
    {
      id: "what",
      header: "What",
      fixed: true,
      widest: WIDEST_NAME,
      // A name cut short draws its dots itself, so the cell around it never overflows and gives no hint of its own: the name carries its whole text as its hint.
      cell: (line) => (
        <span data-gives title={names(line.what)} className="block truncate" style={{ minWidth: LEAST_NAME }}>
          {names(line.what)}
        </span>
      ),
    },
    { id: "used", header: "Used", numeric: true, cell: (line) => <span className="tabular-nums">{used(line)}</span> },
    {
      id: "limit",
      header: "Limit",
      numeric: true,
      cell: (line) => <span className="text-muted-foreground tabular-nums">{line.limit === null ? "No limit" : amount(line, line.limit)}</span>,
    },
    { id: "share", header: "Share of the limit", grows: true, cell: (line) => <ShareCell line={line} name={names(line.what)} host={host} bar={bar ? "table" : null} /> },
  ];
}

/** The lines where the table has no room: the name beside the number, under them the share beside the limit, and last where the line leads, in words. Every number ends at one edge, and every limit ends under it. */
function NarrowList({ usage, names }: { readonly usage: Usage; readonly names: Names }): ReactNode {
  const named = usage.lines.map((line) => ({ line, name: names(line.what) }));

  return (
    <ul aria-label="Usage" className="border-t lg:hidden">
      {named.map(({ line, name }) => (
        <li key={line.what} className="flex min-h-16 flex-col justify-center gap-1 border-b px-4 py-2 md:px-6">
          <span className="flex items-center gap-2">
            <span className="min-w-0 flex-1">{name}</span>
            <span className="shrink-0 tabular-nums">{used(line)}</span>
          </span>
          {/* The limit is read right after its number, and drawn at the end of the row under it. */}
          <span className="flex flex-row-reverse items-start gap-2">
            <span className="shrink-0 text-xs leading-5 text-muted-foreground tabular-nums">{line.limit === null ? "No limit" : `of ${amount(line, line.limit)}`}</span>
            <span className="flex min-w-0 flex-1 flex-col">{GUIDES.has(line.what) ? null : <ShareCell line={line} name={name} host={usage.host} bar="list" />}</span>
          </span>
          {GUIDES.has(line.what) ? <GuideWords line={line} host={usage.host} /> : null}
          <WordLinks line={line} name={name} host={usage.host} />
        </li>
      ))}
    </ul>
  );
}

/** What the line over the table adds of figures that run behind the moment: by about how many minutes. Nothing where the host names no such time. */
function behindWords(behind: number | null): string {
  return behind === null ? "" : ` They run about ${showCount(Math.round(behind / MINUTE_MS))} minutes behind.`;
}

/** What the line over the table says: when the host's own figures were read, or why the install's key gave none. */
function officialWords(official: NonNullable<Usage["official"]>, host: string): string {
  // A host may be named by a plain word, which starts both sentences.
  const first = `${host.slice(0, 1).toUpperCase()}${host.slice(1)}`;
  if ("at" in official) return `${first}'s own figures, as of ${momentIn(official.at)}.${behindWords(official.behind)} ${ACCOUNT_LINES}`;

  if (official.refusal === "unreachable") return `${first} did not answer. ${OWN_COUNT}`;

  if (official.refusal === "key_refused") return `The install's key no longer works. ${NEW_KEY} ${OWN_COUNT}`;

  const lacks = `The install's key has no permission to read usage${official.right === null ? "" : `: ${official.right}`}.`;

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
  // A screen too narrow for the bars draws none in the table: the columns are then other ones, which the table measures anew.
  const roomy = useMediaQuery(ROOMY, IN_BROWSER);
  const columns = useMemo(() => usageColumns(names, usage.host, roomy), [names, usage.host, roomy]);

  return (
    <>
      <OfficialLine usage={usage} />
      <div className="shrink-0 max-lg:hidden">
        <DataTable label="Usage" columns={columns} rows={usage.lines} rowId={(line) => line.what} sort={AS_GIVEN} actions={(line) => <RowLinks line={line} name={names(line.what)} host={usage.host} />} actionsWidth={ACTIONS_WIDTH} />
      </div>
      <NarrowList usage={usage} names={names} />
    </>
  );
}
