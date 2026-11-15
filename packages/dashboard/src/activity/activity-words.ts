// The words of the Activity screen: what each entry of the log says was done, the kinds the log is narrowed to, the order it is read in, and what an empty page says.

import type { Entry } from "@/activity/activity-queries";
import { queryWith } from "@/shared/pages";
import type { Sort } from "@/table/data-table";
import { type Orders, sortIn, sortKeys } from "@/table/sort";

/** The kinds of action the log is narrowed to. The first shows every entry. */
export const KINDS = [
  { value: "all", label: "All activity" },
  { value: "sites", label: "Sites" },
  { value: "access", label: "Access" },
  { value: "settings", label: "Settings" },
] as const;

/** The orders of the log: by when an entry was written, the newest first in a table nobody sorted. */
const ACTIVITY_ORDERS: Orders = { first: { when: "desc" }, unsorted: { key: "when", descending: true } };

/** What each action is called. An action missing here does not compile. */
const WORDS: Readonly<Record<Exclude<Entry["action"], "domain_synced">, string>> = {
  create: "Made the site",
  publish: "Published a version",
  live_version: "Made an older version live",
  access: "Changed who can open it",
  details: "Changed the site's settings",
  new_id: "Made a new link",
  trash: "Deleted (moved to the trash)",
  restore: "Restored from the trash",
  delete: "Deleted for good",
  imported: "Imported the site",
  duplicate: "Made the site as a copy",
  token_added: "Added a token",
  token_revoked: "Removed a token",
  settings_set: "Set the first settings",
  settings_changed: "Changed the settings",
  signed_everyone_out: "Signed everyone out",
  login: "Logged in",
  login_allowed: "Allowed a computer to log in",
  login_denied: "Denied a computer's login",
  update_address_set: "Saved the rebuild address",
  update_address_removed: "Removed the rebuild address",
  update_started: "Started an update",
};

/** What an action says when its entry holds what it set. Each answers `undefined` for an entry that holds no such thing. */
const WITH_DETAIL: Readonly<Partial<Record<Entry["action"], (detail: Entry["detail"]) => string | undefined>>> = {
  publish: (detail) => (typeof detail.version === "number" ? `Published version ${detail.version}` : undefined),
  live_version: (detail) => (typeof detail.version === "number" ? `Made version ${detail.version} live` : undefined),
  access: (detail) => (typeof detail.access === "string" ? `Made it ${detail.access}` : undefined),
  token_added: (detail) => named("Added the token", detail.note),
  token_revoked: (detail) => named("Removed the token", detail.note),
  login_allowed: (detail) => named("Allowed the computer", detail.computer),
  login_denied: (detail) => named("Denied the computer", detail.computer),
  update_started: (detail) => (typeof detail.to === "string" ? `Started an update to ${detail.to}` : undefined),
  domain_synced: domainWords,
};

/** A kind's value. */
export type Kind = (typeof KINDS)[number]["value"];

function named(words: string, name: unknown): string | undefined {
  return typeof name === "string" && name !== "" ? `${words} "${name}"` : undefined;
}

/** A run on the domain says which it was, and a repair with a failure names the first step that failed: the run may have gone on past it. */
function domainWords(detail: Entry["detail"]): string {
  if (detail.run !== "repair") return "Checked the domain";

  const [failed] = Array.isArray(detail.failed) ? detail.failed : [];
  if (typeof failed !== "string") return "Repaired the domain";

  return `Repair failed at ${failed.split(": ")[0]}`;
}

/** Read the kind the address names; every entry for a kind it does not know. */
export function kindOf(query: URLSearchParams): Kind {
  return KINDS.find((entry) => entry.value === query.get("kind"))?.value ?? "all";
}

/** Read the order the address names; the newest first for anything but the oldest first. */
export function sortOf(query: URLSearchParams): Sort {
  return sortIn(query, ACTIVITY_ORDERS);
}

/** Say what an entry of the log did, with what it set where the entry holds it. */
export function whatOf(entry: Pick<Entry, "action" | "detail">): string {
  const detailed = WITH_DETAIL[entry.action]?.(entry.detail);
  if (detailed !== undefined) return detailed;

  return entry.action === "domain_synced" ? domainWords(entry.detail) : WORDS[entry.action];
}

/**
 * Write the query of the log from its first page, in another order.
 *
 * @param next - the order a press on a heading leads to; `undefined` for none, which is the newest first
 */
export function sortedQuery(query: URLSearchParams, next: Sort | undefined): URLSearchParams {
  return queryWith(query, sortKeys(next, ACTIVITY_ORDERS));
}

/** The words of a page that holds no entry. */
export function emptyWords(kind: Kind, site: string): { readonly title: string; readonly says: string } {
  if (site !== "")
    return {
      title: `No activity for "${site}"`,
      says: kind === "all" ? "Check the spelling, or clear the search." : "Clear the search, or choose All activity.",
    };

  if (kind === "all") return { title: "No activity yet", says: "Every change of a site, a token, or a setting is listed here." };

  return { title: "No activity of this kind", says: "Choose All activity to see every entry." };
}
