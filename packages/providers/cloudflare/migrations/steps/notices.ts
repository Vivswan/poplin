// The notices of the steps that need an account token: what a release must tell its users, since an update alone leaves such a step undone.
//
// A release must not hide such a step: `noticeFaults` names every one whose notice is no sentence a person can act on.

import type { ProviderVersionSteps } from "./registry";

/** What a notice names, as a word of its own: the one thing that does the step. */
const REPAIR = /\bRepair\b/;

/** One sentence: it starts with a capital letter, and the one mark that ends a sentence in it is the full stop at its end. */
const SENTENCE = /^[A-Z][^\n.?!]*\.$/;

/**
 * Say what is wrong with the notices of the steps that need an account token.
 *
 * @returns one line a fault of a step: a notice that is no single sentence, and one that does not name Repair; none where every such step can be told to a person as it is
 */
export function noticeFaults(versions: readonly ProviderVersionSteps[]): string[] {
  return versions.flatMap(({ version, steps }) =>
    steps.flatMap((step) => {
      if (step.by !== "account token") return [];

      const faults = [...(SENTENCE.test(step.notice) ? [] : ["is no single sentence"]), ...(REPAIR.test(step.notice) ? [] : ["does not name Repair"])];

      return faults.map((fault) => `${version}/${step.name}: its notice ${fault}`);
    }),
  );
}
