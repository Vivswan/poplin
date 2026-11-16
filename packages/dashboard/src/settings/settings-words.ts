// The words of the Settings screen: its blocks and their headings, and for each setting its name, what it means, and the unit beside its number. A setting with no words here is still shown, under a name made from its key, in the block its key reads like.

import type { Row } from "@/settings/settings-queries";

/** The blocks of the screen, in the order shown, each under its heading. */
const BLOCKS = [
  { id: "sites", heading: "New sites" },
  { id: "visitors", heading: "Visitors" },
  { id: "storage", heading: "Storage" },
  { id: "publishing", heading: "Publishing" },
  { id: "traffic", heading: "Traffic" },
  { id: "limits", heading: "Other limits" },
  { id: "updates", heading: "Updates" },
] as const;

/** The block that is always drawn: it also holds the update link. */
export const UPDATES = "updates";

/** What the units of a number's text are called beside its field. A unit missing here is shown as it is, such as `MB` or `%`. */
const UNIT_WORDS: Readonly<Record<string, string>> = { d: "days", h: "hours", m: "minutes", s: "seconds", B: "bytes" };

/** The most letters the sentence beside a setting's name holds: one short sentence. Anything longer belongs in the docs. */
export const MOST_ABOUT = 60;

/** What each setting is called, the one short sentence under its name, and what its control needs, in the order the settings of a block are shown. */
const WORDS: Readonly<Record<string, Words>> = {
  default_expires: {
    block: "sites",
    label: "Delete new sites",
    about: "A new site is deleted this long after publishing.",
    wordLabels: { word: "Never", number: "After" },
    start: "30",
  },
  default_search_engines: { block: "sites", label: "Show in search engines", about: "A new public site starts with its switch on." },
  versions_kept: { block: "sites", label: "Keep versions", about: "How many versions a site keeps, the live one included.", unit: "versions" },
  trash_days: { block: "sites", label: "Keep deleted sites", about: "After that, a deleted site is gone for good.", unit: "days" },
  search_engines_allowed: {
    block: "visitors",
    label: "Let search engines in",
    about: "While off, search engines find none of your sites.",
  },
  outside_pages: {
    block: "visitors",
    label: "Let outside pages embed sites",
    about: "While off, a page of another domain cannot embed a site.",
    on: "allowed",
  },
  block_bots: {
    block: "visitors",
    label: "Block bots",
    about: "Automatic blocks AI crawlers if the domain is only poplin's.",
    choices: { auto: "Automatic", on: "Always", off: "Never" },
  },
  max_total_size: { block: "storage", label: "All sites together", about: "The most all sites hold, the trash included." },
  max_site_size: { block: "storage", label: "One site", about: "The most one site holds." },
  max_sites: { block: "storage", label: "Number of sites", about: "The most sites, the trash included, or empty for no limit.", unit: "sites", empty: "No limit" },
  max_files_per_publish: { block: "publishing", label: "Files per publish", about: "The most files in one publish, up to 10,000.", unit: "files" },
  max_files_per_day: { block: "publishing", label: "Files per day", about: "The most files published or duplicated in one UTC day.", unit: "files" },
  max_storage_writes_per_day: { block: "publishing", label: "Storage writes per day", about: "A published file counts as 1 write, a duplicated file as 2.", unit: "writes" },
  requests_per_day: { block: "traffic", label: "Requests per day", about: "All sites together, in one UTC day.", unit: "requests" },
  site_share_of_day: { block: "traffic", label: "One site's share", about: "The part of the requests per day one site may use." },
  site_requests_per_minute: { block: "traffic", label: "One site per minute", about: "The most requests one site answers in a minute.", unit: "requests" },
  visitor_requests_per_minute: { block: "traffic", label: "One visitor per minute", about: "The most requests one visitor gets in a minute.", unit: "requests" },
  update_check: { block: "updates", label: "Check for new versions", about: "Asks the project's website once a day." },
  auto_update: { block: "updates", label: "Update automatically", about: "Needs the check above and an update link." },
};

/** A block's id. */
type BlockId = (typeof BLOCKS)[number]["id"];

/** The words of one setting. */
interface Words {
  /** The block it is shown in. */
  readonly block: BlockId;

  /** Its name: two to five everyday words that start with the thing or the action. */
  readonly label: string;

  /** The one short sentence beside its name, of `MOST_ABOUT` letters at most; empty for none. */
  readonly about: string;

  /** What a plain count counts, such as `files`; left out for a number whose text carries its unit. */
  readonly unit?: string;

  /** What an empty number field says, for a setting whose empty field has a meaning. */
  readonly empty?: string;

  /** For a number that can also be a word, such as `never`: what the two are called in the choice before the field. Left out, the empty field stands for the word. */
  readonly wordLabels?: { readonly word: string; readonly number: string };

  /** The number such a choice starts with once the number is chosen. */
  readonly start?: string;

  /** For a choice between two values drawn as a switch: the value that is on. */
  readonly on?: string;

  /** What the options of a choice are called, by option. */
  readonly choices?: Readonly<Record<string, string>>;
}

/** One block as it is drawn: its heading and its rows, in the order of the words; a setting that has none comes last. */
export interface Block {
  readonly id: BlockId;
  readonly heading: string;
  readonly rows: readonly Row[];
}

/** The block of a setting that has no words: the one its key reads like. */
function blockFromKey(key: string): BlockId {
  if (key.includes("update")) return "updates";

  if (key.startsWith("max_") || key.includes("requests") || key.includes("_per_")) return "limits";

  return /search|bots|outside|visitor/.test(key) ? "visitors" : "sites";
}

/**
 * The words of a setting.
 *
 * @returns the settled words, or for a setting that has none its key as a name, such as `Update channel`, with nothing to explain
 */
export function wordsOf(key: string): Words {
  if (Object.hasOwn(WORDS, key) && WORDS[key] !== undefined) return WORDS[key];

  const spaced = key.replaceAll("_", " ");

  return { block: blockFromKey(key), label: `${spaced.slice(0, 1).toUpperCase()}${spaced.slice(1)}`, about: "" };
}

/**
 * What stands beside a number's field.
 *
 * @param unit - what follows the digits in the number's text, such as `MB`, `d`, or nothing
 * @returns the word of the unit, such as `MB`, `%`, or `days`; for a plain count what the setting counts, or nothing
 */
export function unitWord(key: string, unit: string): string {
  if (unit === "") return wordsOf(key).unit ?? "";

  return UNIT_WORDS[unit] ?? unit;
}

/**
 * Sort the rows into the blocks of the screen.
 *
 * @returns the blocks that hold a row, in the order shown, and the Updates block whether it holds one or not
 */
export function blocksOf(rows: readonly Row[]): readonly Block[] {
  const order = Object.keys(WORDS);
  const place = (row: Row): number => (order.includes(row.key) ? order.indexOf(row.key) : order.length);
  const shown = rows.toSorted((one, other) => place(one) - place(other));

  return BLOCKS.map((block) => ({ ...block, rows: shown.filter((row) => wordsOf(row.key).block === block.id) })).filter((block) => block.rows.length > 0 || block.id === UPDATES);
}
