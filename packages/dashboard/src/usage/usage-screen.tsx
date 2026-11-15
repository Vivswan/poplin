// The Usage screen: what the install holds and has answered today, each number beside its limit, with words only once a number nears it, and the way to the setting that holds the limit.

import { showBytes } from "@poplin/core/src/records/settings";
import { Link } from "@tanstack/react-router";
import { cn } from "cn";
import { ArrowUpRightIcon } from "lucide-react";
import { type ReactNode, useMemo } from "react";

import { Progress } from "@/components/ui/progress";
import { showCount } from "@/lib/sites";
import { settingAddress } from "@/settings/setting-address";
import { IconButton } from "@/shared/icon-button";
import { WaitingRows } from "@/shared/waiting-rows";
import { AppShell } from "@/shell/app-shell";
import { type ColumnSpec, DataTable } from "@/table/data-table";
import { useTableLayout } from "@/table/layout";
import { type Line, useUsage } from "@/usage/usage-queries";
import { shareOf } from "@/usage/usage-values";
import { VisitsBlock } from "@/usage/visits-block";

/** What each line counts, in the words of the screen. */
const NAMES: Readonly<Record<Line["what"], string>> = {
  stored: "Storage",
  sites: "Sites",
  trashed: "In the trash",
  files: "Files",
  requests: "Requests today",
};

/** The order of the lines: the server's, which no heading changes. */
const AS_GIVEN = { key: "", descending: false } as const;

function amount(line: Line, value: number): string {
  return line.what === "stored" ? showBytes(value) : showCount(value);
}

/** How much of its limit a line has used: a thin bar, the percent, and words from near the limit on. Nothing for a line without a limit. */
function ShareCell({ line }: { readonly line: Line }): ReactNode {
  const share = shareOf(line.used, line.limit);
  if (share === undefined) return null;

  const loud = share.state !== "fine";

  return (
    <span className="flex items-center gap-3">
      <Progress
        value={Math.min(share.percent, 100)}
        aria-label={`${NAMES[line.what]}: share of the limit`}
        className={cn("w-40 shrink-0", loud && "**:data-[slot=progress-indicator]:bg-warn")}
      />
      <span className="w-10 shrink-0 text-right text-muted-foreground tabular-nums">{share.percent}%</span>
      {share.words === null ? null : <span className="truncate font-medium text-warn">{share.words}</span>}
    </span>
  );
}

/** The columns of the Usage table. */
function usageColumns(): readonly ColumnSpec<Line>[] {
  return [
    { id: "what", header: "What", fixed: true, cell: (line) => NAMES[line.what] },
    { id: "used", header: "Used", numeric: true, cell: (line) => <span className="tabular-nums">{amount(line, line.used)}</span> },
    {
      id: "limit",
      header: "Limit",
      numeric: true,
      cell: (line) => <span className="text-muted-foreground tabular-nums">{line.limit === null ? "No limit" : amount(line, line.limit)}</span>,
    },
    { id: "share", header: "Share of the limit", grows: true, cell: (line) => <ShareCell line={line} /> },
  ];
}

/** The way from a line to the setting that holds its limit, also where that setting sets none; nothing for a line no setting bounds. */
function LimitLink({ line }: { readonly line: Line }): ReactNode {
  if (line.setting === null) return null;

  return (
    <IconButton label="Change this limit" link={<Link {...settingAddress(line.setting)} />}>
      <ArrowUpRightIcon />
    </IconButton>
  );
}

/** The lines on a phone: the name over the number and its limit, and the share under them. */
function PhoneList({ lines }: { readonly lines: readonly Line[] }): ReactNode {
  return (
    <ul aria-label="Usage" className="border-t md:hidden">
      {lines.map((line) => (
        <li key={line.what} className="flex min-h-16 flex-col justify-center gap-1 border-b px-4 py-2">
          <span className="flex items-center gap-2">
            <span className="min-w-0 flex-1 truncate">{NAMES[line.what]}</span>
            <span className="shrink-0 tabular-nums">{amount(line, line.used)}</span>
            <span className="shrink-0 text-xs text-muted-foreground tabular-nums">{line.limit === null ? "No limit" : `of ${amount(line, line.limit)}`}</span>
            <span className="flex w-10 shrink-0 justify-end">
              <LimitLink line={line} />
            </span>
          </span>
          <ShareCell line={line} />
        </li>
      ))}
    </ul>
  );
}

/** Draw the Usage screen. */
export function UsageScreen(): ReactNode {
  const { data: usage, error } = useUsage();
  const columns = useMemo(usageColumns, []);
  const layout = useTableLayout("usage", columns);

  return (
    <AppShell current="usage" heading="Usage">
      <section aria-label="Usage" className="line-room flex min-h-0 min-w-0 flex-1 flex-col overflow-y-auto">
        <VisitsBlock />
        {error === null ? null : <p className="px-6 py-8 text-muted-foreground max-md:px-4">{error.message}</p>}
        {usage === undefined && error === null ? <WaitingRows /> : null}
        {usage === undefined ? null : (
          <>
            <div className="shrink-0 max-md:hidden">
              <DataTable
                label="Usage"
                columns={columns}
                rows={usage.lines}
                rowId={(line) => line.what}
                layout={layout}
                sort={AS_GIVEN}
                actions={(line) => <LimitLink line={line} />}
              />
            </div>
            <PhoneList lines={usage.lines} />
          </>
        )}
      </section>
    </AppShell>
  );
}
