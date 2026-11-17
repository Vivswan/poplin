import { describe, expect, test } from "bun:test";

import type { Installer } from "../../../../core/src/install/installer";
import { installHelp } from "../../../src/install/first/help";
import { emptyAccount, standIn } from "../support/stand-in";

/** The longest line of the command's own help: a terminal 80 wide shows it unbroken. */
const MAX_LINE = 80;

/** The one made-up provider. */
const PROVIDER = standIn(emptyAccount()) as Installer<unknown, unknown>;

/** The help of the command itself, with the one provider listed. */
const COMMAND_HELP = `poplin install <provider> [options]

Make your own install at a provider. It looks for one first: where one is, it
says so and changes nothing.

Providers:
  stand-in  Stand-In Host: under your own place, or without one

Options:
  --login <email>  the first login  (POPLIN_LOGIN)
  --dry-run        read everything, change nothing, and say what a run would
                   make
  --adopt          use what an earlier install left behind, with what it holds
  --yes            ask nothing; a missing answer stops the run and is named
  --token-stdin    read the account token from standard input, and ask nothing
  --log-in         log this computer in when it is done
  --no-log-in      do not log this computer in, and do not ask
  --no-wait        do not wait for the install to answer
  --json           print one JSON value, and nothing else on stdout

A dry run exits as the run after it would, as far as reading can tell: 0 when a
run would go through, and 1 when something stops it first.

The account token is read from POPLIN_INSTALL_TOKEN, or from standard input
with --token-stdin, or asked for without being shown. It is used for the run
and stored nowhere.

An install that is there:
  poplin doctor
  poplin doctor --repair
  poplin update
  poplin uninstall <provider>

  poplin install stand-in --help  its own options, and what the token needs`;

/** The help of the made-up provider: every line but the first and the last is the provider's own words. */
const PROVIDER_HELP = `poplin install stand-in (--place <name> | --no-place) [options]

Stand-In Host: under your own place, or without one

Options of Stand-In Host:
  --place <name>  under your own place: example.com  (POPLIN_PLACE)
  --no-place      at the address the host gives the account  (POPLIN_PLACE=none)
  --account <id>  the account, when the token shows more than one
                  (POPLIN_ACCOUNT)

The account token needs:
  with a place   two permissions: Places: Read, Programs: Edit
  without        one permission: Programs: Edit

Every option of poplin install works here too: poplin install --help`;

describe("installHelp", () => {
  test("the command's own help lists the providers and every shared option the parser takes: without this an option is taken and nowhere shown", () => {
    expect(installHelp([PROVIDER])).toBe(COMMAND_HELP);
  });

  test("a provider's help is made from what the provider declares: without this the command would have to know a provider's options", () => {
    expect(installHelp([PROVIDER], PROVIDER)).toBe(PROVIDER_HELP);
  });

  test("the command's own lines, the option rows apart, fit a terminal 80 wide and are plain ASCII: without this the help wraps in the middle of a word", () => {
    const own = installHelp([]).split("\n");

    expect(own.filter((line) => (line.length > MAX_LINE && !line.startsWith("  --")) || !/^[\x20-\x7e]*$/.test(line) || line !== line.trimEnd())).toEqual([]);
    expect(own).toContain("  none: this build of poplin carries no provider");
  });

  // Drift: a provider words its own rows and the lines of what its token needs, as long as it likes; the help that carried them through unfolded broke 10 of them in the middle of a word on a terminal 80 wide.
  test("a provider's long rows are folded at their spaces to 80 columns, under their own indent, and its address stands whole on a line", () => {
    const address = `https://host.example.com/tokens/new?rights=${"chosen".repeat(15)}`;
    const wordy = { ...PROVIDER, tokenHelp: ["The account token needs:", `  with a place   ${"Places: Read, ".repeat(9)}Programs: Edit`, `                 ${address}`] };
    const lines = installHelp([wordy], wordy).split("\n");

    expect(lines.filter((line) => line.length > MAX_LINE)).toEqual([`                 ${address}`]);
    expect(lines.filter((line) => line.includes("Places: Read")).map((line) => line.startsWith("  "))).toEqual([true, true]);
  });
});
