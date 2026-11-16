// The address layouts the app's tests run under, built from plain values with core's own parser.
//
//   the hostname layout   label addresses end in `-poplin.example.com`, public names in `-page.example.com`
//   the path layout       a private site is a path of `poplin-private.example.net`, every other site a path of `poplin-sites.example.net`

import { type Hostname, parseHostname } from "@poplin/core/src/names/hostname";
import { DEFAULT_PUBLIC_WORD, type PublicWord } from "@poplin/core/src/names/marker";
import { hostnameAddresses } from "../../../src/sites/hostname-addresses";
import { pathAddresses } from "../../../src/sites/path-addresses";

/** Check a hostname that a test wrote by hand; a refusal is a mistake in the test. */
function hostOf(raw: string): Hostname {
  const hostname = parseHostname(raw);
  if (!hostname.ok) throw new Error(`the test's hostname was refused: ${hostname.refusal}`);

  return hostname.value;
}

/**
 * Build the layout of an install under `example.com` whose public addresses end in `publicWord`.
 */
export function addressesUnder(publicWord: PublicWord): ReturnType<typeof hostnameAddresses> {
  return hostnameAddresses({ domain: hostOf("example.com"), publicWord });
}

/** The hostname layout's answers, as serving and the site actions ask them. */
export const ADDRESSES = addressesUnder(DEFAULT_PUBLIC_WORD);

/** The path layout's answers, to the same questions. */
export const PATH_ADDRESSES = pathAddresses({ sitesHost: hostOf("poplin-sites.example.net"), privateHost: hostOf("poplin-private.example.net") });

/** Every layout, with the words a test names it by: what holds under one must hold under the other. */
export const LAYOUTS = [
  ["the hostname layout", ADDRESSES],
  ["the path layout", PATH_ADDRESSES],
] as const;
