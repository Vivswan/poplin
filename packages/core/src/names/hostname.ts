// A hostname as DNS and a provider's rule language may see it: lowercase ASCII labels only, so it holds no quote, backslash, or wildcard.

/** The first label of the hostname every install's dashboard, login, and API answer at: `poplin.<domain>`. No site address is that hostname, since each ends in a dash and a word. */
export const ADMIN_LABEL = "poplin";

/** The most characters DNS carries in a hostname. */
const MAX_HOSTNAME_LENGTH = 253;

/** One label: 1 to 63 lowercase letters, digits, and dashes, with no dash first or last. */
const LABEL = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/;

declare const hostnameBrand: unique symbol;

/** A string that passed `parseHostname`; no other code can make one. */
export type Hostname = string & { readonly [hostnameBrand]: true };

/** Why a string was refused. `single-label` means it has no dot, so it names no host under a domain. */
type HostnameRefusal = "empty" | "too-long" | "single-label" | "bad-label";

/** A hostname, or the first rule the string breaks. */
export type CheckedHostname = { readonly ok: true; readonly value: Hostname } | { readonly ok: false; readonly refusal: HostnameRefusal };

/**
 * Decide whether a string is a hostname.
 *
 * @param raw - compared as given: capitals, a trailing dot, and a wildcard label are refused, never repaired
 * @returns the hostname, or the first rule it breaks
 */
export function parseHostname(raw: string): CheckedHostname {
  if (raw.length === 0) return { ok: false, refusal: "empty" };

  if (raw.length > MAX_HOSTNAME_LENGTH) return { ok: false, refusal: "too-long" };

  const labels = raw.split(".");
  if (labels.length < 2) return { ok: false, refusal: "single-label" };

  if (!labels.every((label) => LABEL.test(label))) return { ok: false, refusal: "bad-label" };

  return { ok: true, value: raw as Hostname };
}
