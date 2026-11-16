// Private values planted in what the fake Cloudflare says when it refuses a call, for the tests that read every place a failed run is written to.
// Each value is made up, and stands for a kind of value a real refusal can quote.

import { ACCOUNT, type Account, KEPT } from "./fake-install";

/** The planted values, each by the kind it stands for. `kept` is the key an install of the fake account holds. */
const MARKERS = {
  bearer: "marker-bearer-0123456789-abcdefghij",
  kept: KEPT,
  email: "marker-person@example.com",
  id: "fedcba9876543210fedcba9876543210",
  hostname: "marker-host.example.com",
} as const;

/** The sentence of a planted refusal: it quotes every marker, as an API that repeats what it was sent does. */
const SENTENCE = `Authentication error for Bearer ${MARKERS.bearer} and Bearer ${MARKERS.kept}: ${MARKERS.email} may not change ${MARKERS.id} at ${MARKERS.hostname}`;

/** How a row words a refusal by Cloudflare: a test finds it in each place first, so a place the refusal never reached does not pass for one that holds no marker. */
export const REFUSED_WORDS = "refused with status 403";

/** What plants the markers in an account, laid over it: a token is refused two reads for a missing permission, in that sentence. Both kinds of install read both, and a run goes on after either, so one run fails a piece and a key. */
export const PLANTED: Pick<Account, "refuse" | "refuseMessage"> = { refuse: [`GET /accounts/${ACCOUNT}/workflows*`, `GET /accounts/${ACCOUNT}/tokens*`], refuseMessage: SENTENCE };

/**
 * Find the markers in a text.
 *
 * @returns the kind of each marker the text holds; none for a text that passed nothing of a refusal's sentence on
 */
export function markersIn(text: string): string[] {
  return Object.entries(MARKERS).flatMap(([kind, marker]) => (text.includes(marker) ? [kind] : []));
}
