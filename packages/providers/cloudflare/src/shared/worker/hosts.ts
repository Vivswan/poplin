// Where an install answers, read from its `ZONE` binding and the Worker's own name. The kind of the install is decided here and nowhere else: every piece that differs by kind is a member of the value this builds.
//
//                      an install with a domain                        an install on the account's free address
//   the admin host     poplin.<domain>                                 <worker>.<account>.workers.dev
//   a site             a hostname of its own under the domain          a path on <worker>-sites or <worker>-private, under the same account
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
import { createInstallKey } from "../install/key/install-key";
import type { KeptKey } from "../install/key/kept-key";
import type { UploadKey } from "../install/key/upload-key";
import type { AccountAlert } from "../install/pieces/alerts/account-alert";
import { BUDGET_ALERT } from "../install/pieces/alerts/budget-alert";
import { CERTIFICATE_ALERT } from "../../with-domain/pieces/alerts/certificate-alert";
import { createRulesFollow } from "../../with-domain/pieces/rules/rules-follow";
import type { AccountAddresses } from "../../without-domain/address-layout";
import type { Connection } from "../install/client";
import { type DomainLayout, privateSitesPattern } from "../../with-domain/layout";
import { type BoundInstall, readInstallBinding } from "../install/kind/zone-binding";
import { createPathPlug, givePathKey } from "../../without-domain/path-plug";
import { createDomainPlug, giveKey } from "../../with-domain/zone-plug";

/** The guard rules of an install with no zone: there is none to write, so a change of their settings is carried the moment it is stored. None is left waiting, and none is noted as a problem. */
const NO_RULES: RulesFollow = { holdsKey: () => true, push: async () => ({ ok: true, rules: "none" }) };

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

/** What a hostname is answered as: the dashboard and its open paths, or a site. */
type HostPart = "admin" | "site";

/** The Worker's own place at Cloudflare, the two keys the install keeps, and the clock a new upload key is dated by. */
interface Own {
  readonly accountId: string;
  readonly script: string;
  readonly kept: KeptKey | undefined;
  readonly uploadKey: UploadKey | undefined;
  readonly fetch: Connection["fetch"] | undefined;
  readonly now: () => number;
}

/** The install's side at Cloudflare: the key it keeps, the plug of its kind, which the Domain screen runs, `rules`, which carries a changed setting to the zone's guard rules, and the alerts of its kind, which the key keeps. */
interface Side {
  readonly key: InstallKey;
  readonly domain: DomainPlug;
  readonly rules: RulesFollow;
  readonly alerts: readonly AccountAlert[];
}

/** Where one install answers, and everything that follows from its kind. */
export interface InstallHosts {
  /** Which kind of install this is. */
  readonly kind: BoundInstall["kind"];

  /** The hostname of the dashboard, the login, and the API. */
  readonly adminHost: Hostname;

  /** What the login guards as the private sites: a pattern of hostnames, or one host whole. */
  readonly privateSites: string;

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

/** What a plug of either kind is told of the Worker: where it is, how calls are sent, the clock, and the id of the upload key it holds. */
function placedOf(own: Own): Pick<Own, "accountId" | "script" | "fetch" | "now"> & { readonly uploadKeyId: string | undefined } {
  const { accountId, script, fetch, now, uploadKey } = own;

  return { accountId, script, fetch, now, uploadKeyId: uploadKey?.id };
}

function domainHosts(layout: DomainLayout): InstallHosts {
  function sideOf(own: Own): Side {
    const placed = { ...placedOf(own), layout };
    const key: ReturnType<typeof createInstallKey> = createInstallKey(own.kept, own.accountId, (authorisation) => giveKey({ ...placed, key }, authorisation));

    return { key, domain: createDomainPlug({ ...placed, key, kept: own.kept }), rules: createRulesFollow(own.kept, { accountId: own.accountId, layout }), alerts: [BUDGET_ALERT, CERTIFICATE_ALERT] };
  }

  return {
    kind: "domain",
    adminHost: layout.adminHostname,
    privateSites: privateSitesPattern(layout),
    addresses: hostnameAddresses(layout),
    layout: { kind: "hostname", public_word: layout.publicWord },
    partOf: (hostname) => (hostname === layout.adminHostname ? "admin" : "site"),
    sideOf,
  };
}

function accountHosts(layout: AccountAddresses): InstallHosts {
  function sideOf(own: Own): Side {
    const placed = { ...placedOf(own), layout };
    const key: ReturnType<typeof createInstallKey> = createInstallKey(own.kept, own.accountId, (authorisation) => givePathKey({ ...placed, key }, authorisation));

    return { key, domain: createPathPlug({ ...placed, key, kept: own.kept }), rules: NO_RULES, alerts: [BUDGET_ALERT] };
  }

  return {
    kind: "account address",
    adminHost: layout.adminHost,
    privateSites: layout.privateHost,
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
