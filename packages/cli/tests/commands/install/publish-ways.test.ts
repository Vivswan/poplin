import { afterEach, describe, expect, test } from "bun:test";
import { join } from "node:path";

import type { Login } from "../../../../core/src/auth/logins";
import type { Found, Token } from "../../../../core/src/install/installer";
import { publishWays } from "../../../src/commands/install/publish-ways";
import { TOKEN_VARIABLE } from "../../../src/install/ask";
import { pasted } from "../../../src/local/invoked";
import { ADDRESS, type Account, emptyAccount, FRESH, installedOf, type Place, runLine, TOKEN, type Where } from "../../install/support/stand-in";
import { cleanUp, openBench, scratch } from "../support/harness";

/** The lines a finished install and a login end with, as a person at a terminal reads them. */
const ENDING = ["Next: give your agent poplin", "  npx skills add Vivswan/poplin", "Publish by hand: npx poplin <folder>"];

/** What the install below answers a login that is begun: the code to show, the secret to keep, and where an admin allows it. */
const BEGUN = { code: "WXKT-RDMP", secret: "kept-by-the-terminal", expires_in: 600, interval: 5, verify_url: `${ADDRESS}/tokens/review/8c2e5a7019bd46f3` };

/** The record of the token the install below hands out once the login is allowed. */
const RECORD = { id: "3f9a1c07b2d84e65", scope: "admin", note: "my-machine.local", created: 0, expires: Date.UTC(2026, 11, 15) };

/** What a login that worked says of that record. */
const LOGGED_IN = ["Logged in. The token is stored on this machine.", `install  ${ADDRESS}`, "role     admin", "token    3f9a1c07b2d84e65 (my-machine.local)", "expires  2026-12-15"];

/** The two JSON values of that login, as stdout holds them: where to allow it, then who the stored token is. */
const LOGIN_VALUES = [JSON.stringify({ verify_url: BEGUN.verify_url, code: BEGUN.code, expires_in: BEGUN.expires_in }), JSON.stringify({ server: ADDRESS, token: RECORD })];

/** The line of an install that says how to log in. */
const LOGIN_LINE = `Next: npx poplin login --server ${ADDRESS}`;

/** An install at the stand-in host that gives every answer but the login's. */
const INSTALL = "install stand-in --no-place --user you@example.com --no-wait";

/** The one JSON value of that install once it logged the machine in, as stdout holds it: each row the stand-in host settles, under the four keys a row is written with. */
const INSTALL_VALUE = JSON.stringify({
  ok: true,
  run: "apply",
  ready: true,
  found: { state: "none" },
  release: "0.1.0",
  address: ADDRESS,
  answers: null,
  token: { proof: "reads" },
  rows: FRESH.map((row) => ({ object: row.object, did: row.state, detail: row.detail, ...(row.right === undefined ? {} : { right: row.right }) })),
  blocked: [],
  steps: [],
  next: { step: "none", command: null },
  login: { ok: true },
});

/** What the made-up provider found with the token. */
const PLACE: Place = { token: TOKEN as Token };

/** A whole install, as a look finds it. */
const WHOLE: Found<Where, Place> = { state: "whole", place: PLACE, version: "0.1.0", address: ADDRESS, newest: "0.1.0" };

/** Records an earlier install left behind. */
const LEFTOVER: Found<Where, Place> = { state: "leftover", place: PLACE, notes: [], words: "Records named poplin are in this account, and no poplin runs.", address: "https://host.example.com/records" };

/** An account whose run keeps the users of its records, and does not use the email of the line. */
function keepsUsers(): Account {
  return { ...emptyAccount(), scenes: [LEFTOVER], installed: { ...installedOf(FRESH), unused: "you@example.com" as Login } };
}

/** An account whose run cannot make one piece. */
function failsAPiece(): Account {
  return { ...emptyAccount(), installed: installedOf([{ object: "Program", state: "fail", detail: "status 500" }], { ready: false }) };
}

/** An account that holds a whole install. */
function installed(): Account {
  return { ...emptyAccount(), scenes: [WHOLE] };
}

/** What an install answers a login its admin decides at once: the code to show, then the token with its record, or that it was denied. */
function loginAnswers(decided: "allowed" | "denied"): (request: Request) => Response | undefined {
  const answers: Readonly<Record<string, unknown>> = {
    "/api/logins": BEGUN,
    "/api/logins/token": decided === "allowed" ? { state: "allowed", token: "a-token-this-test-made-up", record: RECORD } : { state: "denied" },
  };

  return (request) => {
    const path = new URL(request.url).pathname;

    return Object.hasOwn(answers, path) ? Response.json(answers[path]) : undefined;
  };
}

/** The environment of an install whose token is in its variable, and whose login is stored in a folder of the test. */
function held(): Readonly<Record<string, string>> {
  return { [TOKEN_VARIABLE]: TOKEN, POPLIN_CONFIG_DIR: join(scratch(), "config") };
}

/** The lines of the ending a run showed, on either stream. */
function told(ran: { readonly out: readonly string[]; readonly err: readonly string[] }): string[] {
  return [...ran.out, ...ran.err].filter((line) => ENDING.includes(line));
}

/** Every line a login showed on stdout from the one that says it worked. */
function fromLoggedIn(out: readonly string[]): string[] {
  return out.slice(out.indexOf(LOGGED_IN[0] ?? ""));
}

afterEach(cleanUp);

describe("the ways to publish that a finished install and a login end with", () => {
  // Drift: a first install ended on the login's four facts, and no line named the skill the product is made for. The lines stand last, on stdout, after whichever line says what became of the login.
  test.each([
    ["logged the machine in", INSTALL, { typed: [true], answers: loginAnswers("allowed") }, [`out done: ${LOGGED_IN[0]}`, ...LOGGED_IN.slice(1).map((line) => `out plain: ${line}`)]],
    ["was answered no at the login's question", INSTALL, { typed: [false] }, [`out plain: ${LOGIN_LINE}`]],
    ["was run with --yes, and so logged no machine in", `${INSTALL} --yes`, {}, [`out plain: ${LOGIN_LINE}`]],
    ["could not log the machine in", INSTALL, { typed: [true] }, [`err plain: ${LOGIN_LINE}`]],
  ] as const)("a finished install that %s ends with them at a terminal, after what it says of the login", async (_how, line, options, login) => {
    const ran = await runLine(line, emptyAccount(), { ...options, asks: true, env: held() });

    expect([ran.code, ran.shown.slice(ran.shown.indexOf(login[0]))]).toEqual([0, [...login, ...ENDING.map((text) => `out plain: ${text}`)]]);
  });

  // Drift: an agent acts on every line it reads, and these are a person's. A run that made no install that works would name a step nothing is ready for.
  test.each([
    ["with nobody to ask", `${INSTALL} --yes`, emptyAccount, { asks: false }, 0],
    ["that is a dry run", "install stand-in --no-place --user you@example.com --dry-run", emptyAccount, {}, 0],
    ["that left a piece undone", INSTALL, failsAPiece, {}, 1],
    ["whose address does not answer", "install stand-in --no-place --user you@example.com", emptyAccount, { statuses: [503] }, 1],
    ["that kept a database's users, and ends with the repair that lets the person in", `${INSTALL} --adopt`, keepsUsers, {}, 0],
    ["that is a repair", "doctor --repair --no-place", installed, {}, 0],
    ["that is a removal", "uninstall stand-in --no-place", installed, { typed: [new URL(ADDRESS).host] }, 0],
  ] as const)("a run %s says nothing of them, at a terminal too", async (_how, line, account, options, code) => {
    const ran = await runLine(line, account(), { asks: true, ...options, env: held() });

    expect([ran.code, told(ran)]).toEqual([code, []]);
  });

  // Drift: an agent reads `next` from the one JSON value of an install, and where to allow a login from the first of a login's two. A key more, or a line beside a value, would change what every such program parses.
  test("with --json, stdout holds the same bytes at a terminal as where nobody can be asked: the one value of an install, and the two of a login", async () => {
    const bench = await openBench();
    bench.hook = loginAnswers("allowed");
    const install = (asks: boolean): ReturnType<typeof runLine> => runLine(`${INSTALL} --log-in --json`, emptyAccount(), { asks, env: held(), answers: loginAnswers("allowed") });
    const login = (asks: boolean): ReturnType<typeof bench.run> => bench.run(`login --server ${ADDRESS} --json`, { env: {}, terminal: { asks, progress: false } });
    const ran = [await install(true), await install(false), await login(true), await login(false)];

    expect(ran.map(({ code, out }) => [code, out])).toEqual([
      [0, [INSTALL_VALUE]],
      [0, [INSTALL_VALUE]],
      [0, LOGIN_VALUES],
      [0, LOGIN_VALUES],
    ]);
    expect(ran.flatMap(told)).toEqual([]);
  });

  // Drift: every later machine is logged in by `poplin login`, and an agent's own shell runs it too. The person is told the next step there, and the agent reads the four facts as before.
  test("a login ends with them at a terminal, and not where nobody can be asked, or once it was denied", async () => {
    const bench = await openBench();
    const login = async (decided: "allowed" | "denied", asks: boolean): ReturnType<typeof bench.run> => {
      bench.hook = loginAnswers(decided);

      return bench.run(`login --server ${ADDRESS}`, { env: {}, terminal: { asks, progress: false } });
    };
    const [person, agent, denied] = [await login("allowed", true), await login("allowed", false), await login("denied", true)];

    expect([person.code, person.err, fromLoggedIn(person.out)]).toEqual([0, [], [...LOGGED_IN, ...ENDING]]);
    expect([agent.code, agent.err, fromLoggedIn(agent.out)]).toEqual([0, [], LOGGED_IN]);
    expect([denied.code, told(denied)]).toEqual([1, []]);
  });

  // Drift: every line a person reads is rewritten so that a command of poplin starts as this process was started. A rewrite that reached into the skills tool's own line, or left `npx` where poplin is installed, would print a line that does not run.
  test("each line is worded as poplin was started, and the skills tool's own line stays as it is", () => {
    const lines = publishWays({ asks: true });

    expect(lines.map((line) => pasted(line, "npx poplin"))).toEqual(ENDING);
    expect(lines.map((line) => pasted(line, "poplin"))).toEqual([...ENDING.slice(0, 2), "Publish by hand: poplin <folder>"]);
  });
});
