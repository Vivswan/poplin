// The two kinds of install the preview stands in for, and where the addresses of each are on this machine.
//
//   with a domain      one local origin      the dashboard at its root, each site under /served/<its first host label>/
//   without a domain   three local origins   the dashboard at one, the open sites and the private sites as paths of the other two
//
// Either way the app is asked at the install's own https addresses. A kind maps what a browser here asks to those, and what the app writes back.
// A site's place under a domain is its whole first host label, so nothing here knows how a label is built.

import { hostnameAddresses } from "../../../app/src/sites/hostname-addresses";
import type { SiteAddresses } from "../../../app/src/sites/addresses";
import { pathAddresses } from "../../../app/src/sites/path-addresses";
import { ADMIN_LABEL, type Hostname, parseHostname } from "../../../core/src/names/hostname";
import { DEFAULT_PUBLIC_WORD } from "../../../core/src/names/marker";
import type { AddressLayout } from "../../../core/src/sites/address-layout";
import { type Provider, WITH_DOMAIN, WITHOUT_DOMAIN } from "./domain-plug";
import { type Mount, SERVED_PREFIX } from "./mount";

/** The invented domain of the preview's install that has one. */
const DOMAIN = "example.com";

/** The end of every hostname of that install. */
const DOMAIN_ENDING = `.${DOMAIN}`;

/** The origin the dashboard and the API of that install are asked at. */
const ADMIN_ORIGIN = `https://${ADMIN_LABEL}${DOMAIN_ENDING}`;

/** A hostname one label under the domain, with the scheme before it and the slash after it when a text writes them. */
const HOST_ADDRESS = new RegExp(`(https://)?(?<![%@\\w.-])([a-z0-9-]+)${DOMAIN_ENDING.replaceAll(".", "\\.")}/?`, "g");

/** The scheme every address of an install begins with. */
const HTTPS = "https://";

/** The three origins a preview of an install without a domain answers at, each as a browser on this machine writes it, such as `http://sites.localhost:4400`. Their hostnames are three different ones, of two labels or more. */
export interface LocalOrigins {
  /** Where the dashboard and the API answer. */
  readonly admin: string;

  /** Where every unlisted and public site answers, each under a path. */
  readonly sites: string;

  /** Where every private site answers, each under a path. */
  readonly private: string;
}

/** One kind of install, as the preview stands in for it. */
export interface Kind {
  /** The address layout of the install, which is the product's own. */
  readonly addresses: SiteAddresses;

  /** That layout as the API says it to a client; the hosts of a path layout are written as a browser here asks them. */
  readonly layout: AddressLayout;

  /** The origin the app is asked the dashboard and the API at. */
  readonly adminOrigin: string;

  /** The provider's side of the install, as the Domain screen checks and repairs it. */
  readonly provider: Provider;

  /** Reads which site's piece a browser's address belongs to: the prefix of its paths here, and the origin the app is asked at. `undefined` for an address of the dashboard's side. */
  readonly siteAt: (asked: URL) => Pick<Mount, "prefix" | "origin"> | undefined;

  /** Writes where the root of a site hostname of the install is here, with no closing slash: a path of the dashboard's origin, or a whole address at another origin. */
  readonly siteRoot: (hostname: string) => string;

  /** Writes the address of the dashboard's first page, as a page at the address a browser asked links to it. */
  readonly home: (asked: URL) => string;

  /** The address of the dashboard's first page as a page at the root of a public site links to it: a whole address where the dashboard has an origin of its own, else the way up from the place the site is served at. */
  readonly homeFromSite: string;

  /** Rewrites every address of the install that a text holds outside an attribute as the one that works here. `origin` is the one the browser asked; `real` gives the address a site's own leads to instead, by the site's hostname. */
  readonly localText: (text: string, origin: string, real: ReadonlyMap<string, string>) => string;
}

function hostnameOf(raw: string): Hostname {
  const hostname = parseHostname(raw);
  if (!hostname.ok) throw new Error(`the preview's hostname ${raw} was refused: ${hostname.refusal}`);

  return hostname.value;
}

/** The site a path under `/served/` names by its first host label; none for a path that ends before the slash after the label. */
function servedAt(asked: URL): Pick<Mount, "prefix" | "origin"> | undefined {
  const start = `${SERVED_PREFIX}/`;
  if (!asked.pathname.startsWith(start)) return undefined;

  const [label = "", ...rest] = asked.pathname.slice(start.length).split("/");
  if (label === "" || rest.length === 0) return undefined;

  const name = decodeURIComponent(label);

  return { prefix: `${start}${name}`, origin: `${HTTPS}${name}${DOMAIN_ENDING}` };
}

/** An install under the invented domain, all of it on the one origin a browser asks. */
function withDomain(): Kind {
  const addresses = hostnameAddresses({ domain: hostnameOf(DOMAIN), publicWord: DEFAULT_PUBLIC_WORD });
  const siteRoot: Kind["siteRoot"] = (hostname) => `${SERVED_PREFIX}/${hostname.slice(0, -DOMAIN_ENDING.length)}`;

  function localText(text: string, origin: string, real: ReadonlyMap<string, string>): string {
    const host = origin.replace(/^https?:\/\//, "");
    const written = text.replace(HOST_ADDRESS, (...[whole = "", scheme, label = ""]: string[]) => {
      const hostname = `${label}${DOMAIN_ENDING}`;
      if (!addresses.isSiteHost(hostname)) return whole;

      // A real address is written as the text wrote the site's own: with its scheme or without.
      const root = real.get(hostname);
      if (root !== undefined) return scheme === undefined ? root.slice(HTTPS.length) : root;

      return `${scheme === undefined ? host : origin}${siteRoot(hostname)}/`;
    });

    return written.replaceAll(ADMIN_ORIGIN, origin).replaceAll(new URL(ADMIN_ORIGIN).hostname, host);
  }

  return {
    addresses,
    layout: { kind: "hostname", public_word: DEFAULT_PUBLIC_WORD },
    adminOrigin: ADMIN_ORIGIN,
    provider: WITH_DOMAIN,
    siteAt: servedAt,
    siteRoot,
    home: () => "/",
    // A site is served two folders under the dashboard, whatever path the demo itself sits under.
    homeFromSite: "../../",
    localText,
  };
}

/** An install without a domain, on three origins of this machine: the app is asked at the same three hostnames, over https and without a port. */
function withoutDomain(origins: LocalOrigins): Kind {
  const [admin, sites, privates] = [new URL(origins.admin), new URL(origins.sites), new URL(origins.private)];
  const here = new Map([admin, sites, privates].map((origin) => [hostnameOf(origin.hostname) as string, origin]));
  if (here.size < 3) throw new Error("a preview without a domain takes three different hostnames");

  const addresses = pathAddresses({ sitesHost: hostnameOf(sites.hostname), privateHost: hostnameOf(privates.hostname) });
  // A hostname that a port already follows is one of this machine's own addresses, and stays as it is.
  const hostAddress = new RegExp(`(https://)?(?<![%@\\w.-])(${[...here.keys()].map((hostname) => hostname.replaceAll(".", "\\.")).join("|")})(?![\\w.:-])`, "g");

  return {
    addresses,
    layout: { kind: "path", sites_host: sites.host, private_host: privates.host },
    adminOrigin: `${HTTPS}${admin.hostname}`,
    provider: WITHOUT_DOMAIN,
    siteAt: (asked) => (addresses.isSiteHost(asked.hostname) ? { prefix: "", origin: `${HTTPS}${asked.hostname}` } : undefined),
    siteRoot: (hostname) => (hostname === privates.hostname ? privates.origin : sites.origin),
    home: (asked) => (addresses.isSiteHost(asked.hostname) ? `${admin.origin}/` : "/"),
    homeFromSite: `${admin.origin}/`,
    localText: (text) =>
      text.replace(hostAddress, (...[whole = "", scheme, hostname = ""]: string[]) => {
        const origin = here.get(hostname);
        if (origin === undefined) return whole;

        return scheme === undefined ? origin.host : origin.origin;
      }),
  };
}

/**
 * Choose the kind of install a preview stands in for.
 *
 * @param origins - the three local origins of an install without a domain; left out, the install has the invented domain and one origin
 * @returns the kind, whose addresses are the product's own layout of that kind
 * @throws {Error} two of the three origins share a hostname, or one has a hostname of a single label
 */
export function kindOf(origins?: LocalOrigins): Kind {
  return origins === undefined ? withDomain() : withoutDomain(origins);
}
