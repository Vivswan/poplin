import { describe, expect, test } from "bun:test";

import type { Found, RemovalRow, Removed, Row, Token } from "../../../core/src/install/installer";
import { TOKEN_VARIABLE } from "../../src/install/ask";
import { jsonOf } from "../commands/support/harness";
import { ADDRESS, type Account, emptyAccount, installedOf, type Place, removedOf, repairedOf, runLine, TOKEN, type Where } from "./support/stand-in";

/** The environment of a run whose token is in its variable. */
const HELD = { [TOKEN_VARIABLE]: TOKEN };

/** The three commands, each as a run that gives every answer; the removal as its dry run. */
const [INSTALL, UNINSTALL, REPAIR] = ["install stand-in --no-place --user you@example.com --yes", "uninstall stand-in --no-place --dry-run --yes", "doctor --repair --no-place --yes"] as const;

/** A removal that gives its proof. */
const REMOVAL = "uninstall stand-in --no-place --confirm poplin.example.com --yes";

/** The three commands, each with what it says after a provider's sentence of a stop before any change. */
const COMMANDS = [
  ["install", INSTALL, "Nothing changed."],
  ["uninstall", UNINSTALL, "Nothing changed."],
  ["doctor --repair", REPAIR, "Nothing changed."],
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
  install: { step: "install", command: "npx poplin install stand-in --no-place" },
  repair: { step: "repair", command: "npx poplin doctor --repair --no-place" },
  uninstall: { step: "uninstall", command: "npx poplin uninstall stand-in --no-place" },
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

// Drift: a run with nobody to ask stops with exit 2 for the answer of where, so a next step without the place the run knew cannot be run as it is written. Each table below holds for both kinds of install.
describe.each(["--no-place", "--place example.com"])("the next step, in the one JSON value, of a line with %s", (place) => {
  const undone = installedOf([UNDONE], { ready: false });
  const placed = (text: string): string => text.replace("--no-place", place);

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
    const ran = await runLine(`${placed(line)} --json`, account, { env: HELD });

    expect([ran.code, jsonOf(ran).next]).toEqual([code, next.command === null ? next : { ...next, command: placed(next.command) }]);
  });
});

describe("a place the run was told is the wrong one, in the next step", () => {
  const [install, removal, repair] = [INSTALL, REMOVAL, REPAIR].map((line) => line.replace("--no-place", "--place example.com"));

  // Drift: a stop that says the install is at another place than the line named would send whoever follows `next` back to the wrong place, where the same stop waits.
  test.each([
    ["an install", install, accountWith({ state: "refused", why: "other_place", words: "An install was started here without a place: give --no-place.", give: "--no-place" }), "npx poplin install stand-in"],
    ["a removal", removal, { ...accountWith(WHOLE), removed: (): Removed => ({ ok: false, why: "other_place", words: "The install here has no place: give --no-place." }) }, "npx poplin uninstall stand-in"],
    ["a repair", repair, { ...accountWith(WHOLE), repaired: { ok: false, why: "elsewhere", words: "The install here has no place: give --no-place." } }, "npx poplin doctor --repair"],
  ] as const)("%s that is told the install is at another place names the command with no place", async (_name, line, account, command) => {
    const ran = await runLine(`${line} --json`, account, { env: HELD });

    expect([ran.code, jsonOf(ran).problem, (jsonOf(ran).next as { readonly command: string }).command]).toEqual([1, "other_place", command]);
  });
});

describe("a place given at its question, in the next step", () => {
  // Drift: the place a person typed is known as much as one the line gave. A stop at the question after it that forgot the answer names a command that asks for it again, with nobody there to ask.
  test.each([
    ["install stand-in", "npx poplin install stand-in --place example.com"],
    ["doctor --repair", "npx poplin doctor --repair --place example.com"],
    ["uninstall stand-in", "npx poplin uninstall stand-in --place example.com"],
  ])("poplin %s that is ended at the question after the place names the command at that place", async (line, command) => {
    const ran = await runLine(`${line} --json`, emptyAccount(), { asks: true, typed: ["example.com", undefined] });

    expect([ran.code, jsonOf(ran).problem, (jsonOf(ran).next as { readonly command: string }).command]).toEqual([1, "stopped", command]);
  });
});

describe.each(["--no-place", "--place example.com"])("a careful choice of the line, in the next step, of a line with %s", (place) => {
  const placed = (text: string): string => text.replace("--no-place", place);
  const refused = accountWith({ state: "refused", why: "token", words: "The host refused the token." });
  const half = { ...accountWith(WHOLE), removed: () => removedOf(LEFT, { ready: false }) };

  // Drift: a line without `--keep-data` removes the sites' files and the database, and one without `--dry-run` changes the account. A next step that dropped either sends whoever follows it past what the line before asked for.
  test.each([
    ["a removal that keeps the data and left a kind", `${REMOVAL} --keep-data`, half, 1, "npx poplin uninstall stand-in --no-place --keep-data"],
    ["a removal that keeps the data and is refused its token", `${REMOVAL} --keep-data`, refused, 1, "npx poplin uninstall stand-in --no-place --keep-data"],
    ["a removal that keeps the data and lacks its proof, a stop that comes while the line is read", "uninstall stand-in --no-place --keep-data --yes", accountWith(WHOLE), 2, "npx poplin uninstall stand-in --keep-data"],
    ["a removal's dry run that keeps the data and is ready, which the run follows", `${UNINSTALL} --keep-data`, accountWith(WHOLE), 0, "npx poplin uninstall stand-in --no-place --keep-data"],
    ["a removal's dry run that keeps the data and is refused its token", `${UNINSTALL} --keep-data`, refused, 1, "npx poplin uninstall stand-in --no-place --keep-data --dry-run"],
    ["a removal's dry run that is not ready", UNINSTALL, half, 1, "npx poplin uninstall stand-in --no-place --dry-run"],
    ["an install's dry run that is refused its token", `${INSTALL} --dry-run`, refused, 1, "npx poplin install stand-in --no-place --dry-run"],
    ["a repair's dry run that is refused its token", `${REPAIR} --dry-run`, refused, 1, "npx poplin doctor --repair --no-place --dry-run"],
    ["a repair's dry run that is not ready", `${REPAIR} --dry-run`, { ...accountWith(WHOLE), repaired: repairedOf([UNDONE], { ready: false }) }, 1, "npx poplin doctor --repair --no-place --dry-run"],
    ["an install told to adopt that is refused its token: the consent is given anew, as the proof of a removal is", `${INSTALL} --adopt`, refused, 1, "npx poplin install stand-in --no-place"],
  ] as const)("%s names it", async (_name, line, account, code, command) => {
    const ran = await runLine(`${placed(line)} --json`, account, { env: HELD });

    expect([ran.code, (jsonOf(ran).next as { readonly command: string }).command]).toEqual([code, placed(command)]);
  });

  // Drift: the sentence a person reads and the value a program reads name the next step from one list, so the sentence cannot leave out what the value carries.
  test("a removal that keeps the data and left a kind tells a person to rerun it with --keep-data", async () => {
    const ran = await runLine(placed(`${REMOVAL} --keep-data`), half, { env: HELD });

    expect([ran.code, ran.out.slice(-2)]).toEqual([1, ["The run is incomplete: 1 resource type removed, 1 failed", "Next: rerun this command with --keep-data"]]);
  });
});

describe("a piece the run never reached", () => {
  // Drift: a provider gives such a row no words, so the line said `skipped` and a name and nothing of why, or said that a row stopped the run while later rows still ran. The value a program reads keeps the empty detail.
  test("says on the screen that it was not attempted, and that an earlier row was blocked or failed only where one was, and keeps its empty detail in the JSON value", async () => {
    const rows: Row[] = [
      { object: "Jobs", state: "not-run", detail: "" },
      { object: "Login", state: "block", detail: "refused with status 403", right: "Logins: Edit" },
      { object: "Jobs", state: "not-run", detail: "" },
    ];
    const stopped = await runLine(INSTALL, { ...emptyAccount(), installed: installedOf(rows, { ready: false }) }, { env: HELD });
    const account = { ...emptyAccount(), installed: installedOf([{ object: "Jobs", state: "not-run", detail: "" }], { ready: false }) };
    const ran = await runLine(INSTALL, account, { env: HELD });
    const json = await runLine(`${INSTALL} --json`, account, { env: HELD });

    expect(stopped.out.filter((line) => line.startsWith("skipped")).map((line) => line.split(/ {2,}/)[2])).toEqual(["not attempted", "not attempted after a blocked or failed row"]);
    expect(ran.out.filter((line) => line.startsWith("skipped"))).toEqual(["skipped    Jobs                  not attempted"]);
    expect(jsonOf(json).rows).toEqual([{ object: "Jobs", did: "not-run", detail: "" }]);
  });
});
