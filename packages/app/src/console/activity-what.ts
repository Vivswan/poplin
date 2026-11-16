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
};

/** What an action says when its entry holds what it set. Each answers `undefined` for an entry that holds no such thing. */
const WITH_DETAIL: Readonly<Partial<Record<keyof typeof WORDS, (detail: AuditEntry["detail"]) => string | undefined>>> = {
  publish: (detail) => (typeof detail.version === "number" ? `Published version ${detail.version}` : undefined),
  live_version: (detail) => (typeof detail.version === "number" ? `Made version ${detail.version} live` : undefined),
  access: (detail) => (typeof detail.access === "string" ? `Made it ${detail.access}` : undefined),
  details: expiryWords,
  token_added: (detail) => named("Added the token", detail.note),
  token_revoked: (detail) => named(typeof detail.user === "string" ? "Removed with its user, the token" : "Removed the token", detail.note),
  login_allowed: (detail) => named("Allowed the token", detail.computer),
  login_denied: (detail) => named("Denied the token", detail.computer),
  update_started: (detail) => (typeof detail.to === "string" ? `Started an update to ${detail.to}${detail.automatic === true ? " by itself" : ""}` : undefined),
};

function named(words: string, name: unknown): string | undefined {
  return typeof name === "string" && name !== "" ? `${words} "${name}"` : undefined;
}

/** A change of when a site deletes itself, and of nothing else, says so. */
function expiryWords(detail: AuditEntry["detail"]): string | undefined {
  if (Object.keys(detail).join() !== "expires") return undefined;

  return detail.expires === "never" ? "Set it to never delete itself" : "Set when it deletes itself";
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
