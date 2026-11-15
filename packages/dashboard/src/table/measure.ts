// What a table measures of itself in the page: the room it scrolls in, and the width each column's heading and values need.

import { type RefObject, useLayoutEffect, useRef, useState } from "react";

import { useTimeZoneChoice } from "@/lib/timezone";
import type { Fitted } from "@/table/column-widths";

/** The widths of a table nothing was measured of yet. */
const UNMEASURED: Fitted = { needs: new Map(), least: new Map() };

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

/** The width of each column as the table is laid out now, by the column id its heading names in `data-column`. */
function headWidths(table: HTMLTableElement): ReadonlyMap<string, number> {
  return new Map([...table.querySelectorAll<HTMLElement>("th[data-column]")].map((head) => [head.dataset.column ?? "", head.getBoundingClientRect().width]));
}

/**
 * Measure the width each column's heading and values need, and the least each can be drawn at with every value that gives cut to its shortest.
 *
 * A value gives where a cell marks a part of it with `data-gives`: that part may be cut down to its own least width, which its style names.
 * The browser lays the table out by its content for the moment of the reading, which no one sees: the table is put back before anything is drawn.
 */
function fittedWidths(table: HTMLTableElement): Fitted {
  const giving = [...table.querySelectorAll<HTMLElement>("[data-gives]")];
  const parts = [table, ...table.querySelectorAll("col"), ...giving];
  const kept = parts.map((part) => part.style.cssText);
  table.style.tableLayout = "auto";
  table.style.width = "max-content";
  for (const column of table.querySelectorAll("col")) column.style.width = "auto";
  const needs = headWidths(table);
  for (const part of giving) part.style.maxWidth = getComputedStyle(part).minWidth;
  const least = headWidths(table);
  for (const [at, part] of parts.entries()) part.style.cssText = kept[at] ?? "";

  return { needs, least };
}

/** The font a table's text is drawn in, as the page's loader of fonts takes it. */
function fontOf(table: HTMLTableElement): string {
  const { fontStyle, fontWeight, fontSize, fontFamily } = getComputedStyle(table);

  return `${fontStyle} ${fontWeight} ${fontSize} ${fontFamily}`;
}

/** Whether two readings of a table's columns are the same widths. */
function sameWidths(one: ReadonlyMap<string, number>, other: ReadonlyMap<string, number>): boolean {
  return one.size === other.size && [...other].every(([id, width]) => one.get(id) === width);
}

/**
 * The widths each column's heading and values need, measured when what the table shows changes, again once every font its text is drawn in has arrived, and when a person chooses another time zone, which makes a written time longer or shorter.
 *
 * @param shows - what the table shows, and whether it is in sight at all: a change of any of these is a reason to measure again; always the same count of them
 * @returns the reference to give the table, and the widths, empty until the first measuring
 */
export function useFitted(shows: readonly unknown[]): readonly [RefObject<HTMLTableElement | null>, Fitted] {
  const table = useRef<HTMLTableElement>(null);
  const [fitted, setFitted] = useState<Fitted>(UNMEASURED);
  const [timeZone] = useTimeZoneChoice();
  // biome-ignore lint/correctness/useExhaustiveDependencies: the list is what the table shows, handed in by the table.
  useLayoutEffect(() => {
    const element = table.current;
    if (element === null) return undefined;

    const measure = (): void => {
      const next = fittedWidths(element);
      // The same widths as before are no change: a new map would draw the table again for nothing, over and over.
      setFitted((before) => (sameWidths(before.needs, next.needs) && sameWidths(before.least, next.least) ? before : next));
    };
    measure();

    // A font still on its way leaves the text in another one for now, with other widths. The loader answers once every font this very text needs is in:
    // the page's own promise that its fonts are ready answers before a font was asked for at all in one engine.
    let shown = true;
    const arrived = document.fonts?.load(fontOf(element), element.textContent ?? "");
    void arrived?.then(
      () => (shown ? measure() : undefined),
      () => undefined,
    );

    return () => {
      shown = false;
    };
  }, [timeZone, ...shows]);

  return [table, fitted];
}
