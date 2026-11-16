// The Cloudflare side of an install with nothing set yet: the plug is made once a person has chosen the kind of install and typed the first login.
//
//   a domain of their own    the zone plug of the typed domain             the account is the one the token shows that domain in
//   no domain                the plug of the account's free address        the account is the one whose free address the setup page was asked at
//
// No account is known before the token: a repair takes it from what the token shows, and writes the install's values to the Worker of that name in that account.
// A token of another account therefore writes to its own account's Worker, or to none, and never to this one.

import type { FirstRun } from "@poplin/app/src/console/domain/records";
import { addressesAt } from "./address-layout";
import type { Connection } from "./client";
import { parseDomainLayout } from "./layout";
import { createPathPlug } from "./path-plug";
import { createDomainPlug, tokenFacts } from "./zone-plug";

/** What the first run is built from. */
interface FirstParts {
  /** The name of the install's Worker, which its routes or its forwarders name and its values are written to. */
  readonly script: string;

  /** Where the API is; absent outside tests. */
  readonly baseUrl?: string | undefined;

  /** What sends a call; absent outside tests. */
  readonly fetch?: Connection["fetch"];
}

/**
 * Build the first run of an install on Cloudflare.
 *
 * @returns the token's facts for each kind of install, and a way to the plug of the kind a person chose.
 * Text that is no domain, or one too long for the login's address, gets no plug; nor does a hostname that is not the Worker's own free address
 */
export function createFirstRun(parts: FirstParts): FirstRun {
  return {
    forms: { domain: tokenFacts("domain"), "no-domain": tokenFacts("noDomain") },
    plugFor: (first) => {
      if (first.kind === "no-domain") {
        const addresses = addressesAt(first.host, parts.script);

        return addresses === undefined ? undefined : createPathPlug({ ...parts, layout: addresses, first });
      }

      const layout = parseDomainLayout({ domain: first.domain });

      return layout.ok ? createDomainPlug({ ...parts, layout: layout.value, first }) : undefined;
    },
  };
}
