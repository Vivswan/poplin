import { describe, expect, test } from "bun:test";

import type { Found, RemovalRow, Row, Token } from "../../../core/src/install/installer";
import { TOKEN_VARIABLE } from "../../src/install/ask";
import { jsonOf } from "../commands/support/harness";
import { ADDRESS, type Account, emptyAccount, installedOf, type Place, removedOf, repairedOf, runLine, TOKEN, type Where } from "./support/stand-in";

/** The environment of a run whose token is in its variable. */
const HELD = { [TOKEN_VARIABLE]: TOKEN };

/** The three commands, each as a run that gives every answer; the removal as its dry run. */
const [INSTALL, UNINSTALL, REPAIR] = ["install stand-in --no-place --login you@example.com --yes", "uninstall stand-in --no-place --dry-run --yes", "doctor --repair --no-place --yes"] as const;

/** A removal that gives its proof. */
const REMOVAL = "uninstall stand-in --no-place --confirm poplin.example.com --yes";

/** The three commands, each with what it says after a provider's sentence of a stop before any change. */
const COMMANDS = [
  ["install", INSTALL, "nothing was changed"],
  ["uninstall", UNINSTALL, "Nothing was removed."],
  ["doctor --repair", REPAIR, "nothing was changed"],
] as const;

/** What a provider says of a token it refuses, as one that ends its sentence with a full stop writes it and as one that does not. */
const SENTENCES = ["The host refused the token.", "The host refused the token"] as const;

/** A whole install, as a look finds it. */
const WHOLE: Found<Where, Place> = { state: "whole", place: { token: TOKEN as Token }, version: "0.1.0", address: ADDRESS, newest: "0.1.0" };

/** A held name as a look finds it, but for the command that goes on once a person acted, which each case adds. */
const HELD_NAME = { state: "held", words: "A program named poplin is in this account.", address: "https://host.example.com/programs/poplin" } as const;

/** An object a run could not make. */
const UNDONE: Row = { object: "Program", state: "fail", detail: "refused with status 500" };

/** An object a run makes. */
const MADE: Row = { object: "Guard rule", state: "make", detail: "bots" };

/** The kinds of a removal that left one behind. */
const LEFT: readonly RemovalRow[] = [
  { object: "Address", state: "remove", detail: "poplin.example.com" },
  { object: "Program", state: "fail", detail: "refused with status 500" },
];

/** The command line of each step a run can name as the next, at the made-up provider and the made-up install. */
const NEXT = {
  install: { step: "install", command: "npx poplin install stand-in" },
  repair: { step: "repair", command: "npx poplin doctor --repair" },
  uninstall: { step: "uninstall", command: "npx poplin uninstall stand-in" },
  login: { step: "login", command: `npx poplin login --server ${ADDRESS}` },
  none: { step: "none", command: null },
} as const;

function accountWith(...scenes: Found<Where, Place>[]): Account {
  return { ...emptyAccount(), scenes };
}

describe("a provider's sentence and the command's own", () => {
  // Drift: a provider ends its sentence as it likes, and each command joined it its own way. One of them printed two full stops for the provider the package carries.
  test.each(COMMANDS.flatMap(([name, line, tail]) => SENTENCES.map((words) => [name, words, line, tail] as const)))("poplin %s joins %j to its own words with one full stop", async (_name, words, line, tail) => {
    const ran = await runLine(line, accountWith({ state: "refused", why: "token", words }), { env: HELD });

    expect([ran.code, ran.err]).toEqual([1, [`The host refused the token. ${tail}`]]);
  });
});

describe("the next step, in the one JSON value", () => {
  const undone = installedOf([UNDONE], { ready: false });

  // Drift: a person reads the next step in the last line, and `--json` prints no line. Without the key an agent runs a second command to learn what the first one already knew.
  test.each([
    ["an install's dry run that is ready", `${INSTALL} --dry-run`, emptyAccount(), 0, NEXT.install],
    ["an install that is made", `${INSTALL} --no-wait`, emptyAccount(), 0, NEXT.login],
    ["an install that left a piece undone, and is not set yet", INSTALL, { ...emptyAccount(), installed: undone }, 1, NEXT.install],
    ["an install that left a piece undone, and is set", INSTALL, { ...accountWith({ state: "none", place: WHOLE.place, notes: [] }, WHOLE), installed: undone }, 1, NEXT.repair],
    ["an install that met a name held by a stranger", INSTALL, accountWith({ ...HELD_NAME, after: "again" }), 1, NEXT.install],
    ["an install that met an install of its own that a repair takes once it is whole", INSTALL, accountWith({ ...HELD_NAME, after: "repair" }), 1, NEXT.repair],
    ["a removal that met an install that was never set, which an install goes on from", REMOVAL, accountWith({ ...HELD_NAME, after: "install" }), 1, NEXT.install],
    ["a removal that met a name held by a stranger", REMOVAL, accountWith({ ...HELD_NAME, after: "again" }), 1, NEXT.uninstall],
    ["an install the token is refused for", INSTALL, accountWith({ state: "refused", why: "token", words: "The host refused the token." }), 1, NEXT.install],
    ["a repair's dry run that would change something", `${REPAIR} --dry-run`, { ...accountWith(WHOLE), repaired: repairedOf([MADE]) }, 0, NEXT.repair],
    ["a repair's dry run that would change nothing", `${REPAIR} --dry-run`, accountWith(WHOLE), 0, NEXT.login],
    ["a repair that mended", REPAIR, { ...accountWith(WHOLE), repaired: repairedOf([MADE]) }, 0, NEXT.login],
    ["a repair that left a piece undone", REPAIR, { ...accountWith(WHOLE), repaired: repairedOf([UNDONE], { ready: false }) }, 1, NEXT.repair],
    ["a repair where no install is", REPAIR, emptyAccount(), 1, NEXT.install],
    ["a removal's dry run", UNINSTALL, accountWith(WHOLE), 0, NEXT.uninstall],
    ["a removal that is done", REMOVAL, accountWith(WHOLE), 0, NEXT.none],
    ["a removal that left a kind", REMOVAL, { ...accountWith(WHOLE), removed: () => removedOf(LEFT, { ready: false }) }, 1, NEXT.uninstall],
    ["a removal where no install is", REMOVAL, { ...emptyAccount(), removed: () => removedOf([]) }, 1, NEXT.none],
  ] as const)("%s names it", async (_name, line, account, code, next) => {
    const ran = await runLine(`${line} --json`, account, { env: HELD });

    expect([ran.code, jsonOf(ran).next]).toEqual([code, next]);
  });
});

describe("a careful choice of the line, in the next step", () => {
  const refused = accountWith({ state: "refused", why: "token", words: "The host refused the token." });
  const half = { ...accountWith(WHOLE), removed: () => removedOf(LEFT, { ready: false }) };

  // Drift: a line without `--keep-data` removes the sites' files and the database, and one without `--dry-run` changes the account. A next step that dropped either sends whoever follows it past what the line before asked for.
  test.each([
    ["a removal that keeps the data and left a kind", `${REMOVAL} --keep-data`, half, 1, "npx poplin uninstall stand-in --keep-data"],
    ["a removal that keeps the data and is refused its token", `${REMOVAL} --keep-data`, refused, 1, "npx poplin uninstall stand-in --keep-data"],
    ["a removal that keeps the data and lacks its proof, a stop that names no provider", "uninstall stand-in --no-place --keep-data --yes", accountWith(WHOLE), 2, "npx poplin uninstall --keep-data"],
    ["a removal's dry run that keeps the data and is ready, which the run follows", `${UNINSTALL} --keep-data`, accountWith(WHOLE), 0, "npx poplin uninstall stand-in --keep-data"],
    ["a removal's dry run that keeps the data and is refused its token", `${UNINSTALL} --keep-data`, refused, 1, "npx poplin uninstall stand-in --keep-data --dry-run"],
    ["a removal's dry run that is not ready", UNINSTALL, half, 1, "npx poplin uninstall stand-in --dry-run"],
    ["an install's dry run that is refused its token", `${INSTALL} --dry-run`, refused, 1, "npx poplin install stand-in --dry-run"],
    ["a repair's dry run that is refused its token", `${REPAIR} --dry-run`, refused, 1, "npx poplin doctor --repair --dry-run"],
    ["a repair's dry run that is not ready", `${REPAIR} --dry-run`, { ...accountWith(WHOLE), repaired: repairedOf([UNDONE], { ready: false }) }, 1, "npx poplin doctor --repair --dry-run"],
    ["an install told to adopt that is refused its token: the consent is given anew, as the proof of a removal is", `${INSTALL} --adopt`, refused, 1, "npx poplin install stand-in"],
  ] as const)("%s names it", async (_name, line, account, code, command) => {
    const ran = await runLine(`${line} --json`, account, { env: HELD });

    expect([ran.code, (jsonOf(ran).next as { readonly command: string }).command]).toEqual([code, command]);
  });

  // Drift: the sentence a person reads and the value a program reads name the next step from one list, so the sentence cannot leave out what the value carries.
  test("a removal that keeps the data and left a kind tells a person to run it again with --keep-data", async () => {
    const ran = await runLine(`${REMOVAL} --keep-data`, half, { env: HELD });

    expect([ran.code, ran.out.at(-2)]).toEqual([1, "1 not done, 1 kind removed. Run this command again with --keep-data: it removes what is left."]);
  });
});
