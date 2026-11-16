// The words after `poplin install`, read once into what they ask for. Commander splits them: the shared options are the command's own, and each provider is a subcommand whose options are the ones it declares.
//
//   poplin install                         the list of providers, or on a terminal the question which
//   poplin install <provider> [options]    a plan: every answer given, or still to ask where a person can be asked
//
// A line that contradicts itself is refused here with one line, and so is a run that asks nothing and lacks an answer. Nothing is read from disk or sent anywhere.

import { Command, CommanderError, Option } from "commander";

import { type Login, parseLogin } from "../../../core/src/auth/logins";
import type { OptionRow, Question, Token } from "../../../core/src/install/installer";
import { HELP_FLAG, VERSION_FLAG } from "../commands/command-table";
import { nearest } from "../commands/util";
import type { GivenToken, InstallMode, Missing, ParsedInstall, Plan, Provider, Stop } from "./records";

/** The variable the account token is read from. */
export const TOKEN_VARIABLE = "POPLIN_INSTALL_TOKEN";

/** The variable that answers the first login. */
const LOGIN_VARIABLE = "POPLIN_LOGIN";

/** What every line of a refusal starts with. */
const PREFIX = "poplin install: ";

/** The word that ends the options: every word after it is an argument. */
const TERMINATOR = "--";

/** The one word commander quotes in the message of a refusal: the option or the command it is about. */
const QUOTED = /'(.*)'/s;

/** The refusals of commander that are answered in the product's words, by commander's code for each. */
const REFUSALS = { unknownOption: "commander.unknownOption", missingValue: "commander.optionMissingArgument", tooMany: "commander.excessArguments" } as const;

/** The options of the command itself, which every provider takes. The parser reads these rows and the help prints them. */
export const SHARED_OPTIONS: readonly OptionRow[] = [
  { flag: "--login", value: "<email>", about: "the first login", variable: LOGIN_VARIABLE },
  { flag: "--dry-run", value: null, about: "read everything, change nothing, and say what a run would make", variable: null },
  { flag: "--adopt", value: null, about: "use what an earlier install left behind, with what it holds", variable: null },
  { flag: "--yes", value: null, about: "ask nothing; a missing answer stops the run and is named", variable: null },
  { flag: "--token-stdin", value: null, about: "read the account token from standard input, and ask nothing", variable: null },
  { flag: "--log-in", value: null, about: "log this computer in when it is done", variable: null },
  { flag: "--no-log-in", value: null, about: "do not log this computer in, and do not ask", variable: null },
  { flag: "--no-wait", value: null, about: "do not wait for the install to answer", variable: null },
  { flag: "--json", value: null, about: "print one JSON value, and nothing else on stdout", variable: null },
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

/** The environment the variables are read from. */
type Variables = Readonly<Record<string, string | undefined>>;

/** The options as they were typed, by name without the dashes: the value of one that takes a value, `true` for a switch. */
type Typed = Map<string, string | true>;

/** What commander read: the shared options, the provider named, and its own options. */
interface Read {
  readonly shared: Typed;
  readonly own: Typed;
  readonly provider: Provider | undefined;
}

/** A line that names its provider. */
type Named = Read & { readonly provider: Provider };

/** The answers the options and the variables gave: where the install goes or the questions still open, the first login, and the token of the variable. */
interface Answers {
  readonly where: Exclude<ReturnType<Provider["read"]>, { readonly why: "refused" }>;
  readonly login: Login | undefined;
  readonly token: Token | undefined;
}

/** What ends the reading of a line before commander is through with it: the refusal is known. */
class Refused extends Error {
  readonly lines: readonly string[];

  constructor(...lines: string[]) {
    super("the command line is refused");
    this.lines = lines;
  }
}

function usage(...lines: string[]): Stop {
  return { problem: "usage", exit: 2, lines: lines.map((line, at) => (at === 0 ? `${PREFIX}${line}` : line)) };
}

/** Whether a flag stands as a word of its own before `--`. */
function asks(words: readonly string[], flag: string): boolean {
  const end = words.indexOf(TERMINATOR);

  return words.slice(0, end === -1 ? words.length : end).includes(flag);
}

/** Give a command its options, and note each as it is typed: a negated option keeps its own name, so the two forms of one answer can be told apart. */
function addOptions(command: Command, rows: readonly OptionRow[], typed: Typed): void {
  for (const row of rows) {
    const option = new Option(row.value === null ? row.flag : `${row.flag} ${row.value}`);
    command.addOption(option);

    command.on(`option:${option.name()}`, (value: string | undefined) => {
      if (typed.has(option.name())) throw new Refused(`${row.flag} was given twice`);

      typed.set(option.name(), value ?? true);
    });
  }
}

/** A commander command that prints nothing, never ends the process, and has no help of its own. */
function quiet(command: Command): Command {
  return command
    .exitOverride()
    .configureOutput({ writeOut: () => undefined, writeErr: () => undefined })
    .helpOption(false)
    .helpCommand(false)
    .showSuggestionAfterError(false);
}

/** Say why an option is none of this line's: it belongs to another command, to another provider, or to nothing. */
function unknownOption(typed: string, provider: Provider | undefined, providers: readonly Provider[]): Refused {
  const [flag = typed] = typed.split("=");
  const elsewhere = Object.hasOwn(ELSEWHERE, flag) ? ELSEWHERE[flag] : undefined;
  if (elsewhere !== undefined) return new Refused(`no option ${flag}`, elsewhere);

  const owner = providers.find((other) => other !== provider && other.options.some((row) => row.flag === flag));
  if (owner !== undefined && provider !== undefined) return new Refused(`${flag} is no option of ${provider.id}`, `it is an option of ${owner.id}`);

  if (owner !== undefined) return new Refused(`${flag} is an option of ${owner.id}`, `name the provider first: poplin install ${owner.id} ${flag}`);

  const known = [...SHARED_OPTIONS, ...(provider?.options ?? [])].map((row) => row.flag);
  const meant = nearest(flag, known);
  const helpOf = provider === undefined ? "poplin install --help" : `poplin install ${provider.id} --help`;

  return new Refused(`no option ${flag}`, meant === undefined ? `${helpOf} lists the options` : `did you mean ${meant}?`);
}

/** A refusal of commander in the product's words. */
function refusalOf(refused: CommanderError, root: Command, provider: Provider | undefined, providers: readonly Provider[]): Refused | undefined {
  const quoted = QUOTED.exec(refused.message)?.[1];

  if (refused.code === REFUSALS.unknownOption) return unknownOption(quoted ?? "", provider, providers);

  if (refused.code === REFUSALS.missingValue) return new Refused(`${(quoted ?? "").split(" ")[0]} needs a value: ${quoted}`);

  if (refused.code !== REFUSALS.tooMany) return undefined;

  // Commander names the subcommand that was given too much; with no name it is the command itself, whose one word is a provider.
  if (quoted !== undefined) return new Refused(`too many words after ${quoted}`, `poplin install ${quoted} --help lists the options`);

  const [word = ""] = root.args;
  const meant = nearest(
    word,
    providers.map((one) => one.id),
  );

  return new Refused(`no provider ${JSON.stringify(word)}`, meant === undefined ? "poplin install lists the providers" : `did you mean: poplin install ${meant}?`);
}

/** Split the words with commander: the shared options wherever they stand, the provider, and its own options after it. */
function readWords(words: readonly string[], providers: readonly Provider[]): Read | Stop {
  const shared: Typed = new Map();
  const own: Typed = new Map();
  let provider: Provider | undefined;
  const root = quiet(new Command("install")).action(() => undefined);
  addOptions(root, SHARED_OPTIONS, shared);

  // The provider is known once commander goes into its subcommand: a refusal before that names none.
  root.hook("preSubcommand", (_root, command) => {
    provider = providers.find((one) => one.id === command.name());
  });

  for (const one of providers) addOptions(quiet(root.command(one.id)).action(() => undefined), one.options, own);

  try {
    root.parse([...words], { from: "user" });
  } catch (error) {
    const refused = error instanceof CommanderError ? refusalOf(error, root, provider, providers) : error;
    if (refused instanceof Refused) return usage(...refused.lines);

    throw error;
  }

  return { shared, own, provider };
}

/** The answers a run that asks nothing lacks, as one stop that names each. */
function lacking(missing: readonly Missing[]): Stop {
  return { problem: "missing_answer", exit: 2, missing };
}

function missingOf(question: Question<unknown>): Missing {
  return { key: question.key, name: question.name, give: question.give };
}

/** Read the first login from its option or its variable; `undefined` when neither gave one. An option with nothing in it is refused, and a variable with nothing in it is one that is not set. */
function readLogin(shared: Typed, env: Variables): Login | undefined | Stop {
  const typed = shared.get("login");
  const held = env[LOGIN_VARIABLE] ?? "";
  if (typeof typed !== "string" && held === "") return undefined;

  const login = parseLogin(typeof typed === "string" ? typed : held);
  if (login.ok) return login.value;

  return typeof typed === "string" ? usage("--login takes an email address", "for example: --login you@example.com") : usage(`${LOGIN_VARIABLE} holds no email address`);
}

/** How the run goes, from its switches. `open` is what an answer no switch gave is: `"ask"` on a terminal, and `"no"` where nothing is asked. */
function modeOf<Open extends "ask" | "no">(shared: Typed, open: Open): InstallMode<Open> | Stop {
  if (shared.has("log-in") && shared.has("no-log-in")) return usage("give one of --log-in and --no-log-in");

  const adopt = shared.has("adopt") ? "yes" : undefined;
  const stray = RUN_ALONE.find((flag) => shared.has(flag.slice(2)));
  if (shared.has("dry-run")) return stray === undefined ? { mode: "dry-run", adopt: adopt ?? "no" } : usage(`--dry-run changes nothing: leave out ${stray}`);

  const refused = shared.has("no-log-in") ? "no" : undefined;

  return { mode: "apply", adopt: adopt ?? open, wait: !shared.has("no-wait"), login: shared.has("log-in") ? "yes" : (refused ?? open) };
}

/** Read every answer the options and the variables gave, each checked once: a provider's own, the first login, and the token of the variable. */
function readAnswers(read: Named, env: Variables): Answers | Stop {
  const { provider, shared } = read;
  const where = provider.read({ flags: read.own, env });
  if (!where.ok && where.why === "refused") return usage(where.refused);

  const login = readLogin(shared, env);
  if (typeof login === "object") return login;

  const held = env[TOKEN_VARIABLE] ?? "";
  if (held !== "" && shared.has("token-stdin")) return usage(`the token is given twice: ${TOKEN_VARIABLE} is set, and --token-stdin was given`);

  const token = held === "" ? undefined : provider.token(held);
  if (held !== "" && token === undefined) return usage(`${TOKEN_VARIABLE} does not hold an account token of ${provider.name}`);

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
  if (login === undefined) missing.push({ key: "login", name: "the first login", give: `Give --login <email> (or ${LOGIN_VARIABLE}).` });

  if (token === undefined) missing.push({ key: "token", name: "the account token", give: `Set ${TOKEN_VARIABLE}, or pipe it with --token-stdin.` });

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

/** The plan of a line whose provider is known, or why it is refused. */
function planned(read: Named, env: Variables, canAsk: boolean, json: boolean): ParsedInstall {
  const quiet = !canAsk || read.shared.has("yes") || read.shared.has("token-stdin");
  const plan = quiet ? fixedPlan(read, env, json) : askingPlan(read, env, json);

  return "problem" in plan ? { kind: "stop", stop: plan, json } : { kind: "plan", plan };
}

/** Answer for a line that names no provider: the list, the question which, or the refusal of a run that asks nothing. */
function withoutProvider(read: Read, env: Variables, canAsk: boolean): ParsedInstall {
  const { shared } = read;
  const json = shared.has("json");
  const bare = [...shared.keys()].every((name) => name === "json");
  if (canAsk && !json && !shared.has("yes") && !shared.has("token-stdin")) return { kind: "pick", json, named: (provider) => planned({ ...read, provider }, env, canAsk, json) };

  if (bare) return { kind: "list", json };

  return { kind: "stop", json, stop: lacking([{ key: "provider", name: "the provider", give: "Name it after install: poplin install <provider>." }]) };
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
  // The help is of the first provider the line names, whatever else is written wrong on it.
  const first = words.find((word) => providers.some((one) => one.id === word));
  if (asks(words, HELP_FLAG)) return { kind: "help", provider: providers.find((one) => one.id === first) };

  if (asks(words, VERSION_FLAG)) return { kind: "version" };

  const read = readWords(words, providers);
  const json = asks(words, "--json");
  if ("problem" in read) return { kind: "stop", stop: read, json };

  const { provider } = read;

  return provider === undefined ? withoutProvider(read, env, canAsk) : planned({ ...read, provider }, env, canAsk, json);
}
