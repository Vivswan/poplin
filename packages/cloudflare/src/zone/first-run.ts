// The Cloudflare side of an install with nothing set yet: the plug is made once a person has typed the domain and the first login.
//
// No account is known before the token: a repair takes the account from the zone the token shows the domain in, and writes the install's values to the Worker of that name in that account.
// A token of another account therefore writes to its own account's Worker, or to none, and never to this one.

import type { FirstRun } from "@poplin/app/src/console/domain/records";
import type { Connection } from "./client";
import { parseDomainLayout } from "./layout";
import { createDomainPlug, tokenFacts } from "./zone-plug";

/** What the first run is built from. */
interface FirstParts {
  /** The name of the install's Worker, which its routes name and its values are written to. */
  readonly script: string;

  /** Where the API is; absent outside tests. */
  readonly baseUrl?: string | undefined;

  /** What sends a call; absent outside tests. */
  readonly fetch?: Connection["fetch"];
}

/**
 * Build the first run of an install on Cloudflare.
 *
 * @returns the token's facts, and a way to the plug of a typed domain and login; text that is no domain, or one too long for the login's address, gets no plug
 */
export function createFirstRun(parts: FirstParts): FirstRun {
  return {
    ...tokenFacts(),
    plugFor: ({ domain, login }) => {
      const layout = parseDomainLayout({ domain });
      if (!layout.ok) return undefined;

      return createDomainPlug({ ...parts, layout: layout.value, first: { login } });
    },
  };
}
