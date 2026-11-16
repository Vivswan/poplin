// A made-up provider and a bench for `poplin install` and `poplin doctor --repair`: the command runs in process against an account held in memory, and everything it printed and asked is kept.
//
// The provider is no real one: its options, its words, and its token's form are its own, so the command is proven to work through the interface alone.

import type { Login } from "../../../../core/src/auth/logins";
import type { TokenFacts } from "../../../../core/src/install/token-facts";
import type { Found, Given, Installed, Installer, Mend, Question, Read, Removable, Removal, RemovalRow, Removed, Repaired, Row, Run, Startable, Token, Whole } from "../../../../core/src/install/installer";
import type { Io } from "../../../src/commands/records";
import { run } from "../../../src/commands/run";
import type { InstallEnds } from "../../../src/install/records";
import type { Pick as Choice, Screen } from "../../../src/local/screen";
import { words } from "../../commands/support/command-line";

/** A token of the made-up provider's form. */
export const TOKEN = "tok_k3f9x2ab";

/** The address the made-up install's dashboard is at. */
export const ADDRESS = "https://poplin.example.com";

/** The rows a fresh install works through, in the order of the work. */
export const FRESH: readonly Row[] = [
  { object: "Store", state: "make", detail: "poplin-sites" },
  { object: "Records", state: "make", detail: "poplin" },
  { object: "Program", state: "make", detail: "poplin, to run 0.1.0" },
  { object: "Address", state: "leave", detail: "poplin.example.com" },
  { object: "Guard rule", state: "leave-out", detail: "the token lacks Rules: Edit (optional)", right: "Rules: Edit" },
];

/** The rows a removal of a whole install works through, in the order removed. */
export const WHOLE: readonly RemovalRow[] = [
  { object: "Address", state: "remove", detail: "poplin.example.com" },
  { object: "Program", state: "remove", detail: "poplin" },
  { object: "Store", state: "remove", detail: "poplin-sites: 2 files, 15 B", count: 2, bytes: 15 },
  { object: "Records", state: "remove", detail: "poplin: 3 sites", count: 3 },
  { object: "Account token", state: "stay", detail: "delete it at Stand-In Host" },
];

/** Where the made-up provider puts an install: at a place of a name, or at none. */
export type Where = { readonly kind: "place"; readonly name: string; readonly account?: string } | { readonly kind: "none"; readonly account?: string };

/** What the made-up provider found: the token it looked with, which the command must hand back and never print. */
export interface Place {
  readonly token: Token;
}

/** What the account in memory holds, and what was done to it. */
export interface Account {
  /** What each look finds, in order; the last one stands for every look after it. */
  scenes: Found<Where, Place>[];

  /** What a run comes to, in place of the fresh rows. */
  installed: Installed | undefined;

  /** What a run throws in place of working. */
  crash: Error | undefined;

  /** The place of each look, in order. */
  readonly finds: Where[];

  /** What each token a person was asked for was to be made for, in order. */
  readonly tokensFor: string[];

  /** What each call of `install` was handed. */
  readonly runs: { readonly found: Startable<Place>; readonly where: Where; readonly login: Login; readonly run: Run }[];

  /** How many objects the runs made or changed. */
  changes: number;

  /** What a removal comes to, in place of the rows of a whole install; given the removal, so a test can refuse what was typed. */
  removed: ((removal: Removal) => Removed) | undefined;

  /** What each call of `remove` was handed. */
  readonly removals: { readonly found: Removable<Place>; readonly where: Where; readonly removal: Removal }[];

  /** What a repair comes to; one that leaves every row of the fresh install unless given. */
  repaired: Repaired | undefined;

  /** What each call of `repair` was handed. */
  readonly repairs: { readonly found: Whole<Place>; readonly where: Where; readonly mend: Mend }[];
}

/** How one command line is run. */
interface Options {
  /** The environment; empty unless given. */
  readonly env?: Readonly<Record<string, string | undefined>>;

  /** Whether a person is there to ask; nobody unless said. */
  readonly asks?: boolean;

  /** What the person answers each question with, in order: a line typed, yes or no, or `undefined` for a question they end. */
  readonly typed?: readonly (string | boolean | undefined)[];

  /** What standard input holds. */
  readonly stdin?: string;

  /** The status the install's address answers each question of the wait with, in order; the last one stands for every question after it. 401, an install that is up, unless given. */
  readonly statuses?: readonly number[];

  /** How long each question of the wait takes on the clock, in milliseconds; no time unless given. */
  readonly questionMs?: number;

  /** The providers the package carries, in place of the one made-up provider. */
  readonly providers?: readonly Installer<unknown, unknown>[];
}

/** What the stand-in's form for a new token asks for at a place. */
function factsAt(where: Where): TokenFacts {
  return {
    tokenRights: where.kind === "place" ? ["Places: Read", "Programs: Edit"] : ["Programs: Edit"],
    tokenLink: "https://host.example.com/tokens/new?rights=chosen",
    tokenOptional: [{ right: "Rules: Edit", adds: "a guard rule" }],
    tokenNote: "The form asks which account the token is for.",
    tokenFor: where.kind === "place" ? "this account and this place" : "this account",
  };
}

/**
 * What one command printed and asked, and how it exited. `shown` holds every line and every question in the order shown, each line with where it went and its tone.
 *
 * `fetched` lists what the login offer asked for, `reached` what the wait asked for, and `slept` how long each rest of the wait was.
 */
export interface Ran {
  readonly code: number;
  readonly out: string[];
  readonly err: string[];
  readonly asked: string[];
  readonly shown: string[];
  readonly fetched: string[];
  readonly reached: string[];
  readonly slept: number[];
}

function placeQuestion(account: string | undefined): Question<Where> {
  return {
    key: "where",
    name: "where it answers",
    ask: "Your own place (example.com), or Enter for none:",
    give: "Give --place <name> or --no-place (or POPLIN_PLACE).",
    answer: (text) => readPlace(text, account),
  };
}

function readPlace(text: string, account: string | undefined): Read<Where> {
  const extra = account === undefined ? {} : { account };
  if (text === "" || text === "none") return { ok: true, where: { kind: "none", ...extra } };

  if (!/^[a-z0-9-]+(\.[a-z0-9-]+)+$/.test(text)) return { ok: false, why: "refused", refused: `--place takes a name alone, such as example.com: ${JSON.stringify(text)}` };

  return { ok: true, where: { kind: "place", name: text, ...extra } };
}

/** Read the made-up provider's own options and variables: a place, none, or the question that is still open. */
function readGiven(given: Given): Read<Where> {
  const typed = given.flags.get("account") ?? given.env.POPLIN_ACCOUNT;
  const account = typeof typed === "string" ? typed : undefined;
  if (given.flags.has("place") && given.flags.has("no-place")) return { ok: false, why: "refused", refused: "give one of --place <name> and --no-place" };

  if (given.flags.has("no-place")) return readPlace("none", account);

  const named = given.flags.get("place") ?? given.env.POPLIN_PLACE;
  if (typeof named !== "string" || named === "") return { ok: false, why: "open", open: [placeQuestion(account)] };

  return readPlace(named, account);
}

/** The question a token that shows two accounts is asked: its answer is the place with the account chosen. */
export function accountQuestion(where: Where, ask = "Which account? 1) First  2) Second"): Question<Where> {
  return {
    key: "account",
    name: "the account",
    ask,
    give: "Give --account <id> (or POPLIN_ACCOUNT).",
    answer: (text) => {
      if (text !== "1" && text !== "2") return { ok: false, why: "refused", refused: "type 1 or 2" };

      return { ok: true, where: { ...where, account: text === "1" ? "first" : "second" } };
    },
  };
}

/** What a run of the fresh rows comes to. */
export function installedOf(rows: readonly Row[], more: Partial<Pick<Extract<Installed, { readonly ok: true }>, "blocked" | "steps" | "ready">> = {}): Extract<Installed, { readonly ok: true }> {
  return { ok: true, rows, steps: more.steps ?? [], blocked: more.blocked ?? [], release: "0.1.0", address: ADDRESS, ready: more.ready ?? true, proof: "reads" };
}

/** What a repair of some rows comes to. */
export function repairedOf(rows: readonly Row[], more: Partial<Pick<Extract<Repaired, { readonly ok: true }>, "blocked" | "steps" | "ready">> = {}): Extract<Repaired, { readonly ok: true }> {
  return { ok: true, rows, steps: more.steps ?? [], blocked: more.blocked ?? [], address: ADDRESS, ready: more.ready ?? true };
}

/** An account that holds nothing of the product. */
export function emptyAccount(): Account {
  return {
    scenes: [{ state: "none", place: { token: TOKEN as Token }, notes: [] }],
    installed: undefined,
    crash: undefined,
    finds: [],
    tokensFor: [],
    runs: [],
    changes: 0,
    removed: undefined,
    removals: [],
    repaired: undefined,
    repairs: [],
  };
}

/** What a removal of some rows comes to; the install's address is what a person types. */
export function removedOf(rows: readonly RemovalRow[], more: Partial<Pick<Extract<Removed, { readonly ok: true }>, "blocked" | "ready">> = {}): Extract<Removed, { readonly ok: true }> {
  return { ok: true, rows, blocked: more.blocked ?? [], confirm: new URL(ADDRESS).host, ready: more.ready ?? true };
}

/**
 * The made-up provider over an account in memory.
 *
 * A dry run and a run say the same rows; only a run counts a change for each row it made or changed.
 */
export function standIn(account: Account, id = "stand-in"): Installer<Where, Place> {
  return {
    id,
    name: "Stand-In Host",
    about: "Stand-In Host: under your own place, or without one",
    options: [
      { flag: "--place", value: "<name>", about: "under your own place: example.com", variable: "POPLIN_PLACE" },
      { flag: "--no-place", value: null, about: "at the address the host gives the account", variable: "POPLIN_PLACE=none" },
      { flag: "--account", value: "<id>", about: "the account, when the token shows more than one", variable: "POPLIN_ACCOUNT" },
    ],
    usage: "(--place <name> | --no-place)",
    tokenHelp: ["The account token needs:", "  with a place   two permissions: Places: Read, Programs: Edit", "  without        one permission: Programs: Edit"],
    token: (text) => (/^tok_[a-z0-9]{8}$/.test(text) ? (text as Token) : undefined),
    read: readGiven,
    facts: (where, work) => {
      account.tokensFor.push(work);

      return factsAt(where);
    },
    find: async (_token, where) => {
      account.finds.push(where);
      const scene = account.scenes.length > 1 ? account.scenes.shift() : account.scenes[0];
      if (scene === undefined) throw new Error("the account has no scene");

      return scene;
    },
    install: async (found, where, login, mode, _reach, say) => {
      account.runs.push({ found, where, login, run: mode });
      if (account.crash !== undefined) throw account.crash;

      const installed = account.installed ?? installedOf(FRESH);
      if (!installed.ok) return installed;

      for (const row of installed.rows) say(row);

      if (mode === "apply") account.changes += installed.rows.filter((row) => row.state === "make" || row.state === "change").length;

      return installed;
    },
    remove: async (found, where, removal, _reach, say) => {
      account.removals.push({ found, where, removal });
      if (account.crash !== undefined) throw account.crash;

      const removed = account.removed?.(removal) ?? removedOf(WHOLE);
      if (!removed.ok) return removed;

      for (const row of removed.rows) say(row);

      if (removal.run === "apply") account.changes += removed.rows.filter((row) => row.state === "remove").length;

      return removed;
    },
    repair: async (found, where, mend, _reach, say) => {
      account.repairs.push({ found, where, mend });
      const repaired = account.repaired ?? repairedOf(FRESH.map((row) => (row.state === "make" ? { ...row, state: "leave" } : row)));
      if (!repaired.ok) return repaired;

      for (const row of repaired.rows) say(row);

      if (mend.run === "apply") account.changes += repaired.rows.filter((row) => row.state === "make" || row.state === "change").length;

      return repaired;
    },
  };
}

/** A screen that keeps what it is shown and answers from a list. A question with no answer left fails the test. */
function screenOf(ran: Ran, typed: (string | boolean | undefined)[]): Screen {
  const answer = <Answer extends string | boolean>(question: string, kind: "string" | "boolean"): Answer | undefined => {
    ran.asked.push(question);
    ran.shown.push(`ask: ${question}`);
    if (typed.length === 0) throw new Error(`a question was asked that the test has no answer for: ${question}`);

    const next = typed.shift();
    if (next !== undefined && typeof next !== kind) throw new Error(`the answer ${JSON.stringify(next)} is not the kind the question takes: ${question}`);

    return next as Answer | undefined;
  };

  return {
    line: (tone, text) => {
      ran.out.push(text);
      ran.shown.push(`out ${tone}: ${text}`);
    },
    aside: (tone, text) => {
      ran.err.push(text);
      ran.shown.push(`err ${tone}: ${text}`);
    },
    ask: async (question, secret) => answer<string>(secret === undefined ? question : `${question} [secret]`, "string"),
    confirm: async (question, initial) => answer<boolean>(`${question} [${initial ? "Y/n" : "y/N"}]`, "boolean"),
    choose: async (question, picks: readonly Choice[]) => answer<string>(`${question} ${picks.map((pick) => pick.value).join("|")}`, "string"),
    working: () => undefined,
    rest: () => undefined,
  };
}

/**
 * Run one command line against an account, through the command's own `run`.
 *
 * Every run is checked for the token in what it printed and asked before it is handed back. A request the login offer sends is kept in `fetched` and gets no answer.
 *
 * @param line - the words after `poplin`, such as `install stand-in --no-place`
 */
export async function runLine(line: string, account: Account, options: Options = {}): Promise<Ran> {
  const ran: Ran = { code: -1, out: [], err: [], asked: [], shown: [], fetched: [], reached: [], slept: [] };
  const typed = [...(options.typed ?? [])];
  const statuses = [...(options.statuses ?? [401])];
  let clock = 0;
  const sleep = async (milliseconds: number): Promise<void> => {
    ran.slept.push(milliseconds);
    clock += milliseconds;
  };
  const ends: InstallEnds = {
    providers: async () => options.providers ?? [standIn(account) as Installer<unknown, unknown>],
    screen: screenOf(ran, typed),
    input: async () => options.stdin ?? "",
    reach: {
      fetch: async (input) => {
        ran.reached.push(String(input));
        clock += options.questionMs ?? 0;

        return new Response(null, { status: statuses.length > 1 ? statuses.shift() : statuses[0] });
      },
      now: () => clock,
      sleep,
    },
    sleep,
  };
  const io: Io = {
    out: (text) => {
      ran.out.push(text);
      ran.shown.push(`out: ${text}`);
    },
    err: (text) => {
      ran.err.push(text);
      ran.shown.push(`err: ${text}`);
    },
    status: () => undefined,
    fetch: async (input) => {
      ran.fetched.push(input);

      throw new TypeError("no network in this test");
    },
    machine: { env: options.env ?? {}, platform: process.platform, home: "/nowhere" },
    terminal: { asks: options.asks ?? false, progress: false },
    ask: async () => {
      throw new Error("the command asked through the plain question, not the screen");
    },
    timeoutMs: 2000,
    computer: "test-computer",
    open: () => undefined,
    pause: async () => "over",
    stopped: new AbortController().signal,
  };

  const code = await run(words(`poplin ${line}`), io, undefined, () => ends);
  const printed = [...ran.out, ...ran.err, ...ran.asked].join("\n");
  if (printed.includes(TOKEN)) throw new Error(`the token was printed: ${printed.replaceAll(TOKEN, "<the token>")}`);

  if (typed.length > 0) throw new Error(`answers were left over: ${JSON.stringify(typed)}`);

  return { ...ran, code };
}
