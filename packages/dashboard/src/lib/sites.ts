// A site as the data routes answer it, and how its values are written for a person.

import type { InferResponseType } from "hono/client";

import type { api } from "@/lib/api";
import { dayIn, momentIn } from "@/lib/timezone";

/** A site as the data routes answer it. Times are milliseconds since the epoch. */
export type Site = InferResponseType<(typeof api.sites)[":site"]["$get"], 200>["site"];

/** Who can open a site. */
export type Access = Site["access"];

/** The accesses, from the most private on, with what each means. */
export const ACCESSES: readonly { readonly access: Access; readonly label: string; readonly means: string; readonly now: string }[] = [
  { access: "private", label: "Private", means: "Only users who can log in here.", now: "Private now." },
  { access: "unlisted", label: "Unlisted", means: "Anyone with the link. No login.", now: "Unlisted now." },
  { access: "public", label: "Public", means: "Everyone, at a public link.", now: "Public now." },
];

/** How many milliseconds a day holds. */
const DAY_MS = 86_400_000;

/** How a count is written: with its thousands set apart. */
const COUNT_FORMAT = new Intl.NumberFormat("en");

/** How a moment within a week is written: 2 days ago. */
const RELATIVE_FORMAT = new Intl.RelativeTimeFormat("en", { numeric: "auto" });

/** What stands between a site's name and its id in an address. A name never holds it, so a label without it holds no id. */
const ID_SEPARATOR = "--";

/** Where the site's own label ends in its part of an address: at the first dot, or at the end. */
const LABEL_END = /\.|$/;

/** Where an id ends in its label: at the dash after it, or at the end. An id holds no dash. */
const ID_END = /-|$/;

/** The most characters a site's name, or its public name, holds. */
export const LONGEST_NAME = 40;

/** What a site is called on a screen: its title, or its name where it has none. Its name is read in its link. */
export function shownName(site: Pick<Site, "name" | "title">): string {
  return site.title ?? site.name;
}

/**
 * Write a moment briefly: how long ago within a week, the day in the time zone a person chose otherwise.
 *
 * @param now - the moment it is read at
 */
export function shortMoment(moment: number, now: number = Date.now()): string {
  const days = Math.round((moment - now) / DAY_MS);
  if (Math.abs(days) >= 7) return dayIn(moment);

  if (days !== 0) return RELATIVE_FORMAT.format(days, "day");

  const hours = Math.round((moment - now) / 3_600_000);

  return hours === 0 ? "just now" : RELATIVE_FORMAT.format(hours, "hour");
}

/** Write a count with its thousands set apart: 38,373. */
export function showCount(count: number): string {
  return COUNT_FORMAT.format(count);
}

/** Write a moment whole, to the minute, in the time zone a person chose. */
export function wholeMoment(moment: number): string {
  return momentIn(moment);
}

/** Write when a site deletes itself. */
export function expiryOf(expires: Site["expires"]): string {
  return expires === "never" ? "Never" : dayIn(expires);
}

/** An address of a site as a screen writes it. */
export interface AddressParts {
  /** What every site's address starts with: the host and the path before the site's own part. Empty where the site's own part comes first. */
  readonly shared: string;

  /** The site's own part up to its id. */
  readonly before: string;

  /** The id the address holds, which is the key to the site once it is unlisted, so a screen leaves it out until it is asked for. Empty for an address that holds none, as a public name. */
  readonly hidden: string;

  /** What follows the id. */
  readonly after: string;
}

/**
 * Split an address of a site into the part every row shares, the site's own part, and the id a screen leaves out.
 *
 * An address another install gave the site holds that install's id, not this one's: it is read from the address itself, so both are split alike.
 *
 * @param address - the address, with its scheme
 * @param id - the site's id on this install
 * @returns the address without its scheme and last slash, in four parts that join to it
 */
export function addressParts(address: string, id: string): AddressParts {
  const plain = address.replace(/^https?:\/\//, "").replace(/\/$/, "");
  const cut = plain.lastIndexOf("/") + 1;
  const [shared, own] = [plain.slice(0, cut), plain.slice(cut)];
  // The id stands in the site's own label: the first label of a host, or the whole of a path's last part. A domain may hold two dashes of its own.
  const label = own.slice(0, own.search(LABEL_END));
  const [ownAt, namedAt] = [label.indexOf(id), label.indexOf(ID_SEPARATOR)];
  if (ownAt === -1 && namedAt === -1) return { shared, before: own, hidden: "", after: "" };

  // The site's own id is found wherever it stands, a label of an id alone included. Another install's is read from behind the name.
  const start = ownAt === -1 ? namedAt + ID_SEPARATOR.length : ownAt;
  const end = ownAt === -1 ? start + label.slice(start).search(ID_END) : start + id.length;

  return { shared, before: own.slice(0, start), hidden: own.slice(start, end), after: own.slice(end) };
}
