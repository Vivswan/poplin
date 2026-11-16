// How one object of an install stands at its provider, in the words a person reads: the Domain screen says them.

/** The words of each state a check or a repair answers for one object. `optional` is an object the token has no right for and the install works without. */
const DOMAIN_STATE_WORDS: Readonly<Record<string, string>> = {
  present: "present",
  missing: "missing",
  differs: "differs",
  "left-out": "left out",
  optional: "optional",
  created: "created",
  changed: "changed",
  removed: "removed",
  failed: "failed",
  "not-run": "not run",
};

/**
 * Word the state of one object for a person.
 *
 * @param state - the state as a check or a repair answers it, such as `left-out`
 * @returns the words of the state; a state this build does not know is answered as it came
 */
export function domainStateWords(state: string): string {
  return Object.hasOwn(DOMAIN_STATE_WORDS, state) ? (DOMAIN_STATE_WORDS[state] ?? state) : state;
}
