// The Visits block of the Usage screen: how often pages were opened over a stretch of days, all sites together and up to five picked sites beside them. The sum of all sites always stands in the heading.

import { showViews } from "@poplin/core/src/records/views";
import { cn } from "cn";
import { type ReactNode, useEffect } from "react";

import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Toggle } from "@/components/ui/toggle";
import { showCount } from "@/lib/sites";
import { LineSample, type Series, stepWords, VisitsChart } from "@/usage/visits-chart";
import { VisitsPicker } from "@/usage/visits-picker";
import { type Choice, RANGES, type Range, useChoice, useVisits, type Visits } from "@/usage/visits-queries";

/** The line that counts all sites together: in the colour of the text, and wider than a site's. */
const ALL = { key: "all", name: "All sites", color: "var(--foreground)", width: 2.5 } as const;

/** How wide a picked site's line is drawn, in pixels. */
const SITE_WIDTH = 2;

/** The colour and the dashes of a picked site's line, by the place it keeps while it is picked. Each differs from the others, and from the whole line of all sites, without its colour. */
const LOOKS: readonly { readonly color: string; readonly dashes: string }[] = [
  { color: "var(--chart-1)", dashes: "1 4 1 4 9 4" },
  { color: "var(--chart-2)", dashes: "7 5" },
  { color: "var(--chart-3)", dashes: "1 5" },
  { color: "var(--chart-4)", dashes: "12 5 1 5" },
  { color: "var(--chart-5)", dashes: "3 4" },
];

/** Below this a sum says too little to name a number. */
const FEWEST_NAMED = 10;

/** A line with the sum of its days. */
interface Counted extends Series {
  readonly total: number;
}

/** The lines of an answer: all sites first, then each picked site the server still knows, under the title it was picked with. */
function linesOf(visits: Visits, choice: Choice): readonly Counted[] {
  const sites = visits.sites.flatMap((site) => {
    const picked = choice.sites.find((one) => one.id === site.id);
    const look = LOOKS[picked?.slot ?? 0];

    return picked === undefined || look === undefined ? [] : [{ key: site.id, name: picked.title, ...look, width: SITE_WIDTH, counts: site.counts, total: site.total }];
  });

  return [{ ...ALL, counts: visits.all.counts, total: visits.all.total }, ...sites];
}

/** The lines that are drawn: the ones not switched off, and every line where all would be off. */
function shownOf(lines: readonly Counted[], hidden: readonly string[]): readonly Counted[] {
  const shown = lines.filter((line) => !hidden.includes(line.key));

  return shown.length === 0 ? lines : shown;
}

/** Word a sum, never as an exact number: about 1,200, or under 10. */
function showSum(total: number): string {
  return total < FEWEST_NAMED ? `under ${FEWEST_NAMED}` : showViews(total);
}

/** The words of the stretch an answer spans. */
function rangeWords(days: number): string {
  return RANGES.find((entry) => Number(entry.value) === days)?.label ?? `${days} days`;
}

/** What the legend is drawn from. */
interface LegendProps {
  /** Every line. */
  readonly lines: readonly Counted[];

  /** The lines that are drawn. */
  readonly shown: readonly Counted[];

  /** Switches a line on or off, by its key. */
  readonly onSwitch: (key: string, on: boolean) => void;
}

/** The names of the lines under the graph, each a switch beside a piece of its line and the sum of its days. The last line drawn cannot be switched off. */
function Legend({ lines, shown, onSwitch }: LegendProps): ReactNode {
  return (
    <ul aria-label="Lines" className="-mx-1.5 flex flex-wrap gap-x-2 gap-y-1">
      {lines.map((line) => {
        const on = shown.includes(line);

        return (
          <li key={line.key} className="min-w-0">
            <Toggle
              size="sm"
              pressed={on}
              disabled={on && shown.length === 1}
              onPressedChange={(pressed) => onSwitch(line.key, pressed)}
              className={cn("max-w-full gap-2 px-1.5 text-xs font-normal aria-pressed:bg-transparent aria-pressed:hover:bg-muted disabled:opacity-100", !on && "opacity-70")}
            >
              <LineSample line={line} />
              <span className="min-w-0 max-w-48 truncate">{line.name}</span>
              <span className="shrink-0 text-muted-foreground tabular-nums">{showSum(line.total)}</span>
            </Toggle>
          </li>
        );
      })}
    </ul>
  );
}

/** The same numbers as the graph, for a screen reader: a row a step, a column a line that is drawn. */
function NumbersTable({ visits, lines }: { readonly visits: Visits; readonly lines: readonly Counted[] }): ReactNode {
  return (
    <table className="sr-only">
      <caption>Visits by {visits.by}</caption>
      <thead>
        <tr>
          <th scope="col">{visits.by === "week" ? "Week" : "Day"}</th>
          {lines.map((line) => (
            <th key={line.key} scope="col">
              {line.name}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {visits.days.map((day, at) => (
          <tr key={day}>
            <th scope="row">{stepWords(day, visits.by)}</th>
            {lines.map((line) => (
              <td key={line.key}>{showCount(line.counts[at] ?? 0)}</td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  );
}

/** The stretch of days the graph spans. */
function RangeSelect({ range, onChoose }: { readonly range: Range; readonly onChoose: (range: Range) => void }): ReactNode {
  return (
    <Select items={RANGES} value={range} onValueChange={(value) => onChoose(value as Range)}>
      <SelectTrigger aria-label="Days shown" className="w-28">
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

/** The graph of an answer, the switches of its lines once a site is picked, and the table of the same numbers. */
function Graph({ visits, choice, onChoose }: { readonly visits: Visits; readonly choice: Choice; readonly onChoose: (choice: Choice) => void }): ReactNode {
  const lines = linesOf(visits, choice);
  const shown = shownOf(lines, choice.hidden);
  const shownKeys = shown.map((line) => line.key);

  function switchLine(key: string, on: boolean): void {
    const drawn = on ? [...shownKeys, key] : shownKeys.filter((one) => one !== key);
    onChoose({ ...choice, hidden: lines.map((line) => line.key).filter((one) => !drawn.includes(one)) });
  }

  return (
    <>
      <VisitsChart key={`${visits.by} ${visits.days.length}`} days={visits.days} by={visits.by} series={shown} />
      {lines.length > 1 ? <Legend lines={lines} shown={shown} onSwitch={switchLine} /> : null}
      <p className="text-xs text-muted-foreground">Estimates, counted by UTC day.</p>
      <NumbersTable visits={visits} lines={shown} />
    </>
  );
}

/** Draw the block: its heading with the sum of all sites, the two choices, and the graph or the line that stands for it. */
export function VisitsBlock(): ReactNode {
  const [choice, setChoice] = useChoice();
  const { data: visits, error, isPlaceholderData: ofChoiceBefore } = useVisits(choice);
  const counted = visits !== undefined && visits.all.total > 0;

  // A picked site the server no longer knows is dropped from the kept choice, once the answer is the one to this choice.
  useEffect(() => {
    if (visits === undefined || ofChoiceBefore) return;

    const known = choice.sites.filter((site) => visits.sites.some((one) => one.id === site.id));
    if (known.length < choice.sites.length) setChoice({ ...choice, sites: known });
  }, [visits, ofChoiceBefore, choice, setChoice]);

  return (
    <section aria-labelledby="visits-heading" className="flex shrink-0 flex-col gap-3 px-6 pb-6 max-md:px-4">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <h2 id="visits-heading" className="text-sm font-medium">
          Visits
        </h2>
        {counted ? (
          <p className="text-sm text-muted-foreground">
            <span className="text-foreground tabular-nums">{showSum(visits.all.total)}</span> in {rangeWords(visits.range)}
          </p>
        ) : null}
        <div className="ml-auto flex items-center gap-2">
          <VisitsPicker picked={choice.sites} onPick={(sites) => setChoice({ ...choice, sites, hidden: choice.hidden.filter((key) => key === ALL.key || sites.some((site) => site.id === key)) })} />
          <RangeSelect range={choice.range} onChoose={(range) => setChoice({ ...choice, range })} />
        </div>
      </div>
      {error === null ? null : <p className="py-6 text-sm text-muted-foreground">{error.message}</p>}
      {visits === undefined && error === null ? <Skeleton aria-busy="true" className="h-[220px] w-full" /> : null}
      {visits !== undefined && !counted ? <p className="py-6 text-sm text-muted-foreground">No visits yet.</p> : null}
      {counted ? <Graph visits={visits} choice={choice} onChoose={setChoice} /> : null}
    </section>
  );
}
