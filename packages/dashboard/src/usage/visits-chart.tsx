// The graph of the Usage screen: one line a series over the days or the weeks, with the numbers of one step beside the pointer, or beside the step the arrow keys moved to.

import { AxisBottom, AxisLeft } from "@visx/axis";
import { localPoint } from "@visx/event";
import { GridRows } from "@visx/grid";
import { Group } from "@visx/group";
import { useParentSize } from "@visx/responsive";
import { scaleLinear } from "@visx/scale";
import { LinePath } from "@visx/shape";
import { TooltipWithBounds } from "@visx/tooltip";
import { type PointerEvent, type ReactNode, useState } from "react";

import { showCount } from "@/lib/sites";

/** How tall the graph is, in pixels. */
const HEIGHT = 220;

/** The room around the plot, in pixels: the left holds the counts, the bottom the days. */
const ROOM = { top: 12, right: 12, bottom: 24, left: 44 };

/** How long a sample of a line is, in pixels: long enough to show the longest pattern of dashes once. */
const SAMPLE_LENGTH = 28;

/** The width the graph is drawn at before its place was measured, in pixels. */
const FIRST_WIDTH = 640;

/** Under this width the days get three marks instead of five, in pixels. */
const NARROW = 480;

/** How a count is written beside the plot: 1.2K. */
const SHORT_COUNT = new Intl.NumberFormat("en", { notation: "compact", maximumFractionDigits: 1 });

/** How a day is written under the plot: 14 Nov. */
const SHORT_DAY = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", timeZone: "UTC" });

/** How a day is written whole: 14 Nov 2026. */
const WHOLE_DAY = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });

/** One line of the graph. */
export interface Series {
  /** What tells the line from the others: a site's id, or `all`. */
  readonly key: string;

  /** The words the line is named with. */
  readonly name: string;

  /** The line's colour, as CSS reads it. */
  readonly color: string;

  /** How wide the line is drawn, in pixels. */
  readonly width: number;

  /** How the line is broken into dashes; a whole line when left out. */
  readonly dashes?: string;

  /** A count for every step. */
  readonly counts: readonly number[];
}

/** What a step of the graph spans. */
export type Step = "day" | "week";

/** What the graph is drawn from. */
interface VisitsChartProps {
  /** The UTC day each step starts on, the earliest first. */
  readonly days: readonly string[];

  /** What a step spans. */
  readonly by: Step;

  /** The lines, the first drawn on top; at least one. */
  readonly series: readonly Series[];
}

/** Where things stand in the plot: its size, and the scales that place a day across it and a count up it. */
interface Plot {
  readonly width: number;
  readonly height: number;
  readonly across: ReturnType<typeof scaleLinear<number>>;
  readonly up: ReturnType<typeof scaleLinear<number>>;
}

function momentOf(day: string | undefined): number {
  return Date.parse(`${day}T00:00:00Z`);
}

/** Write the step that starts on a UTC day: 14 Nov 2026, or Week of 9 Nov 2026. */
export function stepWords(day: string, by: Step): string {
  const written = WHOLE_DAY.format(momentOf(day));

  return by === "week" ? `Week of ${written}` : written;
}

/** The places of the days that get a mark under the plot: the first, the last, and the ones evenly between. */
function markedDays(days: number, marks: number): number[] {
  if (days <= marks) return Array.from({ length: days }, (_day, at) => at);

  return Array.from({ length: marks }, (_mark, at) => Math.round((at * (days - 1)) / (marks - 1)));
}

/** A short piece of a line, as it is drawn in the plot: what names the line beside its words. */
export function LineSample({ line }: { readonly line: Series }): ReactNode {
  return (
    <svg width={SAMPLE_LENGTH} height={6} aria-hidden="true" className="size-auto shrink-0">
      <line x1={1} x2={SAMPLE_LENGTH - 1} y1={3} y2={3} stroke={line.color} strokeWidth={line.width} strokeDasharray={line.dashes} strokeLinecap="round" />
    </svg>
  );
}

/** The counts at the left with a faint line across for each, and the days under the plot. */
function Axes({ plot, days, marks }: { readonly plot: Plot; readonly days: readonly string[]; readonly marks: number[] }): ReactNode {
  const ends: Readonly<Record<number, "start" | "end">> = { 0: "start", [days.length - 1]: "end" };

  return (
    <>
      <GridRows scale={plot.up} width={plot.width} numTicks={4} stroke="var(--border)" />
      <AxisLeft
        scale={plot.up}
        numTicks={4}
        hideAxisLine
        hideTicks
        tickFormat={(count) => SHORT_COUNT.format(Number(count))}
        tickLabelProps={{ fill: "var(--muted-foreground)", fontSize: 11, textAnchor: "end", dx: -4, dy: 4 }}
      />
      <AxisBottom
        scale={plot.across}
        top={plot.height}
        tickValues={marks}
        hideTicks
        stroke="var(--border)"
        tickFormat={(at) => SHORT_DAY.format(momentOf(days[Number(at)]))}
        tickLabelProps={(at) => ({ fill: "var(--muted-foreground)", fontSize: 11, dy: 4, textAnchor: ends[Number(at)] ?? "middle" })}
      />
    </>
  );
}

/** The marked step: a thin line down the plot, and a dot on each line. */
function DayMark({ plot, series, day }: { readonly plot: Plot; readonly series: readonly Series[]; readonly day: number }): ReactNode {
  return (
    <>
      <line x1={plot.across(day)} x2={plot.across(day)} y1={0} y2={plot.height} stroke="var(--input)" strokeWidth={1} />
      {series.map((line) => (
        <circle key={line.key} cx={plot.across(day)} cy={plot.up(line.counts[day] ?? 0)} r={4} fill={line.color} stroke="var(--background)" strokeWidth={2} />
      ))}
    </>
  );
}

/** The numbers of the marked step, beside it: its day, and each line's name and count. */
function DayNumbers({ left, words, series, at }: { readonly left: number; readonly words: string; readonly series: readonly Series[]; readonly at: number }): ReactNode {
  return (
    <TooltipWithBounds
      unstyled
      applyPositionStyle
      left={left}
      top={ROOM.top}
      className="pointer-events-none z-10 rounded-md bg-popover px-3 py-2 text-xs text-popover-foreground shadow-md ring-1 ring-foreground/10"
    >
      <p data-slot="day-numbers" className="flex flex-col gap-1">
        <span className="font-medium">{words}</span>
        {series.map((line) => (
          <span key={line.key} className="flex items-center gap-2">
            <LineSample line={line} />
            <span className="min-w-0 max-w-40 flex-1 truncate">{line.name}</span>
            <span className="tabular-nums">{showCount(line.counts[at] ?? 0)}</span>
          </span>
        ))}
      </p>
    </TooltipWithBounds>
  );
}

/** Draw the graph as wide as its place. A step is marked by the pointer, or by a slider only the keyboard and a screen reader meet. */
export function VisitsChart({ days, by, series }: VisitsChartProps): ReactNode {
  const { parentRef, width } = useParentSize<HTMLDivElement>({ initialSize: { width: FIRST_WIDTH, height: HEIGHT }, debounceTime: 0 });
  const [marked, setMarked] = useState<number>();
  const size = { width: Math.max(width - ROOM.left - ROOM.right, 1), height: HEIGHT - ROOM.top - ROOM.bottom };
  const last = days.length - 1;
  const plot: Plot = {
    ...size,
    across: scaleLinear({ domain: [0, Math.max(last, 1)], range: [0, size.width] }),
    up: scaleLinear({ domain: [0, Math.max(1, ...series.flatMap((line) => line.counts))], range: [size.height, 0], nice: 4 }),
  };
  const read = marked ?? last;

  function markAt(event: PointerEvent<SVGRectElement>): void {
    const at = Math.round(plot.across.invert((localPoint(event)?.x ?? 0) - ROOM.left));
    setMarked(Math.min(Math.max(at, 0), last));
  }

  return (
    <div ref={parentRef} className="relative rounded-md has-[input:focus-visible]:ring-2 has-[input:focus-visible]:ring-ring">
      <svg width={width} height={HEIGHT} aria-hidden="true" className="block">
        <Group left={ROOM.left} top={ROOM.top}>
          <Axes plot={plot} days={days} marks={markedDays(days.length, width < NARROW ? 3 : 5)} />
          {[...series].reverse().map((line) => (
            <LinePath
              key={line.key}
              data-line={line.key}
              data={[...line.counts]}
              x={(_count, at) => plot.across(at)}
              y={(count) => plot.up(count)}
              stroke={line.color}
              strokeWidth={line.width}
              strokeDasharray={line.dashes}
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          ))}
          {marked === undefined ? null : <DayMark plot={plot} series={series} day={marked} />}
          <rect width={size.width} height={size.height} fill="transparent" onPointerMove={markAt} onPointerDown={markAt} onPointerLeave={() => setMarked(undefined)} />
        </Group>
      </svg>
      <input
        type="range"
        aria-label={by === "week" ? "Week" : "Day"}
        aria-valuetext={[stepWords(days[read] ?? "", by), ...series.map((line) => `${line.name} ${showCount(line.counts[read] ?? 0)}`)].join(", ")}
        min={0}
        max={last}
        value={read}
        onChange={(event) => setMarked(Number(event.target.value))}
        onFocus={() => setMarked(read)}
        onBlur={() => setMarked(undefined)}
        className="sr-only"
      />
      {marked === undefined ? null : <DayNumbers left={ROOM.left + plot.across(marked)} words={stepWords(days[marked] ?? "", by)} series={series} at={marked} />}
    </div>
  );
}
