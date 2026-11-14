// What an install lacks, found by asking it as a stranger: a check that needs the lacking thing is skipped with the reason.

import type { Bench, Missing } from "./records";
import { GHOST_ID, isOwnAddress, labelAddress } from "./util";

/** Why a check that needs a person is skipped. */
const NEEDS_PERSON = "a person in a browser: the manual checklist in tests/live/README.md";

/** Why a check of the access letter is skipped. */
const NO_LETTERS = "an install that sends a private site's address to its letter p form";

/** Why a check of the login in front of the install is skipped. */
const NO_ACCESS = "Access switched on for the account";

/** Where a redirect goes, or `undefined` for an answer that is none. */
function redirectOf(response: Response): string | undefined {
  if (response.status < 300 || response.status >= 400) return undefined;

  return response.headers.get("Location") ?? undefined;
}

/**
 * Find what an install lacks.
 *
 * It sends two requests, neither with a token: the address of a site nobody has, and the login path.
 *
 * @param known - what the run already knows to be lacking, which is kept as it is
 * @returns every lacking capability with its reason; `person` is always among them
 */
export async function probeMissing(install: Pick<Bench, "domain" | "admin" | "visit">, known: Missing): Promise<Missing> {
  const missing: Missing = { person: NEEDS_PERSON, ...known };

  const moved = redirectOf(await install.visit(labelAddress(install.domain, GHOST_ID, "u")));
  if (moved !== labelAddress(install.domain, GHOST_ID, "p")) missing.letters ??= NO_LETTERS;

  const login = redirectOf(await install.visit(`${install.admin}/login`));
  if (login === undefined || isOwnAddress(install.domain, login)) missing.access ??= NO_ACCESS;

  return missing;
}
