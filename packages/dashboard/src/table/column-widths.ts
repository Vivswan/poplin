// How wide each shown column of a table is drawn in the room the table has, and where the table stops when it scrolls sideways.
// A column is as wide as a person made it, or as its heading and values need, up to a cap. Columns that fit the room are drawn side by side.
// Columns that do not are laid out in groups, each as wide as the room between the fixed column and the rows' actions, so the edge of that room never falls inside a column.

/** The narrowest any column is drawn, in pixels: room for the first letters of its heading and for the edge that resizes it. */
export const NARROWEST = 48;

/** The widest a column is drawn for its values' sake when it names no cap of its own, in pixels: one long value does not push the other columns out. */
const WIDEST_FITTED = 320;

/** What of a column its width is worked out from. */
export interface SizedColumn {
  /** The column's key. */
  readonly id: string;

  /** The widest it is drawn for its values' sake, in pixels; a person can still drag it wider. Left out, a general cap. */
  readonly widest?: number;

  /** The narrowest it is drawn to stay beside the columns before it, in pixels, where its own width has no room: for a column whose values can lose their middle. Left out, it moves to the next group whole. */
  readonly gives?: number;

  /** Whether it takes the room the columns beside it leave over: for a column whose values wrap or fill their cell. */
  readonly grows?: boolean;

  /** The one column that is always first and stays in place. */
  readonly fixed?: boolean;
}

/** The widths a table is drawn with. */
export interface ColumnWidths {
  /** The width of each shown column, in pixels, by column id. */
  readonly drawn: ReadonlyMap<string, number>;

  /** The empty room after the last column of a group, in pixels, by that column's id: what the group's columns leave over. */
  readonly gaps: ReadonlyMap<string, number>;

  /** The ids of the columns a sideways scroll stops at: the first of each group. Empty where every column fits the room. */
  readonly stops: readonly string[];
}

function sumOf(widths: Iterable<number>): number {
  return [...widths].reduce((sum, width) => sum + width, 0);
}

/**
 * The columns in groups: each takes as many as fit the room, in order, and a column wider than the room has a group to itself.
 *
 * A column that gives way is drawn as wide as the room its group has left, where that is no less than what it gives way to. One a person gave a width keeps it.
 *
 * @param drawn - the width of each column, which a column that gives way is written into
 */
function groupsOf(columns: readonly SizedColumn[], sizes: Readonly<Record<string, number>>, drawn: Map<string, number>, room: number): SizedColumn[][] {
  const groups: SizedColumn[][] = [];
  let left = 0;
  for (const column of columns) {
    const width = drawn.get(column.id) ?? 0;
    const squeezed = width > left && sizes[column.id] === undefined && column.gives !== undefined && column.gives <= left;
    if (groups.length === 0 || (width > left && !squeezed)) {
      groups.push([]);
      left = room;
    }
    if (squeezed) drawn.set(column.id, left);
    groups.at(-1)?.push(column);
    left -= drawn.get(column.id) ?? 0;
  }

  return groups;
}

/**
 * Place the room a group's columns leave over: the column that grows takes it, unless a person gave it a width; otherwise it stays empty after the group's last column.
 *
 * @param drawn - the width of each column, which a growing column's new width is written into
 * @returns the empty room after the group, by its last column's id, or nothing
 */
function spareOf(group: readonly SizedColumn[], sizes: Readonly<Record<string, number>>, drawn: Map<string, number>, room: number): [string, number][] {
  const spare = room - sumOf(group.map((column) => drawn.get(column.id) ?? 0));
  const last = group.at(-1);
  if (spare <= 0 || last === undefined) return [];

  const grower = group.find((column) => column.grows === true && sizes[column.id] === undefined);
  if (grower === undefined) return [[last.id, spare]];

  drawn.set(grower.id, (drawn.get(grower.id) ?? 0) + spare);

  return [];
}

/**
 * The width each shown column is drawn at, the room left empty, and where a sideways scroll stops.
 *
 * A width a person set wins over the fitted one. The fixed columns leave room for the narrowest of another column, and no other column is drawn wider than the room beside them.
 * Where the columns do not fit that room side by side, the table is wider than its room and scrolls sideways from one group of whole columns to the next.
 *
 * @param fitted - the width each column's heading and values need, in pixels, by column id; a column not measured yet is drawn at the narrowest
 * @param sizes - the widths a person set, by column id
 * @param free - the room for the columns, in pixels; 0 before the room is first measured, when every column is drawn at its own width
 */
export function widthsForRoom(
  shown: readonly SizedColumn[],
  fitted: ReadonlyMap<string, number>,
  sizes: Readonly<Record<string, number>>,
  free: number,
): ColumnWidths {
  const own = (column: SizedColumn): number =>
    Math.max(NARROWEST, sizes[column.id] ?? Math.min(Math.ceil(fitted.get(column.id) ?? 0), column.widest ?? WIDEST_FITTED));
  const drawn = new Map(shown.map((column) => [column.id, own(column)]));
  if (free <= 0) return { drawn, gaps: new Map(), stops: [] };

  const [fixed, moving] = [shown.filter((column) => column.fixed === true), shown.filter((column) => column.fixed !== true)];
  const others = moving.length === 0 ? 0 : NARROWEST;
  for (const column of fixed) drawn.set(column.id, Math.min(own(column), Math.max(NARROWEST, Math.floor((free - others) / fixed.length))));
  const beside = free - sumOf(fixed.map((column) => drawn.get(column.id) ?? 0));
  for (const column of moving) drawn.set(column.id, Math.min(own(column), beside));

  // With no other column the fixed ones have the room to themselves, and what they leave over stays empty after the last.
  const groups = moving.length === 0 ? [fixed] : groupsOf(moving, sizes, drawn, beside);
  const gaps = new Map(groups.flatMap((group) => spareOf(group, sizes, drawn, moving.length === 0 ? free : beside)));

  return { drawn, gaps, stops: groups.length > 1 ? groups.flatMap((group) => group[0]?.id ?? []) : [] };
}
