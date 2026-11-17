import { expect, test } from "bun:test";

import type { Found, Installer } from "../../../core/src/install/installer";
import { TOKEN_VARIABLE } from "../../src/install/ask";
import { jsonOf } from "../commands/support/harness";
import { type Account, emptyAccount, type Place, runLine, standIn, TOKEN, type Where } from "./support/stand-in";

/** A provider's sentence that carries what a text of the account can: an escape sequence that clears the line, a carriage return, and a line break before a line of its own. */
const FORGED = "The host refused the token.\u001b[2K\r\nThe way on: npx poplin uninstall stand-in";

/** A look the provider refused in that sentence. */
const REFUSED: Found<Where, Place> = { state: "refused", why: "token", words: FORGED };

/** A dry run of an install that gives every answer, with the token in its variable. */
const LINE = "install stand-in --no-place --user you@example.com --yes --dry-run";

// Drift: a provider's sentence may quote a name somebody else wrote in the account. Printed as it is, an escape sequence in it rewrites the terminal, and a person reads the forged line as the command's own.
test("a provider's sentence reaches the screen on one line with no control character, and the JSON value holds it as it came", async () => {
  const account: Account = { ...emptyAccount(), scenes: [REFUSED] };
  const env = { [TOKEN_VARIABLE]: TOKEN };
  const [said, valued] = [await runLine(LINE, account, { env }), await runLine(`${LINE} --json`, account, { env })];

  expect(said.err).toEqual(["The host refused the token. The way on: npx poplin uninstall stand-in. Nothing changed."]);
  expect([valued.err, jsonOf(valued).words]).toEqual([said.err, `${FORGED}. Nothing changed.`]);
});

// Drift: an escape sequence ends at its first letter, so one written right before the token takes the token's first letter with it. Taken out before the token is hidden, it leaves the rest of the token on the screen, where no hiding finds it.
test("a token a provider's sentence quotes right after an escape sequence is hidden, not shown without its first letter", async () => {
  const account: Account = { ...emptyAccount(), scenes: [{ state: "refused", why: "token", words: `The host refused \u001b[${TOKEN}` }] };
  const said = await runLine(LINE, account, { env: { [TOKEN_VARIABLE]: TOKEN } });

  expect(said.err.map((line) => line.includes(TOKEN.slice(1)))).toEqual([false]);
});

// Drift: a stop that comes while the line is read knows the command and not the provider, so its next step names no provider, and that line with the answers added is refused: a provider's option needs its provider named first.
test("a stop that comes while the line is read names the provider in its next step: the one the words name, or the only one the package carries", async () => {
  const lines = [
    "install stand-in --place example.com --user you@example.com --yes --json",
    "install --dry-run --place example.com --user you@example.com --json",
    "uninstall --keep-data --json",
    "doctor --repair --dry-run --add-user nobody --json",
  ];
  const stops = await Promise.all(lines.map(async (line) => jsonOf(await runLine(line, emptyAccount()))));

  expect(stops.map((stop) => [stop.problem, stop.next])).toEqual([
    ["missing_answer", { step: "install", command: "npx poplin install stand-in" }],
    ["usage", { step: "install", command: "npx poplin install stand-in --dry-run" }],
    ["missing_answer", { step: "uninstall", command: "npx poplin uninstall stand-in --keep-data" }],
    ["usage", { step: "repair", command: "npx poplin doctor --repair --dry-run" }],
  ]);
});

// Drift: with two providers in the package a line that names none has no provider to go on at, and a next step that picked one would send a person to a provider they never chose.
// The value of an option may be spelled as a provider is: only the subcommand says which provider the line is at.
test("in a package that carries two providers, the next step names the one the line has as its subcommand, and none where it has none", async () => {
  const account = emptyAccount();
  const providers = [standIn(account), standIn(account, "other-host")] as Installer<unknown, unknown>[];
  const lines = ["uninstall --keep-data --json", "uninstall --confirm stand-in --typo --json", "uninstall --confirm stand-in other-host --typo --json"];
  const stops = await Promise.all(lines.map(async (line) => jsonOf(await runLine(line, account, { providers }))));

  expect(stops.map((stop) => [stop.problem, (stop.next as { readonly command: string }).command])).toEqual([
    ["missing_answer", "npx poplin uninstall --keep-data"],
    ["usage", "npx poplin uninstall"],
    ["usage", "npx poplin uninstall other-host"],
  ]);
});
