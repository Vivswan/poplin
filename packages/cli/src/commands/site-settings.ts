// The settings of one site, as `publish` and `set` both read them from the same flags.

import { dayStart, readExpires } from "../../../core/src/actions/changes";
import type { PublicName } from "../../../core/src/names/names";
import type { SettingValues } from "../../../core/src/records/settings";
import { readSetting } from "./install-settings";
import { type Flags, flagValue, isUsageError, type UsageError, usageError } from "./util";

/** The three access flags, each with the access it sets. */
const ACCESS_FLAGS = [
  ["--private", "private"],
  ["--unlisted", "unlisted"],
  ["--public", "public"],
] as const;

/** What `--expires` takes, for the hint of a refused one. */
const EXPIRY_FORMS = "a span is a count of s, m, h, or d: 7d. A date is 2026-12-01";

/** A time span as core counts one: a count of seconds, minutes, hours, or days. */
type Span = Exclude<SettingValues["default_expires"], "never">;

/** When a site moves to the trash: never, a span after the moment it is set, or the start of a calendar date. */
type Expiry = { readonly kind: "never" } | { readonly kind: "span"; readonly span: Span } | { readonly kind: "date"; readonly date: string };

/** The settings a command line gave. A setting that was not given is absent, and changes nothing. A `title` of `null` takes the typed title away, so the site shows its page's own. */
export interface SiteSettings {
  readonly access?: "private" | "unlisted" | "public";
  readonly publicName?: PublicName;
  readonly title?: string | null;
  readonly searchEngines?: boolean;
  readonly embeddable?: boolean;
  readonly expires?: Expiry;
}

function readSwitch(flags: Flags, name: string): boolean | undefined | UsageError {
  const word = flagValue(flags, name);
  if (word === undefined) return undefined;

  // Core reads `on` and `off` for the switch a new site gets, and a site's own switches are typed the same way.
  return readSetting("default_search_engines", word) ?? usageError(`${name} takes on or off, not ${JSON.stringify(word)}`);
}

function readExpiry(flags: Flags, now: number): Expiry | undefined | UsageError {
  const when = flagValue(flags, "--expires");
  if (when === undefined) return undefined;

  // Core decides whether an install takes the expiry; what is read here is only which form was typed.
  const taken = readExpires(when, now) !== undefined;

  if (dayStart(when) !== undefined) {
    if (!taken) return usageError(`--expires ${when} is not ahead: that day has started`, EXPIRY_FORMS);

    return { kind: "date", date: when };
  }

  const span = readSetting("default_expires", when);
  if (span === undefined) return usageError(`--expires takes a span, a date, or never, not ${JSON.stringify(when)}`, EXPIRY_FORMS);

  if (span === "never") return { kind: "never" };

  if (!taken) return usageError(`--expires ${when} is too far ahead`, EXPIRY_FORMS);

  return { kind: "span", span };
}

function readAccess(flags: Flags): SiteSettings["access"] | UsageError {
  const given = ACCESS_FLAGS.filter(([flag]) => flags.has(flag));
  const [first, second] = given;

  if (first !== undefined && second !== undefined) return usageError(`${first[0]} and ${second[0]} cannot go together: a site has one access`);

  return first?.[1];
}

/**
 * Read the settings flags of `publish` and `set`.
 *
 * @param now - the time, in milliseconds since the epoch; an expiry must lie after it
 * @returns the settings that were given, without the public name, or the first flag that was written wrong
 */
export function readSiteSettings(flags: Flags, now: number): SiteSettings | UsageError {
  const access = readAccess(flags);
  if (isUsageError(access)) return access;

  const searchEngines = readSwitch(flags, "--search-engines");
  if (isUsageError(searchEngines)) return searchEngines;

  const embeddable = readSwitch(flags, "--embeddable");
  if (isUsageError(embeddable)) return embeddable;

  const expires = readExpiry(flags, now);
  if (isUsageError(expires)) return expires;

  const title = flagValue(flags, "--title");
  const settings: { -readonly [Setting in keyof SiteSettings]: SiteSettings[Setting] } = {};

  if (access !== undefined) settings.access = access;

  if (title !== undefined) settings.title = title === "" ? null : title;

  if (searchEngines !== undefined) settings.searchEngines = searchEngines;

  if (embeddable !== undefined) settings.embeddable = embeddable;

  if (expires !== undefined) settings.expires = expires;

  return settings;
}
