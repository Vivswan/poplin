// What `poplin install` is read into, and what it works through. The words of the command line become one request that can only be valid, and every later step takes that.
//
//   words -> parseInstall -> Plan: every answer given, or still to ask where a person can be asked
//   Plan  -> settle       -> InstallRequest: where, the first login, the token, and how to run
//
// A provider is held as it was loaded and never looked into: its own answer of where the install goes, and what it found with a token, are its own.

import type { Login } from "../../../core/src/auth/logins";
import type { Blocked, Installer, Question, Reach, Token } from "../../../core/src/install/installer";
import type { Screen } from "../local/screen";

/** A provider whose own answers the command holds and never reads. */
export type Provider = Installer<unknown, unknown>;

/** An answer a flag gave, or with `Open` as `"ask"` one a person is asked for. */
type Choice<Open> = "yes" | "no" | Open;

/**
 * How a run goes. A dry run reads and changes nothing, so it has no wait and no login of this computer.
 *
 * @typeParam Open - `"ask"` for a run that can ask a person, and `never` for one that cannot
 */
export type InstallMode<Open> =
  | { readonly mode: "dry-run"; readonly adopt: "yes" | "no" }
  | { readonly mode: "apply"; readonly adopt: Choice<Open>; readonly wait: boolean; readonly login: Choice<Open> };

/** Whether a person can be asked, tied to how the run goes: only a run that can ask holds an answer still to ask. */
type Asking ={ readonly asking: "terminal"; readonly mode: InstallMode<"ask"> } | { readonly asking: "never"; readonly mode: InstallMode<never> };

/** Where a run that asks nothing takes the account token from: the variable, already checked, or standard input, still to read. */
export type GivenToken = { readonly from: "environment"; readonly token: Token } | { readonly from: "stdin" };

/** One answer a run that asks nothing lacks: its name for a program, its name in a sentence, and how to give it. */
export interface Missing {
  readonly key: string;
  readonly name: string;
  readonly give: string;
}

/**
 * The command line, read. A run that asks nothing holds every answer; one on a terminal holds each answer given, and asks for the rest.
 *
 * `where` on a terminal is the provider's own answer, or the questions it still has. `token` there is the one the variable held.
 */
export type Plan = { readonly provider: Provider; readonly json: boolean } & (
  | { readonly asking: "never"; readonly mode: InstallMode<never>; readonly where: unknown; readonly login: Login; readonly token: GivenToken }
  | {
      readonly asking: "terminal";
      readonly mode: InstallMode<"ask">;
      readonly where: { readonly known: true; readonly where: unknown } | { readonly known: false; readonly open: readonly Question<unknown>[] };
      readonly login: Login | undefined;
      readonly token: Token | undefined;
    }
);

/** Everything a run needs, each answer checked where it was read. */
export type InstallRequest = { readonly provider: Provider; readonly json: boolean; readonly where: unknown; readonly login: Login; readonly token: Token } & Asking;

/**
 * What to run after a command ended: the step as one word for a program, and its command line.
 *
 * The line holds none of the answers the line before it gave: no token, no place, no proof, no consent. It keeps each careful choice of that line where the same command goes on.
 * It holds the place too where the stop's own sentence names one, as after a repair on an install that was started for another place. A consent, as `--adopt` is, is never on the line: a person adds it.
 * `install`, `repair`, and `uninstall` are the three commands; `login` logs a computer in to an install that is whole; `none` is an end with nothing left to run.
 */
export type Next = { readonly step: "install" | "repair" | "uninstall" | "login"; readonly command: string } | { readonly step: "none"; readonly command: null };

/** A choice of a line that makes its run do less: keep the data, or change nothing. A line that goes on without it would remove or change what the line before left alone. */
export type Careful = "--keep-data" | "--dry-run";

/** Whether an install that is there needs mending, as a repair's dry run read it; `unread` where the provider refused that read, with the sentence it refused in. */
type Mending = { readonly mend: "nothing" | "something" } | { readonly mend: "unread"; readonly unread: string };

/**
 * Why a command stopped before its work was done. `exit` is the command's exit code.
 *
 * `usage` is a line written wrong, and `missing_answer` a run that asks nothing and lacks one. The rest are what the provider's account holds, or that it gave no answer.
 * `no_install`, `other_place`, `not_confirmed`, and `changed` are a removal's: nothing to remove, an install of another place than the one named, a typed name that is not the install's, and an account that changed since the look.
 * A repair has `no_install`, `other_place`, and `changed` too, and an install that is `unfinished`, or whose records are of `another_version` of the product.
 * A stop carries `next` where what goes on from it is another command than the one that stopped; from every other stop, the same command goes on.
 */
export type Stop =
  | { readonly problem: "usage"; readonly exit: 2; readonly lines: readonly string[] }
  | { readonly problem: "missing_answer"; readonly exit: 2; readonly missing: readonly Missing[] }
  | { readonly problem: "no_provider"; readonly exit: 1; readonly lines: readonly string[] }
  | ({ readonly problem: "already_installed"; readonly exit: 1; readonly version: string | undefined; readonly address: string; readonly newest: string | undefined; readonly next: Next } & Mending)
  | { readonly problem: "no_install" | "unfinished" | "another_version"; readonly exit: 1; readonly words: string; readonly next: Next }
  | { readonly problem: "leftover"; readonly exit: 1; readonly words: string; readonly address: string }
  | { readonly problem: "name_held"; readonly exit: 1; readonly words: string; readonly address: string; readonly next: Next }
  | { readonly problem: "blocked"; readonly exit: 1; readonly blocked: readonly Blocked[] }
  | { readonly problem: "token_refused" | "no_domain" | "stopped" | "crashed" | "other_place" | "not_confirmed" | "changed"; readonly exit: 1; readonly words: string }
  | { readonly problem: "unreachable"; readonly exit: 5; readonly words: string };

/**
 * What the words after an install command ask for: the help, the version, the list of providers, a refusal, or the command's plan to run.
 *
 * `pick` is a line on a terminal that names no provider: `named` reads the same line for the provider the person chose.
 * A `stop` holds the provider the line that goes on from it names: the one it names as its subcommand, or the only one the package carries; `undefined` where neither says which.
 */
export type Parsed<Planned> =
  | { readonly kind: "help"; readonly provider: Provider | undefined }
  | { readonly kind: "version" }
  | { readonly kind: "list"; readonly json: boolean }
  | { readonly kind: "pick"; readonly json: false; readonly named: (provider: Provider) => Parsed<Planned> }
  | { readonly kind: "stop"; readonly stop: Stop; readonly json: boolean; readonly provider: Provider | undefined }
  | { readonly kind: "plan"; readonly plan: Planned };

/** What the words after `poplin install` ask for. */
export type ParsedInstall = Parsed<Plan>;

/** What the command reaches outside its arguments, beside the machine's own ends, so a test can stand in for each. */
export interface InstallEnds {
  /** Loads every provider the built package carries. */
  readonly providers: () => Promise<readonly Provider[]>;

  /** Where the questions are put and the lines shown. */
  readonly screen: Screen;

  /** Reads all of standard input, for a token that is piped. */
  readonly input: () => Promise<string>;

  /** What a provider reaches the world through. */
  readonly reach: Reach;

  /** Waits that many milliseconds between two questions to a new install; it throws once the person stopped the command. */
  readonly sleep: (milliseconds: number) => Promise<void>;
}
