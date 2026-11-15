// The table every list of the dashboard is shown in. The server sorts and narrows the rows; the person arranges the columns: drags them into another order, drags an edge to resize, and chooses which are shown.
// Every chosen column is drawn, as wide as its values need or as a person made it.
// Where they do not fit the room the table scrolls sideways in its own area, between the first column and the rows' actions, which stay in place, and stops only where whole columns show.

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
import { ScrollArea as ScrollAreaParts } from "@base-ui/react/scroll-area";
import { cn } from "cn";
import { ArrowDownIcon, ArrowUpIcon, ChevronsUpDownIcon, Columns3Icon, GripVerticalIcon } from "lucide-react";
import {
  type CSSProperties,
  type FocusEvent,
  Fragment,
  type KeyboardEvent,
  type MouseEvent,
  type PointerEventHandler,
  type ReactNode,
  useMemo,
  useState,
} from "react";

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
import { type ColumnWidths, NARROWEST, type SizedColumn, widthsForRoom } from "@/table/column-widths";
import type { TableLayout } from "@/table/layout";
import { useFitted, useRoom } from "@/table/measure";

/** What of the table library this table uses. */
const FEATURES = tableFeatures({ rowSortingFeature, columnVisibilityFeature, columnOrderingFeature, columnSizingFeature, columnResizingFeature });

/** How far a press must move before it drags a column, in pixels: a shorter one is a click, which sorts. */
const DRAG_AFTER = 6;

/** The width of the last column where a row's actions are one icon, and how far one press of an arrow key moves a column's edge. */
const [ICON_ACTIONS_WIDTH, NUDGE] = [56, 16];

/** How many rows stand in for the rows being read. */
const LOADING_ROWS = 6;

/** What a press on these never does: open the row. */
const OWN_CONTROLS = "a, button, input, [role^='menu'], [role='dialog']";

/** The look of a heading's grip: it lies over the heading's far end, so it takes no room from the words, and shows when its heading is pointed at or it holds the focus. */
const GRIP_LOOK = cn(
  "absolute top-2 flex size-5 cursor-grab items-center justify-center rounded-sm bg-background text-faint opacity-0 outline-none active:cursor-grabbing",
  "group-hover/head:opacity-100 focus-visible:opacity-100 focus-visible:ring-2 focus-visible:ring-ring",
);

/** The look of the table: columns of the widths it is told, and hairlines drawn by the cells. */
const TABLE_LOOK = "mb-2.5 table-fixed border-separate border-spacing-0 text-sm";

/** The look of a heading while it is dragged to another place. */
const DRAGGED_LOOK = "flex h-9 w-fit cursor-grabbing items-center rounded-md border bg-popover px-3 text-xs text-foreground shadow-md";

/** How a table wider than its room scrolls sideways: one stop at a time, and a stop lies just past the fixed column. */
const STOPS_LOOK = cn(
  "[&>[data-slot=scroll-area-viewport]]:snap-x [&>[data-slot=scroll-area-viewport]]:snap-mandatory",
  "[&>[data-slot=scroll-area-viewport]]:scroll-pl-(--fixed-width)",
);

/** The look of a column's edge: a hairline that shows under the pointer, with the focus, and while it is dragged. */
const EDGE_LOOK = cn(
  "absolute top-0 right-0 z-10 m-0 flex h-full w-2.5 cursor-col-resize touch-none justify-end border-0 bg-transparent p-0 outline-none",
  "after:h-full after:w-px after:bg-transparent hover:after:bg-ring focus-visible:after:w-0.5 focus-visible:after:bg-ring",
);

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

  /** The order, the hidden columns, and the widths, as the person arranged them. */
  readonly layout: TableLayout;

  /** The order the rows are in. */
  readonly sort: Sort;

  /** Asked when a heading is pressed, with the order the press leads to: the column's first direction, then the other one, then none, which is the table's own. Left out for a table no heading orders. */
  readonly onSort?: (next: Sort | undefined) => void;

  /** The id of the row whose detail is open. */
  readonly selected?: string;

  /** Called when a row is pressed anywhere but on its own controls. Left out, a row opens nothing. */
  readonly onOpen?: (row: Row) => void;

  /** What sits at a row's end: its menu and its quick actions. Left out, the table has no such column. */
  readonly actions?: (row: Row) => ReactNode;

  /** The width of the last column, wide enough for a row's actions, in pixels; left out, the width of one icon. */
  readonly actionsWidth?: number;

  /** Whether the rows are being read for the first time: rows of the table's own shape stand in for them. */
  readonly loading?: boolean;

  /** What follows the last row, such as the way to the next page: it scrolls up and down with the rows, and stays in place when they scroll sideways. */
  readonly after?: ReactNode;
}

type Head = Header<typeof FEATURES, object, unknown>;

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

function HeadCell<Row>({
  header,
  spec,
  stop,
  gap,
  sort,
  onSort,
  onNudge,
}: {
  readonly header: Head;
  readonly spec: ColumnSpec<Row>;
  readonly stop: boolean;
  readonly gap: number;
  readonly sort: Sort;
  readonly onSort: ((next: Sort | undefined) => void) | undefined;
  readonly onNudge: (id: string, by: number) => void;
}): ReactNode {
  const fixed = spec.fixed === true;
  const { attributes, listeners, setNodeRef, isDragging, isOver, activeIndex, index } = useSortable({
    id: spec.id,
    disabled: { draggable: fixed, droppable: fixed },
  });
  const sorted = sort.key === spec.id;
  const sortable = spec.sortable !== undefined && onSort !== undefined;
  // The table library says which order a press leads to, from the order the rows are in and the column's first direction.
  const press = (): void => {
    const next = header.column.getNextSortingOrder();
    onSort?.(next === false ? undefined : { key: spec.id, descending: next === "desc" });
  };
  const words = <span className="truncate">{spec.header}</span>;
  const onEdgeKey = (event: KeyboardEvent): void => {
    if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;

    event.preventDefault();
    onNudge(spec.id, event.key === "ArrowLeft" ? -NUDGE : NUDGE);
  };

  return (
    <>
      <th
        ref={setNodeRef}
        scope="col"
        data-column={spec.id}
        aria-sort={ariaSort(sortable, spec.id, sort)}
        title={spec.header}
        className={cn(
          "group/head relative h-9 border-b bg-background p-0 text-left text-xs font-normal text-muted-foreground select-none",
          fixed && "sticky left-0 z-20",
          stop && "snap-start",
          isDragging && "opacity-40",
          landingMark(isOver, activeIndex, index),
        )}
      >
        <div
          className={cn("flex h-9 min-w-0 items-center gap-0.5 pr-3 pl-3", fixed && "pl-6", spec.numeric === true && "flex-row-reverse")}
          onPointerDown={fixed ? undefined : (listeners?.onPointerDown as PointerEventHandler | undefined)}
        >
          {sortable ? (
            <button
              type="button"
              onClick={press}
              className={cn(
                "-mx-1 flex min-w-0 items-center gap-1 rounded-sm px-1 py-0.5 outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring",
                sorted && "font-bold text-foreground",
              )}
            >
              {words}
              {sortArrow(sorted, sort.descending)}
            </button>
          ) : (
            words
          )}
          {fixed ? null : (
            <button
              type="button"
              {...attributes}
              {...listeners}
              aria-label={`Move the ${spec.header} column`}
              title="Drag to move the column"
              className={cn(GRIP_LOOK, spec.numeric === true ? "left-1" : "right-2.5")}
            >
              <GripVerticalIcon className="size-3.5" />
            </button>
          )}
        </div>
        <button
          type="button"
          aria-label={`Resize the ${spec.header} column`}
          title="Drag to resize; double-click to reset"
          onMouseDown={header.getResizeHandler()}
          onTouchStart={header.getResizeHandler()}
          onDoubleClick={() => header.column.resetSize()}
          onKeyDown={onEdgeKey}
          className={cn(EDGE_LOOK, header.column.getIsResizing() && "after:w-0.5 after:bg-ring")}
        />
      </th>
      {gap > 0 ? <td className="h-9 border-b bg-background p-0" /> : null}
    </>
  );
}

function BodyRow<Row>({
  row,
  cells,
  gaps,
  selected,
  onOpen,
  actions,
}: {
  readonly row: Row;
  readonly cells: readonly ColumnSpec<Row>[];
  readonly gaps: ReadonlyMap<string, number>;
  readonly selected: boolean;
  readonly onOpen?: (row: Row) => void;
  readonly actions?: ReactNode;
}): ReactNode {
  const onClick = (event: MouseEvent): void => {
    if (!(event.target as Element).closest(OWN_CONTROLS)) onOpen?.(row);
  };

  return (
    <tr
      data-state={selected ? "selected" : undefined}
      onClick={onClick}
      onMouseOver={hintWhenCut}
      onFocus={hintWhenCut}
      className={cn(
        "group/row bg-background hover:bg-muted has-[:focus-visible]:bg-muted data-[state=selected]:bg-chosen data-[state=selected]:has-[:focus-visible]:bg-chosen [&>td]:border-b",
        onOpen !== undefined && "cursor-pointer",
      )}
    >
      {cells.map((spec) => (
        <Fragment key={spec.id}>
          <td className={cn("h-11 bg-inherit px-3 py-0", spec.fixed === true && "sticky left-0 z-10 pl-6", spec.numeric === true && "text-right")}>
            <div className="truncate">{spec.cell(row)}</div>
          </td>
          {gaps.has(spec.id) ? <td className="h-11 bg-inherit p-0" /> : null}
        </Fragment>
      ))}
      {actions === undefined ? null : <td className="sticky right-0 z-10 h-11 bg-inherit py-0 pr-6 pl-1 text-right whitespace-nowrap">{actions}</td>}
    </tr>
  );
}

/** A row that stands in for one being read: the table's own height and columns, so nothing moves when the rows arrive. */
function LoadingRow<Row>({
  cells,
  gaps,
  withActions,
}: {
  readonly cells: readonly ColumnSpec<Row>[];
  readonly gaps: ReadonlyMap<string, number>;
  readonly withActions: boolean;
}): ReactNode {
  return (
    <tr className="[&>td]:border-b">
      {cells.map((spec) => (
        <Fragment key={spec.id}>
          <td className={cn("h-11 px-3 py-0", spec.fixed === true && "pl-6")}>
            <Skeleton className={cn("h-4", spec.fixed === true ? "w-32" : "w-16")} />
          </td>
          {gaps.has(spec.id) ? <td /> : null}
        </Fragment>
      ))}
      {withActions ? <td className="h-11" /> : null}
    </tr>
  );
}

/** The width the fixed columns take at the table's near edge, in pixels: a sideways scroll stops just past it. */
function sumOfFixed<Row>(shown: readonly ColumnSpec<Row>[], drawn: ReadonlyMap<string, number>): number {
  return shown.filter((spec) => spec.fixed === true).reduce((sum, spec) => sum + (drawn.get(spec.id) ?? 0), 0);
}

/** Say a cell's whole text in the hint a pointer shows, where the cell is too narrow for it. */
function hintWhenCut(event: MouseEvent | FocusEvent): void {
  const cell = (event.target as Element).closest<HTMLElement>("td > div");
  if (cell !== null) cell.title = cell.scrollWidth > cell.clientWidth ? (cell.textContent ?? "") : "";
}

/** The widths of a table's columns as the browser is told them: one per column, one per empty room after a group, and one for the rows' actions. */
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
        <Fragment key={spec.id}>
          <col style={{ width: widths.drawn.get(spec.id) }} />
          {widths.gaps.has(spec.id) ? <col style={{ width: widths.gaps.get(spec.id) }} /> : null}
        </Fragment>
      ))}
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
        {/* Beside an open panel the list is narrow: the button keeps its mark and gives its room to the search. */}
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

/** Draw a table: headings that sort, move, and resize, the first column and the rows' actions held in place, and one row per item. */
export function DataTable<Row>({
  label,
  columns,
  rows,
  rowId,
  layout,
  sort,
  onSort,
  selected,
  onOpen,
  actions,
  actionsWidth = ICON_ACTIONS_WIDTH,
  loading = false,
  after,
}: DataTableProps<Row>): ReactNode {
  const specs = useMemo(() => new Map(columns.map((column) => [column.id, column])), [columns]);
  const definitions = useMemo(() => columns.map(definitionOf), [columns]);
  const data = useMemo(() => [...rows] as object[], [rows]);
  const [frame, room] = useRoom();
  const [sized, fitted] = useFitted([rows, columns, layout.order, layout.hidden, sort.key, loading, room > 0]);
  const [dragged, setDragged] = useState<string>();
  const shown = layout.order.filter((id) => !layout.hidden.includes(id)).flatMap((id) => specs.get(id) ?? []);
  const endWidth = actions === undefined ? 0 : actionsWidth;
  const widths = widthsForRoom(shown, fitted, layout.sizes, room - endWidth);
  const { drawn, gaps, stops } = widths;
  // The table library is told the widths as drawn, so an edge that is dragged starts from where it is seen.
  const sizing = Object.fromEntries(drawn);
  const table = useTable({
    features: FEATURES,
    columns: definitions,
    data,
    manualSorting: true,
    columnResizeMode: "onChange",
    state: {
      columnOrder: [...layout.order],
      columnVisibility: Object.fromEntries(layout.hidden.map((id) => [id, false])),
      columnSizing: sizing,
      sorting: [{ id: sort.key, desc: sort.descending }],
    },
    onColumnSizingChange: (updater) => keepSizes(layout, sizing, typeof updater === "function" ? updater(sizing) : updater),
  });
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: DRAG_AFTER } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );
  const headers = (table.getHeaderGroups()[0]?.headers ?? []) as readonly Head[];
  const movable = shown.filter((spec) => spec.fixed !== true).map((spec) => spec.id);

  const onDragEnd = ({ active, over }: DragEndEvent): void => {
    setDragged(undefined);
    // The fixed column is no place to drop: a column let go over it stays where it was.
    if (over === null || active.id === over.id || !movable.includes(String(over.id))) return;

    const [from, to] = [layout.order.indexOf(String(active.id)), layout.order.indexOf(String(over.id))];
    if (from !== -1 && to !== -1) layout.setOrder(arrayMove([...layout.order], from, to));
  };
  const onNudge = (id: string, by: number): void => {
    if (specs.has(id)) layout.setSizes({ ...layout.sizes, [id]: Math.max(NARROWEST, (drawn.get(id) ?? NARROWEST) + by) });
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
      {/* The library's scroll area draws its bars whenever the table is longer or wider than its room, also where the system hides its own. Its content part tells it when the table's size changes. */}
      <ScrollArea
        ref={frame}
        className={cn("min-h-0 flex-1", stops.length > 0 && STOPS_LOOK)}
        style={{ "--fixed-width": `${sumOfFixed(shown, drawn)}px` } as CSSProperties}
      >
        <ScrollAreaParts.Content>
          <table
            ref={sized}
            aria-label={label}
            aria-busy={loading}
            style={{ width: [...drawn.values(), ...gaps.values()].reduce((sum, size) => sum + size, endWidth) }}
            className={cn(TABLE_LOOK, table.store.state.columnResizing.isResizingColumn !== false && "cursor-col-resize select-none")}
          >
            <Widths shown={shown} widths={widths} endWidth={endWidth} />
            <thead className="sticky top-0 z-30">
              <tr>
                <SortableContext items={movable} strategy={horizontalListSortingStrategy}>
                  {headers.map((header) => {
                    const spec = specs.get(header.column.id);

                    const place = { stop: stops.includes(header.column.id), gap: gaps.get(header.column.id) ?? 0 };

                    return spec === undefined ? null : (
                      <HeadCell key={header.id} header={header} spec={spec} {...place} sort={sort} onSort={onSort} onNudge={onNudge} />
                    );
                  })}
                </SortableContext>
                {actions === undefined ? null : (
                  <th className="sticky right-0 h-9 border-b bg-background p-0">
                    <span className="sr-only">Actions</span>
                  </th>
                )}
              </tr>
            </thead>
            <tbody>
              {loading
                ? Array.from({ length: LOADING_ROWS }, (_, row) => row).map((row) => (
                    <LoadingRow key={row} cells={shown} gaps={gaps} withActions={actions !== undefined} />
                  ))
                : rows.map((row) => (
                    <BodyRow key={rowId(row)} row={row} cells={shown} gaps={gaps} selected={rowId(row) === selected} onOpen={onOpen} actions={actions?.(row)} />
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
      <DragOverlay dropAnimation={null}>{dragged === undefined ? null : <div className={DRAGGED_LOOK}>{specs.get(dragged)?.header}</div>}</DragOverlay>
    </DndContext>
  );
}
