// The words of the commands that work at a provider, which a page may name: `poplin install`, `poplin uninstall`, and `poplin doctor --repair`. Their options, the problems they stop with, what they name as blocking a run, and the next step.
// Each command's own parser reads its provider's options when it runs, so the CLI's table lists none of them: the pages' guards read them here.

import type { ProviderCommand } from "../../packages/cli/src/commands/parse-command";
import { parseInstall, SHARED_OPTIONS } from "../../packages/cli/src/install/first/parse";
import type { Next, Parsed, Stop } from "../../packages/cli/src/install/records";
import { parseUninstall, UNINSTALL_OPTIONS } from "../../packages/cli/src/install/remove/parse";
import { parseRepair, REPAIR_OPTIONS } from "../../packages/cli/src/install/repair/parse";
import type { Blocked } from "../../packages/core/src/install/installer";
import { installer } from "../../packages/providers/cloudflare/src/shared/install/first/installer";

/** Every problem the three commands stop with. The compiler holds this to their own union: a problem added or renamed there fails the typecheck here. */
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
  no_install: true,
  other_place: true,
  not_confirmed: true,
  changed: true,
  unfinished: true,
  another_version: true,
  unreachable: true,
} satisfies Record<Stop["problem"], true>;

/** Everything the commands name as blocking a run, held to the interface's own union the same way. */
const BLOCKS = {
  right_lacking: true,
  storage_off: true,
  login_off: true,
  no_address: true,
  no_release: true,
  bad_release: true,
  newer_release: true,
} satisfies Record<Blocked["what"], true>;

/** Every step the commands name as the next in their JSON, held to their own union the same way. */
const STEPS = {
  install: true,
  repair: true,
  uninstall: true,
  login: true,
  none: true,
} satisfies Record<Next["step"], true>;

/** The parser of each command, which reads the words after the command's own. */
const PARSERS: Readonly<Record<ProviderCommand, (words: readonly string[]) => Parsed<unknown>>> = {
  install: (words) => parseInstall(words, [installer], {}, false),
  uninstall: (words) => parseUninstall(words, [installer], {}, false),
  repair: (words) => parseRepair(words, [installer], {}, false),
};

/** Every command that works at a provider, by the word a parsed line carries. */
export const PROVIDER_COMMAND_NAMES = Object.keys(PARSERS) as readonly ProviderCommand[];

/** Every option of the three commands: each command's own, and the ones their provider declares. */
export const INSTALL_FLAGS: readonly string[] = [...SHARED_OPTIONS, ...UNINSTALL_OPTIONS, ...REPAIR_OPTIONS, ...installer.options].map((row) => row.flag);

/** Every word the commands' JSON names a stop, a block, or the next step by. */
export const INSTALL_WORDS: readonly string[] = [...Object.keys(PROBLEMS), ...Object.keys(BLOCKS), ...Object.keys(STEPS)];

/**
 * Read the words after a command that works at a provider as the command does, with its provider, no variable set, and nobody to ask.
 *
 * @returns what the command refuses of a line written wrong; nothing for a line it reads, an answer it would ask for included
 */
export function providerRefusal(command: ProviderCommand, words: readonly string[]): string | undefined {
  const parsed = PARSERS[command](words);

  return parsed.kind === "stop" && parsed.stop.problem === "usage" ? parsed.stop.lines.join(" ") : undefined;
}
