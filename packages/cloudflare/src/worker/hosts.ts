// Where an install answers, read from its `ZONE` binding and the Worker's own name. The kind of the install is decided here and nowhere else: every piece that differs by kind is a member of the value this builds.
//
//                      an install with a domain                        an install on the account's free address
//   the admin host     poplin.<domain>                                 <worker>.<account>.workers.dev
//   a site             a hostname of its own under the domain          a path on <worker>-sites or <worker>-private, under the same account
//   setup alone        every hostname that ends in .workers.dev        no hostname
//   the setup page     on the admin host and on those                  on the admin host
//   any other host     no site's: serving's 404                        no site's: serving's 404
//   at Cloudflare      the zone plug, and a new key through it         the plug of the free address, and a new key through it
//   the guard rules    follow a changed setting with the kept key      none: there is no zone to hold a rule, so no change of a setting waits for one
//
// The two site hosts of the free address are Workers of their own that hand every request on, so a request for one arrives here with that host in its URL.

import type { DomainPlug } from "@poplin/app/src/console/domain/records";
import type { InstallKey } from "@poplin/app/src/console/key/records";
import type { RulesFollow } from "@poplin/app/src/console/settings/rules-follow";
import type { SiteAddresses } from "@poplin/app/src/sites/addresses";
import { hostnameAddresses } from "@poplin/app/src/sites/hostname-addresses";
import { pathAddresses } from "@poplin/app/src/sites/path-addresses";
import type { Hostname } from "@poplin/core/src/names/hostname";
import type { AddressLayout } from "@poplin/core/src/sites/address-layout";
import { createInstallKey } from "../key/install-key";
import type { KeptKey } from "../key/kept-key";
import { createRulesFollow } from "../key/rules-follow";
import type { AccountAddresses } from "../zone/address-layout";
import type { Connection } from "../zone/client";
import type { DomainLayout } from "../zone/layout";
import { type BoundInstall, readInstallBinding } from "../zone/zone-binding";
import { createPathPlug, givePathKey } from "../zone/path-plug";
import { createDomainPlug, giveKey } from "../zone/zone-plug";

/** What the hostname of a Worker's own address ends in. Cloudflare gives every Worker one, whatever its routes. */
const OWN_ADDRESS = ".workers.dev";

/** The guard rules of an install with no zone: there is none to write, so a change of their settings is carried the moment it is stored. None is left waiting, and none is noted as a problem. */
const NO_RULES: RulesFollow = { holdsKey: () => true, push: async () => ({ ok: true }) };

/** What is wrong with a `ZONE` binding, in a sentence that quotes no value of it. */
const REFUSALS = {
  "bad-shape": "It holds a domain, with or without a public word, or an account address: one of the two, never both, and each as text.",
  "bad-domain": "Its domain is no domain.",
  "domain-too-long": "Its domain is too long for the addresses of the login.",
  "bad-public-word": "Its public word is no word of 2 to 9 lowercase letters.",
  "bad-account": "Its account address is the account's name alone, the part between the Worker's name and workers.dev.",
  "bad-worker": "No hostname can start with the Worker's name, so the account's free address holds no place for it.",
  "account-too-long": "Its account address is too long for the addresses of the login.",
} as const;

/** What a hostname is answered as: the dashboard and its open paths, the setup page alone, or a site. */
type HostPart = "admin" | "setup" | "site";

/** The Worker's own place at Cloudflare, and the key the install keeps. */
interface Own {
  readonly accountId: string;
  readonly script: string;
  readonly kept: KeptKey | undefined;
  readonly fetch: Connection["fetch"] | undefined;
}

/** The install's side at Cloudflare: the key it keeps, the plug of its kind, which the Domain screen and the setup page run, and `rules`, which carries a changed setting to the zone's guard rules. */
interface Side {
  readonly key: InstallKey;
  readonly domain: DomainPlug;
  readonly rules: RulesFollow;
}

/** Where one install answers, and everything that follows from its kind. */
export interface InstallHosts {
  /** Which kind of install this is. */
  readonly kind: BoundInstall["kind"];

  /** The hostname of the dashboard, the login, the API, and the setup page. */
  readonly adminHost: Hostname;

  /** How the addresses of the install's sites are read and written. */
  readonly addresses: SiteAddresses;

  /** The same layout as the API describes it to a client that reads a typed address. */
  readonly layout: AddressLayout;

  /** Says what a request's hostname, in lowercase and without a port, is answered as. */
  readonly partOf: (hostname: string) => HostPart;

  /** Builds the install's side at Cloudflare. */
  readonly sideOf: (own: Own) => Side;
}

/** The hosts a binding names, or what is wrong with it: `absent`, or the rule it breaks followed by a sentence. */
type ReadHosts = { readonly ok: true; readonly value: InstallHosts } | { readonly ok: false; readonly refusal: string };

function domainHosts(layout: DomainLayout): InstallHosts {
  function partOf(hostname: string): HostPart {
    // The Worker's own address is the one that resolves before setup made the domain's records.
    if (hostname.endsWith(OWN_ADDRESS)) return "setup";

    return hostname === layout.adminHostname ? "admin" : "site";
  }

  function sideOf(own: Own): Side {
    const placed = { accountId: own.accountId, script: own.script, layout, fetch: own.fetch };
    const key: InstallKey = createInstallKey(own.kept, own.accountId, (authorisation) => giveKey({ ...placed, key }, authorisation));

    return { key, domain: createDomainPlug({ ...placed, key }), rules: createRulesFollow(own.kept, { accountId: own.accountId, layout }) };
  }

  return { kind: "domain", adminHost: layout.adminHostname, addresses: hostnameAddresses(layout), layout: { kind: "hostname", public_word: layout.publicWord }, partOf, sideOf };
}

function accountHosts(layout: AccountAddresses): InstallHosts {
  function sideOf(own: Own): Side {
    const placed = { accountId: own.accountId, script: own.script, layout, fetch: own.fetch };
    const key: InstallKey = createInstallKey(own.kept, own.accountId, (authorisation) => givePathKey({ ...placed, key }, authorisation));

    return { key, domain: createPathPlug({ ...placed, key }), rules: NO_RULES };
  }

  return {
    kind: "account address",
    adminHost: layout.adminHost,
    addresses: pathAddresses(layout),
    layout: { kind: "path", sites_host: layout.sitesHost, private_host: layout.privateHost },
    partOf: (hostname) => (hostname === layout.adminHost ? "admin" : "site"),
    sideOf,
  };
}

/**
 * Read where an install answers.
 *
 * @param zone - the `ZONE` binding as the runtime hands it over, of any type
 * @param worker - the Worker's own name; `undefined` for one whose name cannot be used, under which an account address is refused and a domain is read as it is
 * @returns the install's hosts, or a refusal the Worker can show: `absent` for a Worker with no such binding, else the rule the binding breaks and one sentence about it; nothing throws
 */
export function readHosts(zone: unknown, worker: string | undefined): ReadHosts {
  // No hostname starts with an empty name, so an account address is refused as `bad-worker`.
  const bound = readInstallBinding(zone, worker ?? "");
  if (bound.ok) return { ok: true, value: bound.value.kind === "domain" ? domainHosts(bound.value.layout) : accountHosts(bound.value.layout) };

  return { ok: false, refusal: bound.refusal === "absent" ? bound.refusal : `${bound.refusal}. ${REFUSALS[bound.refusal]}` };
}
