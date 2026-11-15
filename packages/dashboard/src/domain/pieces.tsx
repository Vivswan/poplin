// The pieces the install needs on the domain, as a run or the install's memory of one left them: one line that counts what is left, the steps only a person can do, and one row per piece.

import { cn } from "cn";
import { CircleAlertIcon, CircleCheckIcon, CircleDashedIcon } from "lucide-react";
import { type ReactNode, type Ref, useMemo } from "react";

import type { Ran } from "@/domain/domain-queries";
import { type ColumnSpec, DataTable } from "@/table/data-table";
import { useTableLayout } from "@/table/layout";

/** The mark of each way a state is read, and the colour of the mark and of the state's words. */
const TONES = {
  good: { icon: CircleCheckIcon, mark: "text-good", words: "text-muted-foreground" },
  bad: { icon: CircleAlertIcon, mark: "text-destructive", words: "font-medium text-destructive" },
  idle: { icon: CircleDashedIcon, mark: "text-faint", words: "text-muted-foreground" },
} as const;

/** The order the rows are in: the one a repair works in, which no heading changes. */
const AS_RUN = { key: "", descending: false } as const;

/** One piece as the server answers it. */
type Piece = Ran["rows"][number];

/** What the pieces are drawn from. */
interface PiecesProps {
  /** The line that counts the rows. */
  readonly summary: Ran["summary"];

  /** Every piece, in the order a repair works in. */
  readonly rows: Ran["rows"];

  /** What only a person can do, each with the address to open. */
  readonly steps: Ran["steps"];

  /** What stands at the end of the count's line, such as when the run was. */
  readonly beside?: ReactNode;

  /** A line under the count, such as which logins the install expects. */
  readonly under?: string;

  /** The count's line, which takes the focus after a run. */
  readonly head?: Ref<HTMLDivElement>;
}

/** A state as a small mark and its words: the mark's shape says how it is read, so the colour is not needed. In the table it keeps the row's height when its words wrap. */
function StateMark({ piece }: { readonly piece: Piece }): ReactNode {
  const { icon: Icon, mark, words } = TONES[piece.tone];

  return (
    <span className={cn("inline-flex items-start gap-1.5 py-3 leading-5 whitespace-normal max-md:py-0", words)}>
      <Icon className={cn("mt-0.5 size-4 shrink-0", mark)} aria-hidden="true" />
      {piece.state}
    </span>
  );
}

/** The columns of the table. A long detail wraps, so a row grows to hold all of it. */
function pieceColumns(): ColumnSpec<Piece & { readonly place: number }>[] {
  return [
    {
      id: "piece",
      header: "Piece",
      size: 232,
      fixed: true,
      cell: (piece) => <span className={cn(piece.tone === "bad" && "font-medium")}>{piece.piece}</span>,
    },
    { id: "state", header: "State", size: 200, minSize: 184, cell: (piece) => <StateMark piece={piece} /> },
    {
      id: "detail",
      header: "Detail",
      size: 560,
      minSize: 240,
      grows: true,
      cell: (piece) => (
        <span className={cn("block py-3 leading-5 break-words whitespace-normal", piece.tone !== "bad" && "text-muted-foreground")}>{piece.detail}</span>
      ),
    },
  ];
}

/** Draw the count, the steps, and the rows. */
export function Pieces({ summary, rows, steps, beside, under, head }: PiecesProps): ReactNode {
  const placed = useMemo(() => rows.map((row, place) => ({ ...row, place })), [rows]);
  const columns = useMemo(pieceColumns, []);
  const layout = useTableLayout("pieces", columns);
  const Mark = summary.tone === "good" ? CircleCheckIcon : CircleAlertIcon;

  return (
    <div className="flex min-w-0 flex-col">
      <div ref={head} tabIndex={-1} role="status" className="flex flex-col gap-1 px-6 pb-3 outline-none max-md:px-4">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <Mark className={cn("size-4 shrink-0", summary.tone === "good" ? "text-good" : "text-destructive")} aria-hidden="true" />
          <span className="font-bold">{summary.line}</span>
          {summary.next === null ? null : <span className="text-muted-foreground">{summary.next}</span>}
          {beside === undefined ? null : <span className="ml-auto text-muted-foreground">{beside}</span>}
        </div>
        {summary.optional === null ? null : <p className="text-muted-foreground">{summary.optional}</p>}
        {under === undefined ? null : <p className="text-muted-foreground">{under}</p>}
        {steps.length === 0 ? null : (
          <ol className="flex flex-col gap-1 pt-1">
            {steps.map((step) => (
              <li key={step.address} className="break-words">
                {step.text}{" "}
                <a href={step.address} target="_blank" rel="noreferrer" className="text-link underline-offset-2 hover:underline">
                  {step.address}
                </a>
              </li>
            ))}
          </ol>
        )}
      </div>
      <div className="max-md:hidden">
        <DataTable label="Pieces" columns={columns} rows={placed} rowId={(piece) => String(piece.place)} layout={layout} sort={AS_RUN} />
      </div>
      <ul aria-label="Pieces" className="border-t md:hidden">
        {placed.map((piece) => (
          <li key={piece.place} className="flex min-h-16 flex-col justify-center gap-0.5 border-b px-4 py-2">
            <div className="flex items-start justify-between gap-3">
              <span className={cn("leading-5", piece.tone === "bad" && "font-medium")}>{piece.piece}</span>
              <StateMark piece={piece} />
            </div>
            <p className={cn("break-words", piece.tone !== "bad" && "text-muted-foreground")}>{piece.detail}</p>
          </li>
        ))}
      </ul>
    </div>
  );
}
