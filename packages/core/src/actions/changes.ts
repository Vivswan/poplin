// The settings of one site as a caller asks for them, checked into what the database takes, and applied.

import * as v from "valibot";

import type { Database, Signed, SiteDetails } from "../database/database";
import { parsePublicName, type SiteName } from "../names/names";
import type { SettingValues } from "../records/settings";
import type { Site, SiteAccess } from "../records/site";
import type { SiteId } from "../sites/ids";
import { type Refused, refuse } from "./records";

/** How many seconds each unit of a time span holds. */
const SECONDS_PER_UNIT = { s: 1, m: 60, h: 3600, d: 86_400 } as const;

/** A time span as typed: a whole number from 1 and its unit, such as `7d`. */
const SPAN_PATTERN = /^([1-9]\d*)([smhd])$/;

/** A calendar day as typed, such as `2026-12-01`. */
const DAY_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

/** How many characters of an ISO timestamp are its day. */
const DAY_LENGTH = 10;

/** What a caller may ask of a site's settings; every key is optional, and no other key is taken. */
const CHANGES = v.strictObject({
  access: v.optional(v.picklist(["private", "unlisted", "public"])),
  public_name: v.optional(v.string()),
  title: v.optional(v.nullable(v.string())),
  search_engines: v.optional(v.boolean()),
  embeddable: v.optional(v.boolean()),
  expires: v.optional(v.string()),
});

/**
 * The settings a caller asks for, on a publish or on their own.
 *
 * `public_name` goes with `access: "public"` alone and is the site's name when left out. A `title` of `null` or `""` takes the title away.
 *
 * `expires` is `"never"`, a span from now such as `"7d"` (units `s`, `m`, `h`, `d`), or a day such as `"2026-12-01"`, which is that day's start in UTC.
 */
export type SiteChanges = v.InferInput<typeof CHANGES>;

/** What the changes are checked against. */
interface Ground {
  /** The name of the site, which a public site takes as its public name unless another is asked for. */
  readonly name: SiteName;

  /** The moment a span of time is counted from, and that an expiry must lie after. */
  readonly now: number;

  /** The public names the install's address layout keeps for itself. */
  readonly reserved: ReadonlySet<string>;
}

/** The changes in the database's terms. `access` is absent when none was asked for. */
export interface CheckedChanges {
  readonly ok: true;
  readonly access?: SiteAccess;
  readonly details: SiteDetails;
}

function momentOf(text: string, now: number): number | undefined {
  const span = SPAN_PATTERN.exec(text);
  if (span !== null) return now + Number(span[1]) * SECONDS_PER_UNIT[span[2] as keyof typeof SECONDS_PER_UNIT] * 1000;

  if (!DAY_PATTERN.test(text)) return undefined;

  // The parser takes a day no month has, such as a 31st of February, as a day of the next month: the round trip refuses it.
  const moment = Date.parse(`${text}T00:00:00Z`);
  if (Number.isNaN(moment) || new Date(moment).toISOString().slice(0, DAY_LENGTH) !== text) return undefined;

  return moment;
}

function readExpires(text: string, now: number): "never" | number | undefined {
  if (text === "never") return "never";

  const moment = momentOf(text, now);
  if (moment === undefined || !Number.isSafeInteger(moment) || moment <= now) return undefined;

  return moment;
}

function readAccess(asked: SiteChanges, ground: Ground): SiteAccess | undefined | Refused<"bad_argument" | "bad_name" | "reserved_name"> {
  if (asked.access === "public") {
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

  return now + span.count * SECONDS_PER_UNIT[span.unit] * 1000;
}

/**
 * Check the settings a caller asks for.
 *
 * @param raw - the caller's object as sent; anything is taken and checked
 * @returns the changes, or the first refusal: `bad_argument` names the key in `about`, `bad_name` and `reserved_name` are about the public name
 */
export function readChanges(raw: unknown, ground: Ground): CheckedChanges | Refused<"bad_argument" | "bad_name" | "reserved_name"> {
  const parsed = v.safeParse(CHANGES, raw);
  if (!parsed.success) return refuse("bad_argument", v.getDotPath(parsed.issues[0]) ?? "settings");

  const asked = parsed.output;
  const access = readAccess(asked, ground);
  if (access !== undefined && "ok" in access) return access;

  const details: { -readonly [Key in keyof SiteDetails]: SiteDetails[Key] } = {};
  if (asked.title !== undefined) details.title = asked.title === "" ? null : asked.title;
  if (asked.search_engines !== undefined) details.search_engines = asked.search_engines;
  if (asked.embeddable !== undefined) details.embeddable = asked.embeddable;

  if (asked.expires !== undefined) {
    const expires = readExpires(asked.expires, ground.now);
    if (expires === undefined) return refuse("bad_argument", "expires");

    details.expires = expires;
  }

  if (access === undefined) return { ok: true, details };

  return { ok: true, access, details };
}

/** Whether the changes ask for anything. */
export function asksNothing(changes: CheckedChanges): boolean {
  return changes.access === undefined && Object.keys(changes.details).length === 0;
}

/**
 * Apply checked changes to a site: the access first, then the details, each as its own step with its own audit entry.
 *
 * @returns the site after the changes. A refused access leaves the site as it was. When both are asked, `not_found` or `in_trash` on the details means the site went between the two steps, with its access already changed
 */
export async function applyChanges(
  database: Database,
  id: SiteId,
  changes: CheckedChanges,
  signed: Signed,
): Promise<{ readonly ok: true; readonly site: Site } | Refused<"not_found" | "in_trash" | "name_taken">> {
  if (changes.access !== undefined) {
    const changed = await database.changeAccess(id, changes.access, signed);
    if (changed.kind === "name_taken") return refuse("name_taken", "public_name");

    if (changed.kind !== "done" && changed.kind !== "unchanged") return refuse(changed.kind);

    if (Object.keys(changes.details).length === 0) return { ok: true, site: changed.site };
  }

  const changed = await database.changeDetails(id, changes.details, signed);
  if (changed.kind !== "done" && changed.kind !== "unchanged") return refuse(changed.kind);

  return { ok: true, site: changed.site };
}
