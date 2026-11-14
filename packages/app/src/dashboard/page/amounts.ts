// Sizes and moments as the dashboard shows them: one spelling for each, on every page.

import { html } from "hono/html";

import type { Html } from "../records";

/** The units a size is shown in, the largest first, and the bytes each holds: decimal, as the settings count sizes. */
const SHOWN_UNITS = [
  { unit: "GB", bytes: 1_000_000_000 },
  { unit: "MB", bytes: 1_000_000 },
  { unit: "KB", bytes: 1000 },
] as const;

/** The end of an ISO timestamp from its seconds on, whatever the length of its year. */
const SECONDS_ON = /:[0-9]{2}\.[0-9]{3}Z$/;

/**
 * Write a count of bytes for a person.
 *
 * @returns the count in its largest fitting decimal unit with at most one decimal, such as `1.2 MB`, or whole bytes below 1 KB
 */
export function showBytes(bytes: number): string {
  const fitting = SHOWN_UNITS.find((candidate) => bytes >= candidate.bytes);
  if (fitting === undefined) return `${bytes} B`;

  const amount = Math.round((bytes / fitting.bytes) * 10) / 10;

  return `${amount} ${fitting.unit}`;
}

/**
 * Write a moment for a person.
 *
 * @param moment - milliseconds since the epoch
 * @returns a `time` element reading `2026-11-14 09:30 UTC`; a moment no calendar holds is shown as its number
 */
export function showMoment(moment: number): Html {
  const date = new Date(moment);
  if (Number.isNaN(date.getTime())) return html`${String(moment)}`;

  const iso = date.toISOString();
  const shown = iso.replace("T", " ").replace(SECONDS_ON, " UTC");

  return html`<time datetime="${iso}">${shown}</time>`;
}
