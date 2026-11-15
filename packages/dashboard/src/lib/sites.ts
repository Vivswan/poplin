// A site as the data routes answer it, and how its values are written for a person.

import type { InferResponseType } from "hono/client";

import type { api } from "@/lib/api";

/** A site as the data routes answer it. Times are milliseconds since the epoch. */
export type Site = InferResponseType<(typeof api.sites)[":site"]["$get"], 200>["site"];

/** Who can open a site. */
export type Access = Site["access"];

/** The accesses, from the most private on, with what each means. */
export const ACCESSES: readonly { readonly access: Access; readonly label: string; readonly means: string; readonly now: string }[] = [
  { access: "private", label: "Private", means: "Only people who can log in here.", now: "Private now." },
  { access: "unlisted", label: "Unlisted", means: "Anyone with the link. No login.", now: "Unlisted now." },
  { access: "public", label: "Public", means: "Everyone, at a public link.", now: "Public now." },
];

/** How many milliseconds a day holds. */
const DAY_MS = 86_400_000;

/** How a day is written: 14 Nov 2026. */
const DAY_FORMAT = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });

/** How a moment is written whole: the day and the time to the minute, in UTC. */
const MOMENT_FORMAT = new Intl.DateTimeFormat("en-GB", {
  day: "numeric",
  month: "short",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
  timeZone: "UTC",
  timeZoneName: "short",
});

/** How a count is written: with its thousands set apart. */
const COUNT_FORMAT = new Intl.NumberFormat("en");

/** How a moment within a week is written: 2 days ago. */
const RELATIVE_FORMAT = new Intl.RelativeTimeFormat("en", { numeric: "auto" });

/**
 * Write a moment briefly: how long ago within a week, the day otherwise.
 *
 * @param now - the moment it is read at
 */
export function shortMoment(moment: number, now: number = Date.now()): string {
  const days = Math.round((moment - now) / DAY_MS);
  if (Math.abs(days) >= 7) return DAY_FORMAT.format(moment);

  if (days !== 0) return RELATIVE_FORMAT.format(days, "day");

  const hours = Math.round((moment - now) / 3_600_000);

  return hours === 0 ? "just now" : RELATIVE_FORMAT.format(hours, "hour");
}

/** Write a count with its thousands set apart: 38,373. */
export function showCount(count: number): string {
  return COUNT_FORMAT.format(count);
}

/** Write a moment whole, to the minute, in UTC. */
export function wholeMoment(moment: number): string {
  return MOMENT_FORMAT.format(moment);
}

/** Write when a site deletes itself. */
export function expiryOf(expires: Site["expires"]): string {
  return expires === "never" ? "Never" : DAY_FORMAT.format(expires);
}

/** An address of a site as a screen writes it. */
export interface AddressParts {
  /** What every site's address starts with: the host and the path before the site's own part. Empty where the site's own part comes first. */
  readonly shared: string;

  /** The site's own part up to its id. */
  readonly before: string;

  /** The site's id, which is the key to the site once it is unlisted, so a screen leaves it out until it is asked for. Empty for an address that holds none, as a public name. */
  readonly hidden: string;

  /** What follows the id. */
  readonly after: string;
}

/**
 * Split an address of a site into the part every row shares, the site's own part, and the id a screen leaves out.
 *
 * @param address - the address, with its scheme
 * @param id - the site's id
 * @returns the address without its scheme and last slash, in four parts that join to it
 */
export function addressParts(address: string, id: string): AddressParts {
  const plain = address.replace(/^https?:\/\//, "").replace(/\/$/, "");
  const cut = plain.lastIndexOf("/") + 1;
  const [shared, own] = [plain.slice(0, cut), plain.slice(cut)];
  const at = own.indexOf(id);
  if (at === -1) return { shared, before: own, hidden: "", after: "" };

  return { shared, before: own.slice(0, at), hidden: id, after: own.slice(at + id.length) };
}
