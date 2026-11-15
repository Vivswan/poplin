// The address layout the app's tests run under, built from plain values with core's own parser: label addresses end in `-poplin.example.com`, public names in `-page.example.com`.

import { type Hostname, parseHostname } from "@poplin/core/src/names/hostname";
import { DEFAULT_PUBLIC_WORD, type PublicWord } from "@poplin/core/src/names/marker";
import { hostnameAddresses } from "../../../src/sites/hostname-addresses";

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

/** The layout's answers, as serving and the site actions ask them. */
export const ADDRESSES = addressesUnder(DEFAULT_PUBLIC_WORD);
