// The answers a plan still lacks, asked for or read: after this a run holds where the install goes, the first login, and the token, and asks for none of them again.
//
//   a run that asks nothing    the token is in the variable, or is the first line of standard input
//   a run on a terminal        each answer no option gave is asked for, and asked again when what was typed is refused

import { type Login, parseLogin } from "../../../core/src/auth/logins";
import type { Found, OptionRow, Question, Token } from "../../../core/src/install/installer";
import { FLAG_WORDS } from "../commands/command-table";
import type { HelpPart } from "../commands/line/help-page";
import type { Io } from "../commands/records";
import { TOKEN_VARIABLES } from "../local/current-login";
import type { Screen } from "../local/screen";
import type { GivenToken, InstallEnds, InstallRequest, Plan, Provider, Rights, Stop } from "./records";
import { formRows, formWords, placeOf, UNCHANGED, type Unsettled } from "./report";

/** The variable the account token is read from. */
export const TOKEN_VARIABLE = TOKEN_VARIABLES.install;

/** The option that asks for a token with the optional permissions too, as a command's parser reads it and its help prints it. It changes what the token's form is opened with, and nothing a run does with the token. */
export const EVERY_RIGHT: OptionRow = { flag: "--all-permissions", value: null, about: FLAG_WORDS.allPermissions, variable: null };

/** The words of the token step, in the order it shows them. */
const FORM = {
  title: "Account token",
  link: "Open the token form",
  open: "Open the form in your browser?",
  unopened: "The browser did not open",
  address: "The form's address",
  steps: "On the form",
} as const;

/** What a token with the optional permissions does for each kind of work, as the line that names the option says it before what they are for. */
const WITH_EVERY_RIGHT = { install: "adds", repair: "adds", remove: "also removes" } as const satisfies Readonly<Record<TokenWork, string>>;

/** The stop of a run whose person ended a question, which is before any change. */
export const STOPPED: Stop = { problem: "stopped", exit: 1, words: `Cancelled. ${UNCHANGED}.` };

/** The work a token is made for. */
type TokenWork = Parameters<Provider["form"]>[1];

/** What the token step reaches of the machine: what hands an address to the person's browser, and what says the person stopped the command. */
export type Browser = Pick<Io, "open" | "stopped">;

/** A token a person is asked for: the provider, its own answer of where the install is, the work the token is made for, and which permissions it is asked for. */
export interface TokenAsk {
  readonly provider: Provider;
  readonly where: unknown;
  readonly work: TokenWork;
  readonly rights: Rights;
}

/**
 * Ask a provider's questions until it has its answer of where the install goes.
 *
 * A reply the provider refuses is said, and the question is put again; a reply that opens other questions goes on with those.
 *
 * @returns the provider's answer, or `undefined` once the person ended a question
 */
export async function askWhere(questions: readonly Question<unknown>[], screen: Screen): Promise<{ readonly where: unknown } | undefined> {
  let open = questions;

  for (;;) {
    const [question] = open;
    if (question === undefined) throw new Error("the provider has no answer of where the install goes, and no question to ask for it");

    const typed = await screen.ask(question.ask);
    if (typed === undefined) return undefined;

    const read = question.answer(typed);
    if (read.ok) return { where: read.where };

    if (read.why === "refused") screen.aside("warning", read.refused);
    else open = read.open;
  }
}

async function askLogin(screen: Screen): Promise<Login | undefined> {
  for (;;) {
    const typed = await screen.ask("First user's email:");
    if (typed === undefined) return undefined;

    const login = parseLogin(typed);
    if (login.ok) return login.value;

    screen.aside("warning", "The input is not an email address");
  }
}

/**
 * The part of a help text that lists what the account token needs, a permission a point.
 *
 * @param work - what the help's command does with the token
 * @param provider - the provider whose permissions for that work are listed; an empty part, which a page leaves out, when absent
 */
export function permissionsPart(work: TokenWork, provider?: Provider): HelpPart {
  return { title: "Permissions:", points: provider?.tokenHelp[work] ?? [] };
}

/** Which permissions the token of a line is asked for: the needed ones, or with the line's option the optional ones too. */
export function rightsOf(shared: ReadonlyMap<string, unknown>): Rights {
  return shared.has(EVERY_RIGHT.flag.slice(2)) ? "every" : "needed";
}

/**
 * Show the way to the provider's form, in the order a person meets it: what the form opens with and a short link to it, the offer to open it here, then what to do on it.
 *
 * The form's address is shown whole wherever the short link may not have opened it: on a screen that makes no link, after a person who declined the browser, and after a browser that did not start.
 *
 * @returns `false` once the person ended the question, or stopped the command while the browser started
 */
async function showForm(asked: TokenAsk, screen: Screen, browser: Browser): Promise<boolean> {
  const form = asked.provider.form(asked.where, asked.work, asked.rights);
  screen.block(FORM.title, [{ text: formWords(asked.provider.name, form) }]);
  const linked = screen.link(FORM.link, form.link);
  const wanted = await screen.confirm(FORM.open, true);
  if (wanted === undefined) return false;

  const opened = wanted && (await browser.open(form.link));
  if (browser.stopped.aborted) return false;

  if (wanted && !opened) screen.aside("warning", FORM.unopened);

  if (!linked || !opened) {
    screen.block(FORM.address, []);
    screen.aside("plain", form.link);
  }

  screen.block(FORM.steps, formRows(form, `${EVERY_RIGHT.flag} ${WITH_EVERY_RIGHT[asked.work]}`));

  return true;
}

/**
 * Show how the token is made, then ask for it without showing it.
 *
 * @param asked - the provider, its own answer of where the install is and the work the token is made for, which say what the token needs, and whether it is asked with the optional permissions too
 * @param browser - what hands the form's address to the person's browser, and what says the person stopped the command
 * @returns the token, or `undefined` once the person ended a question
 */
export async function askToken(asked: TokenAsk, screen: Screen, browser: Browser): Promise<Token | undefined> {
  const { provider } = asked;
  if (!(await showForm(asked, screen, browser))) return undefined;

  for (;;) {
    const typed = await screen.ask("Account token (hidden):", "secret");
    if (typed === undefined) return undefined;

    const token = provider.token(typed.trim());
    if (token !== undefined) return token;

    screen.aside("warning", `The input is not a ${provider.name} account token`);
  }
}

/**
 * The token a run that asks nothing was given: the variable's, or the first line of standard input.
 */
export async function givenToken(given: GivenToken, provider: Provider, input: InstallEnds["input"]): Promise<Token | Stop> {
  if (given.from === "environment") return given.token;

  const [line = ""] = (await input()).split("\n");
  const token = provider.token(line.trim());
  if (token !== undefined) return token;

  return { problem: "usage", exit: 2, lines: [`The first line of stdin is not a ${provider.name} account token`] };
}

/** Ask which of the places a token shows is meant. A run that asks nothing is told which option answers it. */
async function chosen(question: Question<unknown>, asking: "terminal" | "never", screen: Screen): Promise<{ readonly where: unknown } | Stop> {
  if (asking === "never") return { problem: "missing_answer", exit: 2, missing: [{ key: question.key, name: question.name, give: question.give }] };

  return (await askWhere([question], screen)) ?? STOPPED;
}

/**
 * Look for an install with the token. A token that shows more than one place is asked which, and looked with again at the place chosen.
 *
 * @param request - the provider, the token, the place the person named, whether a person can be asked, and the work the token is made for
 * @param tell - `looking` before each look, and `found` with what it found
 * @returns what was found, with the place the provider was last asked about; or the stop of a choice nobody could make
 */
export async function lookFor(
  request: Pick<InstallRequest, "provider" | "token" | "where" | "asking"> & { readonly work: "install" | "repair" | "remove" },
  ends: Pick<InstallEnds, "reach" | "screen">,
  tell: { readonly looking: () => void; readonly found: (found: Found<unknown, unknown>) => void },
): Promise<{ readonly found: Exclude<Found<unknown, unknown>, { readonly state: "choice" }>; readonly where: unknown } | Stop> {
  let { where } = request;

  for (;;) {
    tell.looking();
    const found = await request.provider.find(request.token, where, ends.reach, request.work);
    tell.found(found);

    if (found.state !== "choice") return { found, where };

    const next = await chosen(found.question, request.asking, ends.screen);
    if ("problem" in next) return next;

    ({ where } = next);
  }
}

/**
 * Bring a plan to a request: read the token that is piped, or ask for each answer the plan lacks.
 *
 * @param ends - where the questions are put, and standard input
 * @param browser - what hands the token form's address to the person's browser, and what says the person stopped the command
 * @returns the request; or the refusal of a piped token that is none, or the stop of a person who ended a question, with the place the run knew by then
 */
export async function settle(plan: Plan, ends: Pick<InstallEnds, "screen" | "input">, browser: Browser): Promise<InstallRequest | Unsettled> {
  const { provider, json } = plan;

  if (plan.asking === "never") {
    const token = await givenToken(plan.token, provider, ends.input);
    if (typeof token === "object") return { stop: token, place: placeOf(provider, plan.where) };

    return { provider, json, asking: "never", mode: plan.mode, where: plan.where, login: plan.login, token };
  }

  const where = plan.where.known ? plan.where : await askWhere(plan.where.open, ends.screen);
  if (where === undefined) return { stop: STOPPED, place: [] };

  const stopped = { stop: STOPPED, place: placeOf(provider, where.where) };
  const login = plan.login ?? (await askLogin(ends.screen));
  if (login === undefined) return stopped;

  const token = plan.token ?? (await askToken({ provider, where: where.where, work: "install", rights: plan.rights }, ends.screen, browser));
  if (token === undefined) return stopped;

  return { provider, json, asking: "terminal", mode: plan.mode, where: where.where, login, token };
}
