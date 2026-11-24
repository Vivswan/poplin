// The two help texts of `poplin install`: the command's own, which lists the providers, and one provider's, which lists the provider's options beside the shared ones.

import { PROVIDER_COMMANDS } from "../../commands/command-table";
import { type HelpPage, helpPage } from "../../commands/line/help-page";
import { type Look, PLAIN_LOOK } from "../../local/screen";
import { permissionsPart } from "../ask";
import { SHARED_OPTIONS } from "./parse";
import type { Provider } from "../records";
import { NO_PROVIDER, optionRows } from "../report";
import { optionsOf } from "../words";

/** The help of the command itself: what it does, the providers, the options every provider takes, and the commands about an install. */
function commandHelp(providers: readonly Provider[]): HelpPage {
  return {
    usage: ["poplin install [<provider>] [options]"],
    about: PROVIDER_COMMANDS[0].about,
    parts: [
      { title: "Providers:", rows: providers.map((one) => [one.id, one.about]), text: providers.length === 0 ? NO_PROVIDER : undefined },
      { title: "Options:", rows: optionRows(SHARED_OPTIONS) },
      { title: "Related:", commands: [...providers.map((one) => `poplin install ${one.id} --help`), "poplin doctor", "poplin doctor --repair", "poplin update", "poplin uninstall <provider>"] },
    ],
  };
}

/** The help of one provider: how its options go together, every option the line takes, and what the token needs in the provider's own words. */
function providerHelp(provider: Provider): HelpPage {
  return {
    usage: [`poplin install ${provider.id} ${provider.usage} [options]`],
    about: `Install poplin on ${provider.name}`,
    parts: [{ title: "Options:", rows: optionRows([...optionsOf(provider, "install"), ...SHARED_OPTIONS]) }, permissionsPart("install", provider)],
  };
}

/**
 * Print the help of `poplin install`, or of one provider.
 *
 * @param providers - the providers the built package carries, which the command's own help lists
 * @param provider - the provider to explain; the command itself when absent
 * @param look - how wide the stream shows it and whether in colour; plain lines of at most 80 characters when absent
 * @returns lines with no trailing newline
 */
export function installHelp(providers: readonly Provider[], provider?: Provider, look: Look = PLAIN_LOOK): string {
  return helpPage(provider === undefined ? commandHelp(providers) : providerHelp(provider), look);
}
