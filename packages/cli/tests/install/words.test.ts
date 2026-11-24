// What a line hands its provider to read, by the work of its command.
// Without these an option of an install alone would still answer a repair or a removal through its variable: a value the install refuses would stop a repair for an answer it never reads.

import { expect, test } from "bun:test";

import type { Installer } from "../../../core/src/install/installer";
import { TOKEN_VARIABLE } from "../../src/install/ask";
import { parseInstall } from "../../src/install/first/parse";
import type { Parsed } from "../../src/install/records";
import { parseUninstall } from "../../src/install/remove/parse";
import { parseRepair } from "../../src/install/repair/parse";
import { emptyAccount, standIn, TOKEN } from "./support/stand-in";

/** The one made-up provider, whose `--alias` is an option of an install alone, with the variable `POPLIN_ALIAS`. */
const PROVIDERS = [standIn(emptyAccount()) as Installer<unknown, unknown>];

/** The environment of a line whose token is in its variable, with a value for the install's own variable. */
function envOf(alias: string): Readonly<Record<string, string>> {
  return { [TOKEN_VARIABLE]: TOKEN, POPLIN_ALIAS: alias };
}

/** What a line that asks nothing came to: the place its provider read, or the stop it was refused with. */
function cameTo(parsed: Parsed<{ readonly asking: "never" | "terminal"; readonly where: unknown }>): unknown {
  if (parsed.kind === "plan") return parsed.plan.where;

  return parsed.kind === "stop" ? parsed.stop : parsed.kind;
}

test("the variable of an option of an install alone answers an install, and nothing on a repair or a removal, which a value the install refuses does not stop; a variable of an option of every work still answers them", () => {
  const install = ["stand-in", "--no-place", "--user", "you@example.com"];

  expect([cameTo(parseInstall(install, PROVIDERS, envOf("mine"), false)), cameTo(parseInstall(install, PROVIDERS, envOf("two words"), false))]).toEqual([
    { kind: "none", alias: "mine" },
    { problem: "usage", exit: 2, lines: ["The account's name is one word"] },
  ]);
  // The place's variable is of options every work takes: it answers a repair as it did.
  expect([
    cameTo(parseRepair(["--repair", "--no-place"], PROVIDERS, envOf("two words"), false)),
    cameTo(parseUninstall(["stand-in", "--no-place", "--dry-run"], PROVIDERS, envOf("two words"), false)),
    cameTo(parseRepair(["--repair"], PROVIDERS, { ...envOf("two words"), POPLIN_PLACE: "example.com" }, false)),
  ]).toEqual([{ kind: "none" }, { kind: "none" }, { kind: "place", name: "example.com" }]);
});
