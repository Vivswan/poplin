// What a person types or pastes to name a site: its label, its id, a public name, or its address. An address is read down to the same reference, with where it sits kept beside it.
//
//   report--k3f9x2ab71qz                                      the label
//   k3f9x2ab71qz                                              the id
//   docs                                                      a public name
//   https://report--k3f9x2ab71qz-p-poplin.example.com/a?b#c   the address, with or without `https://`, a path, a query, a fragment
//   report--k3f9x2ab71qz-p-poplin                             the first label of the address
//   https://docs-page.example.com/                            a public site's address, which only its install reads
// A word without a dot is never read as a public address: `docs-page` is itself a public name.
// A public address ends in the word its install chose, so it is kept unread here, and `settleSite` reads it with the word the install answers.

import { ADMIN_LABEL, parseHostname } from "../names/hostname";
import { type HostParts, keptPublicNames, MARKER, parsePublicWord, readHostLabel } from "../names/marker";
import type { Checked } from "../names/names";
import { siteReference } from "./labels";

/** What a paste may carry around the text: one pair of quotes, or the angle brackets a chat or a mail puts around a link. */
const WRAPPERS: readonly (readonly [open: string, close: string])[] = [
  ['"', '"'],
  ["'", "'"],
  ["<", ">"],
];

/** What only an address holds: none of the three is in a label, an id, or a name. */
const ADDRESS_SIGNS = [".", "/", ":"];

/** The scheme an address typed without one is read with. */
const DEFAULT_SCHEME = "https://";

/** The schemes a site is served over. */
const WEB_SCHEMES: readonly string[] = ["https:", "http:"];

/** What parts the labels of a hostname, and ends a fully qualified one. */
const DOT = ".";

/** What stands before the word a hostname label ends in. */
const DASH = "-";

/** A reference `siteReference` reads. */
type SiteReference = Extract<ReturnType<typeof siteReference>, { readonly ok: true }>["value"];

/** Why a typed string names no site: a rule of a name or an id, `no-site-url` for a URL with its scheme that is not a site's, or `no-site-address` for any other text only an address holds. */
type TypedRefusal = Extract<Checked<unknown>, { readonly ok: false }>["refusal"] | "no-site-url" | "no-site-address";

/** A site as an install is asked for it. `under` is set when an address was typed: the domain it sits under, with its port when it names one, such as `example.com`. */
export type SettledSite = SiteReference & { readonly under?: string };

/** An address of the form of a public site's. `label` is its first label, whose last word is the public word of the install it is under, or is not. */
interface UnreadAddress {
  readonly kind: "address";
  readonly label: string;
  readonly under: string;
}

/** What a typed string names: a site, or an address only its install can read. */
export type TypedSite = SettledSite | UnreadAddress;

/** A typed site, or why the string names none. */
type CheckedTyped = { readonly ok: true; readonly value: TypedSite } | { readonly ok: false; readonly refusal: TypedRefusal };

/** Take the whitespace and one wrapping pair off a pasted text. */
function unwrapped(typed: string): string {
  const text = typed.trim();
  const wrapper = WRAPPERS.find(([open, close]) => text.length >= open.length + close.length && text.startsWith(open) && text.endsWith(close));
  if (wrapper === undefined) return text;

  return text.slice(wrapper[0].length, -wrapper[1].length).trim();
}

/** Parse an address with the platform's parser, so every rule of a URL is the platform's. */
function parseAddress(address: string): URL | undefined {
  if (!URL.canParse(address)) return undefined;

  const url = new URL(address);
  if (!WEB_SCHEMES.includes(url.protocol) || url.username !== "" || url.password !== "") return undefined;

  return url;
}

/** The site a label address names: its id, with the name the label carried. */
function ofParts(parts: Extract<HostParts, { readonly kind: "site" }>): SiteReference {
  return parts.name === undefined ? { kind: "id", id: parts.id } : { kind: "site", name: parts.name, id: parts.id };
}

/**
 * Read the first label of a site's hostname without knowing the install.
 *
 * A label address reads the same under every install. Any other label is read with its own last word as the public word, which says only that it has the form of a public address.
 *
 * @returns the site of a label address, `public` for the form of a public address, else `undefined`
 */
function readFirstLabel(label: string): SiteReference | "public" | undefined {
  const publicWord = parsePublicWord(label.slice(label.lastIndexOf(DASH) + DASH.length));
  if (publicWord === undefined) return undefined;

  const parts = readHostLabel(label, { publicWord, reserved: keptPublicNames(publicWord) });
  if (parts.kind === "public-name") return "public";

  return parts.kind === "site" ? ofParts(parts) : undefined;
}

/** The first label of a hostname, and what stands after it with the port: `under` of a typed site. */
function splitHost(url: URL): { readonly label: string; readonly under: string } | undefined {
  const hostname = url.hostname.endsWith(DOT) ? url.hostname.slice(0, -DOT.length) : url.hostname;
  if (!parseHostname(hostname).ok) return undefined;

  const dotAt = hostname.indexOf(DOT);
  const domain = hostname.slice(dotAt + DOT.length);

  return { label: hostname.slice(0, dotAt), under: url.port === "" ? domain : `${domain}:${url.port}` };
}

function readUrl(address: string): TypedSite | undefined {
  const url = parseAddress(address);
  const host = url === undefined ? undefined : splitHost(url);
  const site = host === undefined ? undefined : readFirstLabel(host.label);
  if (host === undefined || site === undefined) return undefined;

  return site === "public" ? { kind: "address", ...host } : { ...site, under: host.under };
}

/** Read an address. A text the platform reads as a URL with a host was typed with its scheme and is read as it stands; any other is read as a host with no scheme before it. */
function readAddress(text: string): CheckedTyped {
  const hasScheme = URL.canParse(text) && new URL(text).host !== "";
  const site = readUrl(hasScheme ? text : `${DEFAULT_SCHEME}${text}`);
  if (site === undefined) return { ok: false, refusal: hasScheme ? "no-site-url" : "no-site-address" };

  return { ok: true, value: site };
}

/**
 * Decide whether an address a person typed is one of the install at `server`.
 *
 * @param site - what `readSiteReference` read
 * @param server - the origin of the install, such as `https://poplin.example.com`
 * @returns `false` for an address under another domain or port than the install's sites; `true` for a site typed as no address
 */
export function isOfInstall(site: TypedSite, server: string): boolean {
  if (site.under === undefined) return true;

  const host = URL.canParse(server) ? splitHost(new URL(server)) : undefined;

  return host !== undefined && host.label === ADMIN_LABEL && host.under === site.under;
}

/**
 * Read a typed site as its install reads it: an address of the form of a public site's is one only under the install's own public word.
 *
 * @param site - what `readSiteReference` read, of an install `isOfInstall` holds for
 * @param publicWord - what the install answered as the word its public addresses end in
 * @returns the site, which is `site` itself unless it was an unread address; `undefined` for an address that is no site's under that word
 */
export function settleSite(site: TypedSite, publicWord: string): SettledSite | undefined {
  if (site.kind !== "address") return site;

  const word = parsePublicWord(publicWord);
  const parts = word === undefined ? undefined : readHostLabel(site.label, { publicWord: word, reserved: keptPublicNames(word) });
  if (parts === undefined || parts.kind === "not-ours" || parts.kind === "not-found") return undefined;

  return { ...(parts.kind === "site" ? ofParts(parts) : parts), under: site.under };
}

/**
 * Read what a person typed or pasted to name a site.
 *
 * Whatever `siteReference` reads means what it means there. A site's address, or the first label of one that carries the id, is read down to the same reference. A public site's address is kept unread, for `settleSite`.
 *
 * @param typed - the string as typed; whitespace and one pair of quotes or angle brackets around it are dropped, and a hostname is lowered
 * @returns the reference, or why the string is none; no lookup is made, and whether an address is this install's is for `isOfInstall` to say
 */
export function readSiteReference(typed: string): CheckedTyped {
  const text = unwrapped(typed);
  if (ADDRESS_SIGNS.some((sign) => text.includes(sign))) return readAddress(text);

  const reference = siteReference(text);
  if (reference.ok || !text.endsWith(MARKER)) return reference;

  const site = readFirstLabel(text);
  if (site === undefined || site === "public") return reference;

  return { ok: true, value: site };
}
