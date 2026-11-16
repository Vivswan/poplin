// The words of `poplin install` a page may name: its options, the problems it stops with, and what it names as blocking a run.
// The command's own parser reads its providers' options when it runs, so its row of the CLI's table lists none: the pages' guards read them here.

import { parseInstall, SHARED_OPTIONS } from "../../packages/cli/src/install/parse";
import type { Stop } from "../../packages/cli/src/install/records";
import type { Blocked } from "../../packages/core/src/install/installer";
import { installer } from "../../packages/providers/cloudflare/src/shared/install/first/installer";

/** Every problem the command stops with. The compiler holds this to the command's own union: a problem added or renamed there fails the typecheck here. */
const PROBLEMS = {
  usage: true,
  missing_answer: true,
  no_provider: true,
  already_installed: true,
  leftover: true,
  name_held: true,
  blocked: true,
  token_refused: true,
  no_domain: true,
  stopped: true,
  crashed: true,
  unreachable: true,
} satisfies Record<Stop["problem"], true>;

/** Everything the command names as blocking a run, held to the interface's own union the same way. */
const BLOCKS = {
  right_lacking: true,
  storage_off: true,
  login_off: true,
  no_address: true,
  no_release: true,
  bad_release: true,
  newer_release: true,
} satisfies Record<Blocked["what"], true>;

/** Every option of `poplin install`: the command's own, and the ones its provider declares. */
export const INSTALL_FLAGS: readonly string[] = [...SHARED_OPTIONS, ...installer.options].map((row) => row.flag);

/** Every word the command's JSON names a stop or a block by. */
export const INSTALL_WORDS: readonly string[] = [...Object.keys(PROBLEMS), ...Object.keys(BLOCKS)];

/**
 * Read the words after `poplin install` as the command does, with its provider, no variable set, and nobody to ask.
 *
 * @returns what the command refuses of a line written wrong; nothing for a line it reads, an answer it would ask for included
 */
export function installRefusal(words: readonly string[]): string | undefined {
  const parsed = parseInstall(words, [installer], {}, false);

  return parsed.kind === "stop" && parsed.stop.problem === "usage" ? parsed.stop.lines.join(" ") : undefined;
}
