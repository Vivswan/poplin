import { describe, expect, test } from "bun:test";

import type { Login } from "../../../../core/src/auth/logins";
import type { Blocked, Found, Installer, Row, Token } from "../../../../core/src/install/installer";
import { TOKEN_VARIABLE } from "../../../src/install/ask";
import { pasted } from "../../../src/local/invoked";
import { jsonOf } from "../../commands/support/harness";
import { ADDRESS, type Account, accountQuestion, emptyAccount, FORM, FRESH, installedOf, type Place, type Ran, repairedOf, runLine, standIn, TOKEN, type Where } from "../support/stand-in";

/** The environment of a run whose token is in its variable. */
const HELD = { [TOKEN_VARIABLE]: TOKEN };

/** A run that gives every answer and asks nothing. */
const RUN = "install stand-in --no-place --user you@example.com --yes";

/** What runs the command again at the place of `RUN`, as the one JSON value names it. */
const AGAIN = { step: "install", command: "npx poplin install stand-in --no-place" };

/** An object a repair is stopped at. */
const STOPPED_AT: Row = { object: "Program", state: "block", detail: "the token lacks Programs: Edit" };

/** The repair at the place of `RUN`, as the one JSON value names it for the next step. */
const REPAIR = { step: "repair", command: "npx poplin doctor --repair --no-place" };

/** What the made-up provider found with the token. */
const PLACE: Place = { token: TOKEN as Token };

/** The login product switched off: a note on a state a run goes on from. */
const LOGIN_OFF: Blocked = { what: "login_off", words: "The login product is not switched on for this account", address: "https://host.example.com/login" };

/** Records an earlier install left behind. */
const LEFTOVER: Found<Where, Place> = { state: "leftover", place: PLACE, notes: [], words: "Records named poplin are in this account, and no poplin runs.", address: "https://host.example.com/records" };

/** The rows of a run as it printed them, in the plain look. */
const MADE = [
  "created    Store                 poplin-sites",
  "created    Records               poplin",
  "created    Program               poplin, to run 0.1.0",
  "unchanged  Address               poplin.example.com",
  "skipped    Guard rule            needs Rules: Edit",
];

/** What a run says once of the piece it left out for an optional permission, before what makes the piece. */
const OPTIONAL = "1 optional row skipped: a guard rule. It needs a permission the account token lacks: add it";

/** That line of a run that made the install, which only the repair changes from then on: the repair at its place stands alone under it. */
const BY_REPAIR = [`${OPTIONAL}, then run:`, `  ${REPAIR.command}`];

function accountWith(...scenes: Found<Where, Place>[]): Account {
  return { ...emptyAccount(), scenes };
}

describe("a fresh install", () => {
  test("a run that asks nothing prints each row as it is made, then the dashboard and how to log in: without this the output an agent and a person read drifts", async () => {
    const account = emptyAccount();
    const ran = await runLine(RUN, account, { env: HELD });

    expect(ran).toMatchObject({ code: 0, err: [], asked: [] });
    expect(ran.out).toEqual([
      "This account has no install",
      ...MADE,
      ...BY_REPAIR,
      `Waiting for ${ADDRESS} to respond`,
      "poplin 0.1.0 is installed",
      `Dashboard: ${ADDRESS}`,
      "The account token was not stored",
      `Next: npx poplin login --server ${ADDRESS}`,
    ]);
    expect<unknown>(account.runs).toEqual([{ found: { state: "none", place: PLACE, notes: [] }, where: { kind: "none" }, login: "you@example.com", run: "apply" }]);
    expect([ran.reached, ran.slept]).toEqual([[`${ADDRESS}/api/whoami`], []]);
    expect(account.changes).toBe(3);
  });

  test("the token on standard input is its first line, and --no-wait asks the new install nothing: without this a piped token with a newline is refused", async () => {
    const account = emptyAccount();
    const ran = await runLine("install stand-in --place example.com --user you@example.com --token-stdin --no-wait", account, { stdin: `${TOKEN}\n` });

    expect(ran.code).toBe(0);
    expect(account.runs[0]).toMatchObject({ where: { kind: "place", name: "example.com" }, run: "apply" });
    expect(ran.out).not.toContain(`Waiting for ${ADDRESS} to respond`);
    expect(ran.reached).toEqual([]);
  });

  test("standard input that holds no token is refused before any look: without this a wrong pipe reaches the provider", async () => {
    const account = emptyAccount();
    const ran = await runLine("install stand-in --no-place --user you@example.com --token-stdin", account, { stdin: "oops\n" });

    expect(ran).toMatchObject({ code: 2, out: [], err: ["The first line of stdin is not a Stand-In Host account token"] });
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

  test("a dry run words each row as what a run would do, and counts what a run would create: without this a dry run reads as if it had made something", async () => {
    const ran = await runLine(`${RUN} --dry-run`, emptyAccount(), { env: HELD });

    expect(ran.code).toBe(0);
    expect(ran.out).toEqual([
      "This account has no install",
      "would create  Store                 poplin-sites",
      "would create  Records               poplin",
      "would create  Program               poplin, to run 0.1.0",
      "unchanged     Address               poplin.example.com",
      "would skip    Guard rule            needs Rules: Edit",
      "1 optional row would be skipped: a guard rule. It needs a permission the account token lacks: add it before the run",
      "A dry run does not test the account token's write permissions",
      "A run would create 3 resources and skip 1",
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
        { object: "Guard rule", did: "leave-out", detail: "needs Rules: Edit", right: "Rules: Edit" },
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
      "blocked       Program               the token lacks Programs: Edit",
      "The token lacks a permission. Add this one: Programs: Edit",
      "  https://host.example.com/tokens",
      "A run would be incomplete: 1 blocked",
    ]);
  });

  test("a run with no answer to give names each, as lines and as one value, exit 2: without this an agent learns of a missing answer by a hang", async () => {
    const account = emptyAccount();
    const ran = await runLine("install stand-in --yes --json", account);

    expect(ran.code).toBe(2);
    expect(jsonOf(ran)).toEqual({ ok: false, problem: "missing_answer", next: { step: "install", command: "npx poplin install stand-in" }, missing: ["where", "user", "token"] });
    expect(ran.err).toEqual([
      "Missing place",
      "Fix: pass --place <name> or --no-place, or set POPLIN_PLACE",
      "Missing first user",
      "Fix: pass --user <email> or set POPLIN_USER",
      "Missing account token",
      `Fix: pass --token-stdin or set ${TOKEN_VARIABLE}`,
    ]);
    expect(account.finds).toEqual([]);
  });

  test("a line written wrong is one value with its words, exit 2: without this an agent's typing mistake is prose alone", async () => {
    const ran = await runLine("install stand-in --place example.com --no-place --json", emptyAccount());

    expect(ran.code).toBe(2);
    expect(jsonOf(ran)).toEqual({ ok: false, problem: "usage", next: { step: "install", command: "npx poplin install stand-in" }, words: ["--place and --no-place are mutually exclusive"] });
  });

  test("the list of providers is one value: without this an agent cannot learn what it may install at", async () => {
    const ran = await runLine("install --json", emptyAccount());

    expect(ran.code).toBe(0);
    expect(jsonOf(ran)).toEqual({ ok: true, providers: [{ id: "stand-in", name: "Stand-In Host", about: "Installs on a place of your own or on the host's" }] });
  });
});

describe("what a look finds", () => {
  test("a whole install is said with its version and address and the commands that own it, with no repair where it needs none, and nothing runs: without this install would touch an install that is there", async () => {
    const account = accountWith({ state: "whole", place: PLACE, version: "0.1.0", address: ADDRESS, newest: "0.2.0" });
    const ran = await runLine(RUN, account, { env: HELD });

    expect(ran.code).toBe(1);
    expect(ran.out).toEqual([]);
    expect(ran.err).toEqual([
      `poplin 0.1.0 is already installed at ${ADDRESS} and needs no repair. Nothing changed.`,
      `Next: npx poplin login --server ${ADDRESS}`,
      "  check   npx poplin doctor",
      "  update  npx poplin update              (0.2.0 is available)",
      "  remove  npx poplin uninstall stand-in",
    ]);
    expect<unknown>([account.runs, account.changes, account.repairs.map((asked) => [asked.where, asked.mend])]).toEqual([[], 0, [[{ kind: "none" }, { run: "dry-run", update: false, addUser: undefined }]]]);
  });

  // Drift: the line once named the repair for every install that is there. A person whose install was whole was sent to mend it, when the way on was to log in.
  test.each([
    ["needs nothing mended", undefined, { mend: "nothing" }, " and needs no repair", [`Next: npx poplin login --server ${ADDRESS}`], { step: "login", command: `npx poplin login --server ${ADDRESS}` }],
    ["lacks an object a repair makes", repairedOf([{ object: "Guard rule", state: "make", detail: "bots" }]), { mend: "something" }, " and needs a repair", [`Next: ${REPAIR.command}`], REPAIR],
    ["has an object a repair is stopped at", repairedOf([STOPPED_AT], { ready: false }), { mend: "something" }, " and needs a repair", [`Next: ${REPAIR.command}`], REPAIR],
    [
      "answers at another place than the one named",
      { ok: false, why: "elsewhere", words: "The install here is at a place: give --place example.com." },
      { mend: "unread", unread: "The install here is at a place: give --place example.com." },
      "",
      // The place of the line is the wrong one, so the repair named holds none: the sentence names the option.
      ["The repair check failed: The install here is at a place: give --place example.com.", "Next: npx poplin doctor --repair --dry-run"],
      { step: "repair", command: "npx poplin doctor --repair" },
    ],
    [
      "holds records of another version",
      { ok: false, why: "another", words: "The install's records are of a newer poplin." },
      { mend: "unread", unread: "The install's records are of a newer poplin." },
      "",
      ["The repair check failed: The install's records are of a newer poplin.", "Next: npx poplin@latest doctor --repair --no-place --dry-run"],
      { step: "repair", command: "npx poplin@latest doctor --repair --no-place" },
    ],
  ] as const)("a whole install that %s is the problem already_installed with the way on that is true of it, in a run and in a dry run: without this an agent cannot tell it from a failure", async (_name, repaired, mend, state, way, next) => {
    const account = { ...accountWith({ state: "whole", place: PLACE, version: undefined, address: ADDRESS, newest: undefined }), repaired };
    const run = await runLine(`${RUN} --json`, account, { env: HELD });
    const dry = await runLine(`${RUN} --dry-run --json`, account, { env: HELD });

    expect([run.code, dry.code]).toEqual([1, 1]);
    expect(jsonOf(run)).toEqual({ ok: false, problem: "already_installed", next, found: { version: null, address: ADDRESS, newest: null, ...mend }, run: "apply", ready: false });
    expect(jsonOf(dry)).toMatchObject({ problem: "already_installed", next, run: "dry-run", ready: false });
    expect(run.err.slice(0, 1 + way.length)).toEqual([`poplin (unknown version) is already installed at ${ADDRESS}${state}. Nothing changed.`, ...way]);
  });

  test("something left behind stops a run that asks nothing, and names --adopt: without this a run would take another install's records silently", async () => {
    const account = accountWith(LEFTOVER);
    const run = await runLine(RUN, account, { env: HELD });
    const dry = await runLine(`${RUN} --dry-run --json`, account, { env: HELD });

    expect(run.code).toBe(1);
    expect(run.err).toEqual([
      "Records named poplin are in this account, and no poplin runs.",
      "To reuse them with their data, rerun with --adopt. For a fresh install, delete them here first:",
      "  https://host.example.com/records",
      "Nothing changed",
    ]);
    expect(dry.code).toBe(1);
    expect(jsonOf(dry)).toEqual({ ok: false, problem: "leftover", next: { ...AGAIN, command: `${AGAIN.command} --dry-run` }, words: LEFTOVER.words, address: LEFTOVER.address, run: "dry-run", ready: false });
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
    expect(ran.out.slice(0, 1)).toEqual(["This account has an incomplete install. A run resumes it."]);
    expect(account.runs[0]?.found.state).toBe("started");
  });

  // Drift: a run that goes on with a program that was there uploads nothing, so it names no release. A last line that still read as this run's own install would vouch for code nobody checked.
  test("a run that names no release ends by saying the program's code was not this run's: the last line and the JSON value both", async () => {
    const account = accountWith({ state: "started", place: PLACE, notes: [] });
    account.installed = { ...installedOf(FRESH), release: undefined };
    const ran = await runLine(`${RUN} --no-wait`, account, { env: HELD });
    const said = await runLine(`${RUN} --no-wait --json`, { ...account, runs: [] }, { env: HELD });

    expect([ran.code, ran.out.at(-4), jsonOf(said).release]).toEqual([0, "poplin is installed. Its code predates this run and was not checked against a release.", null]);
  });

  test.each([
    ["a held name", { state: "held", words: "A program named poplin is in this account and is not poplin's. Rename or delete it, then run this again.", address: "https://host.example.com/programs", after: "again" }, 1, "name_held"],
    ["a block", { state: "blocked", blocked: [{ what: "storage_off", words: "Storage is not switched on for this account", address: "https://host.example.com/storage" }] }, 1, "blocked"],
    ["a refused token", { state: "refused", why: "token", words: "the account token was refused" }, 1, "token_refused"],
    ["a place the token does not show", { state: "refused", why: "no_domain", words: "the account token shows no such place" }, 1, "no_domain"],
    ["an install that was started for another place", { state: "refused", why: "other_place", words: "an install was started here for another place", give: "--place example.com" }, 1, "other_place"],
    ["a provider that gives no answer", { state: "refused", why: "unreachable", words: "the host gave no answer" }, 5, "unreachable"],
  ] as const)("%s stops the command before any change, with its own exit and problem: without this the exit code tells a script the wrong thing", async (_name, scene, code, problem) => {
    const account = accountWith(scene);
    const ran = await runLine(`${RUN} --json`, account, { env: HELD });

    expect(ran.code).toBe(code);
    expect(jsonOf(ran)).toMatchObject({ ok: false, problem, run: "apply", ready: false });
    expect(ran.err.join("\n")).toContain("Nothing changed");
    expect(account.runs).toEqual([]);
  });

  test("a token that shows two accounts stops a run that asks nothing with the option that answers it, exit 2: without this an agent is asked a question", async () => {
    const account = accountWith({ state: "choice", question: accountQuestion({ kind: "none" }) });
    const ran = await runLine(`${RUN} --json`, account, { env: HELD });

    expect(ran.code).toBe(2);
    expect(jsonOf(ran)).toMatchObject({ ok: false, problem: "missing_answer", missing: ["account"] });
    expect(ran.err).toEqual(["Missing account", "Fix: pass --account <id> or set POPLIN_ACCOUNT"]);
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
      "blocked    Login                 the login product is not switched on",
      "failed     Keys                  status 500",
      "skipped    Jobs                  needs the keys",
      `${OPTIONAL} before the next step`,
      "The login product is not switched on for this account",
      "  https://host.example.com/login",
      "Do these steps in a browser, then rerun this command:",
      "  Switch on the login product and choose a team name",
      "  https://host.example.com/login",
      "The run is incomplete: 1 blocked, 1 failed, and 1 skipped",
      "Next: rerun this command",
      "The account token was not stored",
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

      return [String(ran.code), ...ran.out.filter((line) => line.includes("in a browser") || line.startsWith("Next: "))];
    };

    expect(await lastLines(whole)).toEqual(["1", `Do these steps in a browser, then run ${REPAIR.command}:`, `Next: run ${REPAIR.command}`]);
    expect(await lastLines({ state: "started", place: PLACE, notes: [] })).toEqual(["1", "Do these steps in a browser, then rerun this command:", "Next: rerun this command"]);
  });

  test("an install that does not answer in 5 minutes exits 1, is said to be installed at a URL that does not respond yet, and offers no login: without this a person is told of an install at an address that shows nothing", async () => {
    const ran = await runLine(`${RUN} --log-in --json`, emptyAccount(), { env: HELD, statuses: [503] });
    const plain = await runLine(RUN, emptyAccount(), { env: HELD, statuses: [503] });

    expect(ran.code).toBe(1);
    expect(jsonOf(ran)).toMatchObject({ ok: false, ready: true, answers: false, next: { step: "login", command: `npx poplin login --server ${ADDRESS}` } });
    expect([ran.reached.length, ran.slept.length, new Set(ran.slept)]).toEqual([60, 59, new Set([5000])]);
    expect(plain.code).toBe(1);
    expect(ran.fetched).toEqual([]);
    expect(plain.out.slice(MADE.length + 1)).toEqual([
      ...BY_REPAIR,
      `Waiting for ${ADDRESS} to respond`,
      `${ADDRESS} has not responded yet. This can take a few more minutes.`,
      "poplin 0.1.0 is installed, but its URL does not respond yet",
      `Dashboard: ${ADDRESS}`,
      `When it responds, log in: npx poplin login --server ${ADDRESS}`,
      `If it does not respond: ${REPAIR.command}`,
      "The account token was not stored",
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
    account.installed = { ok: false, why: "unreachable", words: "the project's website gave no answer. Nothing changed." };
    const ran = await runLine(`${RUN} --json`, account, { env: HELD });

    expect(ran.code).toBe(5);
    expect(jsonOf(ran)).toEqual({ ok: false, problem: "unreachable", next: AGAIN, words: "the project's website gave no answer. Nothing changed.", run: "apply", ready: false });
  });

  test("--log-in logs this computer in at the dashboard's address, and a login that fails leaves the install done: without this the offer is words alone", async () => {
    const ran = await runLine(`${RUN} --log-in --no-wait --json`, emptyAccount(), { env: HELD });

    expect(ran.code).toBe(0);
    expect(ran.fetched).toEqual([`${ADDRESS}/api/logins`]);
    expect(jsonOf(ran)).toMatchObject({ ok: true, ready: true, login: { ok: false, problem: "unreachable" } });
    expect(ran.err.at(-1)).toBe(`Next: npx poplin login --server ${ADDRESS}`);
  });
});

// Drift: the repair named next once held no place. Run as written where nothing can be asked, it stopped with exit 2 for the answer of where, which the install had just been given. Both kinds of install are held to it.
describe.each([
  ["at no place", "--no-place"],
  ["at a place", "--place example.com"],
])("a first login the run did not use, in an install %s", (_kind, place) => {
  const login = "new@example.com" as Login;
  const line = `install stand-in ${place} --user new@example.com --adopt`;
  const unusedAt = (): Account => ({ ...accountWith(LEFTOVER), installed: { ...installedOf(FRESH), unused: login } });

  // Drift: the install kept the users its records hold, and the email of the line is none of them. An ending that offers the login asks a person in who gets no code, and a `next` of `login` sends a program the same way.
  test("ends with the repair that lets that person in, as its last line and as the next step, and offers no login: without this a person is asked to log in who gets no code", async () => {
    const letIn = `npx poplin doctor --repair ${place} --add-user new@example.com`;
    const plain = await runLine(`${line} --no-wait`, unusedAt(), { env: HELD, asks: true });
    const told = await runLine(`${line} --yes --log-in --no-wait`, unusedAt(), { env: HELD });
    const json = await runLine(`${line} --yes --no-wait --json`, unusedAt(), { env: HELD });
    const silent = await runLine(`${line} --yes`, unusedAt(), { env: HELD, statuses: [503] });

    expect([plain.code, plain.asked, plain.out.slice(-4)]).toEqual([
      0,
      [],
      ["poplin 0.1.0 is installed", `Dashboard: ${ADDRESS}`, "The account token was not stored", `Add new@example.com as a user: ${letIn}`],
    ]);
    expect([told.code, told.fetched, told.out.at(-1)]).toEqual([0, [], plain.out.at(-1)]);
    expect([json.code, jsonOf(json)]).toMatchObject([0, { ok: true, ready: true, next: { step: "repair", command: letIn } }]);
    expect("login" in jsonOf(json)).toBe(false);
    // An install whose address gives no answer yet names the same line, and no login the person could not finish.
    expect<unknown>([silent.code, silent.out.filter((text) => text.includes("log in") || text.includes("as a user"))]).toEqual([1, [plain.out.at(-1)]]);
  });

  // Drift: the repair that finishes such an install mends the login to the users it kept. Named without the email, it leaves the person of the line out for good, and no later line says how to let them in.
  test("that left a piece undone names the repair that also lets that person in, once the install is found whole", async () => {
    const whole: Found<Where, Place> = { state: "whole", place: PLACE, version: "0.1.0", address: ADDRESS, newest: "0.1.0" };
    const undone: Row[] = [{ object: "Login", state: "block", detail: "the login product is not switched on" }];
    const account: Account = { ...accountWith(LEFTOVER, whole), installed: { ...installedOf([...FRESH, ...undone], { ready: false }), unused: login } };
    const ran = await runLine(`${line} --yes --no-wait`, account, { env: HELD });
    const json = await runLine(`${line} --yes --no-wait --json`, { ...account, scenes: [LEFTOVER, whole] }, { env: HELD });

    expect([ran.code, ran.out.at(-2)]).toEqual([1, `Next: run npx poplin doctor --repair ${place} --add-user new@example.com`]);
    expect(jsonOf(json)).toMatchObject({ ok: false, ready: false, next: { step: "repair", command: `npx poplin doctor --repair ${place} --add-user new@example.com` } });
  });

  // Drift: the place and the user are written into a line the terminal starts as poplin was started; a rule that stops at the first option would cut them off, and one that reached the JSON value would hand a program two values.
  test("is shown started as poplin was started with its place and its user whole, and the JSON value keeps the line as it is written", async () => {
    const options = `doctor --repair ${place} --add-user new@example.com`;
    const ran = await runLine(`${line} --yes --no-wait`, unusedAt(), { env: HELD });
    const json = await runLine(`${line} --yes --no-wait --json`, unusedAt(), { env: HELD });
    const last = ran.out.at(-1) ?? "";

    expect([pasted(last, "poplin"), pasted(last, "npx poplin")]).toEqual([`Add new@example.com as a user: poplin ${options}`, `Add new@example.com as a user: npx poplin ${options}`]);
    expect(jsonOf(json).next).toEqual({ step: "repair", command: `npx poplin ${options}` });
  });

  // Drift: a dry run of such an install is followed by the run, and a next step with no place stops that run for the answer of where, with nobody there to give it.
  test("names the run at the same place after its dry run, and says nothing of the repair: without this the run an agent starts from `next` asks where", async () => {
    const dry = await runLine(`${line} --dry-run --json`, unusedAt(), { env: HELD });

    expect([dry.code, jsonOf(dry).next, dry.err.filter((text) => text.includes("--add-user"))]).toEqual([0, { step: "install", command: `npx poplin install stand-in ${place}` }, []]);
  });

  // Drift: the line names the repair, and the repair is what must take it. A place written as the install's line takes it and the repair's does not would be read as a refusal.
  test("the line it names runs as it is written, where nothing can be asked, and adds that person at the same place", async () => {
    const json = await runLine(`${line} --yes --no-wait --json`, unusedAt(), { env: HELD });
    const { command } = jsonOf(json).next as { readonly command: string };
    const account = accountWith({ state: "whole", place: PLACE, version: "0.1.0", address: ADDRESS, newest: "0.1.0" });
    const repair = await runLine(command.replace("npx poplin ", ""), account, { env: HELD });
    const where = place === "--no-place" ? { kind: "none" } : { kind: "place", name: "example.com" };

    expect<unknown>([repair.code, account.finds, account.repairs.map((asked) => [asked.where, asked.mend])]).toEqual([0, [where], [[where, { run: "apply", update: false, addUser: login }]]]);
  });

  // Drift: the line is one a person pastes into a shell. An email with an apostrophe or a dollar sign, pasted bare, opens a quote that never closes or names a variable, and the repair adds nobody or somebody else.
  test.each([
    ["o'brien@example.com", "'o'\\''brien@example.com'"],
    ["pay$roll&co@example.com", "'pay$roll&co@example.com'"],
    ["first.last+tag@example.com", "first.last+tag@example.com"],
    // zsh reads a bare word that starts with an equals sign as a command to look up, and the paste does nothing.
    ["=ls@example.com", "'=ls@example.com'"],
  ])("the line that lets %s in too writes the email as one word of a POSIX shell: %s", async (email, word) => {
    const account: Account = { ...accountWith(LEFTOVER), installed: { ...installedOf(FRESH), unused: email as Login } };
    const json = await runLine(`${line} --yes --no-wait --json`, account, { env: HELD, platform: "linux" });

    expect((jsonOf(json).next as { readonly command: string }).command).toBe(`npx poplin doctor --repair ${place} --add-user ${word}`);
  });

  // Drift: on Windows the line is read by cmd.exe or by PowerShell, and `npx` runs through a command file that reads its words by cmd.exe's rules once more, with the quotes gone.
  // Single quotes mean nothing to cmd.exe, so `'a&calc@example.com'` pasted there runs `calc@example.com'` as a second command. No quoting holds in both shells, so such an email is left out of the line.
  test.each([
    ["cmd.exe and the command file end a command at", "a&calc@example.com", "'a&calc@example.com'"],
    ["cmd.exe pipes at", "a|more@example.com", "'a|more@example.com'"],
    ["cmd.exe escapes with", "a^b@example.com", "'a^b@example.com'"],
    ["cmd.exe reads a variable between two of", "%PATH%@example.com", "%PATH%@example.com"],
    ["both shells open a quote at", 'a"b@example.com', "'a\"b@example.com'"],
    ["PowerShell opens a quote at", "o'brien@example.com", "'o'\\''brien@example.com'"],
    ["PowerShell escapes with", "a`b@example.com", "'a`b@example.com'"],
    ["PowerShell reads a variable at", "pay$roll@example.com", "'pay$roll@example.com'"],
    ["both shells end a word at", "a b@example.com", "'a b@example.com'"],
    ["PowerShell splits a list at", "a,b@example.com", "a,b@example.com"],
  ])("an email with the character %s (%s) is one quoted word on POSIX, and on Windows is left out of the line, which says to add it", async (_reads, email, word) => {
    const account = (): Account => ({ ...accountWith(LEFTOVER), installed: { ...installedOf(FRESH), unused: email as Login } });
    const posix = await runLine(`${line} --yes --no-wait --json`, account(), { env: HELD, platform: "linux" });
    const windows = await runLine(`${line} --yes --no-wait --json`, account(), { env: HELD, platform: "win32" });
    const said = await runLine(`${line} --yes --no-wait`, account(), { env: HELD, platform: "win32" });
    const bare = `npx poplin doctor --repair ${place}`;

    expect([jsonOf(posix).next, jsonOf(windows).next]).toEqual([
      { step: "repair", command: `${bare} --add-user ${word}` },
      { step: "repair", command: bare, add: "--add-user <email>" },
    ]);
    expect(said.out.slice(-2)).toEqual([`Add ${email} as a user: ${bare}`, `Append --add-user <email> to that command yourself, with ${email}: poplin cannot quote this email safely for a Windows shell`]);
  });

  // Drift: a run that left a piece undone ends by naming the same repair. With the email left out of it and no word of that, the line a person pastes mends the install and lets nobody in.
  test("on Windows, a run that left a piece undone names the repair without such an email, and says to add it", async () => {
    const email = "a&calc@example.com";
    const undone: Account = { ...accountWith(LEFTOVER), scenes: [LEFTOVER, { state: "whole", place: PLACE, version: "0.1.0", address: ADDRESS, newest: "0.1.0" }], installed: { ...installedOf(FRESH), ready: false, unused: email as Login } };
    const said = await runLine(`${line} --yes --no-wait`, undone, { env: HELD, platform: "win32" });

    expect([said.code, said.out.at(-1)]).toEqual([1, `Append --add-user <email> to that command yourself, with ${email}: poplin cannot quote this email safely for a Windows shell`]);
    expect(said.out.filter((text) => text.includes("--add-user a")).length).toBe(0);
  });

  // Drift: an email of plain characters is safe bare in every shell. Left out on Windows too, the line a person pastes there would add nobody, on the one platform where they cannot fix the quoting themselves.
  test("an email of letters, digits, and `.`, `+`, `_`, `-` is written bare on Windows, as on POSIX", async () => {
    const account: Account = { ...accountWith(LEFTOVER), installed: { ...installedOf(FRESH), unused: "first.last+tag_1-x@example.com" as Login } };
    const windows = await runLine(`${line} --yes --no-wait --json`, account, { env: HELD, platform: "win32" });

    expect(jsonOf(windows).next).toEqual({ step: "repair", command: `npx poplin doctor --repair ${place} --add-user first.last+tag_1-x@example.com` });
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
      "blocked    Program               the release's files differ from their digests",
      "The files of poplin 0.1.0 are not the ones the project published. Nothing was uploaded.",
      "  https://example.com/releases",
      "The run is incomplete: 1 blocked",
      "Next: rerun this command",
      "The account token was not stored",
    ]);
    expect(plain.fetched).toEqual([]);
    expect(jsonOf(json)).toMatchObject({ ok: false, ready: false, address: null, release: null, blocked: [{ what: "bad_release" }] });
  });

  // Drift: a run that is blocked before its first row has started nothing, so a count of what is undone beside exit 1 and `Next: rerun this command` say what is not so, of a website that names no release as of an account with no address.
  test("before its first row says that nothing changed and when to rerun, and counts nothing: without this a run that started nothing ends with a count of what is undone", async () => {
    const account = emptyAccount();
    const none: Blocked = { what: "no_release", words: "The project's website names no release now. Run this again in a few minutes.", address: "https://example.com" };
    account.installed = { ...installedOf([], { ready: false, blocked: [none] }), address: undefined, release: undefined };

    const plain = await runLine(RUN, account, { env: HELD });
    const json = await runLine(`${RUN} --json`, account, { env: HELD });

    expect([plain.code, plain.out.slice(1)]).toEqual([
      1,
      [
        "The project's website names no release now. Run this again in a few minutes.",
        "  https://example.com",
        "Nothing changed. Fix the above, then rerun this command.",
        "The account token was not stored",
      ],
    ]);
    expect(jsonOf(json)).toMatchObject({ ok: false, ready: false, rows: [], blocked: [{ what: "no_release" }], next: AGAIN });
  });
});

describe("the token", () => {
  test("a question that quotes the token is asked without it: without this a provider's own words put the token into a prompt", async () => {
    const account = accountWith({ state: "choice", question: accountQuestion({ kind: "none" }, `Which account is ${TOKEN} for? 1) First  2) Second`) }, { state: "none", place: PLACE, notes: [] });
    const ran = await runLine("install stand-in --no-place --user you@example.com --dry-run", account, { asks: true, env: HELD, typed: ["1"] });

    expect(ran.asked).toEqual(["Which account is [token] for? 1) First  2) Second"]);
    expect(ran.code).toBe(0);
  });

  test("a failure that quotes the token is printed without it, as lines and as JSON: without this a provider's error puts the token on the screen", async () => {
    const account = emptyAccount();
    account.crash = new Error(`the host refused ${TOKEN}`);
    const plain = await runLine("install stand-in --no-place --user you@example.com --token-stdin", account, { stdin: TOKEN });
    const json = await runLine(`${RUN} --json`, account, { env: HELD });

    expect(plain.code).toBe(1);
    expect(plain.err).toEqual(["Unexpected error: Error: the host refused [token]", "Rerun to resume"]);
    expect(jsonOf(json)).toMatchObject({ ok: false, problem: "crashed", words: expect.stringContaining("[token]") });
  });

  test("a row, a note, and a block that quote the token are printed without it: without this what a provider says of an object can leak the token", async () => {
    const account = accountWith({ state: "none", place: PLACE, notes: [{ ...LOGIN_OFF, words: `seen with ${TOKEN}` }] });
    account.installed = installedOf([{ object: "Program", state: "fail", detail: `refused ${TOKEN}` }], { ready: false, blocked: [{ ...LOGIN_OFF, address: `https://host.example.com/?t=${TOKEN}` }] });

    const plain = await runLine(RUN, account, { env: HELD });
    const json = await runLine(`${RUN} --json`, account, { env: HELD });

    expect(plain.out).toContain("failed     Program               refused [token]");
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
  /** The rows of what to do on the made-up provider's form at a place, as the token step shows them. */
  const STEPS = [
    "block: On the form",
    "  row: 1. Tick: Places > Read",
    "  row: 2. Place: example.com",
    "  row: 3. Account: yours",
    "  row: 4. Press Review. It should read:",
    "  row:    example.com",
    "  faint:      Places: Read",
    "  row:    Whole account",
    "  faint:      Programs: Edit",
    "  row: 5. Press Make > copy the token",
    "  row: ",
    "  row: --all-permissions adds a guard rule",
  ];

  /** What a run at a place shows between the question of the first user and the hidden one, with what the person answers the offer of the browser. */
  async function tokenStep(line: string, answer: boolean | undefined, options: { readonly links?: boolean; readonly opens?: boolean } = {}): Promise<{ readonly step: string[]; readonly ran: Ran; readonly account: Account }> {
    const account = emptyAccount();
    const ran = await runLine(`${line} --place example.com --user you@example.com --dry-run`, account, { ...options, asks: true, typed: answer === undefined ? [undefined] : [answer, TOKEN] });
    const end = ran.shown.indexOf("ask: Account token (hidden): [secret]");

    return { step: ran.shown.slice(0, end === -1 ? ran.shown.length : end), ran, account };
  }

  test("with nothing typed but the command it takes the one provider, asks each answer in order, shows the way to the token, and offers the login: without this a person must know the options", async () => {
    const account = emptyAccount();
    const ran = await runLine("install", account, { asks: true, typed: ["example.com", "you@example.com", true, TOKEN, false] });

    expect(ran.code).toBe(0);
    expect(ran.asked).toEqual(["Your own place (example.com), or Enter for none:", "First user's email:", "Open the form in your browser? [Y/n]", "Account token (hidden): [secret]", "Log this machine in now? [Y/n]"]);
    expect([account.tokensFor, ran.opened]).toEqual([["install"], [FORM]]);
    expect(account.runs[0]).toMatchObject({ where: { kind: "place", name: "example.com" }, login: "you@example.com" });
    expect(ran.out).toContain(`Next: npx poplin login --server ${ADDRESS}`);
  });

  // Drift: the step was a wall of text: every permission a line, then the form's address whole, then what to do on the form as two flat lines under it.
  test("the token step follows the order a person meets it: what the form opens with and one short link, the offer of the browser, then the numbered steps with the summary to compare under its step", async () => {
    const { step, ran } = await tokenStep("install stand-in", true, { links: true });

    expect(step).toEqual(["block: Account token", "  row: Stand-In Host's token form opens with 1 of 2 permissions chosen.", `link: Open the token form -> ${FORM}`, "ask: Open the form in your browser? [Y/n]", ...STEPS]);
    // The browser opened and the terminal made the link, so the address is nowhere shown whole.
    expect([ran.opened, ran.shown.filter((shown) => shown.includes(FORM))]).toEqual([[FORM], [`link: Open the token form -> ${FORM}`]]);
  });

  // Drift: a short link the terminal does not honour, or a browser that never came up, would leave a person with no way to the form.
  test.each([
    ["on a terminal that makes no link", {}, true, []],
    ["after a person who declines the browser", { links: true }, false, []],
    ["after a browser that did not start", { links: true, opens: false }, true, ["err warning: The browser did not open"]],
  ])("%s the form's address is shown whole, once, on a line of its own, before the steps", async (_name, options, answer, warned) => {
    const { step, ran } = await tokenStep("install stand-in", answer, options);
    const after = step.slice(step.indexOf("ask: Open the form in your browser? [Y/n]") + 1);

    expect(after).toEqual([...warned, "block: The form's address", `err plain: ${FORM}`, ...STEPS]);
    expect([ran.opened, ran.shown.filter((shown) => shown === `err plain: ${FORM}`)]).toEqual([answer ? [FORM] : [], [`err plain: ${FORM}`]]);
  });

  // Drift: an option that is read and changes nothing a person sees would leave the optional permissions as hard to find as before.
  test("with --all-permissions the form is asked for with every permission: each optional one is a step and a line of its group, marked, and no line names the option again", async () => {
    const { step, account } = await tokenStep("install stand-in --all-permissions", true, { links: true });

    expect(account.tokensFor).toEqual(["install, every right"]);
    expect(step.slice(1, 2)).toEqual(["  row: Stand-In Host's token form opens with 1 of 3 permissions chosen."]);
    expect(step.slice(4)).toEqual([
      "block: On the form",
      "  row: 1. Tick: Places > Read",
      "  row: 2. Tick: Rules > Edit",
      "  row: 3. Place: example.com",
      "  row: 4. Account: yours",
      "  row: 5. Press Review. It should read:",
      "  row:    example.com",
      "  faint:      Places: Read",
      "  faint:      Rules: Edit (optional)",
      "  row:    Whole account",
      "  faint:      Programs: Edit",
      "  row: 6. Press Make > copy the token",
    ]);
  });

  test("a person who ends the offer of the browser stops the command before any look, and no browser is opened: without this Ctrl-C at the new question would go on to ask for the token", async () => {
    const { ran, account } = await tokenStep("install stand-in", undefined);

    expect([ran.code, ran.asked, ran.err.at(-1), account.finds, ran.opened]).toEqual([1, ["Open the form in your browser? [Y/n]"], "Cancelled. Nothing changed.", [], []]);
  });

  // Drift: a browser takes a moment to start, and a command stopped in that moment went on to list the steps and ask for the token.
  test("a person who stops the command while the browser starts is shown nothing more of the step and asked nothing more, and no look follows", async () => {
    const account = emptyAccount();
    const ran = await runLine("install stand-in --place example.com --user you@example.com --dry-run", account, { asks: true, stopsAtBrowser: true, typed: [true] });
    const after = ran.shown.slice(ran.shown.indexOf("ask: Open the form in your browser? [Y/n]") + 1);

    expect([ran.code, after, ran.opened, account.finds]).toEqual([1, ["err error: Cancelled. Nothing changed."], [FORM], []]);
  });

  // Drift: a token that is given needs no form, and a question about one would stop a script that has nobody to answer it.
  test.each([
    ["the token is in its variable", "install stand-in --place example.com --user you@example.com --dry-run", { asks: true, env: HELD }],
    ["the token is piped", "install stand-in --place example.com --user you@example.com --dry-run --token-stdin", { asks: true, stdin: `${TOKEN}\n` }],
  ])("where %s nothing of the token step is shown, no question is put, and no browser is opened", async (_name, line, options) => {
    const account = emptyAccount();
    const ran = await runLine(line, account, options);

    expect([ran.code, ran.asked, ran.err, ran.opened, account.tokensFor]).toEqual([0, [], [], [], []]);
  });

  test("an answer that is refused is said and asked again, and an answer that was given is not asked: without this one typing mistake ends the run", async () => {
    const account = emptyAccount();
    const ran = await runLine("install stand-in --user you@example.com", account, { asks: true, typed: ["UPPER", "", true, "tok_short", TOKEN, false] });

    expect(ran.code).toBe(0);
    expect(ran.asked).toEqual([
      "Your own place (example.com), or Enter for none:",
      "Your own place (example.com), or Enter for none:",
      "Open the form in your browser? [Y/n]",
      "Account token (hidden): [secret]",
      "Account token (hidden): [secret]",
      "Log this machine in now? [Y/n]",
    ]);
    expect(ran.err).toContain('--place takes a name alone, such as example.com: "UPPER"');
    expect(ran.err).toContain("The input is not a Stand-In Host account token");
    expect(ran.err.join("\n")).not.toContain("tok_short");
    expect(account.runs[0]?.where).toEqual({ kind: "none" });
  });

  test("a mistyped email is asked again: without this the first login could be one nobody can receive mail at", async () => {
    const ran = await runLine("install stand-in --no-place", emptyAccount(), { asks: true, env: HELD, typed: ["you", "you@example.com", false] });

    expect(ran.code).toBe(0);
    expect(ran.err).toEqual(["The input is not an email address"]);
  });

  test("a question the person ends stops the command before any look: without this Ctrl-C at a question would go on with half the answers", async () => {
    const account = emptyAccount();
    const ran = await runLine("install stand-in --no-place", account, { asks: true, env: HELD, typed: [undefined] });

    expect(ran).toMatchObject({ code: 1, err: ["Cancelled. Nothing changed."] });
    expect(account.finds).toEqual([]);
  });

  test("something left behind is asked about, and a no stops the run: without this a person is never asked before another install's records are used", async () => {
    const no = accountWith(LEFTOVER);
    const refused = await runLine("install stand-in --no-place --user you@example.com", no, { asks: true, env: HELD, typed: [false] });
    const yes = accountWith(LEFTOVER);
    const taken = await runLine("install stand-in --no-place --user you@example.com --no-log-in --no-wait", yes, { asks: true, env: HELD, typed: [true] });

    expect(refused.asked).toEqual(["Reuse these resources and their data? [y/N]"]);
    expect(refused.code).toBe(1);
    expect(no.runs).toEqual([]);
    expect(taken.code).toBe(0);
    expect(yes.runs[0]?.found.state).toBe("adopted");
  });

  test("what is switched off is said before the run, and a no stops it; a dry run and a run that asks nothing go on: without this a half-made install is the only way to learn of it", async () => {
    const scene: Found<Where, Place> = { state: "none", place: PLACE, notes: [LOGIN_OFF] };
    const stopped = accountWith(scene);
    const asked = await runLine("install stand-in --no-place --user you@example.com", stopped, { asks: true, env: HELD, typed: [false] });
    const dry = await runLine("install stand-in --no-place --user you@example.com --dry-run", accountWith(scene), { asks: true, env: HELD });
    const quiet = accountWith(scene);
    const went = await runLine(`${RUN} --no-wait`, quiet, { env: HELD });

    expect(asked.asked).toEqual(["Continue anyway? [y/N]"]);
    expect(asked.err).toEqual(["The login product is not switched on for this account", "  https://host.example.com/login", "Cancelled. Nothing changed."]);
    expect(asked.code).toBe(1);
    expect(stopped.runs).toEqual([]);
    expect(dry.asked).toEqual([]);
    expect(dry.code).toBe(0);
    expect(went.code).toBe(0);
    expect(quiet.runs.length).toBe(1);
  });

  test("a token that shows two accounts is asked which, and looked with again at the place chosen: without this an account is picked for the person", async () => {
    const account = accountWith({ state: "choice", question: accountQuestion({ kind: "none" }) }, { state: "none", place: PLACE, notes: [] });
    const ran = await runLine("install stand-in --no-place --user you@example.com --no-log-in --no-wait", account, { asks: true, env: HELD, typed: ["3", "2"] });

    expect(ran.code).toBe(0);
    expect(ran.asked).toEqual(["Which account? 1) First  2) Second", "Which account? 1) First  2) Second"]);
    expect([account.finds, account.looks]).toEqual([[{ kind: "none" }, { kind: "none", account: "second" }], ["install", "install"]]);
    expect(account.runs[0]?.where).toEqual({ kind: "none", account: "second" });
  });

  test("with two providers and none named it asks which: without this the first provider would be taken for the person", async () => {
    const account = emptyAccount();
    const providers = [standIn(emptyAccount(), "other-host"), standIn(account)] as Installer<unknown, unknown>[];
    const ran = await runLine("install --dry-run", account, { asks: true, env: { ...HELD, POPLIN_USER: "you@example.com", POPLIN_PLACE: "none" }, typed: ["stand-in"], providers });

    expect(ran.asked).toEqual(["Provider: other-host|stand-in"]);
    expect(ran.code).toBe(0);
    expect(account.runs.length).toBe(1);
  });
});

describe("no provider", () => {
  test("a build that carries none says so and exits 1, and the help still prints: without this the command fails with no word", async () => {
    const ran = await runLine(RUN, emptyAccount(), { env: HELD, providers: [] });
    const help = await runLine("install --help", emptyAccount(), { providers: [] });

    expect(ran).toMatchObject({ code: 1, err: ["This build of poplin includes no provider", "Fix: use the published package: npx poplin install"] });
    expect(help.code).toBe(0);
    expect(help.out.join("\n")).toContain("none: this build of poplin includes no provider");
  });
});
