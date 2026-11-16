// The addresses of an install without a domain, after their checks: three hostnames on the account's free `workers.dev` address, each safe to write into a Worker's name and an Access application.
//
//   <worker>.<account>.workers.dev            the dashboard, the login, the API, and the setup page
//   <worker>-sites.<account>.workers.dev      every unlisted and public site
//   <worker>-private.<account>.workers.dev    every private site

import { type Hostname, parseHostname } from "@poplin/core/src/names/hostname";
import { INSTALL_OBJECTS } from "./install-objects";
import { MAX_ACCESS_ADDRESS } from "./layout";

/** What every free address of an account ends in, after the account's own name. */
const FREE_ADDRESS = "workers.dev";

/** What the name of the forwarder in front of the open sites ends in, after the Worker's name. */
const SITES_ENDING = "-sites";

/** What the name of the forwarder in front of the private sites ends in, after the Worker's name. */
const PRIVATE_ENDING = "-private";

declare const addressBrand: unique symbol;

/** The layout as the Worker's `ZONE` binding holds it, unchecked: the account's name in its free address, the `<account>` of `<worker>.<account>.workers.dev`. */
export interface RawAddressLayout {
  readonly account_address: string;
}

/** A layout made by `parseAddressLayout` alone. Each forwarder's name is the first label of the host it answers at. */
export interface AddressLayout {
  /** The account's name in its free address. */
  readonly account: string;

  /** The one Worker's name. */
  readonly worker: string;

  /** The hostname of the dashboard, the login, the API, and the setup page: the Worker's own free address. */
  readonly adminHost: Hostname;

  /** The name of the forwarder in front of the open sites. */
  readonly sitesWorker: string;

  /** The hostname of every unlisted and public site. */
  readonly sitesHost: Hostname;

  /** The name of the forwarder in front of the private sites. */
  readonly privateWorker: string;

  /** The hostname of every private site, which Access guards whole. */
  readonly privateHost: Hostname;

  /** The mark no other code can write. */
  readonly [addressBrand]: true;
}

/** Why a layout was refused. `bad-worker` is a Worker's name that is no single label of a hostname, or whose forwarder's name is none. `account-too-long` is an account's name under which an address passes what Access takes. */
type AddressRefusal = "bad-account" | "bad-worker" | "account-too-long";

/** A layout, or the first rule it breaks. */
export type CheckedAddressLayout = { readonly ok: true; readonly value: AddressLayout } | { readonly ok: false; readonly refusal: AddressRefusal };

/**
 * Check the addresses of an install without a domain before any of them reaches Cloudflare.
 *
 * @param worker - the one Worker's name, which the two forwarders' names are made from
 * @returns the layout, or the first rule it breaks; under a Worker named `poplin` the account's name may be 36 characters at most
 */
export function parseAddressLayout(raw: RawAddressLayout, worker: string): CheckedAddressLayout {
  // An account's name is one label: it holds no dot, and under the free address alone it is a hostname.
  if (raw.account_address.includes(".") || !parseHostname(`${raw.account_address}.${FREE_ADDRESS}`).ok) return { ok: false, refusal: "bad-account" };

  const sitesWorker = `${worker}${SITES_ENDING}`;
  const privateWorker = `${worker}${PRIVATE_ENDING}`;
  const [adminHost, sitesHost, privateHost] = [worker, sitesWorker, privateWorker].map((name) => parseHostname(`${name}.${raw.account_address}.${FREE_ADDRESS}`));
  // A Worker's name is one label too: with a dot in it, each host would sit a level deeper than the free address gives.
  if (worker.includes(".") || !adminHost?.ok || !sitesHost?.ok || !privateHost?.ok) return { ok: false, refusal: "bad-worker" };

  const addresses = [...INSTALL_OBJECTS.openPaths.map((path) => `${adminHost.value}${path}`), privateHost.value];
  if (addresses.some((address) => address.length > MAX_ACCESS_ADDRESS)) return { ok: false, refusal: "account-too-long" };

  const layout = { account: raw.account_address, worker, adminHost: adminHost.value, sitesWorker, sitesHost: sitesHost.value, privateWorker, privateHost: privateHost.value };

  return { ok: true, value: layout as AddressLayout };
}
