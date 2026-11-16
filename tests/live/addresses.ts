// Every address of an install as a stranger types it, written by hand for each of the two layouts: no check writes a hostname of its own.
//
//                          an install with a domain              an install without one, on the account's free address
//   the dashboard          poplin.<domain>                       poplin.<account>.workers.dev
//   a private site         <label>-p-poplin.<domain>/            poplin-private.<account>.workers.dev/<label>/
//   any other site         <label>-u-poplin.<domain>/            poplin-sites.<account>.workers.dev/<label>/
//   with no letter         <label>-poplin.<domain>/              no such form: the host says which side it is
//   with no slash          no such form: the label is a host     the same address without its last slash
//
// Nothing here is the product's own code, so a check that compares an answer with one of these compares it with what a person would type.

/** The Worker's name on an install without a domain, which starts each of its three hostnames. */
const WORKER = "poplin";

/** What every free address of an account ends in. */
const FREE_ADDRESS = "workers.dev";

/** A label no site has, in a form no id has: the hostname or the path it makes names nothing of an install. */
const NO_LABEL = "x";

/** The side of an install a site answers on: `p` for a private site, `u` for every other. */
type Letter = "p" | "u";

/** Where an install answers: under its domain, or under the account's name in its free address. */
export type LiveInstall = { readonly kind: "domain"; readonly domain: string } | { readonly kind: "account address"; readonly account: string };

/** The addresses of one install, as a stranger types them. */
export interface LiveAddresses {
  /** Which kind of install these are the addresses of. */
  readonly kind: LiveInstall["kind"];

  /** Where the dashboard, the login, and the API answer: an origin, with no slash at its end. */
  readonly admin: string;

  /** The address of a site by its label, or by its bare id, on the side of a letter, with its last slash. */
  readonly site: (label: string, letter: Letter) => string;

  /** The same address in the form the install itself answers as a site's `url`. */
  readonly answered: (label: string, letter: Letter) => string;

  /** The address of a site with no letter in it; `undefined` in a layout that has no such form. */
  readonly letterless: (label: string) => string | undefined;

  /** The address of a site without its last slash; `undefined` in a layout where that slash follows a hostname. */
  readonly unslashed: (label: string, letter: Letter) => string | undefined;

  /** An address on the side of the open sites that is no site's, with its last slash: files of the install's own would be under it if a site host served any. */
  readonly openRoot: string;

  /** The same on the side of the private sites, which the login stands in front of. */
  readonly privateRoot: string;

  /** Two hostnames beside the install's own that nothing of it answers on: one beside its hosts, one below the dashboard's. */
  readonly beside: (word: string) => readonly string[];

  /** What the frame rule of a site's page names: every address a page of the install's sites has. */
  readonly frameSources: string;

  /** Whether an address is the install's own: of its dashboard, or of a site of it. */
  readonly isOwn: (address: string) => boolean;
}

function hostOf(address: string): string | undefined {
  return URL.canParse(address) ? new URL(address).hostname : undefined;
}

function underDomain(domain: string): LiveAddresses {
  const site: LiveAddresses["site"] = (label, letter) => `https://${label}-${letter}-poplin.${domain}/`;
  const letterless = (label: string): string => `https://${label}-poplin.${domain}/`;

  return {
    kind: "domain",
    admin: `https://poplin.${domain}`,
    site,
    answered: (label, letter) => site(label, letter).slice(0, -1),
    letterless,
    unslashed: () => undefined,
    openRoot: letterless(NO_LABEL),
    privateRoot: site(NO_LABEL, "p"),
    beside: (word) => [`https://${word}.${domain}/`, `https://${word}.poplin.${domain}/`],
    frameSources: `https://*.${domain}`,
    isOwn: (address) => {
      const hostname = hostOf(address);

      return hostname === domain || hostname?.endsWith(`.${domain}`) === true;
    },
  };
}

function underAccount(account: string): LiveAddresses {
  const hosts = { admin: `${WORKER}.${account}.${FREE_ADDRESS}`, u: `${WORKER}-sites.${account}.${FREE_ADDRESS}`, p: `${WORKER}-private.${account}.${FREE_ADDRESS}` };
  const unslashed = (label: string, letter: Letter): string => `https://${hosts[letter]}/${label}`;
  const site: LiveAddresses["site"] = (label, letter) => `${unslashed(label, letter)}/`;

  return {
    kind: "account address",
    admin: `https://${hosts.admin}`,
    site,
    answered: site,
    letterless: () => undefined,
    unslashed,
    openRoot: `https://${hosts.u}/`,
    privateRoot: `https://${hosts.p}/`,
    beside: (word) => [`https://${word}.${account}.${FREE_ADDRESS}/`, `https://${word}.${hosts.admin}/`],
    frameSources: `https://${hosts.u} https://${hosts.p}`,
    isOwn: (address) => Object.values(hosts).includes(hostOf(address) ?? ""),
  };
}

/**
 * Write the addresses of an install by hand, in the layout its kind has.
 *
 * @returns the addresses; nothing is asked of the install, so an install of the other kind answers none of them
 */
export function liveAddresses(install: LiveInstall): LiveAddresses {
  return install.kind === "domain" ? underDomain(install.domain) : underAccount(install.account);
}
