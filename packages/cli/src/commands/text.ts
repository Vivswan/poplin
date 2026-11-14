// How the commands word a size, a day, a table, and a site, so every command prints them alike.

import type { ROUTES } from "../../../core/src/api/routes";

/** The units of a size, each a thousand of the one before, as the install's limits count them. */
const UNITS = ["B", "KB", "MB", "GB"] as const;

/** How many characters of an ISO moment are its day. */
const DAY_LENGTH = 10;

/** What stands between two columns of a row. */
const GAP = "  ";

/** A site as the API answers with it. */
export type SiteObject = NonNullable<(typeof ROUTES)["getSite"]["types"]>["done"]["site"];

/**
 * Word a count of bytes, such as `1.3 MB` or `80 KB`.
 *
 * @returns one decimal below ten of a unit, none from ten on, and whole bytes below a thousand
 */
export function sizeText(bytes: number): string {
  let amount = bytes;
  let unit = 0;

  while (amount >= 1000 && unit < UNITS.length - 1) {
    amount /= 1000;
    unit += 1;
  }

  const digits = unit === 0 || amount >= 10 ? 0 : 1;

  return `${amount.toFixed(digits)} ${UNITS[unit]}`;
}

/**
 * Word a moment as its day in UTC, such as `2026-12-01`.
 *
 * @param moment - milliseconds since the epoch; one no calendar holds is worded as the number it is
 */
export function dayText(moment: number): string {
  const date = new Date(moment);
  if (Number.isNaN(date.getTime())) return String(moment);

  return date.toISOString().slice(0, DAY_LENGTH);
}

/** Word a count with its noun: `1 file`, `42 files`. */
export function countText(count: number, noun: string): string {
  return `${count} ${noun}${count === 1 ? "" : "s"}`;
}

/**
 * Lay rows out in columns, each as wide as its longest cell.
 *
 * @returns one line per row, with no trailing space
 */
export function columns(rows: readonly (readonly string[])[]): string[] {
  const widths: number[] = [];

  for (const row of rows) {
    row.forEach((cell, at) => {
      widths[at] = Math.max(widths[at] ?? 0, cell.length);
    });
  }

  return rows.map((row) =>
    row
      .map((cell, at) => cell.padEnd(widths[at] ?? 0))
      .join(GAP)
      .trimEnd(),
  );
}

/**
 * The two lines every answer about one site ends in: what was done to which site, and its address alone on a line.
 *
 * @param done - the word for what was done, such as `made` or `restored`
 * @param facts - what else the first line says, after the label
 */
export function siteLines(done: string, site: SiteObject, facts: readonly string[]): string[] {
  return [[done, site.label, ...facts].join(GAP), site.url];
}

/**
 * The note for a search-engine switch that was turned on for a site that is not public.
 *
 * @returns one note, or none when the switch was not turned on or the site is public
 */
export function searchNotes(changes: { readonly search_engines?: boolean | undefined }, site: SiteObject): string[] {
  if (changes.search_engines !== true || site.access === "public") return [];

  return ["search engines list a site only once it is public; the setting is stored"];
}
