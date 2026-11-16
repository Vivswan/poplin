import { describe, expect, test } from "bun:test";

import type { Found } from "../../../core/src/install/installer";
import { TOKEN_VARIABLE } from "../../src/install/ask";
import { type Account, emptyAccount, type Place, runLine, TOKEN, type Where } from "./support/stand-in";

/** The environment of a run whose token is in its variable. */
const HELD = { [TOKEN_VARIABLE]: TOKEN };

/** The three commands, each as a run that gives every answer, with what it says after a provider's sentence of a stop before any change. */
const COMMANDS = [
  ["install", "install stand-in --no-place --login you@example.com --yes", "nothing was changed"],
  ["uninstall", "uninstall stand-in --no-place --dry-run --yes", "Nothing was removed."],
  ["doctor --repair", "doctor --repair --no-place --yes", "nothing was changed"],
] as const;

/** What a provider says of a token it refuses, as one that ends its sentence with a full stop writes it and as one that does not. */
const SENTENCES = ["The host refused the token.", "The host refused the token"] as const;

function accountWith(scene: Found<Where, Place>): Account {
  return { ...emptyAccount(), scenes: [scene] };
}

describe("a provider's sentence and the command's own", () => {
  // Drift: a provider ends its sentence as it likes, and each command joined it its own way. One of them printed two full stops for the provider the package carries.
  test.each(COMMANDS.flatMap(([name, line, tail]) => SENTENCES.map((words) => [name, words, line, tail] as const)))("poplin %s joins %j to its own words with one full stop", async (_name, words, line, tail) => {
    const ran = await runLine(line, accountWith({ state: "refused", why: "token", words }), { env: HELD });

    expect([ran.code, ran.err]).toEqual([1, [`The host refused the token. ${tail}`]]);
  });
});
