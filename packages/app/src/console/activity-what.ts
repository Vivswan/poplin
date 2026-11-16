// What each entry of the audit log says was done, in the words the Activity screen shows and the downloaded file holds.

import type { AuditEntry } from "@poplin/core/src/records/audit";

/** What each action is called. An action missing here does not compile. */
const WORDS: Readonly<Record<Exclude<AuditEntry["action"], "domain_synced">, string>> = {
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
  login_allowed: "Allowed a token",
  login_denied: "Denied a token",
  update_started: "Started an update",
  update_went_back: "Went back to the version before",
};

/** What an action says when its entry holds what it set. Each answers `undefined` for an entry that holds no such thing. */
const WITH_DETAIL: Readonly<Partial<Record<keyof typeof WORDS, (detail: AuditEntry["detail"]) => string | undefined>>> = {
  publish: (detail) => (typeof detail.version === "number" ? `Published version ${detail.version}` : undefined),
  live_version: (detail) => (typeof detail.version === "number" ? `Made version ${detail.version} live` : undefined),
  access: (detail) => (typeof detail.access === "string" ? `Made it ${detail.access}` : undefined),
  details: detailsWords,
  token_added: (detail) => named("Added the token", detail.note),
  token_revoked: (detail) => named(typeof detail.user === "string" ? "Removed with its user, the token" : "Removed the token", detail.note),
  login_allowed: (detail) => named("Allowed the token", detail.computer),
  login_denied: (detail) => named("Denied the token", detail.computer),
  settings_changed: usersWords,
  update_started: (detail) => (typeof detail.to === "string" ? `Started an update to ${detail.to}${detail.automatic === true ? " by itself" : ""}` : undefined),
  update_went_back: (detail) => (typeof detail.from === "string" && typeof detail.to === "string" ? `Went back to ${detail.to}: the update to ${detail.from} could not change the database` : undefined),
};

/** What a change of one thing of a site says, by the thing its entry holds. A switch says which way it went. */
const ONE_DETAIL: Readonly<Record<string, (value: unknown) => string>> = {
  expires: (value) => (value === "never" ? "Set it to never delete itself" : "Set when it deletes itself"),
  title: () => "Changed the title",
  name: () => "Changed the name",
  search_engines: (value) => (value === true ? "Let search engines show it" : "Kept it out of search engines"),
  embeddable: (value) => (value === true ? "Allowed embedding" : "Stopped embedding"),
};

/** What a change of a site's title and name together says: the one form sets both. */
const TITLE_AND_NAME = "Changed the title and the name";

function named(words: string, name: unknown): string | undefined {
  return typeof name === "string" && name !== "" ? `${words} "${name}"` : undefined;
}

/** A change of one thing of a site says which, and so does a change of its title and name together. Any other says that the site's settings changed. */
function detailsWords(detail: AuditEntry["detail"]): string | undefined {
  const keys = Object.keys(detail);
  const [only] = keys;
  if (keys.length === 1 && only !== undefined) return ONE_DETAIL[only]?.(detail[only]);

  return keys.length === 2 && "title" in detail && "name" in detail ? TITLE_AND_NAME : undefined;
}

/** A change of the users says so, with how many may log in after it: its entry holds them and nothing else. A change of any setting holds no user. */
function usersWords(detail: AuditEntry["detail"]): string | undefined {
  if (Object.keys(detail).join() !== "logins" || !Array.isArray(detail.logins)) return undefined;

  return `Changed the users: ${detail.logins.length} now`;
}

/** A run at the provider says which it was, and a repair with a failure names the first step that failed: the run may have gone on past it. */
function runWords(detail: AuditEntry["detail"], thing: string): string {
  if (detail.run !== "repair") return `Checked ${thing}`;

  const [failed] = Array.isArray(detail.failed) ? detail.failed : [];
  if (typeof failed !== "string") return `Repaired ${thing}`;

  return `Repair failed at ${failed.split(": ")[0]}`;
}

/**
 * Say what an entry of the log did, with what it set where the entry holds it.
 *
 * @param thing - what a sentence calls the install's side at the provider, such as `the domain`, which a run there is said of
 */
export function whatOf(entry: Pick<AuditEntry, "action" | "detail">, thing: string): string {
  if (entry.action === "domain_synced") return runWords(entry.detail, thing);

  return WITH_DETAIL[entry.action]?.(entry.detail) ?? WORDS[entry.action];
}
