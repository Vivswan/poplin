// The words of the Settings screen: the name and the meaning of each setting, its unit, and the group it is shown in. A setting with no words here is still shown, under a name made from its key.

import type { Row } from "@/settings/settings-queries";

/** The groups, in the order shown. The folded ones stay shut until a row of theirs warns, is refused, or is typed in. */
const GROUPS = [
  { id: "sites", label: "Sites", folded: false },
  { id: "dashboard", label: "This dashboard", folded: false },
  { id: "updates", label: "Updates", folded: false },
  { id: "storage", label: "Storage limits", folded: true },
  { id: "requests", label: "Request limits", folded: true },
  { id: "more", label: "More", folded: true },
  { id: "domain", label: "Set with the domain", folded: true },
] as const;

/** What each setting is called, what it means in a line, the unit of a number, and its group. */
const WORDS: Readonly<Record<string, Words>> = {
  default_expires: { group: "sites", label: "New sites delete themselves", meaning: "After how long: never, or a span such as 12h or 30d." },
  default_search_engines: { group: "sites", label: "Let search engines list new sites", meaning: "What a new site starts with. Each site has its own switch." },
  versions_kept: { group: "sites", label: "Versions kept", meaning: "How many versions each site keeps, the live one included.", unit: "versions" },
  trash_days: { group: "sites", label: "Days in the trash", meaning: "How long a deleted site waits before it is gone for good.", unit: "days" },
  logins: { group: "dashboard", label: "People who can log in", meaning: "One email on a line. A new email gets in after a Repair of the domain." },
  update_check: {
    group: "updates",
    label: "Check for a newer version",
    meaning: "Once a day the install asks the project's website which version is the newest.",
  },
  max_total_size: { group: "storage", label: "Storage, all sites", meaning: "The most all sites hold together, such as 9GB." },
  max_site_size: { group: "storage", label: "Storage, one site", meaning: "The most one site holds, such as 200MB." },
  max_sites: { group: "storage", label: "Sites", meaning: "The most sites, or none for no limit." },
  max_files_per_publish: {
    group: "storage",
    label: "Files in one publish",
    meaning: "The most files one publish, import, or copy holds, up to 10000.",
    unit: "files",
  },
  max_files_per_day: {
    group: "storage",
    label: "Files in one day",
    meaning: "All publishes, imports, and copies begun in one UTC day, together.",
    unit: "files",
  },
  max_storage_writes_per_day: {
    group: "storage",
    label: "Storage writes in one day",
    meaning: "The times the storage is written to or listed in one UTC day: a publish's files, a copy's files twice, and every listing.",
    unit: "writes",
  },
  requests_per_day: { group: "requests", label: "Requests in one day", meaning: "All sites together.", unit: "requests" },
  site_share_of_day: { group: "requests", label: "One site's share of the day", meaning: "The share of the day's requests one site may take." },
  site_requests_per_minute: { group: "requests", label: "One site, in a minute", meaning: "The requests one site answers in a minute.", unit: "a minute" },
  visitor_requests_per_minute: {
    group: "requests",
    label: "One visitor, in a minute",
    meaning: "The requests one visitor is answered in a minute.",
    unit: "a minute",
  },
  outside_pages: { group: "domain", label: "Let outside pages in", meaning: "Whether they may frame a site or load its files." },
  search_engines_allowed: { group: "domain", label: "Let search engines in", meaning: "" },
  block_bots: { group: "domain", label: "Block bots", meaning: "The domain's bot switches." },
};

/** A group's id. */
type GroupId = (typeof GROUPS)[number]["id"];

/** The words of one setting. */
interface Words {
  readonly group: GroupId;
  readonly label: string;
  readonly meaning: string;
  readonly unit?: string;
}

/** One group as it is drawn: its heading, whether it starts shut, and its rows in the order the settings are kept. */
export interface Group {
  readonly id: GroupId;
  readonly label: string;
  readonly folded: boolean;
  readonly rows: readonly Row[];
}

/** The group of a setting that has no words: a limit goes with the limits it reads like, anything else under More. */
function groupFromKey(key: string): GroupId {
  if (key.includes("requests")) return "requests";

  return key.startsWith("max_") ? "storage" : "more";
}

/**
 * The words of a setting.
 *
 * @returns the settled words, or for a setting that has none its key as a name, such as `Max writes per day`, with no meaning
 */
export function wordsOf(key: string): Words {
  if (Object.hasOwn(WORDS, key) && WORDS[key] !== undefined) return WORDS[key];

  const spaced = key.replaceAll("_", " ");

  return { group: groupFromKey(key), label: `${spaced.slice(0, 1).toUpperCase()}${spaced.slice(1)}`, meaning: "" };
}

/**
 * Sort the rows into their groups.
 *
 * @returns the groups that hold a row, in the order shown. A setting changed where the domain is goes into the last group whatever its words say, and Updates is always there: it also holds the rebuild address
 */
export function groupsOf(rows: readonly Row[]): readonly Group[] {
  const groupOf = (row: Row): GroupId => (row.elsewhere ? "domain" : wordsOf(row.key).group);
  const groups = GROUPS.map((group) => ({ ...group, rows: rows.filter((row) => groupOf(row) === group.id) }));

  return groups.filter((group) => group.rows.length > 0 || group.id === "updates");
}
