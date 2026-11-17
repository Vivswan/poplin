// The settings of one site as a caller asks for them, checked into what the database takes, and applied.

import * as v from "valibot";

import type { Database, Signed, SiteDetails } from "../database/database";
import { parsePublicName, parseSiteName, type ReservedNames, type SiteName } from "../names/names";
import { MOST_DAYS, type SettingValues, spanSeconds } from "../records/settings";
import type { Site, SiteAccess } from "../records/site";
import type { SiteId } from "../sites/ids";
import { type Refused, refuse } from "./records";

/** A time span as typed: a whole number from 1 and its unit, such as `7d`. */
const SPAN_PATTERN = /^([1-9]\d*)([smhd])$/;

/** A calendar day as typed, such as `2026-12-01`. */
const DAY_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

/** How many characters of an ISO timestamp are its day. */
const DAY_LENGTH = 10;

/** The last moment a date holds, in milliseconds since the epoch: a later one can be neither shown nor compared as a date. */
const LAST_MOMENT = 8_640_000_000_000_000;

/** A control character or a line break, which a title shown on one line cannot hold. */
const LINE_BREAKER = /[\p{Cc}\p{Zl}\p{Zp}]/u;

/** The longest title a caller may type, in characters: a longer one is refused, so no list of sites carries a title of any length. */
export const MAX_TITLE_LENGTH = 200;

/** The longest title of a page a site keeps, in characters: a longer one is cut, since it comes from the file and not from a person. */
export const MAX_PAGE_TITLE_LENGTH = 200;

/** A high surrogate at the end of a text: a cut that leaves one has cut a surrogate pair in two. */
const HIGH_SURROGATE_AT_END = /[\uD800-\uDBFF]$/;

/** What every title holds to: one line. */
const ONE_LINE = v.check((title: string) => !LINE_BREAKER.test(title), "a title holds no control character and no line break");

/** A title as a caller types it. */
export const TITLE_TEXT = v.pipe(v.string(), v.maxLength(MAX_TITLE_LENGTH), ONE_LINE);

/** The title of a page as a publish sends it, cut to the length a site keeps. Only what is kept has to be one line. */
export const PAGE_TITLE_TEXT = v.pipe(v.string(), v.transform(cutPageTitle), ONE_LINE);

/** What a caller may ask of a site's settings; every key is optional, and no other key is taken. */
export const SITE_CHANGES = v.strictObject({
  name: v.optional(v.string()),
  access: v.optional(v.picklist(["private", "unlisted", "public"])),
  public_name: v.optional(v.string()),
  title: v.optional(v.nullable(TITLE_TEXT)),
  search_engines: v.optional(v.boolean()),
  embeddable: v.optional(v.boolean()),
  expires: v.optional(v.string()),
});

/**
 * The settings a caller asks for, on a publish or on their own. `name` renames a site: its label changes, and its id and its public name stay.
 *
 * `public_name` goes with `access: "public"` alone. Left out, a public site keeps the one it holds, and a site going public takes its own name.
 *
 * A `title` is the typed title: `null` or `""` takes it away, and the site then shows its page's own title. A title holds at most 200 characters, no control character, and no line break.
 *
 * `expires` is `"never"`, a span from now such as `"7d"` (units `s`, `m`, `h`, `d`), a day such as `"2026-12-01"`, which is that day's start in UTC, or a moment such as `"2026-12-01T08:30:00.000Z"`.
 */
export type SiteChanges = v.InferInput<typeof SITE_CHANGES>;

/** A time span as the settings count one. */
type Span = Exclude<SettingValues["default_expires"], "never">;

/** What the changes are checked against. */
interface Ground {
  /** The name of the site, which a site going public takes as its public name unless another is asked for. */
  readonly name: SiteName;

  /** Who may open the site now; absent for a site that is not made yet. */
  readonly current?: SiteAccess;

  /** The moment a span of time is counted from, and that an expiry must lie after. */
  readonly now: number;

  /** The public names the install's address layout keeps for itself. */
  readonly reserved: ReservedNames;
}

/** The changes in the database's terms. `access` is absent when none was asked for. */
export interface CheckedChanges {
  readonly ok: true;
  readonly access?: SiteAccess;
  readonly details: SiteDetails;
}

/** Cut a title to a length, and never through a surrogate pair. */
export function cutTitle(title: string, length: number): string {
  return title.slice(0, length).replace(HIGH_SURROGATE_AT_END, "");
}

/** Cut the title of a page to the length a site keeps. */
function cutPageTitle(title: string): string {
  return cutTitle(title, MAX_PAGE_TITLE_LENGTH);
}

/**
 * The moment a calendar day starts in UTC. This is the one place a typed day is checked.
 *
 * @param text - a day as typed, such as `2026-12-01`
 * @returns milliseconds since the epoch, or `undefined` for text in another form and for a day no month has
 */
export function dayStart(text: string): number | undefined {
  if (!DAY_PATTERN.test(text)) return undefined;

  // The parser takes a day no month has, such as a 31st of February, as a day of the next month: the round trip refuses it.
  const moment = Date.parse(`${text}T00:00:00Z`);
  if (Number.isNaN(moment) || new Date(moment).toISOString().slice(0, DAY_LENGTH) !== text) return undefined;

  return moment;
}

/** The moment a text names when it is written the one way a date writes itself: in UTC, to the millisecond. */
function writtenMoment(text: string): number | undefined {
  const moment = Date.parse(text);
  if (Number.isNaN(moment) || new Date(moment).toISOString() !== text) return undefined;

  return moment;
}

function momentOf(text: string, now: number): number | undefined {
  const [, count, unit] = SPAN_PATTERN.exec(text) ?? [];
  if (count === undefined) return dayStart(text) ?? writtenMoment(text);

  // A span typed for one site is as long as the install's own default may be, and no longer.
  const seconds = spanSeconds({ count: Number(count), unit: unit as Span["unit"] });

  return seconds > spanSeconds({ count: MOST_DAYS, unit: "d" }) ? undefined : now + seconds * 1000;
}

/**
 * Decide whether a text is a time span as typed, whatever its length: a whole number from 1 and its unit, such as `7d`.
 */
export function isSpan(text: string): boolean {
  return SPAN_PATTERN.test(text);
}

/**
 * Read an expiry as a caller types it. This is the one place the bound of an expiry is decided.
 *
 * @param text - `never`, a span from `now` such as `7d`, a day such as `2026-12-01`, or a moment such as `2026-12-01T08:30:00.000Z`
 * @param now - the moment a span is counted from, in milliseconds since the epoch
 * @returns `"never"`, the moment in whole milliseconds, or `undefined` for text in no such form, for a span of more days than a setting takes, for a moment that is not after `now`, and for one past the last moment a date holds
 */
export function readExpires(text: string, now: number): "never" | number | undefined {
  if (text === "never") return "never";

  const moment = momentOf(text, now);
  if (moment === undefined || !Number.isSafeInteger(moment) || moment <= now || moment > LAST_MOMENT) return undefined;

  return moment;
}

function readAccess(asked: SiteChanges, ground: Ground): SiteAccess | undefined | Refused<"bad_argument" | "bad_name" | "reserved_name"> {
  if (asked.access === "public") {
    // A public name left out is a setting left out: the site keeps the one it holds.
    if (asked.public_name === undefined && ground.current?.access === "public") return { access: "public", public_name: ground.current.public_name };

    const publicName = parsePublicName(asked.public_name ?? ground.name, ground.reserved);
    if (!publicName.ok) return refuse(publicName.refusal === "reserved" ? "reserved_name" : "bad_name", "public_name");

    return { access: "public", public_name: publicName.value };
  }

  if (asked.public_name !== undefined) return refuse("bad_argument", "public_name");

  if (asked.access === undefined) return undefined;

  return { access: asked.access };
}

/**
 * The moment a new site expires under the install's `default_expires`.
 *
 * @returns `"never"`, or the moment that span after `now`
 */
export function defaultExpiry(span: SettingValues["default_expires"], now: number): "never" | number {
  if (span === "never") return "never";

  return now + spanSeconds(span) * 1000;
}

/** The details a caller asks for beside the name, or `undefined` for an expiry in no known form. */
function readDetails(asked: SiteChanges, now: number): { -readonly [Key in keyof SiteDetails]: SiteDetails[Key] } | undefined {
  const details: { -readonly [Key in keyof SiteDetails]: SiteDetails[Key] } = {};
  if (asked.title !== undefined) details.title = asked.title === "" ? null : asked.title;
  if (asked.search_engines !== undefined) details.search_engines = asked.search_engines;
  if (asked.embeddable !== undefined) details.embeddable = asked.embeddable;
  if (asked.expires === undefined) return details;

  const expires = readExpires(asked.expires, now);
  if (expires === undefined) return undefined;

  return { ...details, expires };
}

/**
 * Check the settings a caller asks for.
 *
 * @param raw - the caller's object as sent; anything is taken and checked
 * @returns the changes, or the first refusal: `bad_argument` names the key in `about`, `bad_name` is about the name or the public name, and `reserved_name` about the public name
 */
export function readChanges(raw: unknown, ground: Ground): CheckedChanges | Refused<"bad_argument" | "bad_name" | "reserved_name"> {
  const parsed = v.safeParse(SITE_CHANGES, raw);
  if (!parsed.success) return refuse("bad_argument", v.getDotPath(parsed.issues[0]) ?? "settings");

  const asked = parsed.output;
  const name = asked.name === undefined ? undefined : parseSiteName(asked.name);
  if (name?.ok === false) return refuse("bad_name", "name");

  // A site renamed and made public in one change takes its new name as its public name.
  const access = readAccess(asked, name === undefined ? ground : { ...ground, name: name.value });
  if (access !== undefined && "ok" in access) return access;

  const details = readDetails(asked, ground.now);
  if (details === undefined) return refuse("bad_argument", "expires");

  if (name !== undefined) details.name = name.value;

  if (access === undefined) return { ok: true, details };

  return { ok: true, access, details };
}

/** Whether the changes ask for anything. */
export function asksNothing(changes: CheckedChanges): boolean {
  return changes.access === undefined && Object.keys(changes.details).length === 0;
}

/**
 * Apply checked changes to a site in one step: the access, and the details only once the site has it. Each of the two that changes writes its own audit entry.
 *
 * @returns the site after the changes. A refused access leaves the site as it was, its details too
 */
export async function applyChanges(
  database: Database,
  id: SiteId,
  changes: CheckedChanges,
  signed: Signed,
): Promise<{ readonly ok: true; readonly site: Site } | Refused<"not_found" | "in_trash" | "name_taken">> {
  const { access, details } = changes;
  const changed = access === undefined ? await database.changeDetails(id, details, signed) : await database.changeAccessAndDetails(id, access, details, signed);
  if (changed.kind === "name_taken") return refuse("name_taken", "public_name");

  if (changed.kind !== "done" && changed.kind !== "unchanged") return refuse(changed.kind);

  return { ok: true, site: changed.site };
}

/**
 * What checked changes would make of a live site, with nothing written. The one thing asked of the database is whether another site holds the public name the site would claim.
 *
 * @param site - the site as it was read, which is not in the trash
 * @returns the site as `applyChanges` would leave it, or its refusal of a public name that is taken
 */
export async function rehearseChanges(database: Database, site: Site, changes: CheckedChanges): Promise<{ readonly ok: true; readonly site: Site } | Refused<"name_taken">> {
  const { access, details } = changes;
  if (access === undefined) return { ok: true, site: { ...site, ...details } };

  const held = site.access === "public" && access.access === "public" && site.public_name === access.public_name;
  if (access.access === "public" && !held && (await database.findTaken(site.id, access.public_name)).publicName) return refuse("name_taken", "public_name");

  // A public name goes with a public access alone.
  const { public_name: freed, ...rest } = { public_name: null, ...site };

  return { ok: true, site: { ...rest, ...details, ...access } };
}
