import { describe, expect, test } from "bun:test";

import type { Installer } from "../../../../core/src/install/installer";
import { uninstallHelp } from "../../../src/install/remove/help";
import { emptyAccount, runLine, standIn } from "../support/stand-in";

/** The one made-up provider. */
const PROVIDER = standIn(emptyAccount()) as Installer<unknown, unknown>;

/** The help of the command itself, with the one provider listed. */
const COMMAND_HELP = `Usage: poplin uninstall <provider> [options]

Remove the install from the provider: every object that carries poplin's names
and marks, and nothing else. The site files and the database are removed last.

Providers:
  stand-in                  Stand-In Host: under your own place, or without one

Options:
  --dry-run                 List what would be removed and kept; remove nothing
  --confirm <address>       Install address, as confirmation; else prompted
  --keep-data               Keep the site files and the database
  --yes                     Never prompt; a missing answer stops the run
  --token-stdin             Read the account token from stdin; never prompt
  --json                    Print one JSON value, and nothing else on stdout

Notes:
  A run lists what it would remove, then prompts for the install's address.
  Without prompts, pass it with --confirm; --yes alone confirms nothing.

  --dry-run exits as the real run would, as far as reading can tell: 0 when it
  would go through, and 1 when something would stop it first.

  The account token is read from POPLIN_INSTALL_TOKEN, from stdin with
  --token-stdin, or from a hidden prompt. It is used for the run and stored
  nowhere.

  No machine is logged out: run poplin logout on each one first.

Related:
  poplin uninstall stand-in --help  Provider options and token permissions`;

/** The help of the made-up provider, made from what it declares. */
const PROVIDER_HELP = `Usage: poplin uninstall stand-in (--place <name> | --no-place) [options]

Remove the install from Stand-In Host. The provider's options locate the
install.

Options:
  --place <name>            Your own place: example.com  (POPLIN_PLACE)
  --no-place                The address the host gives the account
                            (POPLIN_PLACE=none)
  --account <id>            Account id, when the token can access more than one
                            (POPLIN_ACCOUNT)
  --dry-run                 List what would be removed and kept; remove nothing
  --confirm <address>       Install address, as confirmation; else prompted
  --keep-data               Keep the site files and the database
  --yes                     Never prompt; a missing answer stops the run
  --token-stdin             Read the account token from stdin; never prompt
  --json                    Print one JSON value, and nothing else on stdout

Token:
  The account token needs:
    with a place   two permissions: Places: Read, Programs: Edit
    without        one permission: Programs: Edit

Notes:
  A run lists what it would remove, then prompts for the install's address.
  Without prompts, pass it with --confirm; --yes alone confirms nothing.

  --dry-run exits as the real run would, as far as reading can tell: 0 when it
  would go through, and 1 when something would stop it first.

  The account token is read from POPLIN_INSTALL_TOKEN, from stdin with
  --token-stdin, or from a hidden prompt. It is used for the run and stored
  nowhere.

  No machine is logged out: run poplin logout on each one first.`;

describe("the help of poplin uninstall", () => {
  test("the command's own help says what goes, how a removal is confirmed, and each option: without this the one text a person reads before a removal drifts from the options", () => {
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
