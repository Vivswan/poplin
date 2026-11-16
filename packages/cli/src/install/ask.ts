// The answers a plan still lacks, asked for or read: after this a run holds where the install goes, the first login, and the token, and asks for none of them again.
//
//   a run that asks nothing    the token is in the variable, or is the first line of standard input
//   a run on a terminal        each answer no option gave is asked for, and asked again when what was typed is refused

import { type Login, parseLogin } from "../../../core/src/auth/logins";
import type { Found, Question, Token } from "../../../core/src/install/installer";
import { TOKEN_VARIABLES } from "../local/current-login";
import type { Screen } from "../local/screen";
import type { GivenToken, InstallEnds, InstallRequest, Plan, Provider, Stop } from "./records";
import { factsLines } from "./report";

/** The variable the account token is read from. */
export const TOKEN_VARIABLE = TOKEN_VARIABLES.install;

/** The lines of a help text that say where the account token is read from. */
export const TOKEN_HELP: readonly string[] = [`The account token is read from ${TOKEN_VARIABLE}, or from standard input`, "with --token-stdin, or asked for without being shown. It is used for the run", "and stored nowhere."];

/** The stop of a run whose person ended a question, which is before any change. */
export const STOPPED: Stop = { problem: "stopped", exit: 1, words: "stopped: nothing was changed" };

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
    const typed = await screen.ask("Your email, the first login:");
    if (typed === undefined) return undefined;

    const login = parseLogin(typed);
    if (login.ok) return login.value;

    screen.aside("warning", "that is no email address, such as you@example.com");
  }
}

/**
 * Say what the token needs and where it is made, then ask for it without showing it.
 *
 * @param where - the provider's own answer of where the install is, which says what the token needs
 * @returns the token, or `undefined` once the person ended the question
 */
export async function askToken(provider: Provider, where: unknown, screen: Screen): Promise<Token | undefined> {
  for (const line of factsLines(provider.facts(where))) screen.aside("plain", line);

  for (;;) {
    const typed = await screen.ask("Account token (not shown):", "secret");
    if (typed === undefined) return undefined;

    const token = provider.token(typed.trim());
    if (token !== undefined) return token;

    screen.aside("warning", `that is no account token of ${provider.name}`);
  }
}

/**
 * The token a run that asks nothing was given: the variable's, or the first line of standard input.
 *
 * @param command - the command as it is typed after `poplin`, which the refusal of a piped line that is no token starts with
 */
export async function givenToken(given: GivenToken, provider: Provider, input: InstallEnds["input"], command: string): Promise<Token | Stop> {
  if (given.from === "environment") return given.token;

  const [line = ""] = (await input()).split("\n");
  const token = provider.token(line.trim());
  if (token !== undefined) return token;

  return { problem: "usage", exit: 2, lines: [`poplin ${command}: standard input does not hold an account token of ${provider.name}`] };
}

/** Ask which of the places a token shows is meant. A run that asks nothing is told which option answers it. */
async function chosen(question: Question<unknown>, asking: "terminal" | "never", screen: Screen): Promise<{ readonly where: unknown } | Stop> {
  if (asking === "never") return { problem: "missing_answer", exit: 2, missing: [{ key: question.key, name: question.name, give: question.give }] };

  return (await askWhere([question], screen)) ?? STOPPED;
}

/**
 * Look for an install with the token. A token that shows more than one place is asked which, and looked with again at the place chosen.
 *
 * @param request - the provider, the token, the place the person named, and whether a person can be asked
 * @param tell - `looking` before each look, and `found` with what it found
 * @returns what was found, with the place the provider was last asked about; or the stop of a choice nobody could make
 */
export async function lookFor(
  request: Pick<InstallRequest, "provider" | "token" | "where" | "asking">,
  ends: Pick<InstallEnds, "reach" | "screen">,
  tell: { readonly looking: () => void; readonly found: (found: Found<unknown, unknown>) => void },
): Promise<{ readonly found: Exclude<Found<unknown, unknown>, { readonly state: "choice" }>; readonly where: unknown } | Stop> {
  let { where } = request;

  for (;;) {
    tell.looking();
    const found = await request.provider.find(request.token, where, ends.reach);
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
 * @returns the request, the refusal of a piped token that is none, or the stop of a person who ended a question
 */
export async function settle(plan: Plan, ends: Pick<InstallEnds, "screen" | "input">): Promise<InstallRequest | Stop> {
  const { provider, json } = plan;

  if (plan.asking === "never") {
    const token = await givenToken(plan.token, provider, ends.input, "install");
    if (typeof token === "object") return token;

    return { provider, json, asking: "never", mode: plan.mode, where: plan.where, login: plan.login, token };
  }

  const where = plan.where.known ? plan.where : await askWhere(plan.where.open, ends.screen);
  if (where === undefined) return STOPPED;

  const login = plan.login ?? (await askLogin(ends.screen));
  if (login === undefined) return STOPPED;

  const token = plan.token ?? (await askToken(provider, where.where, ends.screen));
  if (token === undefined) return STOPPED;

  return { provider, json, asking: "terminal", mode: plan.mode, where: where.where, login, token };
}
