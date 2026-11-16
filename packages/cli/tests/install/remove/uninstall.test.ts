import { describe, expect, test } from "bun:test";

import type { Found, Removal, RemovalRow, Removed, Token } from "../../../../core/src/install/installer";
import { TOKEN_VARIABLE } from "../../../src/install/ask";
import { jsonOf } from "../../commands/support/harness";
import { ADDRESS, type Account, emptyAccount, type Place, removedOf, runLine, TOKEN, WHOLE, type Where } from "../support/stand-in";

/** The environment of a run whose token is in its variable. */
const HELD = { [TOKEN_VARIABLE]: TOKEN };

/** What the made-up provider found with the token. */
const PLACE: Place = { token: TOKEN as Token };

/** What a person types to remove the made-up install: its address without the scheme. */
const NAME = "poplin.example.com";

/** A whole install, as a look finds it. */
const INSTALL: Found<Where, Place> = { state: "whole", place: PLACE, version: "0.1.0", address: ADDRESS, newest: "0.1.0" };

/** The line of a look that found the install. */
const FOUND = `looking for an install ... found: poplin 0.1.0, at ${ADDRESS}`;

/** The rows of a dry run as it printed them, in the plain look. */
const LISTED = [
  "would remove  Address               poplin.example.com",
  "would remove  Program               poplin",
  "would remove  Store                 poplin-sites: 2 files, 15 B",
  "would remove  Records               poplin: 3 sites",
  "stays         Account token         delete it at Stand-In Host",
];

/** The rows of a run as it printed them. */
const REMOVED = [
  "removed       Address               poplin.example.com",
  "removed       Program               poplin",
  "removed       Store                 poplin-sites: 2 files, 15 B",
  "removed       Records               poplin: 3 sites",
  "stays         Account token         delete it at Stand-In Host",
];

/** The last lines of a run that removed everything. */
const DONE = ["the install is removed. 4 kinds removed, 0 left.", "On each computer that was logged in: npx poplin logout", "The token was used for this run and is stored nowhere. You can delete it at Stand-In Host."];

/** An account that holds a whole install; `removed` says what a removal comes to in place of the whole rows. */
function installed(removed?: (removal: Removal) => Removed): Account {
  return { ...emptyAccount(), scenes: [INSTALL], removed };
}

/** What each call of `remove` was handed, without the place. */
function handed(account: Account): Removal[] {
  return account.removals.map((call) => call.removal);
}

describe("a dry run", () => {
  test("lists every kind with what the data holds, says a run is ready, and hands the provider no run that removes: without this a person cannot see what goes before it goes", async () => {
    const account = installed();
    const ran = await runLine("uninstall stand-in --no-place --dry-run", account, { env: HELD });

    expect(ran).toMatchObject({ code: 0, err: [], asked: [] });
    expect(ran.out).toEqual([
      FOUND,
      ...LISTED,
      `A run asks you to type this, or takes it with --confirm: ${NAME}`,
      "The sites' files and the database go last: --keep-data leaves them.",
      "ready: a run would remove 4 kinds. nothing was removed",
    ]);
    expect([handed(account), account.changes]).toEqual([[{ run: "dry-run" }], 0]);
  });

  test("with --json prints one value a program reads: each row under `will`, what the data holds, and what to type: without this an agent has to read the lines", async () => {
    const ran = await runLine("uninstall stand-in --no-place --dry-run --json", installed(), { env: HELD });

    expect([ran.code, ran.out.length]).toEqual([0, 1]);
    expect(jsonOf(ran)).toEqual({
      ok: true,
      run: "dry-run",
      ready: true,
      found: { state: "whole" },
      confirm: NAME,
      rows: [
        { object: "Address", will: "remove", detail: "poplin.example.com" },
        { object: "Program", will: "remove", detail: "poplin" },
        { object: "Store", will: "remove", detail: "poplin-sites: 2 files, 15 B", count: 2, bytes: 15 },
        { object: "Records", will: "remove", detail: "poplin: 3 sites", count: 3 },
        { object: "Account token", will: "stay", detail: "delete it at Stand-In Host" },
      ],
      blocked: [],
    });
  });

  test("that meets a kind the token may not remove says so, names the page, and exits 1: without this a dry run calls a run ready that will stop", async () => {
    const blocked = [{ what: "right_lacking", right: "Programs: Edit", words: "the token lacks a permission. Add this one: Programs: Edit", address: "https://host.example.com/tokens" } as const];
    const rows: RemovalRow[] = [
      { object: "Address", state: "remove", detail: "poplin.example.com" },
      { object: "Program", state: "block", detail: "the token lacks a permission. Add this one: Programs: Edit", right: "Programs: Edit" },
      { object: "Store", state: "not-run", detail: "poplin-sites: the Program still stands" },
    ];
    const ran = await runLine("uninstall stand-in --no-place --dry-run", installed(() => removedOf(rows, { ready: false, blocked })), { env: HELD });

    expect(ran.code).toBe(1);
    expect(ran.out.slice(-3)).toEqual(["the token lacks a permission. Add this one: Programs: Edit", "  https://host.example.com/tokens", "not ready: 1 blocked, 1 not run. A run would remove the other 1 kind. nothing was removed"]);
  });
});

describe("a run", () => {
  test("on a terminal lists what goes, warns, takes the install's address typed, and removes: without this a removal starts before a person saw what it takes", async () => {
    const account = installed();
    const ran = await runLine("uninstall stand-in --no-place", account, { env: HELD, asks: true, typed: [NAME] });

    expect(ran).toMatchObject({ code: 0, asked: [`Type ${NAME} to go on:`], err: ["This removes everything listed above. It cannot be undone."] });
    expect(ran.out).toEqual([FOUND, ...LISTED, ...REMOVED, ...DONE]);
    expect(ran.shown.slice(1, 8)).toEqual([...LISTED.map((line, at) => `out ${at === 4 ? "note" : "done"}: ${line}`), "err warning: This removes everything listed above. It cannot be undone.", `ask: Type ${NAME} to go on:`]);
    expect([handed(account), account.changes]).toEqual([[{ run: "dry-run" }, { run: "apply", confirmed: NAME, data: "remove" }], 4]);
  });

  test("on a terminal with --json still shows the list before it asks, beside the one value: without this a person types the address of a removal they never saw", async () => {
    const account = installed();
    const ran = await runLine("uninstall stand-in --no-place --json", account, { env: HELD, asks: true, typed: [NAME] });

    expect([ran.code, ran.out.length, jsonOf(ran)]).toMatchObject([0, 1, { ok: true, run: "apply", rows: [{ did: "remove" }, { did: "remove" }, { did: "remove" }, { did: "remove" }, { did: "stay" }] }]);
    expect(ran.shown.slice(0, 7)).toEqual([...LISTED.map((line) => `err: ${line}`), "err: This removes everything listed above. It cannot be undone.", `ask: Type ${NAME} to go on:`]);
  });

  test("on a terminal asks for where the install is and for the token, hidden, before it looks: without this a person must know every option by heart", async () => {
    const account = installed();
    const ran = await runLine("uninstall stand-in", account, { asks: true, typed: ["example.com", TOKEN, NAME] });

    expect(ran.code).toBe(0);
    expect(ran.asked).toEqual(["Your own place (example.com), or Enter for none:", "Account token (not shown): [secret]", `Type ${NAME} to go on:`]);
    expect(account.finds).toEqual([{ kind: "place", name: "example.com" }]);
  });

  test("given its proof with --confirm asks nothing, lists nothing first, and hands the provider what was given: without this an agent cannot remove an install", async () => {
    const account = installed();
    const ran = await runLine(`uninstall stand-in --no-place --yes --confirm ${NAME} --keep-data`, account, { env: HELD });

    expect(ran).toMatchObject({ code: 0, asked: [], err: [] });
    expect(ran.out).toEqual([FOUND, ...REMOVED, ...DONE]);
    expect(handed(account)).toEqual([{ run: "apply", confirmed: NAME, data: "keep" }]);
  });

  test("whose proof the provider refuses removes nothing and exits 1, typed or given: without this a mistyped address, or another install's, starts a removal", async () => {
    const words = `What was typed is not this install's: this install is ${NAME}. Nothing was removed.`;
    const refuse = (removal: Removal): Removed => (removal.run === "apply" && removal.confirmed !== NAME ? { ok: false, why: "not_confirmed", words } : removedOf(WHOLE));
    const typed = installed(refuse);
    const given = installed(refuse);
    const asked = await runLine("uninstall stand-in --no-place", typed, { env: HELD, asks: true, typed: ["poplin.example.org"] });
    const flagged = await runLine("uninstall stand-in --no-place --confirm poplin.example.org --json", given, { env: HELD });

    expect([asked.code, asked.err.at(-1), typed.changes]).toEqual([1, words, 0]);
    expect([flagged.code, jsonOf(flagged), given.changes]).toEqual([1, { ok: false, problem: "not_confirmed", words, run: "apply", ready: false }, 0]);
  });

  test.each([
    ["ends the question", undefined],
    ["presses Enter at it", ""],
  ])("whose person %s removes nothing, and the provider is asked for no removal: without this Escape or an empty line at the last question is a yes", async (_what, typed) => {
    const account = installed();
    const ran = await runLine("uninstall stand-in --no-place", account, { env: HELD, asks: true, typed: [typed] });

    expect([ran.code, ran.err.at(-1), handed(account)]).toEqual([1, "stopped. Nothing was removed.", [{ run: "dry-run" }]]);
  });

  test("told to keep the data where the data is all that is left says so and exits 1, as does a run that met only what is not the install's: without this a removal of nothing reads as done", async () => {
    const data: RemovalRow[] = [{ object: "Store", state: "keep", detail: "poplin-sites" }, { object: "Account token", state: "stay", detail: "delete it at Stand-In Host" }];
    const others: RemovalRow[] = [{ object: "Jobs", state: "skip", detail: "poplin-jobs: it runs another program" }, { object: "Account token", state: "stay", detail: "delete it at Stand-In Host" }];
    const kept = await runLine(`uninstall stand-in --no-place --confirm ${NAME} --keep-data`, installed(() => removedOf(data)), { env: HELD });
    const skipped = await runLine(`uninstall stand-in --no-place --confirm ${NAME}`, installed(() => removedOf(others)), { env: HELD });

    expect([kept.code, kept.err.at(-1)]).toEqual([1, "Only the data is left here, and --keep-data keeps it. Nothing was removed."]);
    expect([skipped.code, skipped.err.at(-1)]).toEqual([1, "No install is in this account. Nothing was removed."]);
  });

  test("that leaves a kind says how many are not done, exits 1, and with --json writes each row under `did`: without this a half removal reads as a whole one", async () => {
    const rows: RemovalRow[] = [
      { object: "Address", state: "remove", detail: "poplin.example.com" },
      { object: "Program", state: "fail", detail: "refused with status 500" },
    ];
    const ran = await runLine(`uninstall stand-in --no-place --confirm ${NAME}`, installed(() => removedOf(rows, { ready: false })), { env: HELD });
    const json = await runLine(`uninstall stand-in --no-place --confirm ${NAME} --json`, installed(() => removedOf(rows, { ready: false })), { env: HELD });

    expect([ran.code, ran.out.slice(-2)]).toEqual([1, ["1 not done, 1 kind removed. Run this command again: it removes what is left.", "The token was used for this run and is stored nowhere. You can delete it at Stand-In Host."]]);
    expect(jsonOf(json)).toMatchObject({ ok: false, run: "apply", ready: false, rows: [{ object: "Address", did: "remove" }, { object: "Program", did: "fail", detail: "refused with status 500" }] });
  });
});

describe("what stops a removal before it starts", () => {
  test.each<[string, Found<Where, Place>, (removal: Removal) => Removed, number, string]>([
    ["an account that holds nothing of an install", { state: "none", place: PLACE, notes: [] }, () => removedOf([{ object: "Account token", state: "stay", detail: "delete it at Stand-In Host" }]), 1, "No install is in this account. Nothing was removed."],
    ["an install of another place than the one named", INSTALL, () => ({ ok: false, why: "other_place", words: "The install answers elsewhere. Nothing was removed." }), 1, "The install answers elsewhere. Nothing was removed."],
    ["a provider that gives no answer", INSTALL, () => ({ ok: false, why: "unreachable", words: "The host gave no usable answer. Nothing was removed." }), 5, "The host gave no usable answer. Nothing was removed."],
    ["a token the provider refuses", { state: "refused", why: "token", words: "The host refused the token." }, () => removedOf(WHOLE), 1, "The host refused the token. Nothing was removed."],
  ])("%s ends the command with one line and its exit code, and nothing is removed: without this a person is not told why nothing happened", async (_what, scene, removed, code, line) => {
    const account: Account = { ...emptyAccount(), scenes: [scene], removed };
    const ran = await runLine("uninstall stand-in --no-place --dry-run", account, { env: HELD });

    expect([ran.code, ran.err.at(-1), account.changes]).toEqual([code, line, 0]);
  });

  test("a name the install needs that something else holds is said with its page, and nothing is asked of the provider's removal: without this a stranger's object is listed as poplin's", async () => {
    const account: Account = { ...emptyAccount(), scenes: [{ state: "held", words: "A program named poplin is in this account and is not poplin's.", address: "https://host.example.com/programs/poplin" }] };
    const ran = await runLine(`uninstall stand-in --no-place --confirm ${NAME}`, account, { env: HELD });

    expect([ran.code, ran.err, account.removals]).toEqual([1, ["A program named poplin is in this account and is not poplin's.", "  https://host.example.com/programs/poplin", "nothing was changed"], []]);
  });
});
