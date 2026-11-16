import { describe, expect, test } from "bun:test";

import type { Blocked, Found, Installer, Row, Token } from "../../../../core/src/install/installer";
import { TOKEN_VARIABLE } from "../../../src/install/ask";
import { jsonOf } from "../../commands/support/harness";
import { ADDRESS, type Account, accountQuestion, emptyAccount, FRESH, installedOf, type Place, type Ran, repairedOf, runLine, standIn, TOKEN, type Where } from "../support/stand-in";

/** The environment of a run whose token is in its variable. */
const HELD = { [TOKEN_VARIABLE]: TOKEN };

/** A run that gives every answer and asks nothing. */
const RUN = "install stand-in --no-place --login you@example.com --yes";

/** What runs the command again, as the one JSON value names it. */
const AGAIN = { step: "install", command: "npx poplin install stand-in" };

/** An object a repair is stopped at. */
const STOPPED_AT: Row = { object: "Program", state: "block", detail: "the token lacks Programs: Edit" };

/** The repair, as the one JSON value names it for the next step. */
const REPAIR = { step: "repair", command: "npx poplin doctor --repair" };

/** What the made-up provider found with the token. */
const PLACE: Place = { token: TOKEN as Token };

/** The login product switched off: a note on a state a run goes on from. */
const LOGIN_OFF: Blocked = { what: "login_off", words: "The login product is not switched on for this account", address: "https://host.example.com/login" };

/** Records an earlier install left behind. */
const LEFTOVER: Found<Where, Place> = { state: "leftover", place: PLACE, notes: [], words: "Records named poplin are in this account, and no poplin runs.", address: "https://host.example.com/records" };

/** The rows of a run as it printed them, in the plain look. */
const MADE = [
  "made      Store                 poplin-sites",
  "made      Records               poplin",
  "made      Program               poplin, to run 0.1.0",
  "left      Address               poplin.example.com",
  "left out  Guard rule            the token lacks Rules: Edit (optional)",
];

function accountWith(...scenes: Found<Where, Place>[]): Account {
  return { ...emptyAccount(), scenes };
}

describe("a fresh install", () => {
  test("a run that asks nothing prints each row as it is made, then the dashboard and how to log in: without this the output an agent and a person read drifts", async () => {
    const account = emptyAccount();
    const ran = await runLine(RUN, account, { env: HELD });

    expect(ran).toMatchObject({ code: 0, err: [], asked: [] });
    expect(ran.out).toEqual([
      "looking for an install ... none",
      ...MADE,
      `waiting for ${ADDRESS} to answer`,
      `${ADDRESS} answers`,
      "poplin 0.1.0 is installed.",
      `Your dashboard: ${ADDRESS}`,
      "The token was used for this run and is stored nowhere. You can delete it at Stand-In Host.",
      `To log this computer in: npx poplin login --server ${ADDRESS}`,
    ]);
    expect<unknown>(account.runs).toEqual([{ found: { state: "none", place: PLACE, notes: [] }, where: { kind: "none" }, login: "you@example.com", run: "apply" }]);
    expect([ran.reached, ran.slept]).toEqual([[`${ADDRESS}/api/whoami`], []]);
    expect(account.changes).toBe(3);
  });

  test("the token on standard input is its first line, and --no-wait asks the new install nothing: without this a piped token with a newline is refused", async () => {
    const account = emptyAccount();
    const ran = await runLine("install stand-in --place example.com --login you@example.com --token-stdin --no-wait", account, { stdin: `${TOKEN}\n` });

    expect(ran.code).toBe(0);
    expect(account.runs[0]).toMatchObject({ where: { kind: "place", name: "example.com" }, run: "apply" });
    expect(ran.out).not.toContain(`waiting for ${ADDRESS} to answer`);
    expect(ran.reached).toEqual([]);
  });

  test("standard input that holds no token is refused before any look: without this a wrong pipe reaches the provider", async () => {
    const account = emptyAccount();
    const ran = await runLine("install stand-in --no-place --login you@example.com --token-stdin", account, { stdin: "oops\n" });

    expect(ran).toMatchObject({ code: 2, out: [], err: ["poplin install: standard input does not hold an account token of Stand-In Host"] });
    expect(account.finds).toEqual([]);
  });

  test("a dry run lists the same objects in the same order as the run after it, and changes nothing: without this a dry run promises another install than is made", async () => {
    const account = emptyAccount();
    const dry = await runLine(`${RUN} --dry-run --json`, account, { env: HELD });
    const changesAfterDryRun = account.changes;
    const run = await runLine(`${RUN} --no-wait --json`, account, { env: HELD });
    const rows = (ran: Ran, key: string): unknown => (jsonOf(ran).rows as Record<string, unknown>[]).map((row) => [row.object, row[key], row.detail]);

    expect(dry.code).toBe(0);
    expect(changesAfterDryRun).toBe(0);
    expect(account.runs.map((one) => one.run)).toEqual(["dry-run", "apply"]);
    expect(dry.reached).toEqual([]);
    expect(rows(dry, "will")).toEqual(rows(run, "did"));
    expect(rows(dry, "will")).toEqual(FRESH.map((row) => [row.object, row.state, row.detail]));
  });

  test("a dry run words each row as what a run would do, and says it is ready: without this a dry run reads as if it had made something", async () => {
    const ran = await runLine(`${RUN} --dry-run`, emptyAccount(), { env: HELD });

    expect(ran.code).toBe(0);
    expect(ran.out).toEqual([
      "looking for an install ... none",
      "would make       Store                 poplin-sites",
      "would make       Records               poplin",
      "would make       Program               poplin, to run 0.1.0",
      "would leave      Address               poplin.example.com",
      "would leave out  Guard rule            the token lacks Rules: Edit (optional)",
      "the token's permissions: each read was allowed, and a write is proven by the run",
      "ready: a run would make 3 and leave out 1. nothing was changed",
    ]);
  });
});

describe("--json", () => {
  test("a run prints one value with ready, rows, and blocked, and nothing else on stdout: without this an agent parses prose", async () => {
    const ran = await runLine(`${RUN} --json --no-wait`, emptyAccount(), { env: HELD });

    expect(ran.err).toEqual([]);
    expect(jsonOf(ran)).toEqual({
      ok: true,
      run: "apply",
      ready: true,
      found: { state: "none" },
      release: "0.1.0",
      address: ADDRESS,
      answers: null,
      token: { proof: "reads" },
      rows: [
        { object: "Store", did: "make", detail: "poplin-sites" },
        { object: "Records", did: "make", detail: "poplin" },
        { object: "Program", did: "make", detail: "poplin, to run 0.1.0" },
        { object: "Address", did: "leave", detail: "poplin.example.com" },
        { object: "Guard rule", did: "leave-out", detail: "the token lacks Rules: Edit (optional)", right: "Rules: Edit" },
      ],
      blocked: [],
      steps: [],
      next: { step: "login", command: `npx poplin login --server ${ADDRESS}` },
    });
  });

  test("a dry run that is not ready says so with what blocks, and exits 1: without this an agent runs an install that cannot go through", async () => {
    const account = emptyAccount();
    const blocked: Blocked = { what: "right_lacking", right: "Programs: Edit", words: "The token lacks a permission. Add this one: Programs: Edit", address: "https://host.example.com/tokens" };
    account.installed = installedOf([{ object: "Program", state: "block", detail: "the token lacks Programs: Edit", right: "Programs: Edit" }], { ready: false, blocked: [blocked] });

    const json = await runLine(`${RUN} --dry-run --json`, account, { env: HELD });
    const plain = await runLine(`${RUN} --dry-run`, account, { env: HELD });

    expect(json.code).toBe(1);
    expect(jsonOf(json)).toMatchObject({ ok: false, run: "dry-run", ready: false, blocked: [blocked], rows: [{ object: "Program", will: "block", right: "Programs: Edit" }] });
    expect(plain.out.slice(1)).toEqual([
      "blocked          Program               the token lacks Programs: Edit",
      "The token lacks a permission. Add this one: Programs: Edit",
      "  https://host.example.com/tokens",
      "not ready: 1 blocked. nothing was changed",
    ]);
  });

  test("a run with no answer to give names each, as lines and as one value, exit 2: without this an agent learns of a missing answer by a hang", async () => {
    const account = emptyAccount();
    const ran = await runLine("install stand-in --yes --json", account);

    expect(ran.code).toBe(2);
    expect(jsonOf(ran)).toEqual({ ok: false, problem: "missing_answer", next: { step: "install", command: "npx poplin install" }, missing: ["where", "login", "token"] });
    expect(ran.err).toEqual([
      "poplin install: an answer is missing: where it answers. Give --place <name> or --no-place (or POPLIN_PLACE).",
      "poplin install: an answer is missing: the first login. Give --login <email> (or POPLIN_LOGIN).",
      `poplin install: an answer is missing: the account token. Set ${TOKEN_VARIABLE}, or pipe it with --token-stdin.`,
    ]);
    expect(account.finds).toEqual([]);
  });

  test("a line written wrong is one value with its words, exit 2: without this an agent's typing mistake is prose alone", async () => {
    const ran = await runLine("install stand-in --place example.com --no-place --json", emptyAccount());

    expect(ran.code).toBe(2);
    expect(jsonOf(ran)).toEqual({ ok: false, problem: "usage", next: { step: "install", command: "npx poplin install" }, words: ["poplin install: give one of --place <name> and --no-place"] });
  });

  test("the list of providers is one value: without this an agent cannot learn what it may install at", async () => {
    const ran = await runLine("install --json", emptyAccount());

    expect(ran.code).toBe(0);
    expect(jsonOf(ran)).toEqual({ ok: true, providers: [{ id: "stand-in", name: "Stand-In Host", about: "Stand-In Host: under your own place, or without one" }] });
  });
});

describe("what a look finds", () => {
  test("a whole install is said with its version and address and the four commands that own it, and nothing runs: without this install would touch an install that is there", async () => {
    const account = accountWith({ state: "whole", place: PLACE, version: "0.1.0", address: ADDRESS, newest: "0.2.0" });
    const ran = await runLine(RUN, account, { env: HELD });

    expect(ran.code).toBe(1);
    expect(ran.out).toEqual(["looking for an install ... found"]);
    expect(ran.err).toEqual([
      `This account already holds poplin 0.1.0, at ${ADDRESS}, and it is as it should be. nothing was changed.`,
      `The way on: npx poplin login --server ${ADDRESS}`,
      "  to check it   npx poplin doctor",
      "  to mend it    npx poplin doctor --repair",
      "  to update it  npx poplin update              (0.2.0 is out)",
      "  to remove it  npx poplin uninstall stand-in",
    ]);
    expect<unknown>([account.runs, account.changes, account.repairs.map((asked) => [asked.where, asked.mend])]).toEqual([[], 0, [[{ kind: "none" }, { run: "dry-run", addUser: undefined }]]]);
  });

  // Drift: the line once named the repair for every install that is there. A person whose install was whole was sent to mend it, when the way on was to log in.
  test.each([
    ["needs nothing mended", undefined, { mend: "nothing" }, ", and it is as it should be", [`The way on: npx poplin login --server ${ADDRESS}`], { step: "login", command: `npx poplin login --server ${ADDRESS}` }],
    ["lacks an object a repair makes", repairedOf([{ object: "Guard rule", state: "make", detail: "bots" }]), { mend: "something" }, ", and it is not as it should be", ["The way on: npx poplin doctor --repair"], REPAIR],
    ["has an object a repair is stopped at", repairedOf([STOPPED_AT], { ready: false }), { mend: "something" }, ", and it is not as it should be", ["The way on: npx poplin doctor --repair"], REPAIR],
    [
      "answers at another place than the one named",
      { ok: false, why: "elsewhere", words: "The install here is at a place: give --place example.com." },
      { mend: "unread", unread: "The install here is at a place: give --place example.com." },
      "",
      ["Whether it is as it should be was not read: The install here is at a place: give --place example.com.", "To see: npx poplin doctor --repair --dry-run"],
      REPAIR,
    ],
    [
      "holds records of another version",
      { ok: false, why: "another", words: "The install's records are of a newer poplin." },
      { mend: "unread", unread: "The install's records are of a newer poplin." },
      "",
      ["Whether it is as it should be was not read: The install's records are of a newer poplin.", "To see: npx poplin@latest doctor --repair --dry-run"],
      { step: "repair", command: "npx poplin@latest doctor --repair" },
    ],
  ] as const)("a whole install that %s is the problem already_installed with the way on that is true of it, in a run and in a dry run: without this an agent cannot tell it from a failure", async (_name, repaired, mend, state, way, next) => {
    const account = { ...accountWith({ state: "whole", place: PLACE, version: undefined, address: ADDRESS, newest: undefined }), repaired };
    const run = await runLine(`${RUN} --json`, account, { env: HELD });
    const dry = await runLine(`${RUN} --dry-run --json`, account, { env: HELD });

    expect([run.code, dry.code]).toEqual([1, 1]);
    expect(jsonOf(run)).toEqual({ ok: false, problem: "already_installed", next, found: { version: null, address: ADDRESS, newest: null, ...mend }, run: "apply", ready: false });
    expect(jsonOf(dry)).toMatchObject({ problem: "already_installed", next, run: "dry-run", ready: false });
    expect(run.err.slice(0, 1 + way.length)).toEqual([`This account already holds poplin (version not read), at ${ADDRESS}${state}. nothing was changed.`, ...way]);
  });

  test("something left behind stops a run that asks nothing, and names --adopt: without this a run would take another install's records silently", async () => {
    const account = accountWith(LEFTOVER);
    const run = await runLine(RUN, account, { env: HELD });
    const dry = await runLine(`${RUN} --dry-run --json`, account, { env: HELD });

    expect(run.code).toBe(1);
    expect(run.err).toEqual([
      "Records named poplin are in this account, and no poplin runs.",
      "To use it, with what it holds: run this again with --adopt. To start without it, delete it here first, with what it holds:",
      "  https://host.example.com/records",
      "nothing was changed",
    ]);
    expect(dry.code).toBe(1);
    expect(jsonOf(dry)).toEqual({ ok: false, problem: "leftover", next: AGAIN, words: LEFTOVER.words, address: LEFTOVER.address, run: "dry-run", ready: false });
    expect(account.runs).toEqual([]);
  });

  test("--adopt hands what was left behind to the run as adopted, in a dry run too: without this a dry run could not show what the run with the same answers does", async () => {
    const account = accountWith(LEFTOVER);
    const dry = await runLine(`${RUN} --adopt --dry-run --json`, account, { env: HELD });
    const run = await runLine(`${RUN} --adopt --no-wait --json`, account, { env: HELD });
    const { state: _state, ...left } = LEFTOVER;

    expect([dry.code, run.code]).toEqual([0, 0]);
    expect<unknown>(account.runs.map((one) => one.found)).toEqual([
      { ...left, state: "adopted" },
      { ...left, state: "adopted" },
    ]);
    expect(jsonOf(dry)).toMatchObject({ found: { state: "adopted" }, ready: true });
    expect(account.changes).toBe(3);
  });

  test("an install that was started is gone on with, with no question: without this a run that died half way could never be finished", async () => {
    const account = accountWith({ state: "started", place: PLACE, notes: [] });
    const ran = await runLine(`${RUN} --no-wait`, account, { env: HELD });

    expect(ran.code).toBe(0);
    expect(ran.out.slice(0, 2)).toEqual(["looking for an install ... one that was started and not finished", "An install was started here and not finished: this run goes on with it."]);
    expect(account.runs[0]?.found.state).toBe("started");
  });

  // Drift: a run that goes on with a program that was there uploads nothing, so it names no release. A last line that still read as this run's own install would vouch for code nobody checked.
  test("a run that names no release ends by saying the program's code was not this run's: the last line and the JSON value both", async () => {
    const account = accountWith({ state: "started", place: PLACE, notes: [] });
    account.installed = { ...installedOf(FRESH), release: undefined };
    const ran = await runLine(`${RUN} --no-wait`, account, { env: HELD });
    const said = await runLine(`${RUN} --no-wait --json`, { ...account, runs: [] }, { env: HELD });

    expect([ran.code, ran.out.at(-4), jsonOf(said).release]).toEqual([0, "poplin is installed. Its code was there before this run, and this run did not check it against a release.", null]);
  });

  test.each([
    ["a held name", { state: "held", words: "A program named poplin is in this account and is not poplin's. Rename or delete it, then run this again.", address: "https://host.example.com/programs", after: "again" }, 1, "name_held"],
    ["a block", { state: "blocked", blocked: [{ what: "storage_off", words: "Storage is not switched on for this account", address: "https://host.example.com/storage" }] }, 1, "blocked"],
    ["a refused token", { state: "refused", why: "token", words: "the account token was refused" }, 1, "token_refused"],
    ["a place the token does not show", { state: "refused", why: "no_domain", words: "the account token shows no such place" }, 1, "no_domain"],
    ["an install that was started for another place", { state: "refused", why: "other_place", words: "an install was started here for another place" }, 1, "other_place"],
    ["a provider that gives no answer", { state: "refused", why: "unreachable", words: "the host gave no answer" }, 5, "unreachable"],
  ] as const)("%s stops the command before any change, with its own exit and problem: without this the exit code tells a script the wrong thing", async (_name, scene, code, problem) => {
    const account = accountWith(scene);
    const ran = await runLine(`${RUN} --json`, account, { env: HELD });

    expect(ran.code).toBe(code);
    expect(jsonOf(ran)).toMatchObject({ ok: false, problem, run: "apply", ready: false });
    expect(ran.err.join("\n")).toContain("nothing was changed");
    expect(account.runs).toEqual([]);
  });

  test("a token that shows two accounts stops a run that asks nothing with the option that answers it, exit 2: without this an agent is asked a question", async () => {
    const account = accountWith({ state: "choice", question: accountQuestion({ kind: "none" }) });
    const ran = await runLine(`${RUN} --json`, account, { env: HELD });

    expect(ran.code).toBe(2);
    expect(jsonOf(ran)).toMatchObject({ ok: false, problem: "missing_answer", missing: ["account"] });
    expect(ran.err).toEqual(["poplin install: an answer is missing: the account. Give --account <id> (or POPLIN_ACCOUNT)."]);
  });
});

describe("what a run comes to", () => {
  test("a piece that is stopped and one that failed are counted, the steps for a person are listed, and the exit is 1: without this a half-made install reads as done", async () => {
    const account = emptyAccount();
    const undone: readonly Row[] = [
      { object: "Login", state: "block", detail: "the login product is not switched on" },
      { object: "Keys", state: "fail", detail: "status 500" },
      { object: "Jobs", state: "not-run", detail: "needs the keys" },
    ];
    account.installed = installedOf([...FRESH, ...undone], { ready: false, blocked: [LOGIN_OFF], steps: [{ text: "Switch on the login product and choose a team name", address: "https://host.example.com/login" }] });

    const ran = await runLine(`${RUN} --no-wait`, account, { env: HELD });

    expect(ran.code).toBe(1);
    expect(ran.out.slice(1 + MADE.length)).toEqual([
      "stopped   Login                 the login product is not switched on",
      "failed    Keys                  status 500",
      "not run   Jobs                  needs the keys",
      "The login product is not switched on for this account",
      "  https://host.example.com/login",
      "Do this in your browser, then run this command again:",
      "  Switch on the login product and choose a team name",
      "  https://host.example.com/login",
      "3 not done. Run this command again: it goes on from what stands.",
      "The token was used for this run and is stored nowhere. You can delete it at Stand-In Host.",
    ]);
    expect(ran.fetched).toEqual([]);
  });

  test("a run that left something undone names the command that goes on, the repair once the install is found whole and install again while it is not: without this the last line sends a person to a command that refuses", async () => {
    const undone: Row[] = [{ object: "Login", state: "block", detail: "the login product is not switched on" }];
    const whole: Found<Where, Place> = { state: "whole", place: PLACE, version: "0.1.0", address: ADDRESS, newest: "0.1.0" };
    const lastLines = async (after: Found<Where, Place>): Promise<string[]> => {
      const account = accountWith({ state: "none", place: PLACE, notes: [] }, after);
      account.installed = installedOf([...FRESH, ...undone], { ready: false, steps: [{ text: "Switch on the login product", address: "https://host.example.com/login" }] });
      const ran = await runLine(`${RUN} --no-wait`, account, { env: HELD });

      return [String(ran.code), ...ran.out.filter((line) => line.includes("then run") || line.includes("not done"))];
    };

    expect(await lastLines(whole)).toEqual(["1", "Do this in your browser, then run npx poplin doctor --repair:", "1 not done. Run npx poplin doctor --repair: it goes on from what stands."]);
    expect(await lastLines({ state: "started", place: PLACE, notes: [] })).toEqual(["1", "Do this in your browser, then run this command again:", "1 not done. Run this command again: it goes on from what stands."]);
  });

  test("an install that does not answer in 5 minutes exits 1, is called made and not installed, and offers no login: without this a person is told of an install at an address that shows nothing", async () => {
    const ran = await runLine(`${RUN} --log-in --json`, emptyAccount(), { env: HELD, statuses: [503] });
    const plain = await runLine(RUN, emptyAccount(), { env: HELD, statuses: [503] });

    expect(ran.code).toBe(1);
    expect(jsonOf(ran)).toMatchObject({ ok: false, ready: true, answers: false, next: { step: "login", command: `npx poplin login --server ${ADDRESS}` } });
    expect([ran.reached.length, ran.slept.length, new Set(ran.slept)]).toEqual([60, 59, new Set([5000])]);
    expect(plain.code).toBe(1);
    expect(ran.fetched).toEqual([]);
    expect(plain.out.slice(MADE.length + 1)).toEqual([
      `waiting for ${ADDRESS} to answer`,
      `no answer yet at ${ADDRESS}: it can take a few more minutes`,
      "poplin 0.1.0 is made, and its address does not answer yet.",
      `Your dashboard: ${ADDRESS}`,
      `Once it answers, log in: npx poplin login --server ${ADDRESS}`,
      "If it still does not: npx poplin doctor --repair",
      "The token was used for this run and is stored nowhere. You can delete it at Stand-In Host.",
    ]);
  });

  test("the wait asks again every 5 seconds until the install answers 401, and takes a redirect or a failure as no answer yet: without this a login page in front of a new name reads as the install", async () => {
    const ran = await runLine(`${RUN} --json`, emptyAccount(), { env: HELD, statuses: [302, 200, 522, 401] });

    expect(ran.code).toBe(0);
    expect(jsonOf(ran)).toMatchObject({ ok: true, answers: true });
    expect([ran.reached.length, ran.slept]).toEqual([4, [5000, 5000, 5000]]);
  });

  test("the wait ends once 5 minutes have gone by on the clock, however few questions fitted: without this slow answers stretch the wait to a quarter of an hour", async () => {
    const ran = await runLine(`${RUN} --json`, emptyAccount(), { env: HELD, statuses: [503], questionMs: 100_000 });

    expect(jsonOf(ran)).toMatchObject({ answers: false });
    expect(ran.reached.length).toBe(3);
  });

  test("a run that left something undone waits for nothing: without this a half-made install is asked for 5 minutes", async () => {
    const account = emptyAccount();
    account.installed = installedOf([{ object: "Program", state: "fail", detail: "status 500" }], { ready: false });
    const ran = await runLine(`${RUN} --json`, account, { env: HELD, statuses: [503] });

    expect(ran.code).toBe(1);
    expect(jsonOf(ran)).toMatchObject({ ready: false, answers: null });
    expect(ran.reached).toEqual([]);
  });

  test("a provider that could not start its work is exit 5: without this a script retries a failure that is no failure of the install", async () => {
    const account = emptyAccount();
    account.installed = { ok: false, why: "unreachable", words: "the project's website gave no answer. nothing was changed" };
    const ran = await runLine(`${RUN} --json`, account, { env: HELD });

    expect(ran.code).toBe(5);
    expect(jsonOf(ran)).toEqual({ ok: false, problem: "unreachable", next: AGAIN, words: "the project's website gave no answer. nothing was changed", run: "apply", ready: false });
  });

  test("--log-in logs this computer in at the dashboard's address, and a login that fails leaves the install done: without this the offer is words alone", async () => {
    const ran = await runLine(`${RUN} --log-in --no-wait --json`, emptyAccount(), { env: HELD });

    expect(ran.code).toBe(0);
    expect(ran.fetched).toEqual([`${ADDRESS}/api/logins`]);
    expect(jsonOf(ran)).toMatchObject({ ok: true, ready: true, login: { ok: false, problem: "unreachable" } });
    expect(ran.err.at(-1)).toBe(`To try again: npx poplin login --server ${ADDRESS}`);
  });
});

describe("a run that is blocked", () => {
  test("a release whose files are not the ones published is said in its own sentence, nothing names an address, and no login is offered: without this a run with no address prints the word undefined", async () => {
    const account = emptyAccount();
    const bad: Blocked = { what: "bad_release", words: "The files of poplin 0.1.0 are not the ones the project published. Nothing was uploaded.", address: "https://example.com/releases" };
    account.installed = { ...installedOf([{ object: "Program", state: "block", detail: "the release's files differ from their digests" }], { ready: false, blocked: [bad] }), address: undefined, release: undefined };

    const plain = await runLine(`${RUN} --log-in`, account, { env: HELD });
    const json = await runLine(`${RUN} --json`, account, { env: HELD });

    expect(plain.code).toBe(1);
    expect(plain.out.slice(1)).toEqual([
      "stopped   Program               the release's files differ from their digests",
      "The files of poplin 0.1.0 are not the ones the project published. Nothing was uploaded.",
      "  https://example.com/releases",
      "1 not done. Run this command again: it goes on from what stands.",
      "The token was used for this run and is stored nowhere. You can delete it at Stand-In Host.",
    ]);
    expect(plain.fetched).toEqual([]);
    expect(jsonOf(json)).toMatchObject({ ok: false, ready: false, address: null, release: null, blocked: [{ what: "bad_release" }] });
  });
});

describe("the token", () => {
  test("a question that quotes the token is asked without it: without this a provider's own words put the token into a prompt", async () => {
    const account = accountWith({ state: "choice", question: accountQuestion({ kind: "none" }, `Which account is ${TOKEN} for? 1) First  2) Second`) }, { state: "none", place: PLACE, notes: [] });
    const ran = await runLine("install stand-in --no-place --login you@example.com --dry-run", account, { asks: true, env: HELD, typed: ["1"] });

    expect(ran.asked).toEqual(["Which account is [token] for? 1) First  2) Second"]);
    expect(ran.code).toBe(0);
  });

  test("a failure that quotes the token is printed without it, as lines and as JSON: without this a provider's error puts the token on the screen", async () => {
    const account = emptyAccount();
    account.crash = new Error(`the host refused ${TOKEN}`);
    const plain = await runLine("install stand-in --no-place --login you@example.com --token-stdin", account, { stdin: TOKEN });
    const json = await runLine(`${RUN} --json`, account, { env: HELD });

    expect(plain.code).toBe(1);
    expect(plain.err).toEqual(["poplin install failed in a way it has no word for: Error: the host refused [token]. Run it again: it goes on from what stands."]);
    expect(jsonOf(json)).toMatchObject({ ok: false, problem: "crashed", words: expect.stringContaining("[token]") });
  });

  test("a row, a note, and a block that quote the token are printed without it: without this what a provider says of an object can leak the token", async () => {
    const account = accountWith({ state: "none", place: PLACE, notes: [{ ...LOGIN_OFF, words: `seen with ${TOKEN}` }] });
    account.installed = installedOf([{ object: "Program", state: "fail", detail: `refused ${TOKEN}` }], { ready: false, blocked: [{ ...LOGIN_OFF, address: `https://host.example.com/?t=${TOKEN}` }] });

    const plain = await runLine(RUN, account, { env: HELD });
    const json = await runLine(`${RUN} --json`, account, { env: HELD });

    expect(plain.out).toContain("failed    Program               refused [token]");
    expect(plain.err).toContain("seen with [token]");
    expect(JSON.stringify(jsonOf(json))).toContain("https://host.example.com/?t=[token]");
  });

  test("the place the provider found is handed back as it was and printed nowhere: without this the command would read what it must not", async () => {
    const account = emptyAccount();
    await runLine(`${RUN} --json --no-wait`, account, { env: HELD });

    expect(account.runs[0]?.found).toEqual({ state: "none", place: PLACE, notes: [] });
  });
});

describe("on a terminal", () => {
  test("with nothing typed but the command it takes the one provider, asks each answer in order, shows what the token needs, and offers the login: without this a person must know the options", async () => {
    const account = emptyAccount();
    const ran = await runLine("install", account, { asks: true, typed: ["example.com", "you@example.com", TOKEN, false] });

    expect(ran.code).toBe(0);
    expect(ran.asked).toEqual(["Your own place (example.com), or Enter for none:", "Your email, the first login:", "Account token (not shown): [secret]", "Log this computer in now? [Y/n]"]);
    expect(account.tokensFor).toEqual(["install"]);
    expect(ran.err).toEqual([
      "The account token needs 2 permissions, for this account and this place:",
      "  Places: Read, Programs: Edit",
      "Optional:",
      "  Rules: Edit: a guard rule",
      "This link opens the form with each one chosen that a link can choose:",
      "  https://host.example.com/tokens/new?rights=chosen",
      "The form asks which account the token is for.",
    ]);
    expect(account.runs[0]).toMatchObject({ where: { kind: "place", name: "example.com" }, login: "you@example.com" });
    expect(ran.out.at(-1)).toBe(`To log this computer in: npx poplin login --server ${ADDRESS}`);
  });

  test("an answer that is refused is said and asked again, and an answer that was given is not asked: without this one typing mistake ends the run", async () => {
    const account = emptyAccount();
    const ran = await runLine("install stand-in --login you@example.com", account, { asks: true, typed: ["UPPER", "", "tok_short", TOKEN, false] });

    expect(ran.code).toBe(0);
    expect(ran.asked).toEqual([
      "Your own place (example.com), or Enter for none:",
      "Your own place (example.com), or Enter for none:",
      "Account token (not shown): [secret]",
      "Account token (not shown): [secret]",
      "Log this computer in now? [Y/n]",
    ]);
    expect(ran.err).toContain('--place takes a name alone, such as example.com: "UPPER"');
    expect(ran.err).toContain("that is no account token of Stand-In Host");
    expect(ran.err.join("\n")).not.toContain("tok_short");
    expect(account.runs[0]?.where).toEqual({ kind: "none" });
  });

  test("a mistyped email is asked again: without this the first login could be one nobody can receive mail at", async () => {
    const ran = await runLine("install stand-in --no-place", emptyAccount(), { asks: true, env: HELD, typed: ["you", "you@example.com", false] });

    expect(ran.code).toBe(0);
    expect(ran.err).toEqual(["that is no email address, such as you@example.com"]);
  });

  test("a question the person ends stops the command before any look: without this Ctrl-C at a question would go on with half the answers", async () => {
    const account = emptyAccount();
    const ran = await runLine("install stand-in --no-place", account, { asks: true, env: HELD, typed: [undefined] });

    expect(ran).toMatchObject({ code: 1, err: ["stopped: nothing was changed"] });
    expect(account.finds).toEqual([]);
  });

  test("something left behind is asked about, and a no stops the run: without this a person is never asked before another install's records are used", async () => {
    const no = accountWith(LEFTOVER);
    const refused = await runLine("install stand-in --no-place --login you@example.com", no, { asks: true, env: HELD, typed: [false] });
    const yes = accountWith(LEFTOVER);
    const taken = await runLine("install stand-in --no-place --login you@example.com --no-log-in --no-wait", yes, { asks: true, env: HELD, typed: [true] });

    expect(refused.asked).toEqual(["Use it, with what it holds? [y/N]"]);
    expect(refused.code).toBe(1);
    expect(no.runs).toEqual([]);
    expect(taken.code).toBe(0);
    expect(yes.runs[0]?.found.state).toBe("adopted");
  });

  test("what is switched off is said before the run, and a no stops it; a dry run and a run that asks nothing go on: without this a half-made install is the only way to learn of it", async () => {
    const scene: Found<Where, Place> = { state: "none", place: PLACE, notes: [LOGIN_OFF] };
    const stopped = accountWith(scene);
    const asked = await runLine("install stand-in --no-place --login you@example.com", stopped, { asks: true, env: HELD, typed: [false] });
    const dry = await runLine("install stand-in --no-place --login you@example.com --dry-run", accountWith(scene), { asks: true, env: HELD });
    const quiet = accountWith(scene);
    const went = await runLine(`${RUN} --no-wait`, quiet, { env: HELD });

    expect(asked.asked).toEqual(["Go on all the same? No stops here, so that you can switch it on first. [y/N]"]);
    expect(asked.err).toEqual(["The login product is not switched on for this account", "  https://host.example.com/login", "stopped: nothing was changed"]);
    expect(asked.code).toBe(1);
    expect(stopped.runs).toEqual([]);
    expect(dry.asked).toEqual([]);
    expect(dry.code).toBe(0);
    expect(went.code).toBe(0);
    expect(quiet.runs.length).toBe(1);
  });

  test("a token that shows two accounts is asked which, and looked with again at the place chosen: without this an account is picked for the person", async () => {
    const account = accountWith({ state: "choice", question: accountQuestion({ kind: "none" }) }, { state: "none", place: PLACE, notes: [] });
    const ran = await runLine("install stand-in --no-place --login you@example.com --no-log-in --no-wait", account, { asks: true, env: HELD, typed: ["3", "2"] });

    expect(ran.code).toBe(0);
    expect(ran.asked).toEqual(["Which account? 1) First  2) Second", "Which account? 1) First  2) Second"]);
    expect(account.finds).toEqual([{ kind: "none" }, { kind: "none", account: "second" }]);
    expect(account.runs[0]?.where).toEqual({ kind: "none", account: "second" });
  });

  test("with two providers and none named it asks which: without this the first provider would be taken for the person", async () => {
    const account = emptyAccount();
    const providers = [standIn(emptyAccount(), "other-host"), standIn(account)] as Installer<unknown, unknown>[];
    const ran = await runLine("install --dry-run", account, { asks: true, env: { ...HELD, POPLIN_LOGIN: "you@example.com", POPLIN_PLACE: "none" }, typed: ["stand-in"], providers });

    expect(ran.asked).toEqual(["Where? other-host|stand-in"]);
    expect(ran.code).toBe(0);
    expect(account.runs.length).toBe(1);
  });
});

describe("no provider", () => {
  test("a build that carries none says so and exits 1, and the help still prints: without this the command fails with no word", async () => {
    const ran = await runLine(RUN, emptyAccount(), { env: HELD, providers: [] });
    const help = await runLine("install --help", emptyAccount(), { providers: [] });

    expect(ran).toMatchObject({ code: 1, err: ["this build of poplin carries no provider to install at", "install the published package: npx poplin install"] });
    expect(help.code).toBe(0);
    expect(help.out.join("\n")).toContain("none: this build of poplin carries no provider");
  });
});
