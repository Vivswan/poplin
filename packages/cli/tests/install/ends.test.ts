import { expect, test } from "bun:test";

import type { Found } from "../../../core/src/install/installer";
import { TOKEN_VARIABLE } from "../../src/install/ask";
import { jsonOf } from "../commands/support/harness";
import { type Account, emptyAccount, type Place, runLine, TOKEN, type Where } from "./support/stand-in";

/** A provider's sentence that carries what a text of the account can: an escape sequence that clears the line, a carriage return, and a line break before a line of its own. */
const FORGED = "The host refused the token.\u001b[2K\r\nThe way on: npx poplin uninstall stand-in";

/** A look the provider refused in that sentence. */
const REFUSED: Found<Where, Place> = { state: "refused", why: "token", words: FORGED };

/** A dry run of an install that gives every answer, with the token in its variable. */
const LINE = "install stand-in --no-place --login you@example.com --yes --dry-run";

// Drift: a provider's sentence may quote a name somebody else wrote in the account. Printed as it is, an escape sequence in it rewrites the terminal, and a person reads the forged line as the command's own.
test("a provider's sentence reaches the screen on one line with no control character, and the JSON value holds it as it came", async () => {
  const account: Account = { ...emptyAccount(), scenes: [REFUSED] };
  const env = { [TOKEN_VARIABLE]: TOKEN };
  const [said, valued] = [await runLine(LINE, account, { env }), await runLine(`${LINE} --json`, account, { env })];

  expect(said.err).toEqual(["The host refused the token. The way on: npx poplin uninstall stand-in. nothing was changed"]);
  expect([valued.err, jsonOf(valued).words]).toEqual([said.err, `${FORGED}. nothing was changed`]);
});

// Drift: an escape sequence ends at its first letter, so one written right before the token takes the token's first letter with it. Taken out before the token is hidden, it leaves the rest of the token on the screen, where no hiding finds it.
test("a token a provider's sentence quotes right after an escape sequence is hidden, not shown without its first letter", async () => {
  const account: Account = { ...emptyAccount(), scenes: [{ state: "refused", why: "token", words: `The host refused \u001b[${TOKEN}` }] };
  const said = await runLine(LINE, account, { env: { [TOKEN_VARIABLE]: TOKEN } });

  expect(said.err.map((line) => line.includes(TOKEN.slice(1)))).toEqual([false]);
});
