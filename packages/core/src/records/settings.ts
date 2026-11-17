// The install's settings: the typed value of every key, and the text form each key is typed and shown in.

import prettyBytes from "pretty-bytes";
import * as v from "valibot";

import { type Login, parseLogin } from "../auth/logins";
import { LOGIN } from "./fields";

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

/** The settings the rules of the domain are written from: a change of one is carried to those rules, by the install itself or by a repair. */
export const RULE_SETTINGS = ["outside_pages", "search_engines_allowed"] as const;

/** The most files one publish may declare under any setting: finishing lists them a thousand a store call. */
export const MOST_FILES_PER_PUBLISH = 10_000;

/** The most a count may be set to, and the most megabytes a size: one top for every number that is no count of days, far above what a host gives. */
export const MOST_OF_A_COUNT = 1_000_000_000;

/** The most days a span of time may be set to, 100 years: a moment that many days after any day in reach is still a date. */
export const MOST_DAYS = 36_500;

/** The most users the install's alerts go to: a provider's alert takes about that many addresses. */
export const MOST_ALERT_USERS = 20;

/** The word that stands, in text, for alerts that go to the first user: no user is chosen. */
const FIRST_USER = "first";

/** A count from 1 to the top. */
const COUNT_SET = v.pipe(v.number(), v.safeInteger(), v.minValue(1), v.maxValue(MOST_OF_A_COUNT));

/** A count of days from 1 to the top. */
const DAYS_SET = v.pipe(v.number(), v.safeInteger(), v.minValue(1), v.maxValue(MOST_DAYS));

/** A time span from one unit to the most days, in whichever unit it is typed. */
const TIME_SPAN = amountSchema(SECONDS_PER_UNIT, MOST_DAYS * SECONDS_PER_UNIT.d);

/** A size from one unit to the most megabytes, in whichever unit it is typed. */
const SIZE = amountSchema(BYTES_PER_UNIT, MOST_OF_A_COUNT * BYTES_PER_UNIT.MB);

/** The typed value of every key, in the order `poplin config` shows them. */
const VALUES = {
  default_expires: v.union([v.literal("never"), TIME_SPAN]),
  default_search_engines: v.boolean(),
  versions_kept: COUNT_SET,
  trash_days: DAYS_SET,
  users: v.pipe(
    v.array(LOGIN),
    v.minLength(1),
    v.check((users) => new Set(users).size === users.length, "each user is listed once"),
  ),
  alert_users: v.pipe(
    v.array(LOGIN),
    v.maxLength(MOST_ALERT_USERS),
    v.check((chosen) => new Set(chosen).size === chosen.length, "each user is listed once"),
  ),
  outside_pages: v.picklist(OUTSIDE_PAGES),
  search_engines_allowed: v.boolean(),
  block_bots: v.picklist(BLOCK_BOTS),
  max_total_size: SIZE,
  max_site_size: SIZE,
  max_sites: v.union([v.literal("none"), COUNT_SET]),
  max_files_per_publish: v.pipe(v.number(), v.safeInteger(), v.minValue(1), v.maxValue(MOST_FILES_PER_PUBLISH)),
  max_files_per_day: COUNT_SET,
  max_storage_writes_per_day: COUNT_SET,
  requests_per_day: COUNT_SET,
  site_share_of_day: v.pipe(v.number(), v.safeInteger(), v.minValue(1), v.maxValue(100)),
  site_requests_per_minute: COUNT_SET,
  visitor_requests_per_minute: COUNT_SET,
  update_check: v.boolean(),
  auto_update: v.boolean(),
  provider_logs: v.boolean(),
};

/** Every setting, as the settings are stored and read. Two pairs are checked once both of a pair are typed, whatever another key holds: `auto_update` is on only beside `update_check`, and each of `alert_users` is one of `users`. */
export const SETTING_VALUES = v.pipe(
  v.strictObject(VALUES),
  v.forward(
    v.partialCheck([["users"], ["alert_users"]], (values) => values.alert_users.every((chosen) => values.users.includes(chosen)), "each of alert_users is one of users"),
    ["alert_users"],
  ),
  v.forward(
    v.partialCheck([["update_check"], ["auto_update"]], (values) => values.update_check || !values.auto_update, "auto_update is on only while update_check is on"),
    ["auto_update"],
  ),
);

/** Some of the settings, as a change to them is checked before it is written. Whether the two update settings go together after it is the store's to decide: it holds the ones a change leaves out. */
export const SETTING_CHANGES = v.partial(v.strictObject(VALUES));

/** Every key, in the order of `VALUES`. */
const SETTING_KEYS = Object.keys(VALUES) as readonly SettingKey[];

/** How each key's value is read from text and printed back. A key missing here does not compile. */
const FORMS: { readonly [Key in SettingKey]: TextForm<SettingValues[Key]> } = {
  default_expires: orWord("never", amount(SECONDS_PER_UNIT)),
  default_search_engines: onOff(),
  versions_kept: whole(),
  trash_days: whole(),
  users: userList(),
  alert_users: chosenUsers(),
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
  auto_update: onOff(),
  provider_logs: onOff(),
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

/** The users of stored settings as one read gave them, and the emails the install's alerts go to among them. Both are `undefined` before setup stored any settings. */
export type StoredUsers = { readonly users: readonly Login[]; readonly alerts: readonly Login[] } | { readonly users: undefined; readonly alerts: undefined };

/** The values the rules of the domain are written from. */
export type RuleSettings = Pick<SettingValues, (typeof RULE_SETTINGS)[number]>;

type SettingKey = keyof SettingValues;

/** What a new install knows that the defaults are built from. */
interface Install {
  /** The email of whoever sets the install up; the first user. */
  readonly installer: Login;
}

/** Why settings text was refused: a key that is no setting, a setting left out, text not in the key's form, a value outside its range, `auto_update` on beside `update_check` off, or one of `alert_users` that is none of `users`. */
type SettingRefusal = "unknown-key" | "missing" | "bad-form" | "out-of-range" | "needs-update-check" | "not-a-user";

/** One key that was refused, and why. */
interface RefusedSetting {
  readonly key: string;
  readonly refusal: SettingRefusal;
}

/** The typed settings, or the first key that was refused and why, with every refused key beside it in `every`, in the order of the settings. */
export type CheckedSettings = { readonly ok: true; readonly values: SettingValues } | ({ readonly ok: false; readonly every: readonly RefusedSetting[] } & RefusedSetting);

/** An amount of at least one of its unit, and of `most` base units at the most. */
function amountSchema<Table extends Units>(units: Table, most: number): v.GenericSchema<unknown, Amount<keyof Table>> {
  const unitNames = Object.keys(units) as (keyof Table & string)[];

  return v.pipe(
    v.strictObject({ count: v.pipe(v.number(), v.safeInteger(), v.minValue(1)), unit: v.picklist(unitNames) }),
    v.check((amount) => amount.count * (units[amount.unit] ?? 0) <= most, "the amount is no more than the most of its kind"),
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

function userList(): TextForm<Login[]> {
  return {
    read: (text) => {
      const users: Login[] = [];

      for (const entry of text.split(",")) {
        const login = parseLogin(entry);
        if (!login.ok) return undefined;

        users.push(login.value);
      }

      return users;
    },
    print: (users) => users.join(","),
  };
}

/** The users the alerts go to: the word for the first user where none is chosen, else the list as the users are typed. */
function chosenUsers(): TextForm<Login[]> {
  const list = userList();

  return {
    read: (text) => (text === FIRST_USER ? [] : list.read(text)),
    print: (chosen) => (chosen.length === 0 ? FIRST_USER : list.print(chosen)),
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
 * The emails the install's alerts go to, as every reader of them asks.
 *
 * @returns the users chosen in `alert_users`, in their order; the first user alone while none is chosen
 */
export function alertAddresses(settings: Pick<SettingValues, "users" | "alert_users">): readonly Login[] {
  if (settings.alert_users.length > 0) return settings.alert_users;

  const [first] = settings.users;

  return first === undefined ? [] : [first];
}

/**
 * Read the users out of the settings one read of the store gave, with who the alerts go to among them.
 *
 * @param stored - the settings, `undefined` before setup stored any
 */
export function storedUsers(stored: SettingValues | undefined): StoredUsers {
  return stored === undefined ? { users: undefined, alerts: undefined } : { users: stored.users, alerts: alertAddresses(stored) };
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
    users: [install.installer],
    alert_users: [],
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
    auto_update: false,
    provider_logs: true,
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
 * Read one setting from its text form, by its own rule alone. What two settings must hold together is the store's to say, which holds the other one.
 *
 * @returns the typed value, or `undefined` for text that is not in the key's form and for a value the key's rule refuses
 */
export function settingFromText<Key extends SettingKey>(key: Key, text: string): SettingValues[Key] | undefined {
  const value = FORMS[key].read(text);
  if (value === undefined) return undefined;

  const checked = v.safeParse(VALUES[key] as v.GenericSchema<unknown, SettingValues[Key]>, value);

  return checked.success ? checked.output : undefined;
}

function refusedAlone(refused: RefusedSetting): CheckedSettings {
  return { ok: false, ...refused, every: [refused] };
}

/** Why the schema refused a key whose text was read. A check of two keys is a pair that does not go together, told as its own refusal; any other is a value outside its range. */
function refusedValue(key: string, pair: boolean): RefusedSetting {
  if (!pair) return { key, refusal: "out-of-range" };

  return { key, refusal: key === "auto_update" ? "needs-update-check" : "not-a-user" };
}

/** The keys the schema refused, each with whether it was refused as half of a pair. A key's own rule is told before the pair's: the first issue of a key names it. */
function refusedKeys(issues: readonly v.BaseIssue<unknown>[]): ReadonlyMap<string, boolean> {
  const named = new Map<string, boolean>();

  for (const issue of issues) {
    const key = v.getDotPath(issue)?.split(".")[0] ?? "";
    if (!named.has(key)) named.set(key, issue.type === "partial_check");
  }

  return named;
}

/**
 * Read every setting from its text form.
 *
 * @param texts - one text for every key; to change one setting, print the current ones and replace that key
 * @returns the typed values, or the first refused key: a key that is no setting; else, in the order of the settings, the first that is left out or whose text is not in its form; else the first value its rule refuses.
 *   `auto_update` on beside `update_check` off is such a value of `auto_update`, refused as `needs-update-check`, and one of `alert_users` that is none of `users` such a value of `alert_users`, refused as `not-a-user`.
 *   `every` holds each text not in its form and each value the schema refuses, in the order of the settings; for a key that is no setting or is left out, that key alone
 */
export function settingsFromText(texts: Readonly<Record<string, string>>): CheckedSettings {
  const unknown = Object.keys(texts).find((key) => !Object.hasOwn(VALUES, key));
  if (unknown !== undefined) return refusedAlone({ key: unknown, refusal: "unknown-key" });

  const values: Record<string, unknown> = {};
  const unread: RefusedSetting[] = [];

  for (const key of SETTING_KEYS) {
    const text = texts[key];
    const value = text === undefined ? undefined : FORMS[key].read(text);
    if (value === undefined) unread.push({ key, refusal: text === undefined ? "missing" : "bad-form" });
    else values[key] = value;
  }

  const [first] = unread;
  if (first?.refusal === "missing") return refusedAlone(first);

  const checked = v.safeParse(SETTING_VALUES, values);
  if (checked.success) return { ok: true, values: checked.output };

  // A text that was not read leaves its key out of the values, which the schema names too: such a key is told once, by its form.
  const outside = [...refusedKeys(checked.issues)].filter(([key]) => !unread.some((refused) => refused.key === key)).map(([key, pair]) => refusedValue(key, pair));
  const order = (refused: RefusedSetting): number => SETTING_KEYS.indexOf(refused.key as SettingKey);
  const every = [...unread.filter((refused) => refused.refusal === "bad-form"), ...outside].sort((left, right) => order(left) - order(right));

  return { ok: false, ...(first ?? every[0] ?? { key: "", refusal: "out-of-range" }), every };
}
