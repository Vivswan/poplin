// The table every list of the dashboard is shown in. The server sorts and narrows the rows. A table that is given a layout lets a person arrange its columns: drag them into another order, drag an edge to resize, and choose which are shown.
// Every other table stands as it is given. Every shown column is drawn, as wide as its values need or as a person made it.
// Where they do not fit the room, even with every value that gives cut to its shortest, the table scrolls sideways in its own area, between the first column and the rows' actions, which stay in place.

import { ScrollArea as ScrollAreaParts } from "@base-ui/react/scroll-area";
import { Separator } from "@base-ui/react/separator";
import {
  type Announcements,
  closestCenter,
  DndContext,
  type DragEndEvent,
  DragOverlay,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
} from "@dnd-kit/core";
import { restrictToHorizontalAxis } from "@dnd-kit/modifiers";
import { arrayMove, horizontalListSortingStrategy, SortableContext, sortableKeyboardCoordinates, useSortable } from "@dnd-kit/sortable";
import {
  columnOrderingFeature,
  columnResizingFeature,
  columnSizingFeature,
  columnVisibilityFeature,
  type Header,
  rowSortingFeature,
  tableFeatures,
  useTable,
} from "@tanstack/react-table";
import { cn } from "cn";
import { ArrowDownIcon, ArrowUpIcon, ChevronsUpDownIcon, Columns3Icon, GripVerticalIcon } from "lucide-react";
import { type FocusEvent, type KeyboardEvent, type MouseEvent, type PointerEventHandler, type ReactNode, useEffect, useMemo, useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { ScrollArea, ScrollBar } from "@/components/ui/scroll-area";
import { Skeleton } from "@/components/ui/skeleton";
import { type ColumnWidths, type Fitted, NARROWEST, type SizedColumn, widthsForRoom } from "@/table/column-widths";
import type { TableLayout } from "@/table/layout";
import { useFitted, useRoom, useTopOfPage, widestOf } from "@/table/measure";

/** What of the table library this table uses. */
const FEATURES = tableFeatures({ rowSortingFeature, columnVisibilityFeature, columnOrderingFeature, columnSizingFeature, columnResizingFeature });

/** How far a press must move before it drags a column, in pixels: a shorter one is a click, which sorts. */
const DRAG_AFTER = 6;

/** The width of the last column where a row's actions are one icon, and how far one press of an arrow key moves a column's edge. */
const [ICON_ACTIONS_WIDTH, NUDGE] = [56, 16];

/** How many rows stand in for the rows being read. */
const LOADING_ROWS = 6;

/** The widths a person set in a table nobody arranges: none. */
const NO_SIZES: Readonly<Record<string, number>> = {};

/** What a press on these never does: open the row. */
const OWN_CONTROLS = "a, button, input, [role^='menu'], [role='dialog']";

/** The look of a heading's grip: it lies over the heading's far end, so it takes no room from the words, and shows when its heading is pointed at or it holds the focus. */
const GRIP_LOOK = "absolute top-1.5 z-15 cursor-grab bg-background text-faint opacity-0 group-hover/head:opacity-100 focus-visible:opacity-100 active:cursor-grabbing";

/** The look of the table: columns of the widths it is told, and hairlines drawn by the cells. */
const TABLE_LOOK = "mb-2.5 table-fixed border-separate border-spacing-0 text-sm";

/** The look of the last column, which stays in place: it has a hairline at its left edge only while the table is wider than its room, where a cell scrolls under it. The scroll area says when that is. */
const PINNED_LOOK = "sticky right-0 in-data-[has-overflow-x]:border-l";

/** The look of a row that holds the focus after a key, or whose own button does, which is out of sight: a ring drawn by its cells, so the cells that stay in place carry it too, where they would lie over a ring of the row's own. */
const FOCUSED_ROW_LOOK = cn(
  "outline-none [&:is(:focus-visible,:has([data-opens]:focus-visible))>td]:shadow-[inset_0_2px_0_var(--ring),inset_0_-2px_0_var(--ring)]",
  "[&:is(:focus-visible,:has([data-opens]:focus-visible))>td:first-child]:shadow-[inset_2px_0_0_var(--ring),inset_0_2px_0_var(--ring),inset_0_-2px_0_var(--ring)]",
  "[&:is(:focus-visible,:has([data-opens]:focus-visible))>td:last-child]:shadow-[inset_-2px_0_0_var(--ring),inset_0_2px_0_var(--ring),inset_0_-2px_0_var(--ring)]",
);

/** The room after the last column of a table with no column of actions: its headings and values end where the tools over the table end. */
const END_ROOM = "pr-6";

/** The height and the room of a cell under a heading. */
const CELL_LOOK = "h-11 px-3 py-0";

/** The look of a heading while it is dragged to another place. */
const DRAGGED_LOOK = "flex h-9 w-fit cursor-grabbing items-center rounded-md border bg-popover px-3 text-xs text-foreground shadow-md";

/** The look of a column's edge: 24 px to press, under the buttons of the headings it reaches over, and a hairline that shows under the pointer, with the focus, and while it is dragged. With the focus of the keys it also has the ring every stop has. */
const EDGE_LOOK = cn(
  "absolute top-0 z-10 flex h-full w-6 cursor-col-resize touch-none rounded-sm outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset",
  "after:h-full after:w-px after:bg-transparent hover:after:bg-ring focus-visible:after:w-0.5 focus-visible:after:bg-ring",
);

/** Where a column's edge is pressed: half in its own column and half in the next, over the room beside their words. The last column's lies inside it, so the table grows no wider; so does the edge of the column that stays in place. */
const [EDGE_BETWEEN, EDGE_INSIDE] = ["-right-3 justify-center", "right-0 justify-end"];

/** What a pointer and a screen reader are told an edge does. */
const EDGE_HINT = "Drag or use the arrow keys to resize. Double-click or Enter resets.";

/** One column of a table. */
export interface ColumnSpec<Row> extends SizedColumn {
  /** The words of its heading. */
  readonly header: string;

  /** What a row shows under it. */
  readonly cell: (row: Row) => ReactNode;

  /** The direction a first press on its heading asks for, for a column the server can order the rows by; left out for any other column. */
  readonly sortable?: "asc" | "desc";

  /** Hidden until it is chosen. */
  readonly hidden?: boolean;

  /** Numbers, set against the right edge. */
  readonly numeric?: boolean;
}

/** The order the server gave the rows. */
export interface Sort {
  readonly key: string;
  readonly descending: boolean;
}

/** What a row opens, and the name of the button that opens it. */
interface Opens<Row> {
  /** The button's name for a row, such as "Details of Notes". */
  readonly name: (row: Row) => string;

  /** Opens what the row leads to. */
  readonly open: (row: Row) => void;
}

/** What a table is drawn from. */
interface DataTableProps<Row> {
  /** What the table lists, for a screen reader. */
  readonly label: string;

  /** Every column the table can show. */
  readonly columns: readonly ColumnSpec<Row>[];

  /** The rows, in the order the server gave them. */
  readonly rows: readonly Row[];

  /** A row's key. */
  readonly rowId: (row: Row) => string;

  /** The order, the hidden columns, and the widths as a person arranged them: the table's headings then move and resize. Left out, the columns stand as given: each that is not hidden, in the table's own order, as wide as its values need. */
  readonly layout?: TableLayout;

  /** The order the rows are in. */
  readonly sort: Sort;

  /** Asked when a heading is pressed, with the order the press leads to: the column's first direction, then the other one, then none, which is the table's own. Left out for a table no heading orders. */
  readonly onSort?: (next: Sort | undefined) => void;

  /** The id of the row whose detail is open. */
  readonly selected?: string;

  /** What a row opens: `open` is called when a row is pressed anywhere but on its own controls, and by the button each row then starts with, which `name` names for the row, such as "Details of Notes". Left out, a row opens nothing. */
  readonly opens?: Opens<Row>;

  /** What sits at a row's end: its menu and its quick actions. Left out, the table has no such column. */
  readonly actions?: (row: Row) => ReactNode;

  /** The width of the last column, wide enough for a row's actions, in pixels; left out, the width of one icon. */
  readonly actionsWidth?: number;

  /** Whether the rows are being read for the first time: rows of the table's own shape stand in for them. */
  readonly loading?: boolean;

  /** What follows the last row, such as the way to the next page: it scrolls up and down with the rows, and stays in place when they scroll sideways. */
  readonly after?: ReactNode;

  /** Which page of a list the rows are, in any words that differ from page to page: when it changes, the list is shown from its first row. */
  readonly page?: string;

  /** Which list the rows are a page of, in any words that differ from list to list: the column edges of one page then hold on the next, and move only for a value wider than any before. Left out, the columns fit the rows that are shown. */
  readonly list?: string;

  /** What another table that stands in the same columns measured: each column is drawn wide enough for the values of both, so the edges of the two tables line up. */
  readonly alongside?: Fitted;

  /** Told what this table measured whenever it changes, and `undefined` once the table is gone: what the other table of such a pair is given as `alongside`. */
  readonly onFitted?: (fitted: Fitted | undefined) => void;
}

type Head = Header<typeof FEATURES, object, unknown>;

/** What a heading that can be dragged to another place adds to the cell it is drawn in. */
interface Moves {
  /** Tells the drag which cell the heading is. */
  readonly ref: (cell: HTMLElement | null) => void;

  /** The look of the cell while it is dragged, and of the one a dragged heading would land at. */
  readonly look: string;

  /** Starts a drag from anywhere on the heading; left out for the column that stays in place. */
  readonly onPointerDown: PointerEventHandler | undefined;

  /** The grip, which the keys move too. */
  readonly grip: ReactNode;
}

/** What a table whose columns are arranged knows of the arranging. */
interface Arranged {
  /** The arrangement, and the ways to change it. */
  readonly layout: TableLayout;

  /** The ids of the columns that can be moved, in the order shown. */
  readonly movable: readonly string[];

  /** Makes a column wider or narrower by as many pixels. */
  readonly onNudge: (id: string, by: number) => void;
}

function ariaSort(sortable: boolean, id: string, sort: Sort): "ascending" | "descending" | "none" | undefined {
  if (!sortable) return undefined;

  if (sort.key !== id) return "none";

  return sort.descending ? "descending" : "ascending";
}

/** The mark beside a heading the rows can be ordered by: the direction when they are, and a faint hint under the pointer when they are not. */
function sortArrow(sorted: boolean, descending: boolean): ReactNode {
  if (!sorted) return <ChevronsUpDownIcon className="size-3.5 shrink-0 opacity-0 group-hover/head:opacity-60" />;

  return descending ? <ArrowDownIcon className="size-3.5 shrink-0" /> : <ArrowUpIcon className="size-3.5 shrink-0" />;
}

/** Where a dragged column would land, as a line at the edge of the heading it is over. */
function landingMark(over: boolean, from: number, at: number): string | false {
  if (!over || from === at) return false;

  return from > at ? "shadow-[inset_2px_0_0_var(--ring)]" : "shadow-[inset_-2px_0_0_var(--ring)]";
}

/** Where a heading's grip lies: over the far end of its words, clear of the edges at both sides of the column. */
function gripPlace(numeric: boolean, ends: boolean): string {
  if (numeric) return "left-3";

  return ends ? "right-6" : "right-3";
}

/** The room after a cell's value where the cell is the last of a row that no actions follow. */
function endRoom(cells: readonly unknown[], at: number, withoutActions: boolean): string | false {
  return withoutActions && at === cells.length - 1 && END_ROOM;
}

/** The edge of a column, which resizes it: dragged, moved by the arrow keys, and put back by a double press or Enter. A screen reader is told the column's width as its value, which has no upper bound but the table library's own. */
function ColumnEdge({
  header,
  name,
  inside,
  onNudge,
}: {
  readonly header: Head;
  readonly name: string;
  readonly inside: boolean;
  readonly onNudge: (by: number) => void;
}): ReactNode {
  const width = Math.round(header.getSize());
  const onKey = (event: KeyboardEvent): void => {
    if (event.key !== "ArrowLeft" && event.key !== "ArrowRight" && event.key !== "Enter") return;

    event.preventDefault();
    if (event.key === "Enter") header.column.resetSize();
    else onNudge(event.key === "ArrowLeft" ? -NUDGE : NUDGE);
  };

  return (
    <Separator
      orientation="vertical"
      tabIndex={0}
      aria-label={`Resize the ${name} column`}
      aria-valuenow={width}
      aria-valuemin={NARROWEST}
      aria-valuemax={Number.MAX_SAFE_INTEGER}
      aria-valuetext={`${width} pixels`}
      title={EDGE_HINT}
      onMouseDown={header.getResizeHandler()}
      onTouchStart={header.getResizeHandler()}
      onDoubleClick={() => header.column.resetSize()}
      onKeyDown={onKey}
      className={cn(EDGE_LOOK, inside ? EDGE_INSIDE : EDGE_BETWEEN, header.column.getIsResizing() && "after:w-0.5 after:bg-ring")}
    />
  );
}

/** What every heading is drawn from. */
interface HeadCellProps<Row> {
  /** The heading as the table library knows it. */
  readonly header: Head;

  /** The column it stands over. */
  readonly spec: ColumnSpec<Row>;

  /** Whether it is the last heading of a table with no column of actions. */
  readonly ends: boolean;

  /** The order the rows are in. */
  readonly sort: Sort;

  /** Asked for another order when the heading is pressed; left out for a table no heading orders. */
  readonly onSort: ((next: Sort | undefined) => void) | undefined;
}

/** Draw a heading: its words, which sort the rows where the server can, and what a table whose columns are arranged adds to it. */
function HeadCell<Row>({ header, spec, sort, onSort, ends, moves, edge }: HeadCellProps<Row> & { readonly moves?: Moves; readonly edge?: ReactNode }): ReactNode {
  const fixed = spec.fixed === true;
  const sorted = sort.key === spec.id;
  const sortable = spec.sortable !== undefined && onSort !== undefined;
  // The table library says which order a press leads to, from the order the rows are in and the column's first direction.
  const press = (): void => {
    const next = header.column.getNextSortingOrder();
    onSort?.(next === false ? undefined : { key: spec.id, descending: next === "desc" });
  };
  const words = (
    <span className="truncate" title={spec.header}>
      {spec.header}
    </span>
  );

  return (
    <th
      ref={moves?.ref}
      scope="col"
      data-column={spec.id}
      aria-sort={ariaSort(sortable, spec.id, sort)}
      aria-label={spec.header}
      className={cn(
        "group/head relative h-9 border-b bg-background p-0 text-left text-xs font-normal text-muted-foreground select-none",
        fixed && "sticky left-0 z-20",
        moves?.look,
      )}
    >
      <div className={cn("flex h-9 min-w-0 items-center gap-0.5 pr-3 pl-3", fixed && "pl-6", ends && END_ROOM, spec.numeric === true && "flex-row-reverse")} onPointerDown={moves?.onPointerDown}>
        {sortable ? (
          <Button
            type="button"
            variant="ghost"
            size="xs"
            onClick={press}
            className={cn("relative z-15 -mx-1 min-w-0 shrink gap-1 px-1 font-normal", sorted && "font-bold text-foreground")}
          >
            {words}
            {sortArrow(sorted, sort.descending)}
          </Button>
        ) : (
          words
        )}
        {moves?.grip}
      </div>
      {edge}
    </th>
  );
}

/** Draw a heading of a table whose columns are arranged: it is dragged to another place by its grip or from anywhere on it, and its edge resizes its column. The column that stays in place is not moved. */
function ArrangedHeadCell<Row>({ onNudge, ...shared }: HeadCellProps<Row> & { readonly onNudge: (id: string, by: number) => void }): ReactNode {
  const { header, spec, ends } = shared;
  const fixed = spec.fixed === true;
  const { attributes, listeners, setNodeRef, isDragging, isOver, activeIndex, index } = useSortable({
    id: spec.id,
    disabled: { draggable: fixed, droppable: fixed },
  });
  const grip = fixed ? null : (
    <Button
      type="button"
      variant="ghost"
      size="icon-xs"
      {...attributes}
      {...listeners}
      aria-label={`Move the ${spec.header} column`}
      title="Drag to move the column"
      className={cn(GRIP_LOOK, gripPlace(spec.numeric === true, ends))}
    >
      <GripVerticalIcon className="size-3.5" />
    </Button>
  );
  const moves: Moves = {
    ref: setNodeRef,
    look: cn(isDragging && "opacity-40", landingMark(isOver, activeIndex, index)),
    onPointerDown: fixed ? undefined : (listeners?.onPointerDown as PointerEventHandler | undefined),
    grip,
  };

  return <HeadCell {...shared} moves={moves} edge={<ColumnEdge header={header} name={spec.header} inside={ends || fixed} onNudge={(by) => onNudge(spec.id, by)} />} />;
}

function BodyRow<Row>({
  id,
  row,
  cells,
  spare,
  selected,
  opens,
  actions,
}: {
  readonly id: string;
  readonly row: Row;
  readonly cells: readonly ColumnSpec<Row>[];
  readonly spare: boolean;
  readonly selected: boolean;
  readonly opens?: Opens<Row>;
  readonly actions?: ReactNode;
}): ReactNode {
  const own = useRef<HTMLButtonElement>(null);
  // A press on the row leaves the focus on the area the table scrolls in: the row's own button takes it, so the next key starts at this row.
  const onClick = (event: MouseEvent): void => {
    if ((event.target as Element).closest(OWN_CONTROLS)) return;

    own.current?.focus();
    opens?.open(row);
  };

  return (
    <tr
      data-state={selected ? "selected" : undefined}
      data-opens={opens === undefined ? undefined : ""}
      tabIndex={opens === undefined ? -1 : undefined}
      onClick={onClick}
      onMouseOver={hintWhenCut}
      onFocus={hintWhenCut}
      className={cn(
        "group/row bg-background hover:bg-muted has-[:focus-visible]:bg-muted data-[state=selected]:bg-chosen data-[state=selected]:has-[:focus-visible]:bg-chosen [&>td]:border-b",
        FOCUSED_ROW_LOOK,
        opens !== undefined && "cursor-pointer",
      )}
    >
      {cells.map((spec, at) => (
        <td key={spec.id} className={cn(CELL_LOOK, "bg-inherit", spec.fixed === true && "sticky left-0 z-10 pl-6", endRoom(cells, at, actions === undefined), spec.numeric === true && "text-right")}>
          {/* The row's own button is its first control and is out of sight: a press anywhere on the row does the same, and the row draws the ring while the button holds the focus. It eases nothing: a closed panel gives it the focus back at once. */}
          {at === 0 && opens !== undefined ? <Button ref={own} variant="ghost" data-opens={id} aria-label={opens.name(row)} className="sr-only transition-none" onClick={() => opens.open(row)} /> : null}
          <div className="truncate">{spec.cell(row)}</div>
        </td>
      ))}
      {spare ? <td className="h-11 bg-inherit p-0" /> : null}
      {actions === undefined ? null : <td className={cn(PINNED_LOOK, "z-10 h-11 bg-inherit py-0 pr-6 pl-1 text-right whitespace-nowrap")}>{actions}</td>}
    </tr>
  );
}

/** The row of headings: one for each shown column, which move and resize where the table's columns are arranged, then the room the columns leave empty, then the place over the rows' actions. */
function HeadRow<Row>({
  headers,
  specs,
  arranged,
  sort,
  onSort,
  spare,
  withActions,
}: {
  readonly headers: readonly Head[];
  readonly specs: ReadonlyMap<string, ColumnSpec<Row>>;
  readonly arranged: Arranged | undefined;
  readonly sort: Sort;
  readonly onSort: ((next: Sort | undefined) => void) | undefined;
  readonly spare: boolean;
  readonly withActions: boolean;
}): ReactNode {
  const cells = headers.map((header) => {
    const spec = specs.get(header.column.id);
    if (spec === undefined) return null;

    const shared = { header, spec, sort, onSort, ends: !withActions && header === headers.at(-1) };

    return arranged === undefined ? <HeadCell key={header.id} {...shared} /> : <ArrangedHeadCell key={header.id} {...shared} onNudge={arranged.onNudge} />;
  });

  return (
    <tr>
      {arranged === undefined ? (
        cells
      ) : (
        <SortableContext items={[...arranged.movable]} strategy={horizontalListSortingStrategy}>
          {cells}
        </SortableContext>
      )}
      {spare ? <td className="h-9 border-b bg-background p-0" /> : null}
      {withActions ? (
        <th className={cn(PINNED_LOOK, "z-20 h-9 border-b bg-background p-0")}>
          <span className="sr-only">Actions</span>
        </th>
      ) : null}
    </tr>
  );
}

/** A row that stands in for one being read: the table's own height and columns, so nothing moves when the rows arrive. */
function LoadingRow<Row>({
  cells,
  spare,
  withActions,
}: {
  readonly cells: readonly ColumnSpec<Row>[];
  readonly spare: boolean;
  readonly withActions: boolean;
}): ReactNode {
  return (
    <tr className="[&>td]:border-b">
      {cells.map((spec, at) => (
        <td key={spec.id} className={cn(CELL_LOOK, spec.fixed === true && "pl-6", endRoom(cells, at, !withActions))}>
          <Skeleton className={cn("h-4", spec.fixed === true ? "w-32" : "w-16")} />
        </td>
      ))}
      {spare ? <td /> : null}
      {withActions ? <td className="h-11" /> : null}
    </tr>
  );
}

/** Say a cell's whole text in the hint a pointer shows, where the cell is too narrow for it. */
function hintWhenCut(event: MouseEvent | FocusEvent): void {
  const cell = (event.target as Element).closest<HTMLElement>("td > div");
  if (cell !== null) cell.title = cell.scrollWidth > cell.clientWidth ? (cell.textContent ?? "") : "";
}

/** The widths of a table's columns as the browser is told them: one per column, one for the room they leave empty, and one for the rows' actions. */
function Widths<Row>({
  shown,
  widths,
  endWidth,
}: {
  readonly shown: readonly ColumnSpec<Row>[];
  readonly widths: ColumnWidths;
  readonly endWidth: number;
}): ReactNode {
  return (
    <colgroup>
      {shown.map((spec) => (
        <col key={spec.id} style={{ width: widths.drawn.get(spec.id) }} />
      ))}
      {widths.spare === 0 ? null : <col style={{ width: widths.spare }} />}
      {endWidth === 0 ? null : <col style={{ width: endWidth }} />}
    </colgroup>
  );
}

/** A column as the table library is told of it: its narrowest, and the direction a first press on its heading orders it in. */
function definitionOf<Row>(column: ColumnSpec<Row>) {
  return {
    id: column.id,
    minSize: NARROWEST,
    enableHiding: column.fixed !== true,
    enableSorting: column.sortable !== undefined,
    sortDescFirst: column.sortable === "desc",
  };
}

/**
 * Keep what a person changed of the widths the table library was told.
 *
 * Only a width that changed is kept, and one the library took away (a double press on an edge) is forgotten: the rest stay free to fit the room.
 *
 * @param told - the widths as drawn, which the library started from
 * @param next - the widths the library asks for
 */
function keepSizes(layout: TableLayout, told: Readonly<Record<string, number>>, next: Readonly<Record<string, number>>): void {
  // An edge dragged past the narrowest keeps the narrowest: a smaller width would not be drawn, and would not be kept.
  const changed = Object.entries(next)
    .map(([id, size]) => [id, Math.max(NARROWEST, size)] as const)
    .filter(([id, size]) => size !== told[id]);
  const reset = Object.keys(told).filter((id) => !(id in next));
  if (changed.length === 0 && reset.length === 0) return;

  layout.setSizes({ ...Object.fromEntries(Object.entries(layout.sizes).filter(([id]) => !reset.includes(id))), ...Object.fromEntries(changed) });
}

/** Tell the other table of a pair what this one measured, and that nothing is measured once this one is gone. */
function useFittedTold(fitted: Fitted, onFitted: ((fitted: Fitted | undefined) => void) | undefined): void {
  useEffect(() => {
    onFitted?.(fitted);

    return () => onFitted?.(undefined);
  }, [fitted, onFitted]);
}

/** What a screen reader is told while a column is moved by keyboard, in the columns' own words. */
function announcementsOf<Row>(specs: ReadonlyMap<string, ColumnSpec<Row>>): Announcements {
  const named = (id: string | number | undefined): string => specs.get(String(id))?.header ?? "";

  return {
    onDragStart: ({ active }) => `Picked up the ${named(active.id)} column. Move it with the arrow keys, drop it with Space.`,
    onDragOver: ({ active, over }) => (over === null ? undefined : `The ${named(active.id)} column is over ${named(over.id)}.`),
    onDragEnd: ({ active, over }) =>
      over === null ? `The ${named(active.id)} column was put back.` : `The ${named(active.id)} column was dropped at ${named(over.id)}.`,
    onDragCancel: ({ active }) => `The ${named(active.id)} column was put back.`,
  };
}

/**
 * The menu that chooses a table's columns.
 *
 * It lists the fixed column as always shown, the others in the order they stand, and the way back to the layout the table starts with.
 * A table that shows every column it has from the start draws no menu: there is nothing to choose.
 */
export function ColumnsMenu<Row>({ columns, layout }: { readonly columns: readonly ColumnSpec<Row>[]; readonly layout: TableLayout }): ReactNode {
  const ordered = layout.order.flatMap((id) => columns.filter((column) => column.id === id));
  if (!columns.some((column) => column.hidden === true)) return null;

  return (
    <DropdownMenu>
      <DropdownMenuTrigger render={<Button variant="outline" />}>
        <Columns3Icon data-icon="inline-start" />
        {/* In a narrow list the button keeps its mark and gives its room to the search. */}
        <span className="@max-xl:sr-only">Columns</span>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-52">
        <DropdownMenuGroup>
          <DropdownMenuLabel>Shown columns</DropdownMenuLabel>
          {ordered.map((column) => (
            <DropdownMenuCheckboxItem
              key={column.id}
              checked={!layout.hidden.includes(column.id)}
              disabled={column.fixed === true}
              onCheckedChange={(shown) => layout.setHidden(column.id, !shown)}
            >
              {column.header}
            </DropdownMenuCheckboxItem>
          ))}
        </DropdownMenuGroup>
        <DropdownMenuSeparator />
        <DropdownMenuItem disabled={Object.keys(layout.sizes).length === 0} onClick={() => layout.setSizes({})}>
          Reset the widths
        </DropdownMenuItem>
        <DropdownMenuItem disabled={!layout.changed} onClick={layout.reset}>
          Reset the layout
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/** The columns a table shows: as a person arranged them, or, where nobody arranges them, each that is not hidden, in the table's own order. */
function shownOf<Row>(columns: readonly ColumnSpec<Row>[], specs: ReadonlyMap<string, ColumnSpec<Row>>, layout: TableLayout | undefined): readonly ColumnSpec<Row>[] {
  if (layout === undefined) return columns.filter((column) => column.hidden !== true);

  return layout.order.filter((id) => !layout.hidden.includes(id)).flatMap((id) => specs.get(id) ?? []);
}

/** Let a person drag the headings of a table into another order, by pointer or by keys, and say each step to a screen reader. Only a table whose columns are arranged is drawn inside it. */
function ColumnMoves<Row>({
  arranged: { layout, movable },
  specs,
  children,
}: {
  readonly arranged: Arranged;
  readonly specs: ReadonlyMap<string, ColumnSpec<Row>>;
  readonly children: ReactNode;
}): ReactNode {
  const [dragged, setDragged] = useState<string>();
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: DRAG_AFTER } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );
  const onDragEnd = ({ active, over }: DragEndEvent): void => {
    setDragged(undefined);
    // The fixed column is no place to drop: a column let go over it stays where it was.
    if (over === null || active.id === over.id || !movable.includes(String(over.id))) return;

    const [from, to] = [layout.order.indexOf(String(active.id)), layout.order.indexOf(String(over.id))];
    if (from !== -1 && to !== -1) layout.setOrder(arrayMove([...layout.order], from, to));
  };

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={closestCenter}
      modifiers={[restrictToHorizontalAxis]}
      onDragStart={({ active }) => setDragged(String(active.id))}
      onDragCancel={() => setDragged(undefined)}
      onDragEnd={onDragEnd}
      accessibility={{ announcements: announcementsOf(specs) }}
    >
      {children}
      <DragOverlay dropAnimation={null}>{dragged === undefined ? null : <div className={DRAGGED_LOOK}>{specs.get(dragged)?.header}</div>}</DragOverlay>
    </DndContext>
  );
}

/** Draw a table: headings that sort, and that move and resize where the table has a layout, the first column and the rows' actions held in place, and one row per item. */
export function DataTable<Row>({
  label,
  columns,
  rows,
  rowId,
  layout,
  sort,
  onSort,
  selected,
  opens,
  actions,
  actionsWidth = ICON_ACTIONS_WIDTH,
  loading = false,
  after,
  page,
  list,
  alongside,
  onFitted,
}: DataTableProps<Row>): ReactNode {
  const specs = useMemo(() => new Map(columns.map((column) => [column.id, column])), [columns]);
  const definitions = useMemo(() => columns.map(definitionOf), [columns]);
  const data = useMemo(() => [...rows] as object[], [rows]);
  const [frame, room] = useRoom();
  const shown = shownOf(columns, specs, layout);
  const shownIds = shown.map((spec) => spec.id);
  const [sized, fitted] = useFitted([rows, columns, shownIds.join(" "), sort.key, loading, room > 0], list === undefined ? undefined : `${list} ${shownIds.join(" ")}`);
  useTopOfPage(sized, page);
  useFittedTold(fitted, onFitted);
  const endWidth = actions === undefined ? 0 : actionsWidth;
  const widths = widthsForRoom(shown, alongside === undefined ? fitted : widestOf(fitted, alongside), layout?.sizes ?? NO_SIZES, room - endWidth);
  const { drawn, spare } = widths;
  // The table library is told the widths as drawn, so an edge that is dragged starts from where it is seen.
  const sizing = Object.fromEntries(drawn);
  const table = useTable({
    features: FEATURES,
    columns: definitions,
    data,
    manualSorting: true,
    columnResizeMode: "onChange",
    state: {
      columnOrder: shownIds,
      columnVisibility: Object.fromEntries(columns.filter((column) => !shownIds.includes(column.id)).map((column) => [column.id, false])),
      columnSizing: sizing,
      sorting: [{ id: sort.key, desc: sort.descending }],
    },
    onColumnSizingChange: layout === undefined ? undefined : (updater) => keepSizes(layout, sizing, typeof updater === "function" ? updater(sizing) : updater),
  });
  const headers = (table.getHeaderGroups()[0]?.headers ?? []) as readonly Head[];
  const arranged: Arranged | undefined =
    layout === undefined
      ? undefined
      : {
          layout,
          movable: shown.filter((spec) => spec.fixed !== true).map((spec) => spec.id),
          onNudge: (id, by) => layout.setSizes({ ...layout.sizes, [id]: Math.max(NARROWEST, (drawn.get(id) ?? NARROWEST) + by) }),
        };
  const drawnTable = (
    <>
      {/* The library's scroll area draws its bars whenever the table is longer or wider than its room, also where the system hides its own. Its content part tells it when the table's size changes. */}
      <ScrollArea ref={frame} className="min-h-0 flex-1">
        <ScrollAreaParts.Content>
          <table
            ref={sized}
            aria-label={label}
            aria-busy={loading}
            style={{ width: [...drawn.values()].reduce((sum, size) => sum + size, spare + endWidth) }}
            className={cn(TABLE_LOOK, table.store.state.columnResizing.isResizingColumn !== false && "cursor-col-resize select-none")}
          >
            <Widths shown={shown} widths={widths} endWidth={endWidth} />
            <thead className="sticky top-0 z-30">
              <HeadRow headers={headers} specs={specs} arranged={arranged} sort={sort} onSort={onSort} spare={spare > 0} withActions={actions !== undefined} />
            </thead>
            <tbody>
              {loading
                ? Array.from({ length: LOADING_ROWS }, (_, row) => row).map((row) => (
                    <LoadingRow key={row} cells={shown} spare={spare > 0} withActions={actions !== undefined} />
                  ))
                : rows.map((row) => (
                    <BodyRow
                      key={rowId(row)}
                      row={row}
                      cells={shown}
                      spare={spare > 0}
                      id={rowId(row)}
                      selected={rowId(row) === selected}
                      opens={opens}
                      actions={actions?.(row)}
                    />
                  ))}
            </tbody>
          </table>
          {/* As wide as the room, so it stays in view however far the table is scrolled sideways. */}
          {after === undefined ? null : (
            <div className="sticky left-0" style={{ width: room }}>
              {after}
            </div>
          )}
        </ScrollAreaParts.Content>
        <ScrollBar orientation="horizontal" />
      </ScrollArea>
    </>
  );

  return arranged === undefined ? drawnTable : <ColumnMoves arranged={arranged} specs={specs}>{drawnTable}</ColumnMoves>;
}
