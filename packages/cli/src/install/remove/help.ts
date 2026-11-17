// The two help texts of `poplin uninstall`: the command's own, which lists the providers, and one provider's, which lists the provider's options beside the shared ones.

import { PROVIDER_COMMANDS } from "../../commands/command-table";
import { type HelpPage, helpPage } from "../../commands/line/help-page";
import { type Look, PLAIN_LOOK } from "../../local/screen";
import { tokenPart } from "../ask";
import type { Provider } from "../records";
import { NO_PROVIDER, optionRows } from "../report";
import { UNINSTALL_OPTIONS } from "./parse";

/** The help of the command itself: what it does, the providers, and the options every provider takes. */
function commandHelp(providers: readonly Provider[]): HelpPage {
  return {
    usage: ["poplin uninstall [<provider>] [options]"],
    about: PROVIDER_COMMANDS[1].about,
    parts: [
      { title: "Providers:", rows: providers.map((one) => [one.id, one.about]), text: providers.length === 0 ? NO_PROVIDER : undefined },
      { title: "Options:", rows: optionRows(UNINSTALL_OPTIONS) },
      tokenPart("remove"),
      { title: "Related:", commands: [...providers.map((one) => `poplin uninstall ${one.id} --help`), "poplin logout"] },
    ],
  };
}

/** The help of one provider: how its options say where the install is, every option the line takes, and what the token needs in the provider's own words. */
function providerHelp(provider: Provider): HelpPage {
  return {
    usage: [`poplin uninstall ${provider.id} ${provider.usage} [options]`],
    about: `Remove the install from ${provider.name}`,
    parts: [{ title: "Options:", rows: optionRows([...provider.options, ...UNINSTALL_OPTIONS]) }, tokenPart("remove", provider)],
  };
}

/**
 * Print the help of `poplin uninstall`, or of one provider.
 *
 * @param providers - the providers the built package carries, which the command's own help lists
 * @param provider - the provider to explain; the command itself when absent
 * @param look - how wide the stream shows it and whether in colour; plain lines of at most 80 characters when absent
 * @returns lines with no trailing newline
 */
export function uninstallHelp(providers: readonly Provider[], provider?: Provider, look: Look = PLAIN_LOOK): string {
  return helpPage(provider === undefined ? commandHelp(providers) : providerHelp(provider), look);
}
