// The Problems block of the Usage screen: what went wrong in the last days, every kind on its day as one row, whichever screen it is acted on. A press on a row opens its panel.

import { Link, useNavigate } from "@tanstack/react-router";
import { ArrowUpRightIcon } from "lucide-react";
import { type ReactNode, useMemo } from "react";

import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { searchOf, useAddressQuery } from "@/lib/address";
import { FOCUS_HOME } from "@/lib/focus";
import { momentIn, useChosenTimeZone } from "@/lib/timezone";
import { HOMES, howOften, PROBLEM_KEY, problemId } from "@/problems/problem-words";
import { DAYS_KEY, type Problem, RANGES, type Range, useProblems, useRange } from "@/problems/problems-queries";
import { settingAddress } from "@/settings/setting-address";
import { IconButton } from "@/shared/icon-button";
import { WaitingRows } from "@/shared/waiting-rows";
import { type ColumnSpec, DataTable } from "@/table/data-table";
import { useTableLayout } from "@/table/layout";

/** The order of the rows: the server's, the newest first, which no heading changes. */
const AS_GIVEN = { key: "", descending: false } as const;

/** The stretch as the empty block names it. */
const IN_WORDS: Readonly<Record<Range, string>> = { "7": "the last 7 days", "30": "the last 30 days" };

/** An address of the Usage screen, as a link or a move takes it. */
interface UsageAddress {
  readonly to: typeof HOMES.usage.to;
  readonly search: Record<string, string>;
}

/** Where a problem is acted on, as a link to that screen. Nothing for a problem acted on here. */
function Where({ problem }: { readonly problem: Problem }): ReactNode {
  if (problem.home === "usage") return null;

  return (
    <Link to={HOMES[problem.home].to} className="relative text-link underline-offset-2 hover:underline">
      {HOMES[problem.home].label}
    </Link>
  );
}

/** The columns of the block's table. */
function problemColumns(): readonly ColumnSpec<Problem>[] {
  return [
    { id: "what", header: "What", fixed: true, grows: true, cell: (problem) => problem.sentence },
    { id: "last", header: "Last", cell: (problem) => <span className="text-muted-foreground tabular-nums">{momentIn(problem.last_at)}</span> },
    { id: "often", header: "How often", cell: (problem) => howOften(problem) },
    { id: "where", header: "Where", cell: (problem) => <Where problem={problem} /> },
  ];
}

/** The way from a limit that was reached to the setting that holds it; nothing for any other problem. */
function LimitLink({ problem }: { readonly problem: Problem }): ReactNode {
  if (problem.setting === null) return null;

  return (
    <IconButton label="Change this limit" link={<Link {...settingAddress(problem.setting)} />}>
      <ArrowUpRightIcon />
    </IconButton>
  );
}

/** The choice of the stretch of days. It takes the focus of a panel that closes with nothing left to give it back to. */
function RangeSelect({ range, onChoose }: { readonly range: Range; readonly onChoose: (range: Range) => void }): ReactNode {
  return (
    <Select items={RANGES} value={range} onValueChange={(value) => onChoose(value as Range)}>
      <SelectTrigger aria-label="Days of problems shown" className="w-36" {...FOCUS_HOME}>
        <SelectValue />
      </SelectTrigger>
      <SelectContent alignItemWithTrigger={false} align="end">
        <SelectGroup>
          {RANGES.map((entry) => (
            <SelectItem key={entry.value} value={entry.value}>
              {entry.label}
            </SelectItem>
          ))}
        </SelectGroup>
      </SelectContent>
    </Select>
  );
}

/** The problems on a phone: the sentence over when it came last and how often, the whole row the way to its panel. */
function PhoneList({
  problems,
  opened,
  toProblem,
}: {
  readonly problems: readonly Problem[];
  readonly opened: string | undefined;
  readonly toProblem: (problem: Problem) => UsageAddress;
}): ReactNode {
  return (
    <ul aria-label="Problems" className="border-t md:hidden">
      {problems.map((problem) => (
        <li
          key={problemId(problem)}
          data-state={problemId(problem) === opened ? "selected" : undefined}
          className="relative border-b data-[state=selected]:bg-chosen"
        >
          <Link
            {...toProblem(problem)}
            className="flex min-h-16 flex-col justify-center gap-0.5 px-4 py-2 outline-none focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring"
          >
            <span className="truncate">{problem.sentence}</span>
            <span className="text-xs text-muted-foreground tabular-nums">
              {momentIn(problem.last_at)}, {howOften(problem)}
              {problem.home === "usage" ? "" : `, ${HOMES[problem.home].label}`}
            </span>
          </Link>
        </li>
      ))}
    </ul>
  );
}

/** Draw the block: its heading, the choice of days, and the rows, or the line that says there are none. */
export function ProblemsBlock(): ReactNode {
  useChosenTimeZone();
  const query = useAddressQuery();
  const range = useRange();
  const navigate = useNavigate();
  const { data, error } = useProblems(range);
  const columns = useMemo(problemColumns, []);
  const layout = useTableLayout("problems", columns);
  const opened = query.get(PROBLEM_KEY) ?? undefined;
  const address = (changes: Readonly<Record<string, string | undefined>>): UsageAddress => {
    const next = new URLSearchParams(query);
    for (const [key, value] of Object.entries(changes)) {
      if (value === undefined) next.delete(key);
      else next.set(key, value);
    }

    return { to: HOMES.usage.to, search: searchOf(next) };
  };
  // A second press on the open row closes its panel, as it does in every list.
  const toProblem = (problem: Problem): UsageAddress =>
    address({ [PROBLEM_KEY]: problemId(problem) === opened ? undefined : problemId(problem) });
  const problems = data?.problems;

  return (
    <section aria-labelledby="problems-heading" className="flex shrink-0 flex-col pt-6">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2 px-6 pb-3 max-md:px-4">
        <h2 id="problems-heading" className="text-sm font-medium">
          Problems
        </h2>
        <div className="ml-auto">
          <RangeSelect
            range={range}
            onChoose={(days) => void navigate(address({ [DAYS_KEY]: days === RANGES[0].value ? undefined : days, [PROBLEM_KEY]: undefined }))}
          />
        </div>
      </div>
      {error === null ? null : <p className="px-6 pb-6 text-sm text-muted-foreground max-md:px-4">{error.message}</p>}
      {problems === undefined && error === null ? <WaitingRows /> : null}
      {problems?.length === 0 ? <p className="px-6 pb-6 text-sm text-muted-foreground max-md:px-4">No problems in {IN_WORDS[range]}.</p> : null}
      {problems === undefined || problems.length === 0 ? null : (
        <>
          <div className="shrink-0 max-md:hidden">
            <DataTable
              label="Problems"
              columns={columns}
              rows={problems}
              rowId={problemId}
              layout={layout}
              sort={AS_GIVEN}
              selected={opened}
              onOpen={(problem) => void navigate(toProblem(problem))}
              actions={(problem) => <LimitLink problem={problem} />}
            />
          </div>
          <PhoneList problems={problems} opened={opened} toProblem={toProblem} />
        </>
      )}
    </section>
  );
}
