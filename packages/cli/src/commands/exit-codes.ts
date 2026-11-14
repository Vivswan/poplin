// The exit codes: what a shell or a script learns from how a command ended.

/** The exit code of each way a command ends. */
const EXIT_CODES = {
  done: 0,
  failed: 1,
  usage: 2,
  "no-install": 3,
} as const;

/** How a command ended: it did its work, an install or this machine refused it, it was written wrong, or this build had no install to send it to. */
type Ending = { readonly kind: "done" | "version" | "failed" | "usage-error" | "no-install" } | { readonly kind: "help"; readonly asked: boolean };

/**
 * Choose the exit code of a command.
 *
 * @returns 0 when it did what was asked, 1 when it failed whatever the error's code, 2 when the command line was written wrong or was empty, and 3 when the build has no way to reach an install
 */
export function exitCode(ending: Ending): number {
  if (ending.kind === "help") return ending.asked ? EXIT_CODES.done : EXIT_CODES.usage;

  if (ending.kind === "version") return EXIT_CODES.done;

  if (ending.kind === "usage-error") return EXIT_CODES.usage;

  return EXIT_CODES[ending.kind];
}
