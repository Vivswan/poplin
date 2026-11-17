// The command line, read into one request: the words a person typed become a command with checked arguments, a help topic, or a refusal that says what to type.

import { parseArgs } from "node:util";

import { type Command, CommanderError } from "commander";

import { BARE_COMMAND, COMMANDS, type CommandName, type CommandSpec, FULL_HELP, HELP_FLAG, PROVIDER_COMMANDS, REPAIR_FLAG, VERSION_FLAG } from "../command-table";
import { argumentsOf, buildProgram } from "./program";
import { buildRequest, type TypedRequest } from "./requests";
import { type Flags, isUsageError, looksLikePath, nearest, type UsageError, usageError } from "./util";

/** Every command of the table, by the word that runs it. */
const SPECS: ReadonlyMap<string, (typeof COMMANDS)[number]> = new Map(COMMANDS.map((spec) => [spec.name, spec]));

/** Every flag of any command, with whether it takes a value. A flag means the same in each command that has it, so the words can be split before the command is known. */
const TAKES_VALUE: ReadonlyMap<string, boolean> = new Map(
  COMMANDS.flatMap((spec: CommandSpec) => spec.flags.map((flag) => [flag.name, flag.value !== undefined])),
);

/** The same flags as `parseArgs` takes them: without the dashes. */
const PARSE_OPTIONS = Object.fromEntries(
  [...TAKES_VALUE].map(([name, takesValue]) => [name.slice(2), { type: takesValue ? ("string" as const) : ("boolean" as const) }]),
);

/** How many arguments commander is given: the command word, the most arguments a command takes, and one more to be counted as too many. */
const MOST_COUNTED = Math.max(...COMMANDS.map((spec: CommandSpec) => spec.arguments.length)) + 2;

/** The word that ends the flags: every word after it is an argument. */
const TERMINATOR = "--";

/** A word that can be put after `poplin ./` in a hint as it is, with nothing a shell or a terminal reads. */
const PLAIN_WORD = /^[\w.-]+$/;

/** The one word commander quotes in the message of a refusal: the argument it misses. */
const QUOTED = /'(.*)'/s;

/** The refusals of commander that are answered in the product's words, by commander's code for each. */
const REFUSALS = { missing: "commander.missingArgument", tooMany: "commander.excessArguments" } as const;

/** One flag as typed: its name with the dashes, its value when one came with it, and whether the value was joined by `=`. */
interface TypedFlag {
  readonly name: string;
  readonly value: string | undefined;
  readonly joined: boolean;
}

/** The words of a command line, split into the flags and the rest in the order typed. `first` is where the first word that is no flag stands on the line. */
interface TypedWords {
  readonly flags: readonly TypedFlag[];
  readonly positionals: readonly string[];
  readonly first: number | undefined;
}

/**
 * What a command line asks for: a command's request, the help of a command or of `poplin` itself, the version, or a refusal. `asked` is false for the help an empty command line gets, and `full` is set for the help of every command at once.
 *
 * `install`, `uninstall`, and `doctor` with `--repair` are the commands whose words are not read here: their options are their providers', which only the built package knows. `words` are the ones after the command's own.
 */
export type Parsed =
  | TypedRequest
  | { readonly kind: "provider"; readonly command: ProviderCommand; readonly words: readonly string[] }
  | { readonly kind: "help"; readonly topic?: CommandName; readonly asked: boolean; readonly full?: true }
  | { readonly kind: "version" }
  | UsageError;

/** A command that works at a provider, by the word that runs it; `repair` is `doctor` with `--repair`. */
export type ProviderCommand = (typeof PROVIDER_COMMANDS)[number]["name"] | "repair";

/** What ends the reading of a line before commander is through with it: the answer is known. */
class Answered extends Error {
  readonly parsed: Parsed;

  constructor(parsed: Parsed) {
    super("the command line is answered");
    this.parsed = parsed;
  }
}

function splitWords(argv: readonly string[]): TypedWords {
  const { tokens } = parseArgs({ args: [...argv], options: PARSE_OPTIONS, strict: false, tokens: true, allowPositionals: true });
  const flags: TypedFlag[] = [];
  const positionals: string[] = [];

  for (const token of tokens) {
    if (token.kind === "positional") positionals.push(token.value);

    if (token.kind === "option") flags.push({ name: token.rawName, value: token.value, joined: token.inlineValue === true });
  }

  return { flags, positionals, first: tokens.find((token) => token.kind === "positional")?.index };
}

function unknownFlag(typed: string, known: readonly string[], listedBy: string): UsageError {
  const meant = nearest(typed, known);

  return usageError(`Unknown option ${typed}`, meant === undefined ? `See: ${listedBy}` : `Did you mean ${meant}?`);
}

/** The command that works at a provider a word names, if it names one. */
function providerCommand(word: string): (typeof PROVIDER_COMMANDS)[number]["name"] | undefined {
  return PROVIDER_COMMANDS.find((command) => command.name === word)?.name;
}

function unknownCommand(word: string, publishHint: boolean): UsageError {
  const meant = nearest(word, [...SPECS.keys(), ...PROVIDER_COMMANDS.map((command) => command.name)]);
  const unknown = `Unknown command ${JSON.stringify(word)}`;
  if (meant !== undefined) return usageError(unknown, `Did you mean poplin ${meant}?`);

  if (publishHint && PLAIN_WORD.test(word)) return usageError(unknown, `To publish a ${word.endsWith(".html") ? "file" : "folder"} of that name: poplin ./${word}`);

  return usageError(unknown, "See: poplin --help");
}

/** Whether a flag stands as a word of its own before `--`, even where the flag before it would take it as a value. */
function asks(argv: readonly string[], flag: string): boolean {
  const end = argv.indexOf(TERMINATOR);

  return argv.slice(0, end === -1 ? argv.length : end).includes(flag);
}

/** Answer for a line with no argument on it: the help or the version when asked, and else what its first flag lacks. */
function withoutWord(argv: readonly string[], flags: readonly TypedFlag[]): Parsed {
  if (asks(argv, FULL_HELP.name)) return { kind: "help", asked: true, full: true };

  if (asks(argv, HELP_FLAG)) return { kind: "help", asked: true };

  if (asks(argv, VERSION_FLAG)) return { kind: "version" };

  const [first] = flags;
  if (first === undefined) return { kind: "help", asked: false };

  if (!TAKES_VALUE.has(first.name)) return unknownFlag(first.name, [...TAKES_VALUE.keys()], "poplin <command> --help");

  return usageError(`${first.name} requires a command or a path`, "See: poplin --help");
}

/** Answer for a line whose first word is neither a command nor a path. */
function withoutCommand(word: string, flags: readonly TypedFlag[]): UsageError {
  const stray = flags.find((flag) => !TAKES_VALUE.has(flag.name));
  if (stray !== undefined) return unknownFlag(stray.name, [...TAKES_VALUE.keys()], "poplin <command> --help");

  return unknownCommand(word, true);
}

function readFlag(flag: TypedFlag, spec: CommandSpec, seen: Flags): string | true | UsageError {
  const known = spec.flags.find((candidate) => candidate.name === flag.name);

  if (known === undefined)
    return unknownFlag(
      flag.name,
      spec.flags.map((candidate) => candidate.name),
      `poplin ${spec.name} --help`,
    );

  if (seen.has(flag.name)) return usageError(`${flag.name} was passed more than once`);

  if (known.value === undefined && flag.value !== undefined) return usageError(`${flag.name} takes no value`);

  if (known.value === undefined) return true;

  if (flag.value === undefined) return usageError(`${flag.name} requires a value: ${flag.name} ${known.value}`);

  // An unjoined value that starts with a dash is far more often the next flag than a value.
  if (!flag.joined && flag.value.length > 1 && flag.value.startsWith("-"))
    return usageError(
      `${flag.name} requires a value: ${flag.name} ${known.value}`,
      `For a value starting with a dash: ${flag.name}=${known.value}`,
    );

  return flag.value;
}

function readFlags(typed: readonly TypedFlag[], spec: CommandSpec): Flags | UsageError {
  const flags = new Map<string, string | true>();

  for (const flag of typed) {
    const value = readFlag(flag, spec, flags);
    if (typeof value === "object") return value;

    flags.set(flag.name, value);
  }

  return flags;
}

/**
 * Hand the words of a line on unread, where the command works at a provider and its own parser reads them: `install`, `uninstall`, and `doctor` with `--repair`.
 *
 * @param first - where the command's word stands on the line: it is taken out, and the rest handed on as typed
 * @returns `undefined` for a command whose words are read here
 */
function handedOn(name: string, argv: readonly string[], first: number | undefined): Parsed | undefined {
  const command: ProviderCommand | undefined = name === "doctor" && asks(argv, REPAIR_FLAG) ? "repair" : providerCommand(name);
  if (command === undefined || first === undefined) return undefined;

  return { kind: "provider", command, words: [...argv.slice(0, first), ...argv.slice(first + 1)] };
}

/**
 * Hand the help of a command that works at a provider on to its own parser, which prints it: `help install`, `help install cloudflare`, `help doctor --repair`.
 *
 * @param words - the words after `help`: the command, and the provider where one is named
 * @returns `undefined` for the help of any other command, and for more words than the two
 */
function helpHandedOn(words: readonly string[], argv: readonly string[]): Parsed | undefined {
  const [topic = "", ...named] = words;
  const command: ProviderCommand | undefined = topic === "doctor" && asks(argv, REPAIR_FLAG) ? "repair" : providerCommand(topic);
  if (command === undefined || named.length > 1) return undefined;

  return { kind: "provider", command, words: [...named, ...(command === "repair" ? [REPAIR_FLAG] : []), HELP_FLAG] };
}

function helpOf(topic: string | undefined): Parsed {
  if (topic === undefined) return { kind: "help", asked: true };

  const spec = SPECS.get(topic);
  if (spec === undefined) return unknownCommand(topic, false);

  return { kind: "help", topic: spec.name, asked: true };
}

/** A refusal of commander in the product's words: a command was given too few arguments, or too many. */
function refusalOf(refused: CommanderError, spec: CommandSpec, given: readonly string[]): UsageError | undefined {
  const usage = `Usage: poplin ${spec.name} ${argumentsOf(spec)}`.trimEnd();
  if (refused.code === REFUSALS.missing) return usageError(`Missing argument <${QUOTED.exec(refused.message)?.[1] ?? ""}>`, usage);

  if (refused.code !== REFUSALS.tooMany) return undefined;

  const extra = given.slice(spec.arguments.length).map((word) => JSON.stringify(word));

  return usageError(`Unexpected ${extra.length === 1 ? "argument" : "arguments"} ${extra.join(" ")}`, usage);
}

/**
 * Read a command line into what it asks for.
 *
 * Flags go before or after the arguments, `--` ends them, and `--flag=value` joins a value to its flag. Nothing is read from disk or sent anywhere, and nothing throws.
 *
 * @param argv - the words after `poplin`, as the shell split them
 * @param now - the time `--expires` must lie after, in milliseconds since the epoch; the clock's when absent
 * @returns one command's request, a help topic, the version, or what was written wrong. A first word that is neither a command nor a path is refused, never published. The words of a command that works at a provider are handed on unread
 */
export function parseCommand(argv: readonly string[], now: number = Date.now()): Parsed {
  const typed = splitWords(argv);
  const given = SPECS.has(typed.positionals[0] ?? "") ? typed.positionals.slice(1) : typed.positionals;
  const program = buildProgram();
  let reached: { readonly spec: (typeof COMMANDS)[number]; readonly flags: Flags } | undefined;

  /** Go into a command: its help and the version are answered whatever else is on the line, and then every flag must be one of its own. */
  const enter = (command: Command): void => {
    const own = handedOn(command.name(), argv, typed.first);
    if (own !== undefined) throw new Answered(own);

    const spec = SPECS.get(command.name());
    if (spec === undefined) return;

    if (asks(argv, HELP_FLAG)) throw new Answered({ kind: "help", topic: spec.name, asked: true });

    if (asks(argv, VERSION_FLAG)) throw new Answered({ kind: "version" });

    const handed = spec.name === "help" ? helpHandedOn(given, argv) : undefined;
    if (handed !== undefined) throw new Answered(handed);

    const flags = readFlags(typed.flags, spec);
    if (isUsageError(flags)) throw new Answered(flags);

    reached = { spec, flags };
  };

  /** Answer for a line whose first word is no command: it is published only when that word looks like a path. */
  const bare = (words: readonly string[]): void => {
    const [word] = words;
    const publish = program.commands.find((command) => command.name() === BARE_COMMAND);

    if (word === undefined) throw new Answered(withoutWord(argv, typed.flags));

    if (publish === undefined || !looksLikePath(word)) throw new Answered(withoutCommand(word, typed.flags));

    enter(publish);
    publish.parse([TERMINATOR, ...words], { from: "user" });
  };

  /** Answer for a command whose flags are its own and whose arguments commander has counted. */
  const answer = (words: readonly string[]): void => {
    if (reached === undefined) return;

    throw new Answered(reached.spec.name === "help" ? helpOf(words[0]) : buildRequest(reached.spec.name, { positionals: words, flags: reached.flags }, now));
  };

  program.hook("preSubcommand", (_program, command) => enter(command)).action((words: string[]) => bare(words));

  for (const command of program.commands) command.action(() => answer(command.args));

  try {
    // The flags are read above, so commander is given the arguments alone, each as an argument whatever it starts with. It counts them, and needs no more of them than it can count.
    program.parse([TERMINATOR, ...typed.positionals.slice(0, MOST_COUNTED)], { from: "user" });
  } catch (error) {
    if (error instanceof Answered) return error.parsed;

    const refusal = error instanceof CommanderError && reached !== undefined ? refusalOf(error, reached.spec, given) : undefined;
    if (refusal !== undefined) return refusal;

    throw error;
  }

  throw new Error("commander read a command line and ran no command");
}
