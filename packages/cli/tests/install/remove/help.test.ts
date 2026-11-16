import { describe, expect, test } from "bun:test";

import type { Installer } from "../../../../core/src/install/installer";
import { uninstallHelp } from "../../../src/install/remove/help";
import { emptyAccount, runLine, standIn } from "../support/stand-in";

/** The one made-up provider. */
const PROVIDER = standIn(emptyAccount()) as Installer<unknown, unknown>;

/** The help of the command itself, with the one provider listed. */
const COMMAND_HELP = `poplin uninstall <provider> [options]

Remove your install from a provider: every object that carries poplin's names and
marks, and nothing else. The sites' files and the database go last.

Providers:
  stand-in  Stand-In Host: under your own place, or without one

Options:
  --dry-run            list what a run would remove and keep, and remove nothing
  --confirm <address>  the install's address, as proof; asked for when left out
  --keep-data          leave the sites' files and the database
  --yes                ask nothing; a missing answer stops the run and is named
  --token-stdin        read the account token from standard input, and ask nothing
  --json               print one JSON value, and nothing else on stdout

A run lists what it would remove, then asks you to type the install's address.
A run that asks nothing takes it with --confirm; --yes alone confirms nothing.

A dry run exits as the run after it would, as far as reading can tell: 0 when a
run would go through, and 1 when something stops it first.

The account token is read from POPLIN_INSTALL_TOKEN, or from standard input
with --token-stdin, or asked for without being shown. It is used for the run
and stored nowhere.

It logs no computer out: run poplin logout on each one first.

  poplin uninstall stand-in --help  its own options, and what the account token needs`;

/** The help of the made-up provider, made from what it declares. */
const PROVIDER_HELP = `poplin uninstall stand-in (--place <name> | --no-place) [options]

Remove your install from Stand-In Host. Its own options say where the install is.

Options of Stand-In Host:
  --place <name>  under your own place: example.com                (POPLIN_PLACE)
  --no-place      at the address the host gives the account        (POPLIN_PLACE=none)
  --account <id>  the account, when the token shows more than one  (POPLIN_ACCOUNT)

The account token needs:
  with a place   two permissions: Places: Read, Programs: Edit
  without        one permission: Programs: Edit

Every option of poplin uninstall works here too: poplin uninstall --help`;

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
