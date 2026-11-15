// How wide each shown column of a table is drawn in the room the table has.
// A column is as wide as a person made it, or as its heading and values need, up to a cap. Room the columns leave over goes to the column that grows, or stays empty after the last one.
// Columns that need a little more than the room fit it where a value gives: a part of it is cut shorter, down to the least the cell allows.
// Columns that need more than that are drawn at that least: the table is then wider than its room and scrolls sideways by the rest.

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

/** What a table measured of its columns, each in pixels by column id. A column not measured yet is in neither. */
export interface Fitted {
  /** The width a column's heading and values need. */
  readonly needs: ReadonlyMap<string, number>;

  /** The least a column can be drawn at with nothing lost but the end of a value that gives. The same as its need for a column whose values do not give. */
  readonly least: ReadonlyMap<string, number>;
}

/** The widths a table is drawn with. */
export interface ColumnWidths {
  /** The width of each shown column, in pixels, by column id. */
  readonly drawn: ReadonlyMap<string, number>;

  /** The empty room after the last column, in pixels: what the columns leave over where none grows. 0 where they fill the room or need more than it. */
  readonly spare: number;
}

/**
 * The widths of columns that need more than their room, with the columns nobody sized drawn as much narrower as their values give.
 *
 * @param drawn - the width of each column before anything gives
 * @param over - how much more than the room the columns need, in pixels
 * @returns the widths that fit the room, or, where the values give less than `over`, each column at the least its values allow
 */
function fitting(
  shown: readonly SizedColumn[],
  drawn: ReadonlyMap<string, number>,
  { fitted, sizes, over }: { readonly fitted: Fitted; readonly sizes: Readonly<Record<string, number>>; readonly over: number },
): ReadonlyMap<string, number> {
  const gives = (column: SizedColumn): number => {
    const width = drawn.get(column.id) ?? 0;
    if (sizes[column.id] !== undefined) return 0;

    return Math.max(0, width - Math.max(NARROWEST, Math.ceil(fitted.least.get(column.id) ?? width)));
  };
  const narrower = new Map(drawn);
  let left = over;
  for (const column of shown) {
    const given = Math.min(left, gives(column));
    narrower.set(column.id, (drawn.get(column.id) ?? 0) - given);
    left -= given;
  }

  return narrower;
}

/**
 * The width each shown column is drawn at, and the room left empty after the last.
 *
 * A width a person set wins over the fitted one. Columns that need more than the room give what their values can, and the table scrolls sideways by what is still missing.
 * Only a fixed column is held back, so the narrowest of another column stays in reach.
 *
 * @param fitted - what the table measured of each column; a column not measured yet is drawn at the narrowest
 * @param sizes - the widths a person set, by column id
 * @param free - the room for the columns, in pixels; 0 before the room is first measured
 */
export function widthsForRoom(
  shown: readonly SizedColumn[],
  fitted: Fitted,
  sizes: Readonly<Record<string, number>>,
  free: number,
): ColumnWidths {
  const own = (column: SizedColumn): number =>
    Math.max(NARROWEST, sizes[column.id] ?? Math.min(Math.ceil(fitted.needs.get(column.id) ?? 0), column.widest ?? WIDEST_FITTED));
  const drawn = new Map(shown.map((column) => [column.id, own(column)]));
  if (free <= 0) return { drawn, spare: 0 };

  const fixed = shown.filter((column) => column.fixed === true);
  const others = shown.length === fixed.length ? 0 : NARROWEST;
  for (const column of fixed) drawn.set(column.id, Math.min(own(column), Math.max(NARROWEST, Math.floor((free - others) / fixed.length))));

  const spare = free - [...drawn.values()].reduce((sum, width) => sum + width, 0);
  if (spare < 0) return { drawn: fitting(shown, drawn, { fitted, sizes, over: -spare }), spare: 0 };

  if (spare === 0) return { drawn, spare: 0 };

  if (!shown.some((column) => column.grows === true)) return { drawn, spare };

  const unsized = shown.filter((column) => sizes[column.id] === undefined);
  const loose = (column: SizedColumn): boolean => column.fixed !== true;
  // Where a person gave the growing column a width, the room goes to the last column nobody sized, and then to the last column: none stays empty between the columns.
  const grower = unsized.find((column) => column.grows === true) ?? unsized.findLast(loose) ?? shown.findLast(loose);
  if (grower === undefined) return { drawn, spare };

  drawn.set(grower.id, (drawn.get(grower.id) ?? 0) + spare);

  return { drawn, spare: 0 };
}
