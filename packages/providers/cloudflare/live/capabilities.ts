// What an install lacks, found by asking it as a stranger: a check that needs the lacking thing is skipped with the reason.

import type { Bench, Missing } from "./records";
import { GHOST_ID } from "./util";

/** Why a check that needs a person is skipped. */
const NEEDS_PERSON = "a person in a browser: the manual checklist in packages/providers/cloudflare/live/README.md";

/** Why a check of the access letter is skipped. */
const NO_LETTERS = "an install that sends a private site's address to its letter p form";

/** Why a check of the login in front of the install is skipped. */
const NO_ACCESS = "Access switched on for the account";

/** What only a zone gives: the rules and the switches that stand in front of an install with a domain. */
const ZONE_ONLY = ["https-redirect", "guard-rules", "bot-block"] as const;

/** Why a check of such a thing is skipped on an install without a domain. */
const NO_DOMAIN = "a domain";

/** Where a redirect goes, or `undefined` for an answer that is none. */
function redirectOf(response: Response): string | undefined {
  if (response.status < 300 || response.status >= 400) return undefined;

  return response.headers.get("Location") ?? undefined;
}

/**
 * Find what an install lacks.
 *
 * It sends two requests, neither with a token: the address of a site nobody has, on an install with a domain, and a path of the dashboard.
 *
 * @param known - what the run already knows to be lacking, which is kept as it is
 * @returns every lacking capability with its reason; `person` is always among them
 */
export async function probeMissing(install: Pick<Bench, "addresses" | "admin" | "visit">, known: Missing): Promise<Missing> {
  const missing: Missing = { person: NEEDS_PERSON, ...known };
  const { addresses } = install;
  // An install without a domain has no zone, whatever a run was told of it.
  for (const lacking of addresses.kind === "domain" ? [] : ZONE_ONLY) missing[lacking] ??= NO_DOMAIN;

  // Only an install with a domain may have been made before the move to the private form: one without a domain always has it, so there a missing move fails its checks.
  const moved = addresses.kind === "domain" ? redirectOf(await install.visit(addresses.site(GHOST_ID, "u"))) : addresses.site(GHOST_ID, "p");
  if (moved !== addresses.site(GHOST_ID, "p")) missing.letters ??= NO_LETTERS;

  // A path of the dashboard an install of any shape has the login in front of, one made when the login guarded this path alone included.
  const login = redirectOf(await install.visit(`${install.admin}/login`));
  if (login === undefined || addresses.isOwn(login)) missing.access ??= NO_ACCESS;

  return missing;
}
