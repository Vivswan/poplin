import { describe, expect, test } from "bun:test";

import type { Installer } from "../../../../core/src/install/installer";
import { installHelp } from "../../../src/install/first/help";
import { emptyAccount, standIn } from "../support/stand-in";

/** The longest line of the command's own help: a terminal 80 wide shows it unbroken. */
const MAX_LINE = 80;

/** The one made-up provider. */
const PROVIDER = standIn(emptyAccount()) as Installer<unknown, unknown>;

/** The help of the command itself, with the one provider listed. */
const COMMAND_HELP = `Usage: poplin install [<provider>] [options]

Install poplin in your provider account

Providers:
  stand-in                 Installs on a place of your own or on the host's

Options:
  --user <email>           First user
                           Or set POPLIN_USER.
  --dry-run                Show what would change. Change nothing.
  --adopt                  Reuse resources left by an earlier install
  --yes                    Never prompt. A missing answer stops the run.
  --token-stdin            Read the account token from stdin
                           Or set POPLIN_INSTALL_TOKEN.
  --log-in                 Log this machine in when done
  --no-log-in
  --no-wait                Do not wait for the install to respond
  --json
  --help
  --version

Related:
  poplin install stand-in --help
  poplin doctor
  poplin doctor --repair
  poplin update
  poplin uninstall <provider>`;

/** The help of the made-up provider: its own options before the shared ones, and what its token needs, a permission a point. */
const PROVIDER_HELP = `Usage: poplin install stand-in (--place <name> | --no-place) [options]

Install poplin on Stand-In Host

Options:
  --place <name>           Your own place, such as example.com
                           Or set POPLIN_PLACE.
  --no-place               The address the host gives the account
                           Or set POPLIN_PLACE=none.
  --account <id>           Account id, if the token can access several accounts
                           Or set POPLIN_ACCOUNT.
  --user <email>           First user
                           Or set POPLIN_USER.
  --dry-run                Show what would change. Change nothing.
  --adopt                  Reuse resources left by an earlier install
  --yes                    Never prompt. A missing answer stops the run.
  --token-stdin            Read the account token from stdin
                           Or set POPLIN_INSTALL_TOKEN.
  --log-in                 Log this machine in when done
  --no-log-in
  --no-wait                Do not wait for the install to respond
  --json
  --help
  --version

Permissions:
  - Programs: Edit
  - Places: Read (--place)`;

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

  // Drift: a provider words what its token needs, as long as it likes: a permission folded under its dash read as two.
  test("a provider's long permission is folded at its spaces to 80 columns, under its own words: without this the help wraps in the middle of a word", () => {
    const long = `${"Places: Read, ".repeat(9)}Programs: Edit`;
    const wordy = { ...PROVIDER, tokenHelp: { ...PROVIDER.tokenHelp, install: [long] } };
    const lines = installHelp([wordy], wordy).split("\n");
    const first = lines.findIndex((line) => line.startsWith("  - Places: Read"));

    expect(lines.filter((line) => line.length > MAX_LINE)).toEqual([]);
    expect([first > 0, lines[first + 1]?.startsWith("    Places: Read") ?? lines[first + 1]]).toEqual([true, true]);
  });
});
