// The two help texts of `poplin install`: the command's own, which lists the providers, and one provider's, made from what the provider declares.

import { columns } from "../../commands/text";
import { TOKEN_HELP } from "../ask";
import { SHARED_OPTIONS } from "./parse";
import type { Provider } from "../records";
import { optionLines } from "../report";

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
  const own = providers.map((one) => [`poplin install ${one.id} --help`, "its own options, and what the account token needs"]);

  return joined([
    ["poplin install <provider> [options]"],
    ["Make your own install at a provider. It looks for one first: where one is, it", "says so and changes nothing."],
    ["Providers:", ...indented(listed)],
    ["Options:", ...optionLines(SHARED_OPTIONS)],
    [...TOKEN_HELP],
    ["An install that is there:", ...indented(["poplin doctor", "poplin doctor --repair", "poplin update", "poplin uninstall <provider>"])],
    ...(own.length === 0 ? [] : [indented(columns(own))]),
  ]);
}

/** The help of one provider: how its options go together, the options, and what the token needs, all in the provider's own words. */
function providerHelp(provider: Provider): string {
  return joined([
    [`poplin install ${provider.id} ${provider.usage} [options]`],
    [provider.about],
    [`Options of ${provider.name}:`, ...optionLines(provider.options)],
    [...provider.tokenHelp],
    ["Every option of poplin install works here too: poplin install --help"],
  ]);
}

/**
 * Print the help of `poplin install`, or of one provider.
 *
 * @param providers - the providers the built package carries, which the command's own help lists
 * @param provider - the provider to explain; the command itself when absent
 * @returns lines with no trailing newline; a provider's are as long as its own words make them
 */
export function installHelp(providers: readonly Provider[], provider?: Provider): string {
  return provider === undefined ? commandHelp(providers) : providerHelp(provider);
}
