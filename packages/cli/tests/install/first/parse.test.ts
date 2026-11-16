import { describe, expect, test } from "bun:test";

import type { Installer } from "../../../../core/src/install/installer";
import { TOKEN_VARIABLE } from "../../../src/install/ask";
import { parseInstall } from "../../../src/install/first/parse";
import type { ParsedInstall, Plan } from "../../../src/install/records";
import { words } from "../../commands/support/command-line";
import { emptyAccount, standIn, TOKEN } from "../support/stand-in";

/** Two made-up providers: the second declares an option the first has not, so an option of one can be given to the other. */
const PROVIDERS: readonly Installer<unknown, unknown>[] = [
  standIn(emptyAccount()) as Installer<unknown, unknown>,
  { ...standIn(emptyAccount(), "other-host"), name: "Other Host", options: [{ flag: "--region", value: "<name>", about: "where it runs", variable: null }] } as Installer<unknown, unknown>,
];

/** The environment of a run whose token is in its variable. */
const HELD = { [TOKEN_VARIABLE]: TOKEN };

/** Every answer a run needs, as options. */
const ANSWERS = "--no-place --login you@example.com";

function parsed(line: string, env: Readonly<Record<string, string | undefined>> = {}, canAsk = false): ParsedInstall {
  return parseInstall(words(`poplin ${line}`).slice(1), PROVIDERS, env, canAsk);
}

/** The plan of a line, without its provider: the answers and how the run goes. */
function planOf(line: string, env: Readonly<Record<string, string | undefined>> = {}, canAsk = false): Omit<Plan, "provider"> | ParsedInstall {
  const read = parsed(line, env, canAsk);
  if (read.kind !== "plan") return read;

  const { provider: _provider, ...plan } = read.plan;

  return plan;
}

/** The lines and the exit of a refused line. */
function refusal(line: string, env: Readonly<Record<string, string | undefined>> = {}, canAsk = false): unknown {
  const read = parsed(line, env, canAsk);
  if (read.kind !== "stop") return read;

  if (read.stop.problem === "usage") return read.stop.lines;

  return read.stop.problem === "missing_answer" ? read.stop.missing.map((one) => one.key) : read.stop;
}

describe("a line that gives every answer", () => {
  const login = "you@example.com";
  const token = { from: "environment", token: TOKEN };
  const fixed = { json: false, asking: "never", login, token };
  const apply = { mode: "apply", adopt: "no", wait: true, login: "no" };

  test.each([
    ["without a place", `install stand-in ${ANSWERS}`, { ...fixed, where: { kind: "none" }, mode: apply }],
    ["under a place", "install stand-in --place example.com --login you@example.com", { ...fixed, where: { kind: "place", name: "example.com" }, mode: apply }],
    ["an option joined to its value", "install stand-in --place=example.com --login=You@Example.com", { ...fixed, where: { kind: "place", name: "example.com" }, mode: apply }],
    ["the shared options before the provider", "install --login you@example.com --json stand-in --no-place", { ...fixed, json: true, where: { kind: "none" }, mode: apply }],
    ["the provider's own second option", `install stand-in ${ANSWERS} --account second`, { ...fixed, where: { kind: "none", account: "second" }, mode: apply }],
    ["a dry run", `install stand-in ${ANSWERS} --dry-run`, { ...fixed, where: { kind: "none" }, mode: { mode: "dry-run", adopt: "no" } }],
    ["a dry run of a run that adopts", `install stand-in ${ANSWERS} --dry-run --adopt`, { ...fixed, where: { kind: "none" }, mode: { mode: "dry-run", adopt: "yes" } }],
    ["every switch of a run", `install stand-in ${ANSWERS} --adopt --no-wait --log-in --yes`, { ...fixed, where: { kind: "none" }, mode: { mode: "apply", adopt: "yes", wait: false, login: "yes" } }],
    ["no login of this computer", `install stand-in ${ANSWERS} --no-log-in`, { ...fixed, where: { kind: "none" }, mode: apply }],
  ])("%s is read into one plan that asks nothing: without this a typed answer is dropped or read as another", (_name, line, plan) => {
    expect<unknown>(planOf(line, HELD)).toEqual(plan);
  });

  test("the variables answer what the options leave open, and an option wins over its variable: without this an agent that sets variables is asked", () => {
    const env = { ...HELD, POPLIN_LOGIN: "env@example.com", POPLIN_PLACE: "example.org" };

    expect(planOf("install stand-in", env)).toMatchObject({ asking: "never", where: { kind: "place", name: "example.org" }, login: "env@example.com" });
    expect(planOf("install stand-in --no-place --login you@example.com", env)).toMatchObject({ where: { kind: "none" }, login: "you@example.com" });
    expect(planOf("install stand-in", { ...env, POPLIN_LOGIN: "" })).toMatchObject({ kind: "stop" });
  });

  test("a token that is piped is read later, and makes the run one that asks nothing even on a terminal: without this a pipe would be asked a question", () => {
    expect(planOf(`install stand-in ${ANSWERS} --token-stdin`, {}, true)).toMatchObject({ asking: "never", token: { from: "stdin" }, mode: { mode: "apply", adopt: "no", login: "no" } });
  });
});

describe("a line on a terminal", () => {
  test("holds each answer that was given and leaves the rest to ask, and --yes turns the asking off: without this a person is asked for what they typed", () => {
    const open = planOf("install stand-in", {}, true);

    expect(open).toMatchObject({ asking: "terminal", login: undefined, token: undefined, where: { known: false }, mode: { mode: "apply", adopt: "ask", wait: true, login: "ask" } });
    expect(planOf(`install stand-in ${ANSWERS} --adopt --no-log-in`, HELD, true)).toMatchObject({
      asking: "terminal",
      login: "you@example.com",
      token: TOKEN,
      where: { known: true, where: { kind: "none" } },
      mode: { mode: "apply", adopt: "yes", login: "no" },
    });
    expect(planOf(`install stand-in ${ANSWERS} --yes`, HELD, true)).toMatchObject({ asking: "never", mode: { adopt: "no", login: "no" } });
  });

  test("with no provider named it asks which, and with --yes or --json it does not: without this a script would hang on the question", () => {
    const picked = parsed("install --dry-run", {}, true);

    expect(parsed("install", {}, true)).toMatchObject({ kind: "pick", json: false });
    expect(picked.kind === "pick" ? picked.named(PROVIDERS[0] as Installer<unknown, unknown>) : picked).toMatchObject({ kind: "plan", plan: { asking: "terminal", mode: { mode: "dry-run" }, provider: { id: "stand-in" } } });
    expect(parsed("install --json", {}, true)).toEqual({ kind: "list", json: true });
    expect(refusal("install --yes", {}, true)).toEqual(["provider"]);
  });
});

describe("a line that is refused", () => {
  test.each([
    ["both forms of one answer", "install stand-in --place example.com --no-place --login you@example.com", ["poplin install: give one of --place <name> and --no-place"]],
    ["both forms of the login offer", `install stand-in ${ANSWERS} --log-in --no-log-in`, ["poplin install: give one of --log-in and --no-log-in"]],
    ["a dry run that logs in", `install stand-in ${ANSWERS} --dry-run --log-in`, ["poplin install: --dry-run changes nothing: leave out --log-in"]],
    ["a dry run that does not log in", `install stand-in ${ANSWERS} --dry-run --no-log-in`, ["poplin install: --dry-run changes nothing: leave out --no-log-in"]],
    ["a dry run that does not wait", `install stand-in ${ANSWERS} --dry-run --no-wait`, ["poplin install: --dry-run changes nothing: leave out --no-wait"]],
    ["the token given twice", `install stand-in ${ANSWERS} --token-stdin`, [`poplin install: the token is given twice: ${TOKEN_VARIABLE} is set, and --token-stdin was given`]],
    ["an option twice", "install stand-in --no-place --no-place", ["poplin install: --no-place was given twice"]],
    ["a shared option twice", `install stand-in ${ANSWERS} --yes --yes`, ["poplin install: --yes was given twice"]],
    ["an email that is none", "install stand-in --no-place --login you", ["poplin install: --login takes an email address", "for example: --login you@example.com"]],
    ["an email with nothing in it", 'install stand-in --no-place --login ""', ["poplin install: --login takes an email address", "for example: --login you@example.com"]],
    ["a place the provider refuses", "install stand-in --place UPPER --login you@example.com", ['poplin install: --place takes a name alone, such as example.com: "UPPER"']],
    ["an option with no value", "install stand-in --no-place --login", ["poplin install: --login needs a value: --login <email>"]],
    ["a repair", `install stand-in ${ANSWERS} --repair`, ["poplin install: no option --repair", "To mend an install: poplin doctor --repair"]],
    ["an update", `install stand-in ${ANSWERS} --update`, ["poplin install: no option --update", "To update an install: poplin update"]],
    ["a force", `install stand-in ${ANSWERS} --force`, ["poplin install: no option --force", "install changes no install that is there. To remove one: poplin uninstall <provider>"]],
    ["the token as an argument", `install stand-in ${ANSWERS} --token=abc`, ["poplin install: no option --token", `The account token is never an argument: set ${TOKEN_VARIABLE}, or pipe it with --token-stdin`]],
    ["an option of another provider", `install stand-in ${ANSWERS} --region west`, ["poplin install: --region is no option of stand-in", "it is an option of other-host"]],
    ["a provider's option given to the other", "install other-host --place example.com", ["poplin install: --place is no option of other-host", "it is an option of stand-in"]],
    ["a provider's option before any provider", "install --no-place", ["poplin install: --no-place is an option of stand-in", "name the provider first: poplin install stand-in --no-place"]],
    ["a provider's option before its provider", "install --no-place stand-in --login you@example.com", ["poplin install: --no-place is an option of stand-in", "name the provider first: poplin install stand-in --no-place"]],
    ["a value that starts with a dash, unjoined", `install stand-in ${ANSWERS} --account --yes`, ["poplin install: --account needs a value: --account <id>"]],
    ["an option nothing has", `install stand-in ${ANSWERS} --loud`, ["poplin install: no option --loud", "poplin install stand-in --help lists the options"]],
    ["an option one letter off", `install stand-in ${ANSWERS} --dry-rum`, ["poplin install: no option --dry-rum", "did you mean --dry-run?"]],
    ["a provider that is none", "install nowhere --yes", ['poplin install: no provider "nowhere"', "poplin install lists the providers"]],
    ["a provider one letter off", "install stand-on", ['poplin install: no provider "stand-on"', "did you mean: poplin install stand-in?"]],
    ["a word too many", `install stand-in extra ${ANSWERS}`, ["poplin install: too many words after stand-in", "poplin install stand-in --help lists the options"]],
  ])("%s is refused with one line that says what to type: without this a contradiction would reach the run", (_name, line, lines) => {
    expect(refusal(line, HELD)).toEqual(lines);
    expect(parsed(line, HELD)).toMatchObject({ kind: "stop", stop: { exit: 2 } });
  });

  test("a token of the wrong form in the variable is refused before any request, and is not quoted: without this a mistyped token is sent, or printed", () => {
    const lines = refusal(`install stand-in ${ANSWERS}`, { [TOKEN_VARIABLE]: "not-a-token" });

    expect(lines).toEqual([`poplin install: ${TOKEN_VARIABLE} does not hold an account token of Stand-In Host`]);
  });

  test.each([
    ["nothing given", "install stand-in --yes", {}, ["where", "login", "token"]],
    ["the place given", "install stand-in --no-place --yes", {}, ["login", "token"]],
    ["all but the token", `install stand-in ${ANSWERS} --yes`, {}, ["token"]],
    ["all but the login", "install stand-in --no-place", HELD, ["login"]],
    ["no terminal and no --yes", "install stand-in", {}, ["where", "login", "token"]],
  ])("a run that asks nothing names every missing answer, %s: without this an agent learns of one answer a run", (_name, line, env, missing) => {
    expect(refusal(line, env)).toEqual(missing);
    expect(parsed(line, env)).toMatchObject({ kind: "stop", stop: { exit: 2, problem: "missing_answer" } });
  });

  test("a refusal keeps whether JSON was asked for, so the caller can answer in kind: without this an agent's refusal is prose alone", () => {
    expect(parsed("install stand-in --yes --json")).toMatchObject({ kind: "stop", json: true });
    expect(parsed("install stand-in --yes")).toMatchObject({ kind: "stop", json: false });
  });
});

describe("help and version", () => {
  test("--help is answered whatever else is on the line, for the provider the line names: without this a wrong line could not ask how to be right", () => {
    expect(parsed("install --help")).toEqual({ kind: "help", provider: undefined });
    expect(parsed("install stand-in --place --help")).toMatchObject({ kind: "help", provider: { id: "stand-in" } });
    expect(parsed("install --repair other-host --help")).toMatchObject({ kind: "help", provider: { id: "other-host" } });
    expect(parsed("install other-host --region stand-in --help")).toMatchObject({ kind: "help", provider: { id: "other-host" } });
    expect(parsed("install --version")).toEqual({ kind: "version" });
  });
});
