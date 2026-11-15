// How wide each shown column of a table is drawn in the room the table has.
// A column is as wide as a person made it, or as its heading and values need, up to a cap. Room the columns leave over goes to the column that grows, or stays empty after the last one.
// Columns that need more than the room keep their widths: the table is then wider than its room and scrolls sideways.

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

  /** Whether it takes the room the columns leave over: for a column whose values wrap or fill their cell. */
  readonly grows?: boolean;

  /** The one column that is always first and stays in place. */
  readonly fixed?: boolean;
}

/** The widths a table is drawn with. */
export interface ColumnWidths {
  /** The width of each shown column, in pixels, by column id. */
  readonly drawn: ReadonlyMap<string, number>;

  /** The empty room after the last column, in pixels: what the columns leave over where none grows. 0 where they fill the room or need more than it. */
  readonly spare: number;
}

/**
 * The width each shown column is drawn at, and the room left empty after the last.
 *
 * A width a person set wins over the fitted one, and no column is drawn narrower for the room's sake: where the columns need more than the room, the table scrolls sideways.
 * Only a fixed column is held back, so that the narrowest of another column stays in reach beside it.
 *
 * @param fitted - the width each column's heading and values need, in pixels, by column id; a column not measured yet is drawn at the narrowest
 * @param sizes - the widths a person set, by column id
 * @param free - the room for the columns, in pixels; 0 before the room is first measured
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
  if (free <= 0) return { drawn, spare: 0 };

  const fixed = shown.filter((column) => column.fixed === true);
  const others = shown.length === fixed.length ? 0 : NARROWEST;
  for (const column of fixed) drawn.set(column.id, Math.min(own(column), Math.max(NARROWEST, Math.floor((free - others) / fixed.length))));

  const spare = free - [...drawn.values()].reduce((sum, width) => sum + width, 0);
  if (spare <= 0) return { drawn, spare: 0 };

  if (!shown.some((column) => column.grows === true)) return { drawn, spare };

  const unsized = shown.filter((column) => sizes[column.id] === undefined);
  const loose = (column: SizedColumn): boolean => column.fixed !== true;
  // Where a person gave the growing column a width, the room goes to the last column nobody sized, and then to the last column: none stays empty between the columns.
  const grower = unsized.find((column) => column.grows === true) ?? unsized.findLast(loose) ?? shown.findLast(loose);
  if (grower === undefined) return { drawn, spare };

  drawn.set(grower.id, (drawn.get(grower.id) ?? 0) + spare);

  return { drawn, spare: 0 };
}
