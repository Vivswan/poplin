// The words of the Settings screen: its tabs, the blocks of a tab, and for each setting its name, what it means, and the unit beside its number. A setting with no words here is still shown, under a name made from its key, in the tab its key reads like.

import type { Row } from "@/settings/settings-queries";

/** The tabs, in the order shown, each with its blocks. A block with a heading is drawn under it; the first block of a tab needs none where it is the only one. */
export const TABS = [
  { id: "sites", label: "New sites", blocks: [{ id: "sites", heading: "" }] },
  { id: "visitors", label: "Visitors", blocks: [{ id: "visitors", heading: "" }] },
  {
    id: "limits",
    label: "Limits",
    blocks: [
      { id: "storage", heading: "Storage" },
      { id: "publishing", heading: "Publishing" },
      { id: "traffic", heading: "Traffic" },
      { id: "limits", heading: "Other" },
    ],
  },
  { id: "updates", label: "Updates", blocks: [{ id: "updates", heading: "" }] },
] as const;

/** What the units of a number's text are called beside its field. A unit missing here is shown as it is, such as `MB` or `%`. */
const UNIT_WORDS: Readonly<Record<string, string>> = { d: "days", h: "hours", m: "minutes", s: "seconds", B: "bytes" };

/** What each setting is called, what its question mark explains, and what its control needs, in the order the settings of a block are shown. */
const WORDS: Readonly<Record<string, Words>> = {
  default_expires: {
    block: "sites",
    label: "Delete new sites automatically",
    about: "A new site is deleted this long after it is published. Each site can be given its own date.",
    wordLabels: { word: "Never", number: "After" },
    start: "30",
  },
  default_search_engines: {
    block: "sites",
    label: "Show new sites in search engines",
    about: "What a new public site starts with. Each site has its own switch. Search engines must also be allowed under Visitors.",
  },
  versions_kept: {
    block: "sites",
    label: "Published versions kept per site",
    about: "How many versions each site keeps, the live one included. Older ones are deleted.",
    unit: "versions",
  },
  trash_days: {
    block: "sites",
    label: "Keep deleted sites in the trash for",
    about: "A deleted site can be restored for this long. After that it is gone for good.",
    unit: "days",
  },
  search_engines_allowed: {
    block: "visitors",
    label: "Allow search engines to list your sites",
    about: "While off, no site is shown in search engines. While on, a public site is shown only if its own switch is on too.",
  },
  outside_pages: {
    block: "visitors",
    label: "Allow other websites to embed your sites",
    about: "While off, a page of another website cannot show a site in a frame or load its files.",
    on: "allowed",
  },
  block_bots: {
    block: "visitors",
    label: "Block bots",
    about:
      "Automatic blocks AI crawlers unless your domain has other hostnames. Always also turns on the domain's bot protection, which can block the command line from cloud hosts. Never leaves the domain's bot rules as they are.",
    choices: { auto: "Automatic", on: "Always", off: "Never" },
  },
  max_total_size: { block: "storage", label: "Storage for all sites together", about: "The most all sites hold together, the trash included." },
  max_site_size: { block: "storage", label: "Storage for one site", about: "The most one site holds." },
  max_sites: { block: "storage", label: "Maximum number of sites", about: "The most sites the install holds. Empty means no limit.", unit: "sites", empty: "No limit" },
  max_files_per_publish: { block: "publishing", label: "Files per publish", about: "The most files one publish, import, or copy holds, up to 10,000.", unit: "files" },
  max_files_per_day: { block: "publishing", label: "Files published per day, all sites", about: "All publishes, imports, and copies begun in one UTC day, together.", unit: "files" },
  max_storage_writes_per_day: {
    block: "publishing",
    label: "Storage write operations per day",
    about: "How often the storage is written to or listed in one UTC day. A published file is one, a copied file two, a listing one.",
    unit: "operations",
  },
  requests_per_day: { block: "traffic", label: "Requests per day, all sites", about: "The most requests all sites answer in one UTC day, together.", unit: "requests" },
  site_share_of_day: { block: "traffic", label: "Daily requests one site may use", about: "The share of the requests per day that one site may take. Past it the site waits for the next UTC day." },
  site_requests_per_minute: { block: "traffic", label: "Requests per minute, one site", about: "The most requests one site answers in a minute.", unit: "requests" },
  visitor_requests_per_minute: { block: "traffic", label: "Requests per minute, one visitor", about: "The most requests one visitor is answered in a minute.", unit: "requests" },
  update_check: {
    block: "updates",
    label: "Check daily for a newer version",
    about: "Once a day the install asks the project's website which version is the newest. Nothing is installed by it.",
  },
  auto_update: {
    block: "updates",
    label: "Update automatically",
    about:
      "Three days after a newer version is first seen, the install starts the update. It needs the check for a newer version on and a rebuild address saved. A version that changes the database always waits for you.",
  },
};

/** A tab's id. */
export type TabId = (typeof TABS)[number]["id"];

/** A block's id. */
type BlockId = (typeof TABS)[number]["blocks"][number]["id"];

/** The words of one setting. */
interface Words {
  /** The block it is shown in. */
  readonly block: BlockId;

  /** Its name, which says alone what changing it does. */
  readonly label: string;

  /** What its question mark explains; empty for none. */
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
interface Block {
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
 * Sort the rows of one tab into its blocks.
 *
 * @returns the blocks of the tab that hold a row, in the order shown
 */
export function blocksOf(tab: TabId, rows: readonly Row[]): readonly Block[] {
  const blocks: readonly { readonly id: BlockId; readonly heading: string }[] = TABS.find((entry) => entry.id === tab)?.blocks ?? [];
  const order = Object.keys(WORDS);
  const place = (row: Row): number => (order.includes(row.key) ? order.indexOf(row.key) : order.length);
  const shown = rows.toSorted((one, other) => place(one) - place(other));

  return blocks.map((block) => ({ ...block, rows: shown.filter((row) => wordsOf(row.key).block === block.id) })).filter((block) => block.rows.length > 0);
}

/**
 * The tab a setting is shown in.
 *
 * @returns the tab that holds the setting's block
 */
export function tabOf(key: string): TabId | undefined {
  const { block } = wordsOf(key);

  return TABS.find((tab) => tab.blocks.some((entry) => entry.id === block))?.id;
}
