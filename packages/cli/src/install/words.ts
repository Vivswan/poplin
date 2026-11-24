// The words after an install command, split once with commander: the command's own options wherever they stand, the provider as a subcommand, and that provider's options after it.
//
//   poplin <command>                         the list of providers, or on a terminal the question which
//   poplin <command> <provider> [options]    what the command's own reading makes of the options
//
// A line commander refuses is refused here in the product's words, with one line. Nothing is read from disk or sent anywhere.

import { Command, CommanderError, Option } from "commander";

import type { Given, OptionRow, Question, Token } from "../../../core/src/install/installer";
import { HELP_FLAG, VERSION_FLAG } from "../commands/command-table";
import { nearest } from "../commands/line/util";
import { TOKEN_VARIABLE } from "./ask";
import type { Missing, Parsed, Provider, Stop } from "./records";

/** The word that ends the options: every word after it is an argument. */
const TERMINATOR = "--";

/** The one word commander quotes in the message of a refusal: the option or the command it is about. */
const QUOTED = /'(.*)'/s;

/** The refusals of commander that are answered in the product's words, by commander's code for each. */
const REFUSALS = { unknownOption: "commander.unknownOption", missingValue: "commander.optionMissingArgument", tooMany: "commander.excessArguments" } as const;

/** The options that make a run ask nothing. */
const ASK_NOTHING = ["yes", "token-stdin"] as const;

/** The token a run that asks nothing lacks, as a missing answer. */
export const MISSING_TOKEN: Missing = { key: "token", name: "account token", give: `pass --token-stdin or set ${TOKEN_VARIABLE}` };

/** One command of the family, as its words are read. */
export interface CommandWords {
  /** The command as it is typed after `poplin`, such as `install`. */
  readonly name: string;

  /** The work the command does at a provider: a provider's options of another work alone are none of the line's. */
  readonly work: NonNullable<OptionRow["work"]>;

  /** The options of the command itself, which every provider takes. */
  readonly options: readonly OptionRow[];

  /** The options a person may reach for that belong elsewhere, each with the line that says where. */
  readonly elsewhere: Readonly<Record<string, string>>;

  /** Set on a command whose line may leave the provider out where the package carries one: that provider's options are then the line's own. */
  readonly loneProvider?: true;
}

/** The environment the variables are read from. */
export type Variables = Readonly<Record<string, string | undefined>>;

/** The options as they were typed, by name without the dashes: the value of one that takes a value, `true` for a switch. */
export type Typed = Map<string, string | true>;

/** What commander read: the command's own options, the provider named, and its own options. */
interface Read {
  readonly shared: Typed;
  readonly own: Typed;
  readonly provider: Provider | undefined;
}

/** A line that names its provider, with the work of its command: the one its options were read by. */
export type Named = Read & { readonly provider: Provider; readonly work: CommandWords["work"] };

/** What ends the reading of a line before commander is through with it: the refusal is known. */
class Refused extends Error {
  readonly lines: readonly string[];

  constructor(...lines: string[]) {
    super("the command line is refused");
    this.lines = lines;
  }
}

/** The stop of a line written wrong: its first line says what is wrong, and a second, where there is one, what to do. */
export function usage(...lines: string[]): Stop {
  return { problem: "usage", exit: 2, lines };
}

/**
 * The options of a provider that the command of one work takes.
 *
 * @returns the provider's options of every work, and the ones of that work alone, in the provider's order
 */
export function optionsOf(provider: Provider, work: CommandWords["work"]): readonly OptionRow[] {
  return provider.options.filter((row) => row.work === undefined || row.work === work);
}

/**
 * What a line gives its provider to read: its own options as typed, and the environment.
 *
 * @returns the environment without the variable of each option that is of another work alone: such a variable answers nothing on this line, as its option is none of the line's
 */
export function givenTo(read: Named, env: Variables): Given {
  const taken = optionsOf(read.provider, read.work);
  const others = read.provider.options.flatMap((row) => (taken.includes(row) || row.variable === null ? [] : [row.variable]));

  return { flags: read.own, env: Object.fromEntries(Object.entries(env).filter(([name]) => !others.includes(name))) };
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
      if (typed.has(option.name())) throw new Refused(`${row.flag} is given twice`);

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
function unknownOption(typed: string, command: CommandWords, provider: Provider | undefined, providers: readonly Provider[]): Refused {
  const [flag = typed] = typed.split("=");
  const elsewhere = Object.hasOwn(command.elsewhere, flag) ? command.elsewhere[flag] : undefined;
  if (elsewhere !== undefined) return new Refused(`Unknown option ${flag}`, elsewhere);

  const owner = providers.find((other) => other !== provider && optionsOf(other, command.work).some((row) => row.flag === flag));
  if (owner !== undefined && provider !== undefined) return new Refused(`${flag} is an option of ${owner.id}, not of ${provider.id}`);

  if (owner !== undefined) return new Refused(`${flag} is an option of ${owner.id}`, `Usage: poplin ${command.name} ${owner.id} ${flag}`);

  const known = [...command.options, ...(provider === undefined ? [] : optionsOf(provider, command.work))].map((row) => row.flag);
  const meant = nearest(flag, known);
  const helpOf = provider === undefined ? `poplin ${command.name} --help` : `poplin ${command.name} ${provider.id} --help`;

  return new Refused(`Unknown option ${flag}`, meant === undefined ? `See: ${helpOf}` : `Did you mean ${meant}?`);
}

/** A refusal of commander in the product's words. */
function refusalOf(refused: CommanderError, root: Command, command: CommandWords, provider: Provider | undefined, providers: readonly Provider[]): Refused | undefined {
  const quoted = QUOTED.exec(refused.message)?.[1];

  if (refused.code === REFUSALS.unknownOption) return unknownOption(quoted ?? "", command, provider, providers);

  if (refused.code === REFUSALS.missingValue) return new Refused(`${(quoted ?? "").split(" ")[0]} requires a value`, `Usage: ${quoted}`);

  if (refused.code !== REFUSALS.tooMany) return undefined;

  // Commander names the subcommand that was given too much; with no name it is the command itself, whose one word is a provider.
  if (quoted !== undefined) return new Refused(`Unexpected argument after ${quoted}`, `See: poplin ${command.name} ${quoted} --help`);

  const [word = ""] = root.args;
  const meant = nearest(
    word,
    providers.map((one) => one.id),
  );

  return new Refused(`Unknown provider ${JSON.stringify(word)}`, meant === undefined ? `See: poplin ${command.name}` : `Did you mean poplin ${command.name} ${meant}?`);
}

/** A line commander refused: why, and the provider it had gone into by then. */
interface Unread {
  readonly refused: Stop;
  readonly provider: Provider | undefined;
}

/** Split the words with commander: the command's own options wherever they stand, the provider, and its own options after it. The options of `lone`, the one provider a line may leave out, are taken with no provider named too. */
function readWords(words: readonly string[], command: CommandWords, providers: readonly Provider[], lone: Provider | undefined): Read | Unread {
  const shared: Typed = new Map();
  const own: Typed = new Map();
  let provider: Provider | undefined;
  const root = quiet(new Command(command.name)).action(() => undefined);
  addOptions(root, command.options, shared);
  addOptions(root, lone === undefined ? [] : optionsOf(lone, command.work), own);

  // The provider is known once commander goes into its subcommand: a refusal before that names none.
  root.hook("preSubcommand", (_root, subcommand) => {
    provider = providers.find((one) => one.id === subcommand.name());
  });

  for (const one of providers) addOptions(quiet(root.command(one.id)).action(() => undefined), optionsOf(one, command.work), own);

  try {
    root.parse([...words], { from: "user" });
  } catch (error) {
    const refused = error instanceof CommanderError ? refusalOf(error, root, command, provider, providers) : error;
    if (refused instanceof Refused) return { refused: usage(...refused.lines), provider };

    throw error;
  }

  return { shared, own, provider };
}

/** The answers a run that asks nothing lacks, as one stop that names each. */
export function lacking(missing: readonly Missing[]): Stop {
  return { problem: "missing_answer", exit: 2, missing };
}

/** A provider's open question, as the answer a run that asks nothing lacks. */
export function missingOf(question: Question<unknown>): Missing {
  return { key: question.key, name: question.name, give: question.give };
}

/**
 * Read the account token of the variable, checked by the provider.
 *
 * @returns the token; `undefined` for a variable that is not set or holds nothing; or the refusal of a token given twice, and of a variable that holds none
 */
export function heldToken(read: Named, env: Variables): Token | undefined | Stop {
  const held = env[TOKEN_VARIABLE] ?? "";
  if (held === "") return undefined;

  if (read.shared.has("token-stdin")) return usage(`${TOKEN_VARIABLE} and --token-stdin are mutually exclusive`);

  return read.provider.token(held) ?? usage(`${TOKEN_VARIABLE} is not a ${read.provider.name} account token`);
}

/**
 * Answer for a line that names no provider: the list, the question which, or the refusal of a run that asks nothing.
 *
 * @param sole - the only provider the package carries, which the line that goes on from the refusal names; `undefined` where it carries more
 */
function withoutProvider<Plan extends object>(read: Read, canAsk: boolean, command: CommandWords, named: (provider: Provider) => Parsed<Plan>, sole: Provider | undefined): Parsed<Plan> {
  const { shared } = read;
  const json = shared.has("json");
  const bare = [...shared.keys()].every((name) => name === "json");
  if (canAsk && !json && !ASK_NOTHING.some((name) => shared.has(name))) return { kind: "pick", json, named };

  if (bare) return { kind: "list", json };

  return { kind: "stop", json, provider: sole, stop: lacking([{ key: "provider", name: "provider", give: `poplin ${command.name} <provider>` }]) };
}

/**
 * Read the words after an install command into what they ask for.
 *
 * A run asks nothing when `--yes` or `--token-stdin` is given, or when no person can be asked.
 *
 * @param providers - the providers the built package carries: each is a subcommand, with the options it declares
 * @param canAsk - whether a person is there to answer a question
 * @param planned - makes the command's plan of a line that names its provider, or says why the line is refused; `asking` is whether the run may ask
 * @returns the help, the version, the list of providers, the question which provider with the way to go on from its answer, a refusal with its lines, or the plan
 */
export function parseWords<Plan extends object>(
  words: readonly string[],
  providers: readonly Provider[],
  canAsk: boolean,
  command: CommandWords,
  planned: (read: Named, asking: boolean, json: boolean) => Plan | Stop,
): Parsed<Plan> {
  // The help is of the first provider the line names, whatever else is written wrong on it.
  const first = words.find((word) => providers.some((one) => one.id === word));
  if (asks(words, HELP_FLAG)) return { kind: "help", provider: providers.find((one) => one.id === first) };

  if (asks(words, VERSION_FLAG)) return { kind: "version" };

  const [only, ...others] = providers;
  const sole = others.length === 0 ? only : undefined;
  const lone = command.loneProvider === true ? sole : undefined;
  const read = readWords(words, command, providers, lone);
  const json = asks(words, "--json");
  if ("refused" in read) return { kind: "stop", stop: read.refused, json, provider: read.provider ?? sole };

  const named = (provider: Provider): Parsed<Plan> => {
    const line = { ...read, provider, work: command.work };
    const plan = planned(line, canAsk && !ASK_NOTHING.some((name) => line.shared.has(name)), json);

    return "problem" in plan ? { kind: "stop", stop: plan, json, provider } : { kind: "plan", plan };
  };

  const provider = read.provider ?? lone;

  return provider === undefined ? withoutProvider(read, canAsk, command, named, sole) : named(provider);
}
