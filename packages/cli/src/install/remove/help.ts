// The two help texts of `poplin uninstall`: the command's own, which lists the providers, and one provider's, which lists the provider's options beside the shared ones.

import { type HelpPage, helpPage } from "../../commands/line/help-page";
import { type Look, PLAIN_LOOK } from "../../local/screen";
import { TOKEN_HELP } from "../ask";
import type { Provider } from "../records";
import { DRY_RUN_HELP, NO_PROVIDER, optionRows, PROVIDER_HELP } from "../report";
import { UNINSTALL_OPTIONS } from "./parse";

/** What every help of the command says after its options: how a removal is confirmed, what a dry run exits with, where the token comes from, and what a removal leaves. */
const NOTES: readonly string[] = [
  "A run lists what it would remove, then prompts for the install's address.",
  "Without prompts, pass it with --confirm; --yes alone confirms nothing.",
  "",
  ...DRY_RUN_HELP,
  "",
  ...TOKEN_HELP,
  "",
  "No machine is logged out: run poplin logout on each one first.",
];

/** The help of the command itself: what it does, the providers, and the options every provider takes. */
function commandHelp(providers: readonly Provider[]): HelpPage {
  return {
    usage: ["poplin uninstall <provider> [options]"],
    about: "Remove the install from the provider: every object that carries poplin's names and marks, and nothing else. The site files and the database are removed last.",
    parts: [
      { title: "Providers:", rows: providers.map((one) => [one.id, one.about]), lines: providers.length === 0 ? [NO_PROVIDER] : [] },
      { title: "Options:", rows: optionRows(UNINSTALL_OPTIONS) },
      { title: "Notes:", lines: NOTES },
      { title: "Related:", rows: providers.map((one) => [`poplin uninstall ${one.id} --help`, PROVIDER_HELP]) },
    ],
  };
}

/** The help of one provider: how its options say where the install is, every option the line takes, and what the token needs in the provider's own words. */
function providerHelp(provider: Provider): HelpPage {
  return {
    usage: [`poplin uninstall ${provider.id} ${provider.usage} [options]`],
    about: `Remove the install from ${provider.name}. The provider's options locate the install.`,
    parts: [
      { title: "Options:", rows: optionRows([...provider.options, ...UNINSTALL_OPTIONS]) },
      { title: "Token:", lines: provider.tokenHelp },
      { title: "Notes:", lines: NOTES },
    ],
  };
}

/**
 * Print the help of `poplin uninstall`, or of one provider.
 *
 * @param providers - the providers the built package carries, which the command's own help lists
 * @param provider - the provider to explain; the command itself when absent
 * @param look - how wide the stream shows it and whether in colour; plain lines of at most 80 characters when absent
 * @returns lines with no trailing newline; a provider's own lines are as long as its words make them
 */
export function uninstallHelp(providers: readonly Provider[], provider?: Provider, look: Look = PLAIN_LOOK): string {
  return helpPage(provider === undefined ? commandHelp(providers) : providerHelp(provider), look);
}
