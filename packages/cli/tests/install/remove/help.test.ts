import { describe, expect, test } from "bun:test";

import type { Installer } from "../../../../core/src/install/installer";
import { uninstallHelp } from "../../../src/install/remove/help";
import { emptyAccount, runLine, standIn } from "../support/stand-in";

/** The one made-up provider. */
const PROVIDER = standIn(emptyAccount()) as Installer<unknown, unknown>;

/** The help of the command itself, with the one provider listed. */
const COMMAND_HELP = `Usage: poplin uninstall [<provider>] [options]

Remove the install from the provider

Providers:
  stand-in                 Stand-In Host: under your own place, or without one

Options:
  --dry-run                Show what would change. Change nothing.
  --confirm <address>      Confirm the removal with the address --dry-run shows
  --keep-data              Keep the site files and the database
  --yes                    Never prompt. A missing answer stops the run.
  --token-stdin            Read the account token from stdin
  --json
  --help
  --version

Token:
  Read from POPLIN_INSTALL_TOKEN, --token-stdin, or a prompt.

Related:
  poplin uninstall stand-in --help
  poplin logout`;

/** The help of the made-up provider, made from what it declares. */
const PROVIDER_HELP = `Usage: poplin uninstall stand-in (--place <name> | --no-place) [options]

Remove the install from Stand-In Host

Options:
  --place <name>           Your own place, such as example.com
                           Or set POPLIN_PLACE.
  --no-place               The address the host gives the account
                           Or set POPLIN_PLACE=none.
  --account <id>           Account id, if the token can access several accounts
                           Or set POPLIN_ACCOUNT.
  --dry-run                Show what would change. Change nothing.
  --confirm <address>      Confirm the removal with the address --dry-run shows
  --keep-data              Keep the site files and the database
  --yes                    Never prompt. A missing answer stops the run.
  --token-stdin            Read the account token from stdin
  --json
  --help
  --version

Token:
  Read from POPLIN_INSTALL_TOKEN, --token-stdin, or a prompt. Needs:
  - Programs: Edit
  - Places: Read (--place)`;

describe("the help of poplin uninstall", () => {
  test("the command's own help says what goes, what confirms a removal, and each option: without this the one text a person reads before a removal drifts from the options", () => {
    expect(uninstallHelp([PROVIDER])).toBe(COMMAND_HELP);
  });

  test("a provider's help is made from the provider's own rows: without this the command would name a provider's options itself", () => {
    expect(uninstallHelp([PROVIDER], PROVIDER)).toBe(PROVIDER_HELP);
  });

  test("the command prints each help on stdout and exits 0, and `poplin help uninstall` is the same text: without this the help is reachable one way only", async () => {
    const own = await runLine("uninstall --help", emptyAccount());
    const topic = await runLine("help uninstall", emptyAccount());
    const provider = await runLine("uninstall stand-in --help", emptyAccount());

    expect([own.code, own.out, topic.out, provider.out]).toEqual([0, [COMMAND_HELP], [COMMAND_HELP], [PROVIDER_HELP]]);
  });
});
