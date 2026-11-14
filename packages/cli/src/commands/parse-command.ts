// The command line, read into one request: the words a person typed become a command with checked arguments, a help topic, or a refusal that says what to type.

import { parseArgs } from "node:util";

import { BARE_COMMAND, COMMANDS, type CommandName, type CommandSpec, HELP_FLAG, VERSION_FLAG } from "./command-table";
import { buildRequest, type Request } from "./requests";
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

/** The word that ends the flags: every word after it is an argument. */
const TERMINATOR = "--";

/** A word that can be put after `poplin ./` in a hint as it is, with nothing a shell or a terminal reads. */
const PLAIN_WORD = /^[\w.-]+$/;

/** One flag as typed: its name with the dashes, its value when one came with it, and whether the value was joined by `=`. */
interface TypedFlag {
  readonly name: string;
  readonly value: string | undefined;
  readonly joined: boolean;
}

/** The words of a command line, split into the flags and the rest in the order typed. */
interface TypedWords {
  readonly flags: readonly TypedFlag[];
  readonly positionals: readonly string[];
}

/** What a command line asks for: a command's request, the help of a command or of `poplin` itself, the version, or a refusal. `asked` is false for the help an empty command line gets. */
export type Parsed = Request | { readonly kind: "help"; readonly topic?: CommandName; readonly asked: boolean } | { readonly kind: "version" } | UsageError;

function splitWords(argv: readonly string[]): TypedWords {
  const { tokens } = parseArgs({ args: [...argv], options: PARSE_OPTIONS, strict: false, tokens: true, allowPositionals: true });
  const flags: TypedFlag[] = [];
  const positionals: string[] = [];

  for (const token of tokens) {
    if (token.kind === "positional") positionals.push(token.value);

    if (token.kind === "option") flags.push({ name: token.rawName, value: token.value, joined: token.inlineValue === true });
  }

  return { flags, positionals };
}

function unknownFlag(typed: string, known: readonly string[], listedBy: string): UsageError {
  const meant = nearest(typed, known);

  return usageError(`unknown flag ${JSON.stringify(typed)}`, meant === undefined ? `${listedBy} lists the flags` : `did you mean ${meant}?`);
}

function unknownCommand(word: string, publishHint: boolean): UsageError {
  const meant = nearest(word, [...SPECS.keys()]);
  const hints: string[] = [];

  if (meant !== undefined) hints.push(`Did you mean: poplin ${meant}?`);

  if (publishHint && PLAIN_WORD.test(word)) hints.push(`To publish a ${word.endsWith(".html") ? "file" : "folder"} with that name: poplin ./${word}`);

  if (hints.length === 0) hints.push("poplin --help lists the commands");

  return usageError(`unknown command ${JSON.stringify(word)}`, hints.join(" "));
}

/** The command a line runs and the arguments after it. A first word that is no command is published only when it looks like a path. */
function resolveCommand(positionals: readonly string[]): { readonly spec: (typeof COMMANDS)[number]; readonly rest: readonly string[] } | undefined {
  const [word = "", ...rest] = positionals;
  const named = SPECS.get(word);
  if (named !== undefined) return { spec: named, rest };

  const bare = SPECS.get(BARE_COMMAND);
  if (bare === undefined || !looksLikePath(word)) return undefined;

  return { spec: bare, rest: positionals };
}

/** Whether a flag stands as a word of its own before `--`, even where the flag before it would take it as a value. */
function asks(argv: readonly string[], flag: string): boolean {
  const end = argv.indexOf(TERMINATOR);

  return argv.slice(0, end === -1 ? argv.length : end).includes(flag);
}

function withoutCommand(argv: readonly string[], flags: readonly TypedFlag[]): Parsed {
  if (asks(argv, HELP_FLAG)) return { kind: "help", asked: true };

  if (asks(argv, VERSION_FLAG)) return { kind: "version" };

  const [first] = flags;
  if (first === undefined) return { kind: "help", asked: false };

  if (!TAKES_VALUE.has(first.name)) return unknownFlag(first.name, [...TAKES_VALUE.keys()], "poplin help <command>");

  return usageError(`${first.name} needs a command or a path before or after it`, "poplin --help lists the commands");
}

function readFlag(flag: TypedFlag, spec: CommandSpec, seen: Flags): string | true | UsageError {
  const known = spec.flags.find((candidate) => candidate.name === flag.name);

  if (known === undefined)
    return unknownFlag(
      flag.name,
      spec.flags.map((candidate) => candidate.name),
      `poplin help ${spec.name}`,
    );

  if (seen.has(flag.name)) return usageError(`${flag.name} was given twice`);

  if (known.value === undefined && flag.value !== undefined) return usageError(`${flag.name} takes no value`);

  if (known.value === undefined) return true;

  if (flag.value === undefined) return usageError(`${flag.name} needs a value: ${flag.name} ${known.value}`);

  // An unjoined value that starts with a dash is far more often the next flag than a value.
  if (!flag.joined && flag.value.length > 1 && flag.value.startsWith("-"))
    return usageError(
      `${flag.name} needs a value: ${flag.name} ${known.value}`,
      `for a value that starts with a dash, join the two with =: ${flag.name}=${known.value}`,
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

function countArguments(spec: CommandSpec, given: readonly string[]): UsageError | undefined {
  const usage =
    `poplin ${spec.name} ${spec.arguments.map((argument) => (argument.required ? `<${argument.name}>` : `[<${argument.name}>]`)).join(" ")}`.trimEnd();
  const missing = spec.arguments.find((argument, index) => argument.required && given[index] === undefined);

  if (missing !== undefined) return usageError(`poplin ${spec.name} needs a ${missing.name}`, usage);

  if (given.length > spec.arguments.length) {
    const extra = given.slice(spec.arguments.length).map((word) => JSON.stringify(word));

    return usageError(`too many arguments for poplin ${spec.name}: ${extra.join(" ")}`, usage);
  }

  return undefined;
}

function helpOf(topic: string | undefined): Parsed {
  if (topic === undefined) return { kind: "help", asked: true };

  const spec = SPECS.get(topic);
  if (spec === undefined) return unknownCommand(topic, false);

  return { kind: "help", topic: spec.name, asked: true };
}

/**
 * Read a command line into what it asks for.
 *
 * Flags go before or after the arguments, `--` ends them, and `--flag=value` joins a value to its flag. Nothing is read from disk or sent anywhere, and nothing throws.
 *
 * @param argv - the words after `poplin`, as the shell split them
 * @param now - the time `--expires` must lie after, in milliseconds since the epoch; the clock's when absent
 * @returns one command's request, a help topic, the version, or what was written wrong. A first word that is neither a command nor a path is refused, never published
 */
export function parseCommand(argv: readonly string[], now: number = Date.now()): Parsed {
  const typed = splitWords(argv);
  if (typed.positionals.length === 0) return withoutCommand(argv, typed.flags);

  const resolved = resolveCommand(typed.positionals);

  if (resolved === undefined) {
    const stray = typed.flags.find((flag) => !TAKES_VALUE.has(flag.name));
    if (stray !== undefined) return unknownFlag(stray.name, [...TAKES_VALUE.keys()], "poplin help <command>");

    return unknownCommand(typed.positionals[0] ?? "", true);
  }

  const { spec, rest } = resolved;
  if (asks(argv, HELP_FLAG)) return { kind: "help", topic: spec.name, asked: true };

  if (asks(argv, VERSION_FLAG)) return { kind: "version" };

  const flags = readFlags(typed.flags, spec);
  if (isUsageError(flags)) return flags;

  const miscounted = countArguments(spec, rest);
  if (miscounted !== undefined) return miscounted;

  if (spec.name === "help") return helpOf(rest[0]);

  return buildRequest(spec.name, { positionals: rest, flags }, now);
}
