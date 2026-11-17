// The settings of one site, as `publish` and `set` both read them from the same flags.

import * as v from "valibot";

import { dayStart, isSpan, MAX_TITLE_LENGTH, readExpires, TITLE_TEXT } from "../../../../core/src/actions/sites/changes";
import type { PublicName, SiteName } from "../../../../core/src/names/names";
import { type SettingValues, settingFromText } from "../../../../core/src/records/settings";
import { type Flags, flagValue, isUsageError, type UsageError, usageError } from "../line/util";

/** The three access flags, each with the access it sets. */
const ACCESS_FLAGS = [
  ["--private", "private"],
  ["--unlisted", "unlisted"],
  ["--public", "public"],
] as const;

/** What `--expires` takes, for the hint of a refused one. */
const EXPIRY_FORMS = "Usage: --expires 7d (s, m, h, or d), 2026-12-01, or never";

/** What `--title` takes, for the hint of a refused one. */
const TITLE_FORM = `A title is one line of at most ${MAX_TITLE_LENGTH} characters. "" uses the page title.`;

/** A time span as core counts one: a count of seconds, minutes, hours, or days. */
type Span = Exclude<SettingValues["default_expires"], "never">;

/** When a site moves to the trash: never, a span after the moment it is set, or the start of a calendar date. */
type Expiry = { readonly kind: "never" } | { readonly kind: "span"; readonly span: Span } | { readonly kind: "date"; readonly date: string };

/** The settings a command line gave. A setting that was not given is absent, and changes nothing. A `title` of `null` takes the typed title away, so the site shows its page's own. `name` renames a site that exists. */
export interface SiteSettings {
  readonly name?: SiteName;
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
  return settingFromText("default_search_engines", word) ?? usageError(`${name} requires on or off, got ${JSON.stringify(word)}`);
}

function readExpiry(flags: Flags, now: number): Expiry | undefined | UsageError {
  const when = flagValue(flags, "--expires");
  if (when === undefined) return undefined;

  // Core decides whether an install takes the expiry; what is read here is only which form was typed.
  const taken = readExpires(when, now) !== undefined;

  if (dayStart(when) !== undefined) {
    if (!taken) return usageError(`--expires ${when} is not a future date`, EXPIRY_FORMS);

    return { kind: "date", date: when };
  }

  const span = settingFromText("default_expires", when);
  if (span === "never") return { kind: "never" };

  if (span !== undefined && taken) return { kind: "span", span };

  // A span in its form that core does not take is longer than a span may be.
  if (isSpan(when)) return usageError(`--expires ${when} is too long a duration`, EXPIRY_FORMS);

  return usageError(`--expires requires a duration, a date, or never, got ${JSON.stringify(when)}`, EXPIRY_FORMS);
}

/** Read `--title` by core's own rule of a typed title, so a title the install would refuse is refused here, with the rule it breaks. */
function readTitle(flags: Flags): string | null | undefined | UsageError {
  const title = flagValue(flags, "--title");
  if (title === undefined) return undefined;

  if (title === "") return null;

  if (title.length > MAX_TITLE_LENGTH) return usageError(`--title is ${title.length} characters, the maximum is ${MAX_TITLE_LENGTH}`, TITLE_FORM);

  if (!v.is(TITLE_TEXT, title)) return usageError("--title has a line break or a control character", TITLE_FORM);

  return title;
}

function readAccess(flags: Flags): SiteSettings["access"] | UsageError {
  const given = ACCESS_FLAGS.filter(([flag]) => flags.has(flag));
  const [first, second] = given;

  if (first !== undefined && second !== undefined) return usageError(`${first[0]} and ${second[0]} are mutually exclusive`);

  return first?.[1];
}

/**
 * Read the settings flags of `publish` and `set`.
 *
 * @param now - the time, in milliseconds since the epoch; an expiry must lie after it
 * @returns the settings that were given, without the names, or the first flag that was written wrong
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

  const title = readTitle(flags);
  if (isUsageError(title)) return title;

  const settings: { -readonly [Setting in keyof SiteSettings]: SiteSettings[Setting] } = {};

  if (access !== undefined) settings.access = access;

  if (title !== undefined) settings.title = title;

  if (searchEngines !== undefined) settings.searchEngines = searchEngines;

  if (embeddable !== undefined) settings.embeddable = embeddable;

  if (expires !== undefined) settings.expires = expires;

  return settings;
}
