import { describe, expect, test } from "bun:test";

import type { Installer } from "../../../../core/src/install/installer";
import { installHelp } from "../../../src/install/first/help";
import { emptyAccount, standIn } from "../support/stand-in";

/** The longest line of the command's own help: a terminal 80 wide shows it unbroken. */
const MAX_LINE = 80;

/** The one made-up provider. */
const PROVIDER = standIn(emptyAccount()) as Installer<unknown, unknown>;

/** The help of the command itself, with the one provider listed. */
const COMMAND_HELP = `Usage: poplin install <provider> [options]

Install poplin in your provider account. An existing install is reported and
left unchanged.

Providers:
  stand-in                  Stand-In Host: under your own place, or without one

Options:
  --user <email>            Email of the first user  (POPLIN_USER)
  --dry-run                 Read everything and show the plan; change nothing
  --adopt                   Reuse what an earlier install left behind
  --yes                     Never prompt; a missing answer stops the run
  --token-stdin             Read the account token from stdin; never prompt
  --log-in                  Log this machine in when done
  --no-log-in               Do not log this machine in; do not ask
  --no-wait                 Do not wait for the install to answer
  --json                    Print one JSON value, and nothing else on stdout

Notes:
  --dry-run exits as the real run would, as far as reading can tell: 0 when it
  would go through, and 1 when something would stop it first.

  The account token is read from POPLIN_INSTALL_TOKEN, from stdin with
  --token-stdin, or from a hidden prompt. It is used for the run and stored
  nowhere.

Related:
  poplin install stand-in --help  Provider options and token permissions
  poplin doctor                   Check the install
  poplin doctor --repair          Repair the install
  poplin update                   Update the install
  poplin uninstall <provider>     Remove the install`;

/** The help of the made-up provider: its own options before the shared ones, and what its token needs in its own words. */
const PROVIDER_HELP = `Usage: poplin install stand-in (--place <name> | --no-place) [options]

Stand-In Host: under your own place, or without one

Options:
  --place <name>            Your own place: example.com  (POPLIN_PLACE)
  --no-place                The address the host gives the account
                            (POPLIN_PLACE=none)
  --account <id>            Account id, when the token can access more than one
                            (POPLIN_ACCOUNT)
  --user <email>            Email of the first user  (POPLIN_USER)
  --dry-run                 Read everything and show the plan; change nothing
  --adopt                   Reuse what an earlier install left behind
  --yes                     Never prompt; a missing answer stops the run
  --token-stdin             Read the account token from stdin; never prompt
  --log-in                  Log this machine in when done
  --no-log-in               Do not log this machine in; do not ask
  --no-wait                 Do not wait for the install to answer
  --json                    Print one JSON value, and nothing else on stdout

Token:
  The account token needs:
    with a place   two permissions: Places: Read, Programs: Edit
    without        one permission: Programs: Edit

Notes:
  --dry-run exits as the real run would, as far as reading can tell: 0 when it
  would go through, and 1 when something would stop it first.

  The account token is read from POPLIN_INSTALL_TOKEN, from stdin with
  --token-stdin, or from a hidden prompt. It is used for the run and stored
  nowhere.`;

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
    expect(own).toContain("  none: this build of poplin includes no provider");
  });

  // Drift: a provider words its own rows and the lines of what its token needs, as long as it likes; the help that carried them through unfolded broke 10 of them in the middle of a word on a terminal 80 wide.
  test("a provider's long rows are folded at their spaces to 80 columns, under their own indent, and its address stands whole on a line", () => {
    const address = `https://host.example.com/tokens/new?rights=${"chosen".repeat(15)}`;
    const wordy = { ...PROVIDER, tokenHelp: ["The account token needs:", `  with a place   ${"Places: Read, ".repeat(9)}Programs: Edit`, `                 ${address}`] };
    const lines = installHelp([wordy], wordy).split("\n");

    expect(lines.filter((line) => line.length > MAX_LINE)).toEqual([`                   ${address}`]);
    expect(lines.filter((line) => line.includes("Places: Read")).map((line) => line.startsWith("  "))).toEqual([true, true]);
  });
});
