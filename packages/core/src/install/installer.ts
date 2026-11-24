// How the command makes an install at a provider, with no provider named here: the provider's package gives one `Installer`, and the command works through it.
//
//   the arguments -> read -> Where (or the questions still open)
//   the token     -> find -> Found: nothing there, data left behind, a start not finished, a whole install, a name held, a block
//   Found that a run can go on from -> install -> every row, in the order of the work, and whether it is ready
//   Found that is a whole install   -> repair  -> every row of what was mended, and of the user it was asked to add
//
// Each answer is checked once, where it is read: what `read` and `token` give is taken by the later steps as it is.
// `find` only reads. `install` with a dry run only reads too, and lists the rows a run would work through: the same objects, in the same order.
// The provider asks nothing itself: it declares each question, and the command asks it, or names the option that answers it.
// An answer only the account shows the need of is asked for by `install`, before it makes anything: the command gets the answer, and runs it again.

import type { Login } from "../auth/logins";

/** Some rights of a token as the summary of the provider's form groups them: the group's heading there, and each right in the summary's own name and order, with whether the form's link chose it and whether the work goes without it. */
export interface RightGroup {
  readonly heading: string;
  readonly rights: readonly { readonly name: string; readonly chosen: boolean; readonly optional: boolean }[];
}

/** What a provider's form for a new token asks of the person about to make one, for one kind of work: what a command shows before it asks for the token. */
export interface TokenForm {
  /** The form's address, with each right chosen that a link can choose. */
  readonly link: string;

  /** What the person does on the form before its summary, in order: each one line, in the provider's own words for the control. */
  readonly before: readonly string[];

  /** The step that opens the form's summary, which is to read as `summary` does. */
  readonly compare: string;

  /** Every right the token is to end with, as the form's summary shows them, so that a person can hold the two side by side. */
  readonly summary: readonly RightGroup[];

  /** What the person does after the summary, in order. */
  readonly after: readonly string[];

  /** What the optional rights the form does not ask for are for, each in a few words; none where it asks for every one, or the work has none. */
  readonly leftOut: readonly string[];
}

declare const tokenBrand: unique symbol;

/** An account token in the form its provider takes. Made by that provider's `token` alone, and stored nowhere. */
export type Token = string & { readonly [tokenBrand]: true };

/** One option of a provider's own, as the command's parser and help are made from it. */
export interface OptionRow {
  /** The option as it is typed, such as `--domain`. */
  readonly flag: string;

  /** The name of the value it takes, such as `<name>`; `null` for an option that takes none. */
  readonly value: string | null;

  /** What it means in the help, in one line: empty where the option's name says it. */
  readonly about: string;

  /** The variable that answers the same, as the help shows it, such as `POPLIN_DOMAIN`; `null` for an option with none. */
  readonly variable: string | null;

  /** The one work the option is of, such as an install's alone; absent for an option every work takes. */
  readonly work?: "install" | "repair" | "remove";
}

/** What a person gave the provider's own options: each option typed, by its name without the dashes, with its value or `true`, and the environment. */
export interface Given {
  readonly flags: ReadonlyMap<string, string | true>;
  readonly env: Readonly<Record<string, string | undefined>>;
}

/** One answer the provider still needs. A run that may ask shows `ask` and hands the reply to `answer`; one that may not names `give`. */
export interface Question<Where> {
  /** The answer's name in a list for a program, such as `where`. */
  readonly key: string;

  /** The answer's name in a sentence, such as `where it answers`. */
  readonly name: string;

  /** The line a person is asked. */
  readonly ask: string;

  /** How to give the answer with no question, such as `Give --domain <name> or --no-domain (or POPLIN_DOMAIN).` */
  readonly give: string;

  /** Take what the person typed: the place, the questions still open, or why the text is refused. */
  answer(text: string): Read<Where>;
}

/** The provider's own answers, read once: where the install goes, or the questions still open, or one line that says what is written wrong. */
export type Read<Where> =
  | { readonly ok: true; readonly where: Where }
  | { readonly ok: false; readonly why: "open"; readonly open: readonly Question<Where>[] }
  | { readonly ok: false; readonly why: "refused"; readonly refused: string };

/** What a run reaches the world through: the platform's own, or stand-ins. `now` is the clock, in milliseconds since the epoch, and `sleep` waits for so many milliseconds; its `why` is the line a person is shown meanwhile. */
export interface Reach {
  readonly fetch: (input: string | URL | Request, init?: RequestInit) => Promise<Response>;
  readonly now: () => number;
  readonly sleep: (milliseconds: number, why?: string) => Promise<void>;
}

/** Something that stops a piece until a person acts at the provider's own pages: what it is, the line that says so, and the address to open. `right_lacking` names the right the token lacks. */
export type Blocked =
  | { readonly what: "right_lacking"; readonly right: string; readonly words: string; readonly address: string }
  | { readonly what: "storage_off" | "login_off" | "no_address" | "no_release" | "bad_release" | "newer_release"; readonly words: string; readonly address: string };

/**
 * What `find` read with a token, as one value. `place` is the provider's own: the command hands it back and never reads or prints it, since it holds the token.
 *
 * `none` is nothing of the product; `leftover` is data of the product's names and no install, which a run takes only once a person said to; `started` is an install begun and not finished, which a run goes on with.
 * `whole` is an install that is set: its version where it can be read, its dashboard's address, and the newest release where the project's website answered.
 * `held` is a name the install needs, held by something that is not the product's, or by an install the provider cannot take as one, which its words say; `blocked` is a person having to act first.
 * `after` is the command its words name for once a person did what they say: the one that ran, `again`, or an install or a repair. `notes` are on a state a run can go on from: what is switched off that a run does not stop for.
 * `choice` is a token that shows more than one place: the question's answer is a `Where` to find with again; `refused` is a token that is refused or shows no such domain, or a provider that gave no answer.
 * A `refused` of `other_place` is an install begun and not finished, for another place than the one named: `give` is the option of the place it was started for, as a line gives it and as its words name it.
 */
export type Found<Where, Place> =
  | { readonly state: "none"; readonly place: Place; readonly notes: readonly Blocked[] }
  | { readonly state: "leftover"; readonly place: Place; readonly notes: readonly Blocked[]; readonly words: string; readonly address: string }
  | { readonly state: "started"; readonly place: Place; readonly notes: readonly Blocked[] }
  | { readonly state: "whole"; readonly place: Place; readonly version: string | undefined; readonly address: string; readonly newest: string | undefined }
  | { readonly state: "held"; readonly words: string; readonly address: string; readonly after: "again" | "install" | "repair" }
  | { readonly state: "blocked"; readonly blocked: readonly Blocked[] }
  | { readonly state: "choice"; readonly question: Question<Where> }
  | { readonly state: "refused"; readonly why: "token" | "no_domain" | "unreachable"; readonly words: string }
  | { readonly state: "refused"; readonly why: "other_place"; readonly words: string; readonly give: string };

/** What a run can go on from: nothing there, a start not finished, or data left behind that a person said to use. */
export type Startable<Place> =
  | Extract<Found<never, Place>, { readonly state: "none" | "started" }>
  | (Omit<Extract<Found<never, Place>, { readonly state: "leftover" }>, "state"> & { readonly state: "adopted" });

/** Whether a run changes anything. A dry run reads, and says what a run with the same answers would do. */
export type Run = "dry-run" | "apply";

/**
 * What a run does, or a dry run would do, to one object.
 *
 * `make` it is not there; `change` it is there and differs; `remove` it is there and should not be; `leave` it is as it should be.
 * `leave-out` it is optional, and the token lacks its right or the account's plan has none.
 * `block` it cannot be made until a person acts; `fail` the provider refused it; `not-run` an earlier object stopped the run before it.
 */
export type RowState = "make" | "change" | "remove" | "leave" | "leave-out" | "block" | "fail" | "not-run";

/**
 * One object of an install, in the order of the work. `detail` names it and says why it was left out, blocked, or failed; `right` is on a row that lacks one right of the token, and names it.
 *
 * A row left out with a `right` is a piece the install works without, which the token could not read for want of that right. `extra` says what such a piece is for, in a few words, for the one line that speaks of all of them.
 */
export interface Row {
  readonly object: string;
  readonly state: RowState;
  readonly detail: string;
  readonly right?: string;
  readonly extra?: string;
}

/** Something only a person can do, at the provider's own pages: what to do there, and the address to open. */
export interface Step {
  readonly text: string;
  readonly address: string;
}

/**
 * What a run came to.
 *
 * `rows` are the same objects in the same order for a dry run and the run after it. `ready` is true for a dry run that a run would go through after, and for a run that left nothing undone.
 * `release` and `address` are absent from a run that ended before it had read the release. Whether the install answers at `address`, its dashboard's, is the command's to ask.
 * Once the release is read, `release` is the version a run uploads, also for a dry run and a run that stopped before its upload. A run that goes on with standing code uploads none, and names the version that code states, if any.
 * `proof` says how the token's rights were proven: each object's first read was allowed, which a write then proves.
 * `unused` is the first login a person gave, where the install keeps the users its records hold and that login is none of them: nobody lets that person in but a repair that adds them.
 * The second shape is a run that got no answer from the provider or the project's website, at its start or after rows it had told.
 */
export type Installed =
  | {
      readonly ok: true;
      readonly rows: readonly Row[];
      readonly steps: readonly Step[];
      readonly blocked: readonly Blocked[];
      readonly release: string | undefined;
      readonly address: string | undefined;
      readonly ready: boolean;
      readonly proof: "reads";
      readonly unused: Login | undefined;
    }
  | { readonly ok: false; readonly why: "unreachable"; readonly words: string };

/**
 * A run that stopped before it made anything or told a row, for an answer of the provider's own that only the account shows the need of.
 *
 * `question` asks for the answer, and its answer is the place to run with again. `refused` is on an answer a person gave and the provider did not take: one line that says why.
 * A dry run sends no change, so it meets no such refusal: the run after a dry run that was ready can still answer with one, in place of its rows.
 */
export interface Unanswered<Where> {
  readonly ok: false;
  readonly why: "answer";
  readonly question: Question<Where>;
  readonly refused: string | undefined;
}

/** What a removal starts from: an install that is set, one begun and not finished, data of the product's names that no install holds, or no install, where an earlier removal may have left an object behind. */
export type Removable<Place> = Extract<Found<never, Place>, { readonly state: "whole" | "started" | "leftover" | "none" }>;

/**
 * How a removal goes. A dry run lists what a run with the same `data` would do, and removes nothing.
 *
 * `data` is whether the sites' files and the records go too. A run carries `confirmed`, what the person typed as proof of which install is meant.
 */
export type Removal = { readonly run: "dry-run"; readonly data: "remove" | "keep" } | { readonly run: "apply"; readonly confirmed: string; readonly data: "remove" | "keep" };

/**
 * What a removal does, or a dry run would do, to one kind of object.
 *
 * `remove` it is there and is the product's; `gone` it was there when the run listed it, and gone before the run reached it; `keep` it is data the run was told to leave.
 * `stay` it is nothing a removal takes away, and the row says what to do by hand; one with a `right` is a kind the token could not look for, which may still be there. `skip` it carries a name of the product's and is not this install's.
 * `block` the token lacks the right to remove it, or the provider asked to wait for longer than a run waits, which a rerun goes on from; `fail` the provider refused; `not-run` an earlier object still stands that must go first.
 */
export type RemovalState = "remove" | "gone" | "keep" | "stay" | "skip" | "block" | "fail" | "not-run";

/** One kind of object of an install, in the order removed. `detail` names what is there; `count` and `bytes` are how much it holds, where that was read; `right` is on a row that lacks one right of the token. */
export interface RemovalRow {
  readonly object: string;
  readonly state: RemovalState;
  readonly detail: string;
  readonly count?: number;
  readonly bytes?: number;
  readonly right?: string;
}

/**
 * What a removal came to: its rows, the same for a dry run and the run after it, and `confirm`, what a person types to say this install is meant.
 *
 * `ready` is true for a dry run that a run would go through after, and for a run that left nothing it was to remove.
 * The second shape removed nothing: no answer, an install of another place than the one named, a `confirmed` that is not this install's `confirm`, or an account that changed since it was looked at.
 */
export type Removed =
  | { readonly ok: true; readonly rows: readonly RemovalRow[]; readonly blocked: readonly Blocked[]; readonly confirm: string; readonly ready: boolean }
  | { readonly ok: false; readonly why: "unreachable" | "other_place" | "not_confirmed" | "changed"; readonly words: string };

/** An install that is set, as `find` answers it: the one state a repair goes on from. */
export type Whole<Place> = Extract<Found<never, Place>, { readonly state: "whole" }>;

/** What a repair is asked for: whether it changes anything, whether it first brings an install that is behind to the newest release, and the email of one more person to let log in, or `undefined` for none. */
export interface Mend {
  readonly run: Run;
  readonly update: boolean;
  readonly addUser: Login | undefined;
}

/**
 * What a repair came to.
 *
 * `rows` are the same objects in the same order for a dry run and the run after it, the user a repair adds among them. `ready` is true for a run that left nothing undone, and for a dry run of one that would.
 * `address` is where the install's dashboard is.
 * The second shape is a repair that changed nothing: the provider gave no answer, or refused the token at the install; the install answers at `elsewhere` than the place named;
 * its records are of `another` poplin than this one, or it runs a newer release than the newest this one reads; or it `changed` since it was found, and is no whole install now.
 * `behind` is an install behind the newest release whose records this code does not read as they are. Its `ways` on follow its words, each a sentence that ends in its command, so that the caller can write an option after one:
 * first the product of the install's own version, which mends it as it is, then the repair that updates.
 */
export type Repaired =
  | { readonly ok: true; readonly rows: readonly Row[]; readonly steps: readonly Step[]; readonly blocked: readonly Blocked[]; readonly address: string; readonly ready: boolean }
  | { readonly ok: false; readonly why: "unreachable" | "token" | "elsewhere" | "another" | "changed"; readonly words: string }
  | { readonly ok: false; readonly why: "behind"; readonly words: string; readonly ways: readonly string[] };

/**
 * One provider, as the command works through it. `Where` is the provider's own answer of where the install goes, and `Place` what it found with a token: the command holds both and looks into neither.
 */
export interface Installer<Where, Place> {
  /** The provider as it is typed after the command, which is the name of its built file. */
  readonly id: string;

  /** Its name in the list of providers. */
  readonly name: string;

  /** Its line in the command's help. */
  readonly about: string;

  /** Its own options. */
  readonly options: readonly OptionRow[];

  /** How its options go together, such as `(--domain <name> | --no-domain)`. */
  readonly usage: string;

  /** What the account token needs for each kind of work, as the help of that work lists it: a permission a line. */
  readonly tokenHelp: Readonly<Record<"install" | "repair" | "remove", readonly string[]>>;

  /** Check a token's form; `undefined` for text that is none, which then reaches no request. */
  token(text: string): Token | undefined;

  /** Read its own options and variables, once. */
  read(given: Given): Read<Where>;

  /** The option that names the place of `where` again, word by word as a command line gives it: `--domain`, `example.com`. The account is no part of it. */
  placeWords(where: Where): readonly string[];

  /**
   * What its form for a new token asks of a person, at that place, for the work the token is made for: a repair makes less than an install, and a removal leaves some of what an install made.
   *
   * @param rights - `needed` for a token with the rights the work cannot go without, and `every` for one with the optional rights too
   */
  form(where: Where, work: "install" | "repair" | "remove", rights: "needed" | "every"): TokenForm;

  /** Look for an install with the token, in the account that place is in, for the work the token is made for: a look reads nothing that needs a permission that work's token is not asked for. It only reads. */
  find(token: Token, where: Where, reach: Reach, work: "install" | "repair" | "remove"): Promise<Found<Where, Place>>;

  /** Make the install, or with a dry run say what a run would make. `say` is told each row as it is settled. A run that lacks an answer of the provider's own makes nothing, and asks for it. */
  install(found: Startable<Place>, where: Where, login: Login, run: Run, reach: Reach, say: (row: Row) => void): Promise<Installed | Unanswered<Where>>;

  /** Remove the install and nothing else, or with a dry run list what a run would remove. `say` is told each row as it is settled. */
  remove(found: Removable<Place>, where: Where, removal: Removal, reach: Reach, say: (row: RemovalRow) => void): Promise<Removed>;

  /**
   * Mend an install that is set, with the token alone, or with a dry run say what a run would change. It needs no login of the install, and reads the install's own settings from its records.
   * A repair mends and takes no newer release: an install behind the newest release is brought to it first only where `mend.update` asks, and else one row says that a newer release is out.
   * An install that runs a newer release than this code reads is left whole.
   *
   * A user is added only once the provider took a change of who may log in from this token, in this run: a token that may only read adds nobody.
   *
   * @param where - the place a person named, which must be the install's own
   */
  repair(found: Whole<Place>, where: Where, mend: Mend, reach: Reach, say: (row: Row) => void): Promise<Repaired>;
}
