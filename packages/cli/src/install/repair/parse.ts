// The words after `poplin doctor` that carry `--repair`, read once into a plan: where the install is, the token, and whether one more person is let in.
// A line that contradicts itself is refused here with one line, and so is a run that asks nothing and lacks an answer. Nothing is read from disk or sent anywhere.

import { type Login, parseLogin } from "../../../../core/src/auth/logins";
import type { OptionRow, Question, Run, Token } from "../../../../core/src/install/installer";
import { TOKEN_VARIABLE } from "../ask";
import type { GivenToken, Parsed, Provider, Stop } from "../records";
import { type CommandWords, heldToken, lacking, MISSING_TOKEN, missingOf, type Named, parseWords, usage, type Variables } from "../words";

/** The command as it is typed after `poplin`, which its refusals and its hints name. */
export const REPAIR_COMMAND = "doctor --repair";

/** The options of a repair, which every provider takes. The parser reads these rows and the help prints them. */
export const REPAIR_OPTIONS: readonly OptionRow[] = [
  { flag: "--repair", value: null, about: "mend the install at its provider, with an account token", variable: null },
  { flag: "--dry-run", value: null, about: "say what a repair would change, and change nothing", variable: null },
  { flag: "--add-user", value: "<email>", about: "let one more person log in", variable: null },
  { flag: "--yes", value: null, about: "ask nothing; a missing answer stops the run and is named", variable: null },
  { flag: "--token-stdin", value: null, about: "read the account token from standard input, and ask nothing", variable: null },
  { flag: "--json", value: null, about: "print one JSON value, and nothing else on stdout", variable: null },
];

/** The options a person may reach for that a repair does not take, each with the line that says why or where. */
const ELSEWHERE: Readonly<Record<string, string>> = {
  "--server": "--repair works with the account token, not a login: leave out --server",
  "--token": `The account token is never an argument: set ${TOKEN_VARIABLE}, or pipe it with --token-stdin`,
  "--login": "a repair keeps the users the install has. To let one more person in: --add-user <email>",
  "--update": "To update an install: poplin update",
  "--remove": "To remove an install: poplin uninstall <provider>",
};

/** The command, as its words are read. */
const COMMAND: CommandWords = { name: REPAIR_COMMAND, options: REPAIR_OPTIONS, elsewhere: ELSEWHERE, loneProvider: true };

/**
 * A repair as the command line asks for it. A run that asks nothing holds every answer; one on a terminal holds each answer given, and asks for the rest.
 *
 * `where` on a terminal is the provider's own answer, or the questions it still has. `token` there is the one the variable held.
 */
export type RepairPlan = { readonly provider: Provider; readonly json: boolean; readonly run: Run; readonly addUser: Login | undefined } & (
  | { readonly asking: "never"; readonly where: unknown; readonly token: GivenToken }
  | { readonly asking: "terminal"; readonly where: { readonly known: true; readonly where: unknown } | { readonly known: false; readonly open: readonly Question<unknown>[] }; readonly token: Token | undefined }
);

/** The answers the options and the variables gave: where the install is or the questions still open, the email of the person to let in, and the token of the variable. */
interface Answers {
  readonly where: Exclude<ReturnType<Provider["read"]>, { readonly why: "refused" }>;
  readonly addUser: Login | undefined;
  readonly token: Token | undefined;
}

/** Read the email of the person to let in; `undefined` when the option was not given. */
function readUser(read: Named): Login | undefined | Stop {
  const typed = read.shared.get("add-user");
  if (typeof typed !== "string") return undefined;

  const login = parseLogin(typed);

  return login.ok ? login.value : usage(COMMAND, "--add-user takes an email address", "for example: --add-user you@example.com");
}

/** Read every answer the options and the variables gave, each checked once: the provider's own, the email of the person to let in, and the token of the variable. */
function readAnswers(read: Named, env: Variables): Answers | Stop {
  const where = read.provider.read({ flags: read.own, env });
  if (!where.ok && where.why === "refused") return usage(COMMAND, where.refused);

  const addUser = readUser(read);
  if (typeof addUser === "object") return addUser;

  const token = heldToken(read, env, COMMAND);
  if (typeof token === "object") return token;

  return { where, addUser, token };
}

/** The plan of a line whose provider is known, or why the line is refused. A run that asks nothing must hold every answer, and each one it lacks is named. */
function planned(read: Named, env: Variables, asking: boolean, json: boolean): RepairPlan | Stop {
  const answers = readAnswers(read, env);
  if ("problem" in answers) return answers;

  const { where, addUser } = answers;
  const said = { provider: read.provider, json, run: read.shared.has("dry-run") ? "dry-run" : "apply", addUser } as const;
  if (asking) return { ...said, asking: "terminal", where: where.ok ? { known: true, where: where.where } : { known: false, open: where.open }, token: answers.token };

  const piped: GivenToken | undefined = read.shared.has("token-stdin") ? { from: "stdin" } : undefined;
  const token = answers.token === undefined ? piped : ({ from: "environment", token: answers.token } as const);
  const missing = [...(where.ok ? [] : where.open.map(missingOf)), ...(token === undefined ? [MISSING_TOKEN] : [])];
  if (!where.ok || token === undefined) return lacking(missing);

  return { ...said, asking: "never", where: where.where, token };
}

/**
 * Read the words after `poplin doctor`, of a line that carries `--repair`, into what they ask for.
 *
 * A package that carries one provider needs no word for it: the line is read as that provider's.
 * A run asks nothing when `--yes` or `--token-stdin` is given, or when no person can be asked: each answer it lacks is then named.
 *
 * @param providers - the providers the built package carries: each is a subcommand, with the options it declares
 * @param env - the environment the variables are read from; an empty variable is one that is not set
 * @returns the help, the version, the list of providers, the question which provider, a refusal with its lines, or a plan in which no two answers contradict each other
 */
export function parseRepair(words: readonly string[], providers: readonly Provider[], env: Variables, canAsk: boolean): Parsed<RepairPlan> {
  return parseWords(words, providers, canAsk, COMMAND, (read, asking, json) => planned(read, env, asking, json));
}
