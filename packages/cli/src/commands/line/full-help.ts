// The help of every command on one page: the overview, then each command's own help in the overview's order, a rule between two.

import { installHelp } from "../../install/first/help";
import type { Provider } from "../../install/records";
import { uninstallHelp } from "../../install/remove/help";
import { repairHelp } from "../../install/repair/report";
import { type Look, PLAIN_LOOK } from "../../local/screen";
import { COMMANDS } from "../command-table";
import { helpText } from "./help";
import { buildProgram } from "./program";

/** The command whose help is followed by the help of its repair. */
const REPAIRED = "doctor";

/**
 * Print the help of `poplin` itself and of every command after it.
 *
 * @param providers - the providers the built package carries: each adds its own help of `install` and `uninstall`, and of a repair where there is more than one
 * @param look - how wide the stream shows it and whether in colour
 * @returns the lines with no trailing newline, each help as the command's own `--help` prints it
 */
export function fullHelp(providers: readonly Provider[], look: Look): string {
  const each = (help: (providers: readonly Provider[], provider: Provider | undefined, look: Look) => string): string[] => [undefined, ...providers].map((provider) => help(providers, provider, look));
  const [repair = "", ...repairs] = each(repairHelp);
  const provided: Readonly<Record<string, readonly string[]>> = { install: each(installHelp), uninstall: each(uninstallHelp) };
  const pages = buildProgram().commands.flatMap((command) => {
    const spec = COMMANDS.find((one) => one.name === command.name());
    if (spec === undefined) return provided[command.name()] ?? [];

    return spec.name === REPAIRED ? [helpText(spec.name, look), repair, ...(repairs.length > 1 ? repairs : [])] : [helpText(spec.name, look)];
  });

  return [helpText(undefined, look), ...pages].join(`\n\n${"-".repeat(Math.min(look.width, PLAIN_LOOK.width))}\n\n`);
}
