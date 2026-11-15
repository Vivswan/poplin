// The install's settings: the typed value of every key, and the text form each key is typed and shown in.

import prettyBytes from "pretty-bytes";
import * as v from "valibot";

import { type Login, parseLogin } from "../auth/logins";
import { LOGIN, POSITIVE } from "./fields";

/** A whole number as text: no sign, no leading zero, no fraction. */
const WHOLE_PATTERN = /^(?:0|[1-9]\d*)$/;

/** A whole number followed by its unit, such as `60s`, `9GB`, or `25%`. */
const AMOUNT_PATTERN = /^(0|[1-9]\d*)([A-Za-z%]+)$/;

/** How many seconds each unit of a duration holds. */
const SECONDS_PER_UNIT = { s: 1, m: 60, h: 3600, d: 86_400 } as const;

/** How many bytes each unit of a size holds. They are decimal, so `9GB` stays under R2's 10 GB whichever way that is counted. */
const BYTES_PER_UNIT = { B: 1, KB: 1000, MB: 1_000_000, GB: 1_000_000_000 } as const;

/** Whether a page that is not one of the install's own sites may frame a site or load its files. */
const OUTSIDE_PAGES = ["blocked", "allowed"] as const;

/** The zone's bot switches: `auto` sets them on a zone with no hostnames of its own, `on` on any zone, `off` leaves them alone. */
const BLOCK_BOTS = ["auto", "on", "off"] as const;

/** The most files one publish may declare under any setting: finishing lists them a thousand a store call. */
export const MOST_FILES_PER_PUBLISH = 10_000;

/** A time span of at least one unit. */
const TIME_SPAN = amountSchema(SECONDS_PER_UNIT, 1);

/** A size of at least one unit. */
const SIZE = amountSchema(BYTES_PER_UNIT, 1);

/** The typed value of every key, in the order `poplin config` shows them. */
const VALUES = {
  default_expires: v.union([v.literal("never"), TIME_SPAN]),
  default_search_engines: v.boolean(),
  versions_kept: POSITIVE,
  trash_days: POSITIVE,
  logins: v.pipe(
    v.array(LOGIN),
    v.minLength(1),
    v.check((logins) => new Set(logins).size === logins.length, "each login is listed once"),
  ),
  outside_pages: v.picklist(OUTSIDE_PAGES),
  search_engines_allowed: v.boolean(),
  block_bots: v.picklist(BLOCK_BOTS),
  max_total_size: SIZE,
  max_site_size: SIZE,
  max_sites: v.union([v.literal("none"), POSITIVE]),
  max_files_per_publish: v.pipe(v.number(), v.safeInteger(), v.minValue(1), v.maxValue(MOST_FILES_PER_PUBLISH)),
  max_files_per_day: POSITIVE,
  max_storage_writes_per_day: POSITIVE,
  requests_per_day: POSITIVE,
  site_share_of_day: v.pipe(v.number(), v.safeInteger(), v.minValue(1), v.maxValue(100)),
  site_requests_per_minute: POSITIVE,
  visitor_requests_per_minute: POSITIVE,
  update_check: v.boolean(),
};

/** Every setting, as the settings are stored and read. */
export const SETTING_VALUES = v.strictObject(VALUES);

/** Some of the settings, as a change to them is checked before it is written. */
export const SETTING_CHANGES = v.partial(SETTING_VALUES);

/** Every key, in the order of `VALUES`. */
const SETTING_KEYS = Object.keys(VALUES) as readonly SettingKey[];

/** How each key's value is read from text and printed back. A key missing here does not compile. */
const FORMS: { readonly [Key in SettingKey]: TextForm<SettingValues[Key]> } = {
  default_expires: orWord("never", amount(SECONDS_PER_UNIT)),
  default_search_engines: onOff(),
  versions_kept: whole(),
  trash_days: whole(),
  logins: loginList(),
  outside_pages: oneOf(OUTSIDE_PAGES),
  search_engines_allowed: onOff(),
  block_bots: oneOf(BLOCK_BOTS),
  max_total_size: amount(BYTES_PER_UNIT),
  max_site_size: amount(BYTES_PER_UNIT),
  max_sites: orWord("none", whole()),
  max_files_per_publish: whole(),
  max_files_per_day: whole(),
  max_storage_writes_per_day: whole(),
  requests_per_day: whole(),
  site_share_of_day: percent(),
  site_requests_per_minute: whole(),
  visitor_requests_per_minute: whole(),
  update_check: onOff(),
};

/** The suffix of each unit of an amount and how many base units it holds. */
type Units = Readonly<Record<string, number>>;

/** A count of one unit, kept as typed so a setting is shown as it was set: `60s` is 60 of `s`. */
interface Amount<Unit> {
  readonly count: number;
  readonly unit: Unit;
}

/** The text form of one kind of value. `read` answers `undefined` for text that is not in the form; ranges are the schema's to refuse. */
interface TextForm<Value> {
  readonly read: (text: string) => Value | undefined;
  readonly print: (value: Value) => string;
}

/** The values of every setting. */
export type SettingValues = v.InferOutput<typeof SETTING_VALUES>;

type SettingKey = keyof SettingValues;

/** What a new install knows that the defaults are built from. */
interface Install {
  /** The email of whoever sets the install up; the first login. */
  readonly installer: Login;
}

/** Why settings text was refused: a key that is no setting, a setting left out, text not in the key's form, or a value outside its range. */
type SettingRefusal = "unknown-key" | "missing" | "bad-form" | "out-of-range";

/** The typed settings, or the first key that was refused and why. */
export type CheckedSettings =
  | { readonly ok: true; readonly values: SettingValues }
  | { readonly ok: false; readonly key: string; readonly refusal: SettingRefusal };

function amountSchema<Table extends Units>(units: Table, least: number): v.GenericSchema<unknown, Amount<keyof Table>> {
  const unitNames = Object.keys(units) as (keyof Table & string)[];

  return v.pipe(
    v.strictObject({ count: v.pipe(v.number(), v.safeInteger(), v.minValue(least)), unit: v.picklist(unitNames) }),
    v.check((amount) => Number.isSafeInteger(amount.count * (units[amount.unit] ?? 0)), "the amount is a whole number of base units"),
  );
}

function whole(): TextForm<number> {
  return {
    read: (text) => (WHOLE_PATTERN.test(text) ? Number(text) : undefined),
    print: (value) => String(value),
  };
}

function onOff(): TextForm<boolean> {
  return {
    read: (text) => {
      if (text === "on") return true;

      if (text === "off") return false;

      return undefined;
    },
    print: (value) => (value ? "on" : "off"),
  };
}

function amount<Table extends Units>(units: Table): TextForm<Amount<keyof Table>> {
  return {
    read: (text) => {
      const [, digits = "", suffix = ""] = AMOUNT_PATTERN.exec(text) ?? [];
      if (!Object.hasOwn(units, suffix)) return undefined;

      return { count: Number(digits), unit: suffix };
    },
    print: (value) => `${value.count}${String(value.unit)}`,
  };
}

function percent(): TextForm<number> {
  return {
    read: (text) => (text.endsWith("%") ? whole().read(text.slice(0, -1)) : undefined),
    print: (value) => `${value}%`,
  };
}

function oneOf<Word extends string>(words: readonly Word[]): TextForm<Word> {
  return {
    read: (text) => words.find((word) => word === text),
    print: (word) => word,
  };
}

function orWord<Word extends string, Value>(word: Word, form: TextForm<Value>): TextForm<Word | Value> {
  return {
    read: (text) => (text === word ? word : form.read(text)),
    print: (value) => (value === word ? word : form.print(value as Value)),
  };
}

function loginList(): TextForm<Login[]> {
  return {
    read: (text) => {
      const logins: Login[] = [];

      for (const entry of text.split(",")) {
        const login = parseLogin(entry);
        if (!login.ok) return undefined;

        logins.push(login.value);
      }

      return logins;
    },
    print: (logins) => logins.join(","),
  };
}

function printOne<Key extends SettingKey>(key: Key, values: SettingValues): string {
  return FORMS[key].print(values[key]);
}

/**
 * The bytes a size setting such as `max_total_size` stands for.
 *
 * @returns the count times its unit, which is decimal: `9GB` is 9,000,000,000
 */
export function sizeBytes(size: SettingValues["max_total_size"]): number {
  return size.count * BYTES_PER_UNIT[size.unit];
}

/**
 * Write a count of bytes for a person, in decimal units as the size settings count in.
 *
 * @param bytes - a whole number from 0 up
 * @returns the count in the largest unit it fills, cut to one decimal place at most: `0 B`, `999 B`, `1.5 kB`, `200 MB`, `9 GB`, `1 TB`. The decimals past the first are cut, not rounded.
 * @throws {RangeError} `bytes` is not a whole number from 0 up
 */
export function showBytes(bytes: number): string {
  if (!Number.isSafeInteger(bytes) || bytes < 0) throw new RangeError(`a size is a whole number of bytes from 0 up, not ${bytes}`);

  return prettyBytes(bytes, { maximumFractionDigits: 1 });
}

/**
 * The seconds a time span such as `default_expires` stands for.
 *
 * @returns the count times its unit: `7d` is 604,800
 */
export function spanSeconds(span: Exclude<SettingValues["default_expires"], "never">): number {
  return span.count * SECONDS_PER_UNIT[span.unit];
}

/**
 * Build the settings a new install starts with.
 *
 * @returns the values of the published defaults table; the one that depends on the install comes from `install`
 */
export function defaultSettings(install: Install): SettingValues {
  return {
    default_expires: "never",
    default_search_engines: false,
    versions_kept: 3,
    trash_days: 7,
    logins: [install.installer],
    outside_pages: "blocked",
    search_engines_allowed: false,
    block_bots: "auto",
    max_total_size: { count: 9, unit: "GB" },
    max_site_size: { count: 200, unit: "MB" },
    max_sites: "none",
    max_files_per_publish: 5000,
    max_files_per_day: 25_000,
    max_storage_writes_per_day: 30_000,
    requests_per_day: 100_000,
    site_share_of_day: 25,
    site_requests_per_minute: 6000,
    visitor_requests_per_minute: 600,
    update_check: true,
  };
}

/**
 * Print every setting in the text form it is typed in, such as `60s`, `9GB`, `25%`, `on`.
 *
 * @returns one text per key; `settingsFromText` reads each back to the same value
 */
export function settingsToText(values: SettingValues): Record<SettingKey, string> {
  const texts = {} as Record<SettingKey, string>;

  for (const key of SETTING_KEYS) texts[key] = printOne(key, values);

  return texts;
}

/**
 * Read every setting from its text form.
 *
 * @param texts - one text for every key; to change one setting, print the current ones and replace that key
 * @returns the typed values, or the first refused key
 */
export function settingsFromText(texts: Readonly<Record<string, string>>): CheckedSettings {
  const unknown = Object.keys(texts).find((key) => !Object.hasOwn(VALUES, key));
  if (unknown !== undefined) return { ok: false, key: unknown, refusal: "unknown-key" };

  const values: Record<string, unknown> = {};

  for (const key of SETTING_KEYS) {
    const text = texts[key];
    if (text === undefined) return { ok: false, key, refusal: "missing" };

    const value = FORMS[key].read(text);
    if (value === undefined) return { ok: false, key, refusal: "bad-form" };

    values[key] = value;
  }

  const checked = v.safeParse(SETTING_VALUES, values);
  if (checked.success) return { ok: true, values: checked.output };

  const [issue] = checked.issues;

  return { ok: false, key: v.getDotPath(issue)?.split(".")[0] ?? "", refusal: "out-of-range" };
}
