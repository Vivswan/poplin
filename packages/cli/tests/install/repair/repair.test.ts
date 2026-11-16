import { describe, expect, test } from "bun:test";

import type { Found, Installer, Repaired, Row, Token } from "../../../../core/src/install/installer";
import { parseCommand } from "../../../src/commands/parse-command";
import { TOKEN_VARIABLE } from "../../../src/install/ask";
import { words } from "../../commands/support/command-line";
import { jsonOf } from "../../commands/support/harness";
import { ADDRESS, type Account, emptyAccount, type Place, repairedOf, runLine, standIn, TOKEN, type Where } from "../support/stand-in";

/** The environment of a run whose token is in its variable. */
const HELD = { [TOKEN_VARIABLE]: TOKEN };

/** A repair that gives every answer and asks nothing. */
const RUN = "doctor --repair --no-place --yes";

/** What the made-up provider found with the token. */
const PLACE: Place = { token: TOKEN as Token };

/** A whole install, as a look finds it. */
const WHOLE: Found<Where, Place> = { state: "whole", place: PLACE, version: "0.1.0", address: ADDRESS, newest: "0.2.0" };

/** Records an earlier install left behind. */
const LEFTOVER: Found<Where, Place> = { state: "leftover", place: PLACE, notes: [], words: "Records named poplin are in this account.", address: "https://host.example.com/records" };

/** What runs the command again, as the one JSON value names it. */
const AGAIN = { step: "repair", command: "npx poplin doctor --repair" };

/** The line that says which install was found. */
const FOUND = `looking for an install ... found: poplin 0.1.0, at ${ADDRESS}`;

/** The last lines of a run that left nothing undone, after the line that says what it is called. */
const ENDED = [`Your dashboard: ${ADDRESS}`, "The token was used for this run and is stored nowhere. You can delete it at Stand-In Host."];

/** The rows of an install with one object missing, which a repair makes. */
const ONE_GONE: readonly Row[] = [
  { object: "Store", state: "leave", detail: "poplin-sites" },
  { object: "Guard rule", state: "make", detail: "bots" },
];

/** A permission the token lacks, as the provider says it. */
const LACKING = { what: "right_lacking", right: "Rules: Edit", words: "The token lacks a permission. Add this one: Rules: Edit", address: "https://host.example.com/tokens" } as const;

/** An account that holds a whole install, and what a repair of it comes to. */
function installed(repaired?: Repaired, scene: Found<Where, Place> = WHOLE): Account {
  return { ...emptyAccount(), scenes: [scene], repaired };
}

describe("a repair with the account token", () => {
  test("an install with nothing to mend is said to be as it should be, and the command exits with 0: without this a healthy install reads as a failure", async () => {
    const account = installed();
    const ran = await runLine(RUN, account, { env: HELD });

    expect(ran).toMatchObject({ code: 0, err: [], asked: [], fetched: [] });
    expect(ran.out).toEqual([
      FOUND,
      "left      Store                 poplin-sites",
      "left      Records               poplin",
      "left      Program               poplin, to run 0.1.0",
      "left      Address               poplin.example.com",
      "left out  Guard rule            the token lacks Rules: Edit (optional)",
      "the install is as it should be. nothing was changed",
      ...ENDED,
    ]);
    expect<unknown>(account.repairs).toEqual([{ found: WHOLE, where: { kind: "none" }, mend: { run: "apply", addUser: undefined } }]);
    expect(account.runs).toEqual([]);
  });

  test("the provider may be named or left out where the package carries one: without this the two forms the help shows drift apart", async () => {
    const [bare, named] = [installed(), installed()];
    const lines = [await runLine("doctor --repair --place example.com --yes", bare, { env: HELD }), await runLine("doctor stand-in --repair --place example.com --yes", named, { env: HELD })];

    expect(lines.map((ran) => ran.code)).toEqual([0, 0]);
    expect<unknown>([bare.repairs[0]?.where, named.repairs[0]?.where]).toEqual(Array(2).fill({ kind: "place", name: "example.com" }));
  });

  test("a value that reads like the provider's word is a value, and with two providers the word must be given: without this an account of that name sends the options to no provider", async () => {
    const account = installed();
    const valued = await runLine("doctor --repair --no-place --account stand-in --yes", account, { env: HELD });
    const two = [standIn(account), standIn(account, "other")] as Installer<unknown, unknown>[];
    const unnamed = await runLine("doctor --repair --yes", account, { env: HELD, providers: two });
    const help = await runLine("doctor other --repair --help", account, { providers: two });

    expect<unknown>([valued.code, account.repairs[0]?.where]).toEqual([0, { kind: "none", account: "stand-in" }]);
    expect([unnamed.code, unnamed.err]).toEqual([2, ["poplin doctor --repair: an answer is missing: the provider. Name it after doctor --repair: poplin doctor --repair <provider>."]]);
    expect(help.out[0]?.split("\n")[0]).toBe("poplin doctor --repair other (--place <name> | --no-place) [options]");
  });

  test("a run that mends says so and exits with 0, and tells the person what the provider says is theirs to do: without this a mended login is not followed by where to log in", async () => {
    const account = installed(repairedOf(ONE_GONE, { steps: [{ text: "The login is ready. Open your dashboard and log in:", address: ADDRESS }] }));
    const ran = await runLine(RUN, account, { env: HELD });

    expect(ran.code).toBe(0);
    expect(ran.out.slice(1)).toEqual([
      "left      Store                 poplin-sites",
      "made      Guard rule            bots",
      "The login is ready. Open your dashboard and log in:",
      `  ${ADDRESS}`,
      "the install is mended.",
      ...ENDED,
    ]);
    expect(account.changes).toBe(1);
  });

  test("a dry run names what a run would change, changes nothing, and exits with 0 as the run after it would, with the repair as the next step: without this its words say ready while its exit and its value say failed", async () => {
    const account = installed(repairedOf(ONE_GONE));
    const dry = await runLine(`${RUN} --dry-run`, account, { env: HELD });
    const json = await runLine(`${RUN} --dry-run --json`, account, { env: HELD });
    const same = await runLine(`${RUN} --dry-run --json`, installed(), { env: HELD });

    expect([dry.code, json.code, account.changes, account.repairs.map((asked) => asked.mend.run)]).toEqual([0, 0, 0, ["dry-run", "dry-run"]]);
    expect(dry.out.slice(1)).toEqual([
      "would leave      Store                 poplin-sites",
      "would make       Guard rule            bots",
      "the token's permissions: each read was allowed, and a write is proven by the run",
      "ready: a run would make 1. nothing was changed",
    ]);
    expect(jsonOf(json)).toEqual({
      ok: true,
      run: "dry-run",
      ready: true,
      changes: 1,
      found: { state: "whole", version: "0.1.0", address: ADDRESS, newest: "0.2.0" },
      rows: [
        { object: "Store", will: "leave", detail: "poplin-sites" },
        { object: "Guard rule", will: "make", detail: "bots" },
      ],
      blocked: [],
      steps: [],
      next: AGAIN,
    });
    expect([same.code, jsonOf(same)]).toMatchObject([0, { ok: true, ready: true, changes: 0, next: { step: "login" } }]);
  });

  test("a run that leaves a piece undone names the permission and its page, says to run it again, and exits with 1: without this a token that lacks a permission looks like a repair that worked", async () => {
    const rows: Row[] = [{ object: "Guard rule", state: "block", detail: "bots: The token lacks a permission. Add this one: Rules: Edit", right: "Rules: Edit" }];
    const ran = await runLine(RUN, installed(repairedOf(rows, { ready: false, blocked: [LACKING] })), { env: HELD });

    expect(ran.code).toBe(1);
    expect(ran.out.slice(1)).toEqual([
      "stopped   Guard rule            bots: The token lacks a permission. Add this one: Rules: Edit",
      LACKING.words,
      `  ${LACKING.address}`,
      "1 not done. Run this command again: it goes on from what stands.",
      ENDED[1] ?? "",
    ]);
  });

  test("the email of --add-user reaches the provider in its normal form, and text that is none is refused before any look: without this a typing slip is sent to the provider", async () => {
    const account = installed(repairedOf([{ object: "User", state: "make", detail: "lost@example.com" }]));
    const ran = await runLine(`${RUN} --add-user Lost@Example.com`, account, { env: HELD });
    const refused = await runLine(`${RUN} --add-user lost`, account, { env: HELD });

    expect<unknown>([ran.code, ran.out[1], account.repairs.map((asked) => asked.mend.addUser)]).toEqual([0, "made      User                  lost@example.com", ["lost@example.com"]]);
    expect(refused).toMatchObject({ code: 2, out: [], err: ["poplin doctor --repair: --add-user takes an email address", "for example: --add-user you@example.com"] });
    expect(account.finds.length).toBe(1);
  });

  test("a row that quotes the token, as a provider's refusal may, is printed and written as JSON without it: without this the token lands in a log", async () => {
    const quoting = repairedOf([{ object: "Address", state: "fail", detail: `refused: bad token ${TOKEN}` }], { ready: false });
    const ran = await runLine("doctor --repair --no-place --token-stdin", installed(quoting), { stdin: `${TOKEN}\n` });
    const json = await runLine("doctor --repair --no-place --token-stdin --json", installed(quoting), { stdin: `${TOKEN}\n` });

    expect([ran.code, ran.out[1]?.startsWith("failed    Address               refused: bad token "), ran.out[1]?.includes(TOKEN)]).toEqual([1, true, false]);
    expect(JSON.stringify(jsonOf(json)).includes(TOKEN)).toBe(false);
  });

  test("on a terminal the place and the token are asked for, the token without being shown: without this a person must know the options before the first run", async () => {
    const account = installed();
    const ran = await runLine("doctor --repair", account, { asks: true, typed: ["example.com", TOKEN] });

    expect([ran.code, ran.asked]).toEqual([0, ["Your own place (example.com), or Enter for none:", "Account token (not shown): [secret]"]]);
    expect<unknown>(account.repairs[0]?.where).toEqual({ kind: "place", name: "example.com" });
  });
});

describe("what a repair does not go on from", () => {
  const install = "npx poplin install stand-in";
  const MAKE = { step: "install", command: install };

  // Drift: every state a look can find has one command that takes it. A state this command neither mends nor sends on would leave a person with no way on.
  test.each([
    ["nothing", { state: "none", place: PLACE, notes: [] }, 1, "no_install", `No install is in this account. To make one: ${install}`, MAKE],
    ["data left behind", LEFTOVER, 1, "no_install", `Records named poplin are in this account. To make an install that uses it: ${install} --adopt`, MAKE],
    ["an install that was started", { state: "started", place: PLACE, notes: [] }, 1, "unfinished", `An install was started in this account and not finished. To finish it: ${install}`, MAKE],
    ["a token the provider refuses", { state: "refused", why: "token", words: "The host refused the token." }, 1, "token_refused", "The host refused the token. nothing was changed", AGAIN],
    ["an install that was started for another place", { state: "refused", why: "other_place", words: "An install was started here for another place." }, 1, "other_place", "An install was started here for another place. nothing was changed", AGAIN],
    ["a provider that gives no answer", { state: "refused", why: "unreachable", words: "The host gave no answer." }, 5, "unreachable", "The host gave no answer. nothing was changed", AGAIN],
  ] as const)("%s is said in one line with what to run next, and nothing is repaired", async (_, scene, code, problem, line, next) => {
    const account = installed(undefined, scene);
    const ran = await runLine(RUN, account, { env: HELD });
    const json = await runLine(`${RUN} --json`, account, { env: HELD });

    expect([ran.code, ran.out, ran.err, account.repairs]).toEqual([code, [], [line], []]);
    expect(jsonOf(json)).toEqual({ ok: false, problem, next, words: line, run: "apply", ready: false });
  });

  // Drift: each of these is the provider's own refusal of a repair it began. Worded as a failure with no code, a program could not tell a wrong option from a lost connection.
  test.each([
    ["the install answers elsewhere than the place named", "elsewhere", 1, "other_place", AGAIN],
    ["the install's records are of another version", "another", 1, "another_version", { step: "repair", command: "npx poplin@latest doctor --repair" }],
    ["the provider refuses the token at the install", "token", 1, "token_refused", AGAIN],
    ["the provider gives no answer", "unreachable", 5, "unreachable", AGAIN],
  ] as const)("a repair that stops because %s exits with its code, says that nothing was changed, and names what goes on from it", async (_, why, code, problem, next) => {
    const ran = await runLine(`${RUN} --json`, installed({ ok: false, why, words: "The host says why." }), { env: HELD });

    expect([ran.code, jsonOf(ran)]).toEqual([code, { ok: false, problem, next, words: "The host says why. nothing was changed", run: "apply", ready: false }]);
  });
});

describe("the words of a repair", () => {
  test.each([
    ["doctor --dry-run", "poplin doctor changes nothing already: --dry-run goes with --repair"],
    ["doctor --add-user you@example.com", "--add-user goes with --repair"],
    ["doctor --token-stdin", "--token-stdin goes with --repair"],
  ])("%s is refused, since the option means something in a repair alone: without this a person believes a check added a user", (line, message) => {
    expect(parseCommand(words(`poplin ${line}`))).toMatchObject({ kind: "usage-error", message });
  });

  test("a line of doctor is a repair exactly when it carries --repair, and its other words are handed on as typed: without this the plain check changes, or a repair is read by the wrong parser", () => {
    expect(parseCommand(words("poplin doctor --json"))).toMatchObject({ kind: "doctor", json: true });
    expect(parseCommand(words("poplin doctor stand-in --repair --place example.com --json"))).toEqual({ kind: "provider", command: "repair", words: ["stand-in", "--repair", "--place", "example.com", "--json"] });
  });

  test.each([
    ["--server https://poplin.example.com", ["poplin doctor --repair: no option --server", "--repair works with the account token, not a login: leave out --server"]],
    ["--login you@example.com", ["poplin doctor --repair: no option --login", "a repair keeps the users the install has. To let one more person in: --add-user <email>"]],
    ["--place example.com --no-place", ["poplin doctor --repair: give one of --place <name> and --no-place"]],
  ])("a repair with %s is refused with a line that says what to type: without this a wrong option is ignored", async (options, err) => {
    const account = installed();
    const ran = await runLine(`doctor --repair --yes ${options}`, account, { env: HELD });

    expect([ran.code, ran.err, account.finds]).toEqual([2, err, []]);
  });

  test("a run that asks nothing names each answer it lacks, with the option that gives it: without this an agent's run hangs on a question", async () => {
    const ran = await runLine("doctor --repair --yes --json", installed());

    expect(ran.err).toEqual([
      "poplin doctor --repair: an answer is missing: where it answers. Give --place <name> or --no-place (or POPLIN_PLACE).",
      "poplin doctor --repair: an answer is missing: the account token. Set POPLIN_INSTALL_TOKEN, or pipe it with --token-stdin.",
    ]);
    expect([ran.code, jsonOf(ran)]).toEqual([2, { ok: false, problem: "missing_answer", next: AGAIN, missing: ["where", "token"] }]);
  });

  test("the help of a repair lists its own options, the provider's, and how the token is given: without this --repair has options no help shows", async () => {
    const ran = await runLine("doctor --repair --help", installed());
    const [help = ""] = ran.out;

    expect([ran.code, help.split("\n")[0]]).toEqual([0, "poplin doctor --repair (--place <name> | --no-place) [options]"]);
    expect(["--add-user <email>", "--dry-run", "--token-stdin", "--place <name>", "POPLIN_INSTALL_TOKEN", "a token that may only read adds nobody"].filter((part) => !help.includes(part))).toEqual([]);
  });
});
