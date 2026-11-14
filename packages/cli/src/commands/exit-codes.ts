// The exit codes: what a shell or a script learns from how a command ended.

/** The exit code of each way a command ends. */
const EXIT_CODES = {
  done: 0,
  failed: 1,
  usage: 2,
  "no-install": 3,
  unavailable: 4,
  unreachable: 5,
} as const;

/**
 * How a command ended: it did its work, an install or this machine refused it, or it was written wrong.
 *
 * `no-install` is a command with no login to send it with, `unavailable` one this build cannot do, and `unreachable` one whose install gave no answer of the API.
 */
export type Ending =
  | { readonly kind: "done" | "version" | "failed" | "usage-error" | "no-install" | "unavailable" | "unreachable" }
  | { readonly kind: "help"; readonly asked: boolean };

/**
 * Choose the exit code of a command.
 *
 * @returns 0 done, 1 failed whatever the error's code, 2 written wrong or empty, 3 no login to reach an install with, 4 not done by this build, 5 no answer from the install
 */
export function exitCode(ending: Ending): number {
  if (ending.kind === "help") return ending.asked ? EXIT_CODES.done : EXIT_CODES.usage;

  if (ending.kind === "version") return EXIT_CODES.done;

  if (ending.kind === "usage-error") return EXIT_CODES.usage;

  return EXIT_CODES[ending.kind];
}
