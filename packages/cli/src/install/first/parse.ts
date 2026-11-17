// The options of `poplin install <provider>`, read once into a plan: every answer given, or still to ask where a person can be asked.
// A line that contradicts itself is refused here with one line, and so is a run that asks nothing and lacks an answer. Nothing is read from disk or sent anywhere.

import { type Login, parseLogin } from "../../../../core/src/auth/logins";
import type { OptionRow, Token } from "../../../../core/src/install/installer";
import { TOKEN_VARIABLE } from "../ask";
import type { GivenToken, InstallMode, Missing, ParsedInstall, Plan, Provider, Stop } from "../records";
import { type CommandWords, heldToken, lacking, MISSING_TOKEN, missingOf, type Named, parseWords, type Typed, usage, type Variables } from "../words";

/** The variable that answers the first login. */
const USER_VARIABLE = "POPLIN_USER";

/** The options of the command itself, which every provider takes. The parser reads these rows and the help prints them. */
export const SHARED_OPTIONS: readonly OptionRow[] = [
  { flag: "--user", value: "<email>", about: "Email of the first user", variable: USER_VARIABLE },
  { flag: "--dry-run", value: null, about: "Read everything and show the plan; change nothing", variable: null },
  { flag: "--adopt", value: null, about: "Reuse what an earlier install left behind", variable: null },
  { flag: "--yes", value: null, about: "Never prompt; a missing answer stops the run", variable: null },
  { flag: "--token-stdin", value: null, about: "Read the account token from stdin; never prompt", variable: null },
  { flag: "--log-in", value: null, about: "Log this machine in when done", variable: null },
  { flag: "--no-log-in", value: null, about: "Do not log this machine in; do not ask", variable: null },
  { flag: "--no-wait", value: null, about: "Do not wait for the install to answer", variable: null },
  { flag: "--json", value: null, about: "Print one JSON value, and nothing else on stdout", variable: null },
];

/** The options a person may reach for that belong to another command, each with the line that says which. */
const ELSEWHERE: Readonly<Record<string, string>> = {
  "--repair": "To mend an install: poplin doctor --repair",
  "--update": "To update an install: poplin update",
  "--force": "install changes no install that is there. To remove one: poplin uninstall <provider>",
  "--remove": "To remove an install: poplin uninstall <provider>",
  "--token": `The account token is never an argument: set ${TOKEN_VARIABLE}, or pipe it with --token-stdin`,
};

/** The options of a real run alone, which a dry run refuses. */
const RUN_ALONE = ["--log-in", "--no-log-in", "--no-wait"] as const;

/** The command, as its words are read. */
const COMMAND: CommandWords = { name: "install", options: SHARED_OPTIONS, elsewhere: ELSEWHERE };

/** The answers the options and the variables gave: where the install goes or the questions still open, the first login, and the token of the variable. */
interface Answers {
  readonly where: Exclude<ReturnType<Provider["read"]>, { readonly why: "refused" }>;
  readonly login: Login | undefined;
  readonly token: Token | undefined;
}

/** Read the first login from its option or its variable; `undefined` when neither gave one. An option with nothing in it is refused, and a variable with nothing in it is one that is not set. */
function readLogin(shared: Typed, env: Variables): Login | undefined | Stop {
  const typed = shared.get("user");
  const held = env[USER_VARIABLE] ?? "";
  if (typeof typed !== "string" && held === "") return undefined;

  const login = parseLogin(typeof typed === "string" ? typed : held);
  if (login.ok) return login.value;

  return typeof typed === "string" ? usage(COMMAND, "--user takes an email address", "for example: --user you@example.com") : usage(COMMAND, `${USER_VARIABLE} holds no email address`);
}

/** How the run goes, from its switches. `open` is what an answer no switch gave is: `"ask"` on a terminal, and `"no"` where nothing is asked. */
function modeOf<Open extends "ask" | "no">(shared: Typed, open: Open): InstallMode<Open> | Stop {
  if (shared.has("log-in") && shared.has("no-log-in")) return usage(COMMAND, "give one of --log-in and --no-log-in");

  const adopt = shared.has("adopt") ? "yes" : undefined;
  const stray = RUN_ALONE.find((flag) => shared.has(flag.slice(2)));
  if (shared.has("dry-run")) return stray === undefined ? { mode: "dry-run", adopt: adopt ?? "no" } : usage(COMMAND, `--dry-run changes nothing: leave out ${stray}`);

  const refused = shared.has("no-log-in") ? "no" : undefined;

  return { mode: "apply", adopt: adopt ?? open, wait: !shared.has("no-wait"), login: shared.has("log-in") ? "yes" : (refused ?? open) };
}

/** Read every answer the options and the variables gave, each checked once: a provider's own, the first login, and the token of the variable. */
function readAnswers(read: Named, env: Variables): Answers | Stop {
  const { provider, shared } = read;
  const where = provider.read({ flags: read.own, env });
  if (!where.ok && where.why === "refused") return usage(COMMAND, where.refused);

  const login = readLogin(shared, env);
  if (typeof login === "object") return login;

  const token = heldToken(read, env, COMMAND);
  if (typeof token === "object") return token;

  return { where, login, token };
}

/** The plan of a run that asks nothing: every answer must be there, and each one that is not is named. */
function fixedPlan(read: Named, env: Variables, json: boolean): Plan | Stop {
  const mode = modeOf(read.shared, "no");
  if ("problem" in mode) return mode;

  const answers = readAnswers(read, env);
  if ("problem" in answers) return answers;

  const { where, login } = answers;
  const piped: GivenToken | undefined = read.shared.has("token-stdin") ? { from: "stdin" } : undefined;
  const token = answers.token === undefined ? piped : ({ from: "environment", token: answers.token } as const);
  const missing: Missing[] = where.ok ? [] : where.open.map(missingOf);
  if (login === undefined) missing.push({ key: "user", name: "the first login", give: `Give --user <email> (or ${USER_VARIABLE}).` });

  if (token === undefined) missing.push(MISSING_TOKEN);

  if (!where.ok || login === undefined || token === undefined) return lacking(missing);

  return { provider: read.provider, json, asking: "never", mode, where: where.where, login, token };
}

/** The plan of a run on a terminal: each answer given is checked, and the rest are asked for. */
function askingPlan(read: Named, env: Variables, json: boolean): Plan | Stop {
  const mode = modeOf(read.shared, "ask");
  if ("problem" in mode) return mode;

  const answers = readAnswers(read, env);
  if ("problem" in answers) return answers;

  const where = answers.where.ok ? ({ known: true, where: answers.where.where } as const) : ({ known: false, open: answers.where.open } as const);

  return { provider: read.provider, json, asking: "terminal", mode, where, login: answers.login, token: answers.token };
}

/**
 * Read the words after `poplin install` into what they ask for.
 *
 * A run asks nothing when `--yes` or `--token-stdin` is given, or when no person can be asked. Then every answer comes from an option or a variable, and each missing one is named.
 *
 * @param providers - the providers the built package carries: each is a subcommand, with the options it declares
 * @param env - the environment the variables are read from; an empty variable is one that is not set
 * @param canAsk - whether a person is there to answer a question
 * @returns the help, the version, the list of providers, the question which provider with the way to go on from its answer, a refusal with its lines, or a plan in which no two answers contradict each other
 */
export function parseInstall(words: readonly string[], providers: readonly Provider[], env: Variables, canAsk: boolean): ParsedInstall {
  return parseWords(words, providers, canAsk, COMMAND, (read, asking, json) => (asking ? askingPlan(read, env, json) : fixedPlan(read, env, json)));
}
