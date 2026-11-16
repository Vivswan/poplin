// The pieces the install needs on the domain, as a run or the install's memory of one left them: one row per piece, in the table every list is shown in. The table is as tall as its rows: the screen's page scrolls, and the table has no bar of its own.

import { cn } from "cn";
import { type ReactNode, useMemo } from "react";

import type { Ran } from "@/domain/domain-queries";
import { ToneMark } from "@/domain/tone-mark";
import { type ColumnSpec, DataTable } from "@/table/data-table";

/** The look of a state's words, by how the state is read. */
const WORDS = { good: "text-muted-foreground", bad: "font-medium text-destructive", idle: "text-muted-foreground" } as const;

/** The order the rows are in: the one a repair works in, which no heading changes. */
const AS_RUN = { key: "", descending: false } as const;

/** One piece as the server answers it. */
type Piece = Ran["rows"][number];

/** A state as a small mark and its words, the first with a capital. In the table it keeps the row's height when its words wrap. */
function StateMark({ piece }: { readonly piece: Piece }): ReactNode {
  return (
    <span className={cn("inline-flex items-start gap-1.5 py-3 leading-5 whitespace-normal max-md:py-0", WORDS[piece.tone])}>
      <ToneMark tone={piece.tone} className="mt-0.5" />
      <span className="first-letter:uppercase">{piece.state}</span>
    </span>
  );
}

/** The columns of the table. A long detail wraps, so a row grows to hold all of it. */
function pieceColumns(): ColumnSpec<Piece & { readonly place: number }>[] {
  return [
    {
      id: "piece",
      header: "Piece",
      fixed: true,
      cell: (piece) => <span className={cn(piece.tone === "bad" && "font-medium")}>{piece.piece}</span>,
    },
    { id: "state", header: "State", widest: 200, cell: (piece) => <StateMark piece={piece} /> },
    {
      id: "detail",
      header: "Detail",
      grows: true,
      cell: (piece) => (
        <span className={cn("block py-3 leading-5 break-words whitespace-normal", piece.tone !== "bad" && "text-muted-foreground")}>{piece.detail}</span>
      ),
    },
  ];
}

/**
 * Draw one row per piece, in the order given.
 *
 * @param rows - every piece, in the order a repair works in
 */
export function Pieces({ rows }: { readonly rows: Ran["rows"] }): ReactNode {
  const placed = useMemo(() => rows.map((row, place) => ({ ...row, place })), [rows]);
  const columns = useMemo(pieceColumns, []);

  return (
    <>
      <div className="shrink-0 max-md:hidden">
        <DataTable label="Pieces" columns={columns} rows={placed} rowId={(piece) => String(piece.place)} sort={AS_RUN} />
      </div>
      <ul aria-label="Pieces" className="border-t md:hidden">
        {placed.map((piece) => (
          <li key={piece.place} className="flex min-h-16 flex-col justify-center gap-0.5 border-b px-4 py-2">
            <span className={cn("leading-5", piece.tone === "bad" && "font-medium")}>{piece.piece}</span>
            <StateMark piece={piece} />
            <p className={cn("break-words", piece.tone !== "bad" && "text-muted-foreground")}>{piece.detail}</p>
          </li>
        ))}
      </ul>
    </>
  );
}
