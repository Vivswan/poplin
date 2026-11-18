// The notices of the steps that need an account token: what a release must tell its users, since an update alone leaves such a step undone.
//
//   bun run --cwd packages/providers/cloudflare step-notices 0.3.0     prints one line a step of 0.3.0.ts that needs an account token, for the release notes
//
// A release must not hide such a step: `noticeFaults` names every one whose notice is no sentence a person can act on.

import { type ProviderVersionSteps, VERSIONS } from "./registry";

/** What a notice names, as a word of its own: the one thing that does the step. */
const REPAIR = /\bRepair\b/;

/** One sentence: it starts with a capital letter, and the one mark that ends a sentence in it is the full stop at its end. */
const SENTENCE = /^[A-Z][^\n.?!]*\.$/;

/** What the command prints for a version none of whose steps needs an account token. */
const NONE = "No step needs an account token.";

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

/**
 * List the notices of one version's steps that need an account token, as lines of a release's notes.
 *
 * @param version - the release the steps migrate away from: the one before the release the notes are of
 * @returns one Markdown bullet a step, in the order the steps run; none for a version with no such step or no file
 */
export function noticeLines(versions: readonly ProviderVersionSteps[], version: string): string[] {
  const steps = versions.filter((file) => file.version === version).flatMap((file) => file.steps);

  return steps.flatMap((step) => (step.by === "account token" ? [`- ${step.notice}`] : []));
}

if (import.meta.main) {
  const [version] = process.argv.slice(2);
  if (version === undefined) throw new Error("name the release the steps migrate away from, such as 0.3.0");

  const lines = noticeLines(VERSIONS, version);
  console.log(lines.length === 0 ? NONE : lines.join("\n"));
}
