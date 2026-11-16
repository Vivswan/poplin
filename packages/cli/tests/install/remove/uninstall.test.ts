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

/** What runs the command again, as the one JSON value names it. */
const AGAIN = { step: "uninstall", command: "npx poplin uninstall stand-in" };

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

/** What a run says of the computers that are still logged in, once the install is gone. */
const LOGOUT = "On each computer that is still logged in: npx poplin logout. It forgets the login there, and says the install could not be reached.";

/** The last lines of a run that removed everything. */
const DONE = [
  "the install is removed. 4 kinds removed, 0 left, 1 stays.",
  "Each row that says stays names what is yours to do by hand.",
  LOGOUT,
  "The token was used for this run and is stored nowhere. You can delete it at Stand-In Host.",
];

/** What a person is told before the name is typed. */
const WARNED = ["This removes every row above that says would remove. It cannot be undone.", "It logs no computer out. Run npx poplin logout on each one first: after the removal a logout cannot reach the install."] as const;

/** A kind the token could not look for: it lacks the optional permission the kind is made with. */
const UNLOOKED: RemovalRow = { object: "Guard rule", state: "stay", detail: "the token lacks an optional permission, so this was not looked for. Add this one: Rules: Edit", right: "Rules: Edit" };

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
      "A removal logs no computer out: run npx poplin logout on each one first.",
      "ready: a run would remove 4 kinds. nothing was removed",
    ]);
    expect([handed(account), account.changes]).toEqual([[{ run: "dry-run", data: "remove" }], 0]);
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
      unlooked: [],
      next: AGAIN,
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

    expect(ran).toMatchObject({ code: 0, asked: [`Type ${NAME} to go on:`], err: WARNED });
    expect(ran.out).toEqual([FOUND, ...LISTED, ...REMOVED, ...DONE]);
    expect(ran.shown.slice(1, 9)).toEqual([...LISTED.map((line, at) => `out ${at === 4 ? "note" : "done"}: ${line}`), ...WARNED.map((line) => `err warning: ${line}`), `ask: Type ${NAME} to go on:`]);
    expect([handed(account), account.changes]).toEqual([[{ run: "dry-run", data: "remove" }, { run: "apply", confirmed: NAME, data: "remove" }], 4]);
  });

  test("on a terminal with --json still shows the list before it asks, beside the one value: without this a person types the address of a removal they never saw", async () => {
    const account = installed();
    const ran = await runLine("uninstall stand-in --no-place --json", account, { env: HELD, asks: true, typed: [NAME] });

    expect([ran.code, ran.out.length, jsonOf(ran)]).toMatchObject([0, 1, { ok: true, run: "apply", rows: [{ did: "remove" }, { did: "remove" }, { did: "remove" }, { did: "remove" }, { did: "stay" }] }]);
    expect(ran.shown.slice(0, 8)).toEqual([...LISTED.map((line) => `err: ${line}`), ...WARNED.map((line) => `err: ${line}`), `ask: Type ${NAME} to go on:`]);
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
    expect([flagged.code, jsonOf(flagged), given.changes]).toEqual([1, { ok: false, problem: "not_confirmed", next: AGAIN, words, run: "apply", ready: false }, 0]);
  });

  test.each([
    ["ends the question", undefined],
    ["presses Enter at it", ""],
  ])("whose person %s removes nothing, and the provider is asked for no removal: without this Escape or an empty line at the last question is a yes", async (_what, typed) => {
    const account = installed();
    const ran = await runLine("uninstall stand-in --no-place", account, { env: HELD, asks: true, typed: [typed] });

    expect([ran.code, ran.err.at(-1), handed(account)]).toEqual([1, "stopped. Nothing was removed.", [{ run: "dry-run", data: "remove" }]]);
  });

  // Drift: the list before the question was a dry run that knew nothing of --keep-data, so it said `would remove` for the data the run then kept.
  test("told to keep the data lists the data as kept before it asks, and in a dry run too: without this a person types the address under a list that says their sites go", async () => {
    const rows = (removal: Removal): Removed => removedOf(WHOLE.map((row) => (removal.data === "keep" && (row.object === "Store" || row.object === "Records") ? { ...row, state: "keep" } : row)));
    const account = installed(rows);
    const asked = await runLine("uninstall stand-in --no-place --keep-data", account, { env: HELD, asks: true, typed: [NAME] });
    const dry = await runLine("uninstall stand-in --no-place --keep-data --dry-run", installed(rows), { env: HELD });
    const kept = ["would keep    Store                 poplin-sites: 2 files, 15 B", "would keep    Records               poplin: 3 sites"];

    expect([asked.code, asked.out.slice(3, 5), asked.err]).toEqual([0, kept, [`${WARNED[0]} The sites' files and the database stay.`, WARNED[1]]]);
    expect(handed(account)).toEqual([
      { run: "dry-run", data: "keep" },
      { run: "apply", confirmed: NAME, data: "keep" },
    ]);
    expect([dry.code, dry.out.slice(3, 5), dry.out.slice(-3)]).toEqual([
      0,
      kept,
      ["The sites' files and the database stay: --keep-data was given.", "A removal logs no computer out: run npx poplin logout on each one first.", "ready: a run would remove 2 kinds. nothing was removed"],
    ]);
  });

  // Drift: a kind made with an optional permission is not looked for by a token that lacks it. The run ended `the install is removed`, with nothing of the kinds that may still stand.
  test("whose token could not look for a kind says so in its last lines and in the one value, and still exits 0: without this an alert or a rule is left behind under a line that says all is gone", async () => {
    const rows = (): Removed => removedOf([...WHOLE, UNLOOKED, { ...UNLOOKED, object: "Alert" }]);
    const ran = await runLine(`uninstall stand-in --no-place --confirm ${NAME}`, installed(rows), { env: HELD });
    const json = await runLine(`uninstall stand-in --no-place --confirm ${NAME} --json`, installed(rows), { env: HELD });
    const dry = await runLine("uninstall stand-in --no-place --dry-run", installed(rows), { env: HELD });
    const unlooked = "since the token lacks an optional permission: Guard rule and Alert.";

    expect([ran.code, ran.out.slice(-5)]).toEqual([
      0,
      [
        "the install is removed, but for what the token could not look for. 4 kinds removed, 0 left, 3 stay.",
        "Each row that says stays names what is yours to do by hand.",
        `2 kinds were not looked for, ${unlooked} If the install made one, it is still there: delete it by hand, or add the permission and run this command again.`,
        LOGOUT,
        "The token was used for this run and is stored nowhere. You can delete it at Stand-In Host.",
      ],
    ]);
    expect([json.code, jsonOf(json)]).toMatchObject([0, { ok: true, ready: true, unlooked: ["Guard rule", "Alert"], next: { step: "none" } }]);
    expect([dry.code, dry.out.slice(-2)]).toEqual([0, [`2 kinds would not be looked for, ${unlooked}`, "ready: a run would remove 4 kinds. nothing was removed"]]);
  });

  test("told to keep the data where the data is all that is left says so and exits 1, as does a run that met only what is not the install's: without this a removal of nothing reads as done", async () => {
    const data: RemovalRow[] = [{ object: "Store", state: "keep", detail: "poplin-sites" }, { object: "Account token", state: "stay", detail: "delete it at Stand-In Host" }];
    const others: RemovalRow[] = [{ object: "Jobs", state: "skip", detail: "poplin-jobs: it runs another program" }, { object: "Account token", state: "stay", detail: "delete it at Stand-In Host" }];
    const kept = await runLine(`uninstall stand-in --no-place --confirm ${NAME} --keep-data`, installed(() => removedOf(data)), { env: HELD });
    const skipped = await runLine(`uninstall stand-in --no-place --confirm ${NAME}`, installed(() => removedOf(others)), { env: HELD });

    expect([kept.code, kept.err.at(-1)]).toEqual([1, "Only the data is left here, and --keep-data keeps it. Nothing was removed."]);
    expect([skipped.code, skipped.err.at(-1)]).toEqual([1, "No install is in this account. Nothing was removed."]);
  });

  // Drift: a kind the token could not look for may be all that an earlier removal left. A line that said only the data is left, or no install, would call the account clean.
  test("that meets nothing to remove, and could not look for a kind, says which kind beside what is left: without this an alert a removal left behind is never named again", async () => {
    const data: RemovalRow[] = [{ object: "Store", state: "keep", detail: "poplin-sites" }, UNLOOKED];
    const kept = await runLine("uninstall stand-in --no-place --dry-run --keep-data", installed(() => removedOf(data)), { env: HELD });
    const none = await runLine(`uninstall stand-in --no-place --confirm ${NAME}`, installed(() => removedOf([UNLOOKED])), { env: HELD });
    const unlooked = "since the token lacks an optional permission: Guard rule.";

    expect([kept.code, kept.err.at(-1)]).toEqual([1, `Only the data is left here, and --keep-data keeps it. 1 kind would not be looked for, ${unlooked} Nothing was removed.`]);
    expect([none.code, none.err.at(-1)]).toEqual([
      1,
      `No install is in this account. 1 kind was not looked for, ${unlooked} If the install made one, it is still there: delete it by hand, or add the permission and run this command again. Nothing was removed.`,
    ]);
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

  // Drift: a program reads the problem, not the sentence. Told as a token that shows no such domain, it would send a person to the token's form in place of the option to give.
  test("an install that was started for another place than the one named stops the removal as other_place, with the provider's sentence, and nothing is removed", async () => {
    const account: Account = { ...emptyAccount(), scenes: [{ state: "refused", why: "other_place", words: "An install was started here for another place." }], removed: () => removedOf(WHOLE) };
    const ran = await runLine("uninstall stand-in --no-place --dry-run --json", account, { env: HELD });

    expect([ran.code, jsonOf(ran), account.changes]).toMatchObject([1, { ok: false, problem: "other_place", words: "An install was started here for another place. Nothing was removed." }, 0]);
  });

  test("a name the install needs that something else holds is said with its page, and nothing is asked of the provider's removal: without this a stranger's object is listed as poplin's", async () => {
    const account: Account = { ...emptyAccount(), scenes: [{ state: "held", words: "A program named poplin is in this account and is not poplin's.", address: "https://host.example.com/programs/poplin", after: "again" }] };
    const ran = await runLine(`uninstall stand-in --no-place --confirm ${NAME}`, account, { env: HELD });

    expect([ran.code, ran.err, account.removals]).toEqual([1, ["A program named poplin is in this account and is not poplin's.", "  https://host.example.com/programs/poplin", "nothing was changed"], []]);
  });
});
