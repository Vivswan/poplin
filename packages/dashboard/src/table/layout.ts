// A table's layout as one person arranged it: the order of its columns, which are hidden, and how wide each is. It is kept in the browser, under the table's own key.

import { useCallback, useMemo, useState } from "react";
import useLocalStorageState from "use-local-storage-state";

/** What of a column the layout needs to know. */
export interface LayoutColumn {
  /** The column's key. */
  readonly id: string;

  /** A fixed column is always first and always shown. */
  readonly fixed?: boolean;

  /** A column hidden until it is chosen. */
  readonly hidden?: boolean;
}

/** A layout, and the ways to change it. Every change is kept at once. */
export interface TableLayout {
  /** Every column's id, the fixed one first, in the order shown. */
  readonly order: readonly string[];

  /** The ids of the hidden columns. */
  readonly hidden: readonly string[];

  /** The widths that were changed, in pixels, by column id. */
  readonly sizes: Readonly<Record<string, number>>;

  /** Keeps another order. */
  readonly setOrder: (order: readonly string[]) => void;

  /** Hides or shows one column. */
  readonly setHidden: (id: string, hidden: boolean) => void;

  /** Keeps the changed widths. */
  readonly setSizes: (sizes: Readonly<Record<string, number>>) => void;

  /** The ids of the chosen columns the table has no room for at its width: they are chosen still, and not drawn. */
  readonly noRoom: readonly string[];

  /** Told by the table which chosen columns it has no room for. This is not kept: it follows the table's width. */
  readonly setNoRoom: (ids: readonly string[]) => void;

  /** Whether anything differs from the layout the table starts with. */
  readonly changed: boolean;

  /** Goes back to the layout the table starts with. */
  readonly reset: () => void;
}

/** What is kept. */
interface Kept {
  readonly order: readonly string[];
  readonly hidden: readonly string[];
  readonly sizes: Readonly<Record<string, number>>;
}

/** The first part of every key the layouts are kept under. */
const KEY_PREFIX = "poplin.table.";

/** The narrowest and the widest a kept width may be. */
const [NARROWEST, WIDEST] = [56, 4000];

function startOf(columns: readonly LayoutColumn[]): Kept {
  const fixed = columns.filter((column) => column.fixed === true);
  const free = columns.filter((column) => column.fixed !== true);

  return {
    order: [...fixed, ...free].map((column) => column.id),
    hidden: free.filter((column) => column.hidden === true).map((column) => column.id),
    sizes: {},
  };
}

/** Keep of what the browser kept only what the table's columns still allow: a column that is gone is dropped, a new one goes last, and the fixed one stays first and shown. Anything that is no layout is the layout the table starts with. */
function allowedOf(stored: unknown, columns: readonly LayoutColumn[]): Kept {
  const start = startOf(columns);
  const { order, hidden, sizes } = (typeof stored === "object" && stored !== null ? stored : {}) as { readonly [Part in keyof Kept]?: unknown };
  if (!Array.isArray(order) || !Array.isArray(hidden)) return start;

  const fixed = new Set(columns.filter((column) => column.fixed === true).map((column) => column.id));
  const known = new Set(start.order);
  const kept = order.filter((id): id is string => known.has(id) && !fixed.has(id));
  const widths = Object.entries(typeof sizes === "object" && sizes !== null ? sizes : {}).filter(
    (entry): entry is [string, number] => known.has(entry[0]) && typeof entry[1] === "number" && entry[1] >= NARROWEST && entry[1] <= WIDEST,
  );

  return {
    order: [...start.order.filter((id) => fixed.has(id)), ...kept, ...start.order.filter((id) => !fixed.has(id) && !kept.includes(id))],
    hidden: hidden.filter((id): id is string => known.has(id) && !fixed.has(id)),
    sizes: Object.fromEntries(widths),
  };
}

/**
 * Keep one table's layout in the browser.
 *
 * A browser that keeps nothing still shows the layout until the page is left, and a layout changed in another tab shows here too.
 *
 * @param key - the table's name, such as `sites`; each table has its own layout
 * @param columns - every column the table can show
 */
export function useTableLayout(key: string, columns: readonly LayoutColumn[]): TableLayout {
  const [stored, keep, { removeItem }] = useLocalStorageState<unknown>(`${KEY_PREFIX}${key}`);
  const kept = useMemo(() => allowedOf(stored, columns), [stored, columns]);
  const start = useMemo(() => startOf(columns), [columns]);
  const [noRoom, keepNoRoom] = useState<readonly string[]>([]);
  // The same ids told again are the same list, so a table that draws again does not draw its screen again.
  const setNoRoom = useCallback((ids: readonly string[]) => keepNoRoom((told) => (told.join(" ") === ids.join(" ") ? told : ids)), []);

  return {
    ...kept,
    setOrder: (order) => keep({ ...kept, order }),
    setHidden: (id, hidden) =>
      keep({ ...kept, hidden: hidden ? [...kept.hidden.filter((other) => other !== id), id] : kept.hidden.filter((other) => other !== id) }),
    setSizes: (sizes) => keep({ ...kept, sizes }),
    noRoom,
    setNoRoom,
    changed: JSON.stringify(kept) !== JSON.stringify(start),
    reset: removeItem,
  };
}
