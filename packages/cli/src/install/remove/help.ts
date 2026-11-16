// The two help texts of `poplin uninstall`: the command's own, which lists the providers, and one provider's, made from what the provider declares.

import { columns } from "../../commands/text";
import { TOKEN_HELP } from "../ask";
import type { Provider } from "../records";
import { optionLines } from "../report";
import { UNINSTALL_OPTIONS } from "./parse";

/** How far a line of a list stands in. */
const INDENT = "  ";

function indented(lines: readonly string[]): string[] {
  return lines.map((line) => `${INDENT}${line}`);
}

function joined(sections: readonly (readonly string[])[]): string {
  return sections.map((lines) => lines.join("\n")).join("\n\n");
}

/** The help of the command itself: what it does, the providers, and the options every provider takes. */
function commandHelp(providers: readonly Provider[]): string {
  const listed = providers.length === 0 ? ["none: this build of poplin carries no provider"] : columns(providers.map((one) => [one.id, one.about]));
  const own = providers.map((one) => [`poplin uninstall ${one.id} --help`, "its own options, and what the account token needs"]);

  return joined([
    ["poplin uninstall <provider> [options]"],
    ["Remove your install from a provider: every object that carries poplin's names and", "marks, and nothing else. The sites' files and the database go last."],
    ["Providers:", ...indented(listed)],
    ["Options:", ...optionLines(UNINSTALL_OPTIONS)],
    ["A run lists what it would remove, then asks you to type the install's address.", "A run that asks nothing takes it with --confirm; --yes alone confirms nothing."],
    [...TOKEN_HELP],
    ["It logs no computer out: run poplin logout on each one."],
    ...(own.length === 0 ? [] : [indented(columns(own))]),
  ]);
}

/** The help of one provider: how its options say where the install is, the options, and what the token needs, all in the provider's own words. */
function providerHelp(provider: Provider): string {
  return joined([
    [`poplin uninstall ${provider.id} ${provider.usage} [options]`],
    [`Remove your install from ${provider.name}. Its own options say where the install is.`],
    [`Options of ${provider.name}:`, ...optionLines(provider.options)],
    [...provider.tokenHelp],
    ["Every option of poplin uninstall works here too: poplin uninstall --help"],
  ]);
}

/**
 * Print the help of `poplin uninstall`, or of one provider.
 *
 * @param providers - the providers the built package carries, which the command's own help lists
 * @param provider - the provider to explain; the command itself when absent
 * @returns lines with no trailing newline; a provider's are as long as its own words make them
 */
export function uninstallHelp(providers: readonly Provider[], provider?: Provider): string {
  return provider === undefined ? commandHelp(providers) : providerHelp(provider);
}
