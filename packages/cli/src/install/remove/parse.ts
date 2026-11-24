// The options of `poplin uninstall <provider>`, read once into a plan: every answer given, or still to ask where a person can be asked.
// A line that contradicts itself is refused here with one line, and so is a run that asks nothing and lacks an answer. `--yes` is no proof of which install is meant.

import type { OptionRow } from "../../../../core/src/install/installer";
import { FLAG_WORDS } from "../../commands/command-table";
import { EVERY_RIGHT, rightsOf, TOKEN_VARIABLE } from "../ask";
import type { GivenToken, Missing, Parsed, Provider, Stop } from "../records";
import { type CommandWords, heldToken, lacking, MISSING_TOKEN, missingOf, type Named, parseWords, type Typed, usage, type Variables } from "../words";
import type { RemovalMode, UninstallPlan } from "./records";

/** The options of the command itself, which every provider takes. The parser reads these rows and the help prints them. */
export const UNINSTALL_OPTIONS: readonly OptionRow[] = [
  { flag: "--dry-run", value: null, about: FLAG_WORDS.dryRun, variable: null },
  { flag: "--confirm", value: "<text>", about: "Confirm the removal with the text --dry-run shows", variable: null },
  { flag: "--keep-data", value: null, about: "Keep the site files and the database", variable: null },
  { flag: "--yes", value: null, about: FLAG_WORDS.yes, variable: null },
  { flag: "--token-stdin", value: null, about: FLAG_WORDS.tokenStdin, variable: null },
  EVERY_RIGHT,
  { flag: "--json", value: null, about: "", variable: null },
];

/** The options a person may reach for that this command has none of, each with the line that says what to give. */
const ELSEWHERE: Readonly<Record<string, string>> = {
  "--force": "Fix: confirm with --confirm <text>",
  "--user": "Fix: remove --user",
  "--token": `Fix: pass --token-stdin or set ${TOKEN_VARIABLE}`,
};

/** The option of a real run alone, which a dry run refuses: a dry run removes nothing, and takes no proof. */
const RUN_ALONE = "--confirm";

/** The command, as its words are read. */
const COMMAND: CommandWords = { name: "uninstall", options: UNINSTALL_OPTIONS, elsewhere: ELSEWHERE };

/** The proof a run that asks nothing lacks, as a missing answer. */
const MISSING_PROOF: Missing = { key: "confirm", name: "confirmation", give: "pass --confirm <text>, which a run with --dry-run prints" };

/** What the switches say of how the run goes: a dry run, or a run with the proof `--confirm` gave, if it gave one; and for both whether the data stays. */
type Switches =
  | { readonly mode: "dry-run"; readonly data: "remove" | "keep" }
  | {
      readonly mode: "apply";
      readonly given: { readonly by: "flag"; readonly typed: string } | undefined;
      readonly data: "remove" | "keep";
    };

/** Read how the run goes from its switches. */
function switchesOf(shared: Typed): Switches | Stop {
  const data = shared.has("keep-data") ? "keep" : "remove";
  const typed = shared.get("confirm");
  if (shared.has("dry-run")) return typed === undefined ? { mode: "dry-run", data } : usage(`--dry-run and ${RUN_ALONE} are mutually exclusive`);

  if (typeof typed === "string" && typed.trim() === "") return usage("--confirm requires the text --dry-run shows", "Fix: get the text from a run with --dry-run");

  return { mode: "apply", given: typeof typed === "string" ? { by: "flag", typed } : undefined, data };
}

/** The mode of a run that asks nothing; `undefined` for one that removes and was given no proof. */
function fixedMode(switches: Switches): RemovalMode<never> | undefined {
  if (switches.mode === "dry-run") return switches;

  return switches.given === undefined ? undefined : { mode: "apply", confirm: switches.given, data: switches.data };
}

/** The plan of a run that asks nothing: every answer must be there, and each one that is not is named. */
function fixedPlan(read: Named, env: Variables, json: boolean): UninstallPlan | Stop {
  const switches = switchesOf(read.shared);
  if ("problem" in switches) return switches;

  const mode = fixedMode(switches);
  if (mode === undefined && read.shared.has("yes")) return usage("--yes does not confirm an uninstall", "Fix: pass --confirm <text>, which a run with --dry-run prints");

  const where = read.provider.read({ flags: read.own, env });
  if (!where.ok && where.why === "refused") return usage(where.refused);

  const held = heldToken(read, env);
  if (typeof held === "object") return held;

  const piped: GivenToken | undefined = read.shared.has("token-stdin") ? { from: "stdin" } : undefined;
  const token = held === undefined ? piped : ({ from: "environment", token: held } as const);
  const missing: Missing[] = where.ok ? [] : where.open.map(missingOf);
  if (token === undefined) missing.push(MISSING_TOKEN);

  if (mode === undefined) missing.push(MISSING_PROOF);

  if (!where.ok || token === undefined || mode === undefined) return lacking(missing);

  return { provider: read.provider, json, asking: "never", mode, where: where.where, token };
}

/** The plan of a run on a terminal: each answer given is checked, and the rest are asked for, the proof once the list was shown. */
function askingPlan(read: Named, env: Variables, json: boolean): UninstallPlan | Stop {
  const switches = switchesOf(read.shared);
  if ("problem" in switches) return switches;

  const place = read.provider.read({ flags: read.own, env });
  if (!place.ok && place.why === "refused") return usage(place.refused);

  const token = heldToken(read, env);
  if (typeof token === "object") return token;

  const mode = switches.mode === "dry-run" ? switches : ({ mode: "apply", confirm: switches.given ?? { by: "typing" }, data: switches.data } as const);
  const where = place.ok ? ({ known: true, where: place.where } as const) : ({ known: false, open: place.open } as const);

  return { provider: read.provider, json, asking: "terminal", mode, where, token, rights: rightsOf(read.shared) };
}

/**
 * Read the words after `poplin uninstall` into what they ask for.
 *
 * A run asks nothing when `--yes` or `--token-stdin` is given, or when no person can be asked. Then every answer comes from an option or a variable, the proof among them, and each missing one is named.
 *
 * @param providers - the providers the built package carries: each is a subcommand, with the options it declares
 * @param env - the environment the variables are read from; an empty variable is one that is not set
 * @param canAsk - whether a person is there to answer a question
 * @returns the help, the version, the list of providers, the question which provider with the way to go on from its answer, a refusal with its lines, or a plan in which no run that removes is without its proof
 */
export function parseUninstall(words: readonly string[], providers: readonly Provider[], env: Variables, canAsk: boolean): Parsed<UninstallPlan> {
  return parseWords(words, providers, canAsk, COMMAND, (read, asking, json) => (asking ? askingPlan(read, env, json) : fixedPlan(read, env, json)));
}
