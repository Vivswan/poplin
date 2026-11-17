// How `poplin install` words what it found and did: one line per object, the same words for a dry run and for a run but for the tense, and one JSON value for a program.
//
//   a dry run    would create   <object>   <detail>
//   a run        created        <object>   <detail>

import type { Login } from "../../../core/src/auth/logins";
import type { Blocked, Found, Installed, OptionRow, Repaired, Row, RowState, Run, WorkTokenFacts } from "../../../core/src/install/installer";
import { HELP_FLAG, VERSION_FLAG } from "../commands/command-table";
import { columns, countText, type StateWords, wordedRow } from "../commands/text";
import type { Line } from "../local/screen";
import type { Careful, Next, Provider, Stop } from "./records";

/** The word of each state in a dry run and in a run, and what kind of line it is. */
const STATES: Readonly<Record<RowState, StateWords>> = {
  make: { "dry-run": "would create", apply: "created", tone: "done" },
  change: { "dry-run": "would update", apply: "updated", tone: "done" },
  remove: { "dry-run": "would remove", apply: "removed", tone: "done" },
  leave: { "dry-run": "unchanged", apply: "unchanged", tone: "note" },
  "leave-out": { "dry-run": "would skip", apply: "skipped", tone: "warning" },
  block: { "dry-run": "blocked", apply: "blocked", tone: "error" },
  fail: { "dry-run": "failed", apply: "failed", tone: "error" },
  "not-run": { "dry-run": "not run", apply: "not run", tone: "warning" },
};

/** The states of an object that a run changes, or a dry run would. */
const CHANGES: ReadonlySet<RowState> = new Set(["make", "change", "remove"]);

/** What the line of an install that is there says of it, by whether it needs a repair. */
const STANDING = { nothing: " and needs no repair", something: " and needs a repair", unread: "" } as const;

/** The states of an object a run did not bring to what it should be. */
const UNDONE: ReadonlySet<RowState> = new Set(["block", "fail", "not-run"]);

/** The states a dry run counts in its last line, in the order it names them, each with its word there. */
const COUNTED: readonly (readonly [RowState, string])[] = [
  ["make", "create"],
  ["change", "update"],
  ["remove", "remove"],
  ["leave-out", "skip"],
];

/** What a line that stands under another starts with. */
const INDENT = "  ";

/** How some parts are joined into one phrase: `a and b`, `a, b, and c`. */
const LIST = new Intl.ListFormat("en", { style: "long", type: "conjunction" });

/** A word a shell reads as it is written, with no quote around it. It holds no equals sign: zsh takes a word that starts with one as a command to look up. */
const PLAIN_WORD = /^[A-Za-z0-9@%+:,./_-]+$/;

/** A word cmd.exe and PowerShell both read as it is written, as does the command file `npx` runs through, which reads its arguments by cmd.exe's rules again whatever quotes stood around them. */
const WINDOWS_WORD = /^[A-Za-z0-9][A-Za-z0-9@+./_-]*$/;

/** The platform whose terminals read a pasted line by the rules of cmd.exe or of PowerShell: a run cannot tell which. */
const WINDOWS = "win32";

/** The option of a repair's user, as a line that leaves it out names it for a person to add. */
const ADD_USER = "--add-user <email>";

/** The sentence every stop before the first change ends in, on the screen and in the one JSON value alike. */
export const UNCHANGED = "Nothing changed";

/** What a help lists in place of the providers where the built package carries none. */
export const NO_PROVIDER = "none: this build of poplin includes no provider";

/** Every step a command can name as the next, with its command line: the provider where the line got as far as one, each option in `named` (a place, a user, a repair's update, never a consent), then each careful choice. */
export const NEXT = {
  install: (provider: Provider | undefined, careful: readonly Careful[] = [], named: readonly string[] = []): Next => ({ step: "install", command: lineOf(["npx poplin install", provider?.id, ...named], careful) }),
  repair: (poplin: "this" | "newest" = "this", careful: readonly Careful[] = [], named: readonly string[] = []): Next => ({
    step: "repair",
    command: lineOf([poplin === "newest" ? "npx poplin@latest doctor --repair" : "npx poplin doctor --repair", ...named], careful),
  }),
  uninstall: (provider: Provider | undefined, careful: readonly Careful[] = [], named: readonly string[] = []): Next => ({ step: "uninstall", command: lineOf(["npx poplin uninstall", provider?.id, ...named], careful) }),
  login: (address: string): Next => ({ step: "login", command: `npx poplin login --server ${address}` }),
  none: (): Next => ({ step: "none", command: null }),
} satisfies Readonly<Record<Next["step"], (...given: never[]) => Next>>;

/** How the last lines of a run are worded: what a run that left nothing undone is called, what to run after it, which goes on from what stands, what runs the same command again, and the repair of an install whose address stays silent. */
export interface Ending {
  readonly done: string;
  readonly next: Next;
  readonly again: Next;
  readonly repair: Next;
}

/** A stop that came while a plan's open answers were settled, with the place the run knew by then: none while that was still to ask. */
export interface Unsettled {
  readonly stop: Stop;
  readonly place: readonly string[];
}

function plain(text: string): Line {
  return { tone: "plain", text };
}

/**
 * Put the command's own words after a sentence a provider said, which ends with a full stop or without one.
 *
 * @returns the two with one full stop between them
 */
export function followed(sentence: string, tail: string): string {
  return `${sentence.replace(/\.$/, "")}. ${tail}`;
}

/**
 * The careful choices a command named next keeps after a run that worked through its rows.
 *
 * @param ready - whether the run left nothing undone, or a dry run says a run would leave nothing
 * @returns every choice, but for `--dry-run` once a dry run is ready: the run is what follows it
 */
export function carried(careful: readonly Careful[], ready: boolean): readonly Careful[] {
  return ready ? careful.filter((choice) => choice !== "--dry-run") : careful;
}

/** The careful choice of a line by how its run goes: `--dry-run` of a dry run, and none of a run. */
export function carefulOf(run: Run): readonly Careful[] {
  return run === "dry-run" ? ["--dry-run"] : [];
}

/** Say `rerun this command` with each careful choice the line carried, so the sentence names what the next step's command line holds. */
export function againWords(careful: readonly Careful[]): string {
  return careful.length === 0 ? "rerun this command" : `rerun this command with ${careful.join(" and ")}`;
}

/**
 * The stop of a name the install needs that another thing holds, with the command the provider's sentence names as its next step.
 *
 * @param again - what runs the command that stopped again, with the careful choices of its line: it is also the next step where the sentence names this same command
 * @param provider - the provider, which an install's command line names
 * @param place - the place the run knows, which the provider's sentence writes after the command it names
 * @param repair - what names a repair as a next step: `NEXT.repair`, or a repair's own way, which keeps the user of its line
 */
export function heldStop(found: Extract<Found<unknown, unknown>, { readonly state: "held" }>, again: Next, provider: Provider, place: readonly string[], repair: typeof NEXT.repair): Stop {
  const named = { again, install: NEXT.install(provider, [], place), repair: repair("this", [], place) };
  const next = named[found.after];

  return { problem: "name_held", exit: 1, words: found.words, address: found.address, next: next.step === again.step ? again : next };
}

/** Say that the account token was not stored and where it can be deleted: the last line of a run that used one. */
function tokenLine(provider: Provider): string {
  return `The account token was not stored. You can delete it at ${provider.name}.`;
}

/** Name the poplin an install runs: with its version, or with the words for one that could not be read. */
export function runningWords(version: string | undefined): string {
  return `poplin ${version ?? "(unknown version)"}`;
}

/** The problem a look that the provider refused stops with, by why it was refused. */
export const REFUSED_AS = { token: "token_refused", no_domain: "no_domain", other_place: "other_place" } as const;

/**
 * The option of a repair that first brings the install to the newest release, as the command it is named in carries it.
 *
 * @param update - whether the line asked for it, or the stop it is named after says that only such a repair goes on
 */
export function updateWords(update: boolean): readonly string[] {
  return update ? ["--update"] : [];
}

/**
 * What runs a repair again that the provider refused: the newest poplin's where the install's records are of another version, which this poplin would stop at again.
 * An install that is behind, with records this poplin does not read as they are, is one only a repair that updates goes on from, so that repair is named.
 *
 * @param careful - the careful choices of the repair's own line; none where another command names the repair
 * @param place - the place the run knows, which is left out where the provider says the install answers elsewhere
 * @param update - whether the repair's own line asked for the newest release; false where another command names the repair
 * @param repair - what names the repair: `NEXT.repair` where another command names it, or a repair's own way, which keeps the user of its line
 */
export function repairAfter(refused: Extract<Repaired, { readonly ok: false }>, careful: readonly Careful[], place: readonly string[], update: boolean, repair: typeof NEXT.repair): Next {
  const named = [...updateWords(update || refused.why === "behind"), ...(refused.why === "elsewhere" ? [] : place)];

  return repair(refused.why === "another" ? "newest" : "this", careful, named);
}

/**
 * The one way a repair's own line names a repair as its next step: every such step keeps the user the line named, after the words of the step.
 *
 * @param user - that user, as `userOption` writes it on this machine
 * @returns what takes the place of `NEXT.repair` for that line: the same step, with the user's option at its end, or with `add` where the line leaves the option out
 */
export function repairFor(user: ReturnType<typeof userOption>): typeof NEXT.repair {
  return (poplin = "this", careful = [], named = []) => leaving(NEXT.repair(poplin, careful, [...named, ...user.words]), user.add);
}

/**
 * The provider's words of a repair it refused, as the command says them.
 *
 * @param user - the words that add the user the line was given, which each way on from an install that is behind ends in: a person who follows either adds the user too
 */
export function refusedWords(refused: Extract<Repaired, { readonly ok: false }>, user: readonly string[]): string {
  if (refused.why !== "behind") return refused.words;

  return [refused.words, refused.ways.map((way) => [way, ...user].join(" ")).join(". ")].join(" ");
}

/** Write a word so a POSIX shell reads it as that one word: as it is, or in single quotes with each one inside written `'\''`. */
function shellWord(word: string): string {
  return PLAIN_WORD.test(word) ? word : `'${word.replaceAll("'", "'\\''")}'`;
}

/**
 * The place a run knows, as the command it names next carries it, so that the line runs as it is written where nothing can be asked.
 *
 * @param where - the provider's own answer of where the install goes
 * @returns the provider's option of that place, each word as one word of a POSIX shell
 */
export function placeOf(provider: Provider, where: unknown): readonly string[] {
  return provider.placeWords(where).map(shellWord);
}

/**
 * The option of a repair that lets one more person log in, as the command it is named in carries it on this machine.
 *
 * No quoting makes a word safe on Windows: cmd.exe reads `%` inside quotes, PowerShell reads `$`, and the command file `npx` runs through reads the word once more with its quotes gone.
 * So an email there is written bare where every character of it is plain to both shells, and is left out where one is not.
 *
 * @param login - the email of that person; `undefined` for a line that adds nobody
 * @param platform - the machine's `process.platform`
 * @returns `words` are the option and the email as one word of the machine's shell, or none; `add` names the option where the line leaves it out for a person to add
 */
export function userOption(login: Login | undefined, platform: string): { readonly words: readonly string[]; readonly add?: string } {
  if (login === undefined) return { words: [] };

  if (platform !== WINDOWS) return { words: ["--add-user", shellWord(login)] };

  return WINDOWS_WORD.test(login) ? { words: ["--add-user", login] } : { words: [], add: ADD_USER };
}

/**
 * Put on a step what its line leaves out for a person to add.
 *
 * @param add - the option left out; `undefined` for a line that holds every word
 * @returns the same step, with `add` where it names a command and something was left out
 */
function leaving(next: Next, add: string | undefined): Next {
  return add === undefined || next.step === "none" ? next : { ...next, add };
}

/**
 * The repair that lets one more person log in, as the next step of an install that kept the users its records hold.
 *
 * @param login - the first login the run did not use
 * @param place - the place of the install, which the line holds before the user
 * @param platform - the machine's `process.platform`, which says how the email is written
 */
export function letInNext(login: Login, place: readonly string[], platform: string): Next {
  return repairFor(userOption(login, platform))("this", [], place);
}

/**
 * Say how the person of a first login the run did not use is let in: the line such a run ends with.
 *
 * @param next - the repair that lets them in, whose command the sentence names
 */
export function unusedLine(login: Login, next: Next): Line {
  return plain(`Add ${login} as a user: ${next.command}`);
}

/**
 * Say what the command a run named next leaves out, for the person to add: without it, the line they paste lets nobody in.
 *
 * @param login - the email the line leaves out
 * @returns the line, or none where the command holds every word
 */
export function leftOutLines(login: Login, next: Next): Line[] {
  if (next.step === "none" || next.add === undefined) return [];

  return [plain(`Append ${next.add} to that command yourself, with ${login}: poplin cannot quote this email safely for a Windows shell`)];
}

/** How many objects a run changed, or with a dry run would. */
export function changesIn(rows: readonly Row[]): number {
  return rows.filter((row) => CHANGES.has(row.state)).length;
}

/** The lines of what stops a piece until a person acts: what it is, then the address to open, under it. */
export function blockedLines(blocked: readonly Blocked[]): Line[] {
  return blocked.flatMap((one) => [{ tone: "warning", text: one.words }, plain(`${INDENT}${one.address}`)]);
}

/** One command line: its words, a provider's id among them where the line got as far as one, then each careful choice. */
function lineOf(words: readonly (string | undefined)[], careful: readonly Careful[]): string {
  return [...words.filter((word) => word !== undefined), ...careful].join(" ");
}

/** Name what to run next in a sentence: the command that just ran as `rerun this command`, and another by its line. */
function nextWords(next: Next, again: Next): string {
  return next.step === again.step || next.command === null ? againWords([]) : `run ${next.command}`;
}

/** The commands that own an install that is there, each with what it is for: the repair among them unless the install was read to need none. */
function ownerLines(provider: Provider, version: string | undefined, newest: string | undefined, repairs: boolean): string[] {
  const out = newest === undefined || newest === version ? "" : `(${newest} is available)`;
  const rows = [
    ["check", "npx poplin doctor", ""],
    ...(repairs ? [["repair", "npx poplin doctor --repair", ""]] : []),
    ["update", "npx poplin update", out],
    ["remove", `npx poplin uninstall ${provider.id}`, ""],
  ];

  return columns(rows).map((line) => `${INDENT}${line}`);
}

/**
 * The rows of some options in a help text: each as it is typed, and what it means, with the variable that answers the same on a line of its own. The two flags every command takes end them.
 */
export function optionRows(rows: readonly OptionRow[]): [term: string, about: string][] {
  const own = rows.map((row): [string, string] => [row.value === null ? row.flag : `${row.flag} ${row.value}`, row.variable === null ? row.about : `${row.about}\nOr set ${row.variable}.`]);

  return [...own, [HELP_FLAG, ""], [VERSION_FLAG, ""]];
}

/**
 * Word one object of an install.
 *
 * @param run - whether the row is of a dry run or of a run: the state's word differs, and nothing else
 * @returns the line, and what kind of line it is
 */
export function rowLine(row: Row, run: Run): Line {
  return wordedRow(STATES, row, run);
}

/**
 * The rows of a run, as its JSON value holds them.
 *
 * @returns each object with its detail, its state under `will` in a dry run and under `did` in a run, and the permission it lacks where it names one
 */
export function rowValues(rows: readonly Row[], run: Run): Readonly<Record<string, unknown>>[] {
  const key = run === "dry-run" ? "will" : "did";

  return rows.map((row) => ({ object: row.object, [key]: row.state, detail: row.detail, ...(row.right === undefined ? {} : { right: row.right }) }));
}

/**
 * Word what a dry run came to.
 *
 * @returns the last lines: whether a run would go through, with what it would do counted, and what stops it when something does
 */
export function dryRunLines(installed: Pick<Extract<Installed, { readonly ok: true }>, "rows" | "blocked" | "ready">): Line[] {
  const count = (state: RowState): number => installed.rows.filter((row) => row.state === state).length;
  const proof = "A dry run does not test the account token's write permissions";

  if (!installed.ready) {
    const undone = [...UNDONE].filter((state) => count(state) > 0).map((state) => `${count(state)} ${STATES[state]["dry-run"]}`);

    return [...blockedLines(installed.blocked), { tone: "error", text: undone.length === 0 ? "A run would be incomplete until the steps above are done" : `A run would be incomplete: ${LIST.format(undone)}` }];
  }

  const parts = COUNTED.filter(([state]) => count(state) > 0).map(([state, word], at) => `${word} ${at === 0 ? countText(count(state), "resource") : count(state)}`);

  return [plain(proof), { tone: "done", text: `A run would ${parts.length === 0 ? "change nothing" : LIST.format(parts)}` }];
}

/**
 * Word what a run came to.
 *
 * @param provider - the provider, whose name says where the token can be deleted
 * @param answers - whether the install answered at its address once it was made; `null` for a run that did not wait
 * @param ending - what a run that left nothing undone is called, what to run after one that did, what runs this command again, and the repair at the run's place
 * @returns the last lines: what the run is called and the dashboard's address, what is not done and what only a person can do, or that nothing was changed by a run with no row.
 *   A run that never learned its address names none. One whose address gave no answer is told to log in once it does, and what to run if it does not, where the login is what follows it
 */
export function runLines(installed: Pick<Extract<Installed, { readonly ok: true }>, "rows" | "steps" | "blocked" | "address" | "ready">, provider: Provider, answers: boolean | null, ending: Ending): Line[] {
  const { address } = installed;
  const silent: Line = { tone: "warning", text: `${address} has not responded yet. This can take a few more minutes.` };
  const answer = answers === false ? [silent] : [];
  const dashboard = address === undefined ? [] : [plain(`Dashboard: ${address}`)];
  const stored = plain(tokenLine(provider));

  if (installed.ready && answers === false && address !== undefined) {
    const later = ending.next.step === "login" ? [`When it responds, log in: ${ending.next.command}`, `If it does not respond: ${ending.repair.command}`] : [];

    return [...answer, { tone: "warning", text: ending.done }, ...dashboard, ...later.map(plain), stored];
  }

  if (installed.ready) return [...answer, { tone: "done", text: ending.done }, ...dashboard, stored];

  const next = nextWords(ending.next, ending.again);
  if (installed.rows.length === 0) return [...answer, ...blockedLines(installed.blocked), { tone: "error", text: `${UNCHANGED}. Fix the above, then ${next}.` }, plain("The account token was not stored")];

  const undone = [...UNDONE].flatMap((state) => {
    const count = installed.rows.filter((row) => row.state === state).length;

    return count === 0 ? [] : [`${count} ${STATES[state].apply}`];
  });
  const kept = plain("The account token was not stored");
  const steps = installed.steps.flatMap((step) => [`${INDENT}${step.text}`, `${INDENT}${step.address}`]);
  const byHand = steps.length === 0 ? [] : [`Do these steps in a browser, then ${next}:`, ...steps];

  return [...answer, ...blockedLines(installed.blocked), ...byHand.map(plain), { tone: "error", text: `The run is incomplete${undone.length === 0 ? "" : `: ${LIST.format(undone)}`}. To resume, ${next}.` }, kept];
}

/**
 * Word what the account token is for and where it is made, before a person is asked for it: what a person needs at that moment, and where the rest stands.
 *
 * @param help - the command line whose help lists every permission
 * @returns what the token is for, a permission a line, where the optional ones are listed, the form's address alone on a line, and each permission the link cannot choose
 */
export function factsLines(facts: WorkTokenFacts, help: string): string[] {
  const more = facts.tokenOptional.length;
  const optional = more === 0 ? [] : [`See: ${help} for ${countText(more, "optional permission")}`];

  return [
    `The account token needs ${countText(facts.tokenRights.length, "permission")} on ${facts.tokenFor}:`,
    ...facts.tokenRights.map((right) => `${INDENT}${right}`),
    ...optional,
    "Create the account token here:",
    `${INDENT}${facts.tokenLink}`,
    `On the form, limit it to ${facts.tokenFor}`,
    ...facts.tokenByHand.map((right) => `Tick by hand: ${right}`),
  ];
}

/** The words of a stop that is one message: its first line says what it is, and the rest stand under it. */
function stopWords(stop: Exclude<Stop, { readonly problem: "missing_answer" | "blocked" }>, provider: Provider | undefined): string[] {
  if (stop.problem === "usage" || stop.problem === "no_provider") return [...stop.lines];

  if (stop.problem === "leftover") return [stop.words, "To reuse them with their data, rerun with --adopt. For a fresh install, delete them here first:", `${INDENT}${stop.address}`, UNCHANGED];

  if (stop.problem === "name_held") return [stop.words, `${INDENT}${stop.address}`, UNCHANGED];

  if (stop.problem !== "already_installed") return [stop.words];

  const owners = provider === undefined ? [] : ownerLines(provider, stop.version, stop.newest, stop.mend !== "nothing");

  const way = stop.mend === "unread" ? [`The repair check failed: ${stop.unread}`, `Next: ${stop.next.command} --dry-run`] : [`Next: ${stop.next.command}`];

  return [`${runningWords(stop.version)} is already installed at ${stop.address}${STANDING[stop.mend]}. ${UNCHANGED}.`, ...way, ...owners];
}

/**
 * Word why a command stopped before its work was done.
 *
 * @param provider - the provider the line names, when the command got as far as one
 * @returns the lines for a person, the first of which says what it is
 */
export function stopLines(stop: Stop, provider: Provider | undefined): Line[] {
  if (stop.problem === "missing_answer") return stop.missing.flatMap((one): Line[] => [{ tone: "error", text: `Missing ${one.name}` }, plain(`Fix: ${one.give}`)]);

  if (stop.problem === "blocked") return [...blockedLines(stop.blocked), { tone: "error", text: UNCHANGED }];

  return stopWords(stop, provider).map((text, at) => (at === 0 ? { tone: "error", text } : plain(text)));
}

/**
 * The JSON value of a command that stopped before its work was done.
 *
 * @param again - what runs the command that stopped again: the next step of every stop that names no other
 * @returns `ok` false, the problem's code, what a program needs of it (the answers that are missing, the install that is there and whether it needs mending, or what blocks), and what to run next
 */
export function stopValue(stop: Stop, again: Next): Readonly<Record<string, unknown>> {
  const said = { ok: false, problem: stop.problem, next: "next" in stop ? stop.next : again };

  if (stop.problem === "usage" || stop.problem === "no_provider") return { ...said, words: stop.lines };

  if (stop.problem === "missing_answer") return { ...said, missing: stop.missing.map((one) => one.key) };

  if (stop.problem === "blocked") return { ...said, blocked: stop.blocked };

  if (stop.problem === "leftover" || stop.problem === "name_held") return { ...said, words: stop.words, address: stop.address };

  if (stop.problem !== "already_installed") return { ...said, words: stop.words };

  const unread = stop.mend === "unread" ? { unread: stop.unread } : {};

  return { ...said, found: { version: stop.version ?? null, address: stop.address, newest: stop.newest ?? null, mend: stop.mend, ...unread } };
}

/**
 * The JSON value of a dry run or a run that worked through its rows.
 *
 * @param found - what the look for an install found, which the run went on from
 * @param answers - whether the install answered at its address once it was made; `null` for a dry run and for a run that did not wait
 * @param next - what to run after this run
 * @returns the same value for both, but for `run` and the key of each row's state: `will` in a dry run, `did` in a run. `ok` is whether the command exits with 0
 */
export function runValue(installed: Extract<Installed, { readonly ok: true }>, run: Run, found: string, answers: boolean | null, next: Next): Readonly<Record<string, unknown>> {
  return {
    ok: installed.ready && answers !== false,
    run,
    ready: installed.ready,
    found: { state: found },
    release: installed.release ?? null,
    address: installed.address ?? null,
    answers,
    token: { proof: installed.proof },
    rows: rowValues(installed.rows, run),
    blocked: installed.blocked,
    steps: installed.steps,
    next,
  };
}
