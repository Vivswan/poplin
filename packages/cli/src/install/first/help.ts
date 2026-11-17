// The two help texts of `poplin install`: the command's own, which lists the providers, and one provider's, which lists the provider's options beside the shared ones.

import { type HelpPage, helpPage } from "../../commands/line/help-page";
import { type Look, PLAIN_LOOK } from "../../local/screen";
import { TOKEN_HELP } from "../ask";
import { SHARED_OPTIONS } from "./parse";
import type { Provider } from "../records";
import { DRY_RUN_HELP, NO_PROVIDER, optionRows, PROVIDER_HELP } from "../report";

/** The help of the command itself: what it does, the providers, and the options every provider takes. */
function commandHelp(providers: readonly Provider[]): HelpPage {
  return {
    usage: ["poplin install <provider> [options]"],
    about: "Install poplin in your provider account. An existing install is reported and left unchanged.",
    parts: [
      { title: "Providers:", rows: providers.map((one) => [one.id, one.about]), lines: providers.length === 0 ? [NO_PROVIDER] : [] },
      { title: "Options:", rows: optionRows(SHARED_OPTIONS) },
      { title: "Notes:", lines: [...DRY_RUN_HELP, "", ...TOKEN_HELP] },
      {
        title: "Related:",
        rows: [
          ...providers.map((one) => [`poplin install ${one.id} --help`, PROVIDER_HELP] as const),
          ["poplin doctor", "Check the install"],
          ["poplin doctor --repair", "Repair the install"],
          ["poplin update", "Update the install"],
          ["poplin uninstall <provider>", "Remove the install"],
        ],
      },
    ],
  };
}

/** The help of one provider: how its options go together, every option the line takes, and what the token needs in the provider's own words. */
function providerHelp(provider: Provider): HelpPage {
  return {
    usage: [`poplin install ${provider.id} ${provider.usage} [options]`],
    about: provider.about,
    parts: [
      { title: "Options:", rows: optionRows([...provider.options, ...SHARED_OPTIONS]) },
      { title: "Token:", lines: provider.tokenHelp },
      { title: "Notes:", lines: [...DRY_RUN_HELP, "", ...TOKEN_HELP] },
    ],
  };
}

/**
 * Print the help of `poplin install`, or of one provider.
 *
 * @param providers - the providers the built package carries, which the command's own help lists
 * @param provider - the provider to explain; the command itself when absent
 * @param look - how wide the stream shows it and whether in colour; plain lines of at most 80 characters when absent
 * @returns lines with no trailing newline; a provider's own lines are as long as its words make them
 */
export function installHelp(providers: readonly Provider[], provider?: Provider, look: Look = PLAIN_LOOK): string {
  return helpPage(provider === undefined ? commandHelp(providers) : providerHelp(provider), look);
}
