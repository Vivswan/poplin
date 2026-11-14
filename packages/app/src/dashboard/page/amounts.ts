// A moment as the dashboard shows it: one spelling, on every page.

import { html } from "hono/html";

import type { Html } from "../records";

/** The end of an ISO timestamp from its seconds on, whatever the length of its year. */
const SECONDS_ON = /:[0-9]{2}\.[0-9]{3}Z$/;

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
