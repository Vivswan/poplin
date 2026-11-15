// What a table measures of itself in the page: the room it scrolls in, and the width each column's heading and values need.

import { type RefObject, useEffect, useLayoutEffect, useRef, useState } from "react";

/** The width of the area a table scrolls in, measured again whenever it changes: 0 until it is first measured. */
export function useRoom(): readonly [RefObject<HTMLDivElement | null>, number] {
  const frame = useRef<HTMLDivElement>(null);
  const [room, setRoom] = useState(0);
  useLayoutEffect(() => {
    const element = frame.current;
    if (element === null) return undefined;

    const watcher = new ResizeObserver(([entry]) => setRoom(entry?.contentRect.width ?? 0));
    watcher.observe(element);

    return () => watcher.disconnect();
  }, []);

  return [frame, room];
}

/**
 * Measure the width each column's heading and values need, by the column id its heading names in `data-column`.
 *
 * The browser lays the table out by its content for the moment of the reading, which no one sees: the table is put back before anything is drawn.
 */
function fittedWidths(table: HTMLTableElement): ReadonlyMap<string, number> {
  const parts = [table, ...table.querySelectorAll("col")];
  const kept = parts.map((part) => part.style.cssText);
  table.style.tableLayout = "auto";
  table.style.width = "max-content";
  for (const column of parts.slice(1)) column.style.width = "auto";
  const fitted = new Map(
    [...table.querySelectorAll<HTMLElement>("th[data-column]")].map((head) => [head.dataset.column ?? "", head.getBoundingClientRect().width]),
  );
  for (const [at, part] of parts.entries()) part.style.cssText = kept[at] ?? "";

  return fitted;
}

/**
 * The width each column's heading and values need, measured when what the table shows changes and once the page's fonts are in.
 *
 * @param shows - what the table shows, and whether it is in sight at all: a change of any of these is a reason to measure again; always the same count of them
 * @returns the reference to give the table, and the widths by column id, empty until the first measuring
 */
export function useFitted(shows: readonly unknown[]): readonly [RefObject<HTMLTableElement | null>, ReadonlyMap<string, number>] {
  const table = useRef<HTMLTableElement>(null);
  const [fitted, setFitted] = useState<ReadonlyMap<string, number>>(new Map());
  const [fonts, setFonts] = useState(false);
  useEffect(() => void document.fonts?.ready.then(() => setFonts(true)), []);
  // biome-ignore lint/correctness/useExhaustiveDependencies: the list is what the table shows, handed in by the table.
  useLayoutEffect(() => {
    if (table.current === null) return;

    const next = fittedWidths(table.current);
    // The same widths as before are no change: a new map would draw the table again for nothing, over and over.
    setFitted((before) => (before.size === next.size && [...next].every(([id, width]) => before.get(id) === width) ? before : next));
  }, [fonts, ...shows]);

  return [table, fitted];
}
