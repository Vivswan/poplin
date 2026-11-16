// What a person types or pastes to name a site: its label, its id, a public name, or its address. An address is read down to the same reference, with where it sits kept beside it.
//
//   report--k3f9x2ab71qz                                      the label
//   k3f9x2ab71qz                                              the id
//   docs                                                      a public name
//   https://report--k3f9x2ab71qz-p-poplin.example.com/a?b#c   the address, with or without `https://`, a path, a query, a fragment
//   report--k3f9x2ab71qz-p-poplin                             the first label of the address
//   https://docs-page.example.com/                            a public site's address, which only its install reads
//   https://sites.example.net/report--k3f9x2ab71qz/a?b#c      the address on an install that keeps its sites at paths, which only its install reads
// A word without a dot is never read as a public address: `docs-page` is itself a public name.
// A public address ends in the word its install chose, and a path address sits on a host its install names, so both are kept unread here, and `settleSite` reads them with the layout the install answers.

import { ADMIN_LABEL, parseHostname } from "../names/hostname";
import { type HostParts, keptPublicNames, MARKER, type PublicWord, parsePublicWord, readHostLabel } from "../names/marker";
import type { Checked } from "../names/names";
import type { AddressLayout } from "./address-layout";
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

/** What parts the segments of a path. */
const SLASH = "/";

/** A reference `siteReference` reads. */
type SiteReference = Extract<ReturnType<typeof siteReference>, { readonly ok: true }>["value"];

/** Why a typed string names no site: a rule of a name or an id, `no-site-url` for a URL with its scheme that is not a site's, or `no-site-address` for any other text only an address holds. */
type TypedRefusal = Extract<Checked<unknown>, { readonly ok: false }>["refusal"] | "no-site-url" | "no-site-address";

/** A site as an install is asked for it. `under` is set when a hostname address was typed: the domain it sits under, with its port when it names one, such as `example.com`. */
export type SettledSite = SiteReference & { readonly under?: string };

/** An address only its install can read. `label` is the first label of its host and `under` what stands after it; `segment` is what the first segment of its path names, when that has the form of a label, an id, or a public name. */
interface UnreadAddress {
  readonly kind: "address";
  readonly label: string;
  readonly under: string;
  readonly segment?: SiteReference;
}

/** An install as it reads an address: its origin, such as `https://poplin.example.com`, and the layout it answered. */
interface ReadingInstall {
  readonly server: string;
  readonly layout: AddressLayout;
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

/** What the first segment of a path names, when it has the form of what names a site. */
function firstSegment(url: URL): SiteReference | undefined {
  const reference = siteReference(url.pathname.split(SLASH)[1] ?? "");

  return reference.ok ? reference.value : undefined;
}

function readUrl(address: string): TypedSite | undefined {
  const url = parseAddress(address);
  const host = url === undefined ? undefined : splitHost(url);
  if (url === undefined || host === undefined) return undefined;

  const site = readFirstLabel(host.label);
  if (site !== undefined && site !== "public") return { ...site, under: host.under };

  const segment = firstSegment(url);
  if (segment !== undefined) return { kind: "address", ...host, segment };

  return site === "public" ? { kind: "address", ...host } : undefined;
}

/** Whether an install at `server` keeps hostname addresses under `under`. */
function isUnderServer(under: string, server: string): boolean {
  const host = URL.canParse(server) ? splitHost(new URL(server)) : undefined;

  return host !== undefined && host.label === ADMIN_LABEL && host.under === under;
}

/** Read an unread address as an install of the hostname layout reads it. */
function settleHostname(site: UnreadAddress, server: string, publicWord: PublicWord): SettledSite | undefined {
  if (!isUnderServer(site.under, server)) return undefined;

  const parts = readHostLabel(site.label, { publicWord, reserved: keptPublicNames(publicWord) });
  if (parts.kind === "not-ours" || parts.kind === "not-found") return undefined;

  return { ...(parts.kind === "site" ? ofParts(parts) : parts), under: site.under };
}

/** Read an unread address as an install of the path layout reads it: the private host holds no public name. */
function settlePath(site: UnreadAddress, hosts: { readonly sites: string; readonly private: string }): SettledSite | undefined {
  const host = `${site.label}${DOT}${site.under}`;
  if (site.segment === undefined || (host !== hosts.sites && host !== hosts.private)) return undefined;

  return host === hosts.private && site.segment.kind === "public-name" ? undefined : site.segment;
}

/** Read an address. A text the platform reads as a URL with a host was typed with its scheme and is read as it stands; any other is read as a host with no scheme before it. */
function readAddress(text: string): CheckedTyped {
  const hasScheme = URL.canParse(text) && new URL(text).host !== "";
  const site = readUrl(hasScheme ? text : `${DEFAULT_SCHEME}${text}`);
  if (site === undefined) return { ok: false, refusal: hasScheme ? "no-site-url" : "no-site-address" };

  return { ok: true, value: site };
}

/**
 * Decide whether an address a person typed can be one of the install at `server`, before the install is asked anything.
 *
 * @param site - what `readSiteReference` read
 * @param server - the origin of the install, such as `https://poplin.example.com`
 * @returns `false` for a hostname address under another domain or port than the install's sites; `true` for a site typed as no address, and for an address with a path segment, which only the install's layout places
 */
export function mayBeOfInstall(site: TypedSite, server: string): boolean {
  if (site.under === undefined || (site.kind === "address" && site.segment !== undefined)) return true;

  return isUnderServer(site.under, server);
}

/**
 * Read a typed site as its install reads it: the one place an address with a path segment, or of the form of a public site's, is told to be the install's or not.
 *
 * Under the hostname layout an unread address is a public site's only under the install's domain and with its own public word. Under the path layout it is a site's only on one of the install's two hosts, by its first path segment.
 *
 * @param site - what `readSiteReference` read
 * @param install - the install's origin, and the layout it answered
 * @returns the site, which is `site` itself unless it was an unread address; `undefined` for an address that is no site's of that install
 */
export function settleSite(site: TypedSite, install: ReadingInstall): SettledSite | undefined {
  if (site.kind !== "address") return site;

  if (install.layout.kind === "hostname") return settleHostname(site, install.server, install.layout.public_word);

  return settlePath(site, { sites: install.layout.sites_host, private: install.layout.private_host });
}

/**
 * Read what a person typed or pasted to name a site.
 *
 * Whatever `siteReference` reads means what it means there. A site's address, or the first label of one that carries the id, is read down to the same reference. A public site's address and an address with a path are kept unread, for `settleSite`.
 *
 * @param typed - the string as typed; whitespace and one pair of quotes or angle brackets around it are dropped, and a hostname is lowered
 * @returns the reference, or why the string is none; no lookup is made, and whether an address is this install's is for `mayBeOfInstall` and `settleSite` to say
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
