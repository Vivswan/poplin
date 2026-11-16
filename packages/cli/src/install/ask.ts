// The answers a plan still lacks, asked for or read: after this a run holds where the install goes, the first login, and the token, and asks for none of them again.
//
//   a run that asks nothing    the token is in the variable, or is the first line of standard input
//   a run on a terminal        each answer no option gave is asked for, and asked again when what was typed is refused

import { type Login, parseLogin } from "../../../core/src/auth/logins";
import type { Question, Token } from "../../../core/src/install/installer";
import type { Screen } from "../local/screen";
import type { InstallEnds, InstallRequest, Plan, Provider, Stop } from "./records";
import { factsLines } from "./report";

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

/** Say what the token needs and where it is made, then ask for it without showing it. */
async function askToken(provider: Provider, where: unknown, screen: Screen): Promise<Token | undefined> {
  for (const line of factsLines(provider.facts(where))) screen.aside("plain", line);

  for (;;) {
    const typed = await screen.ask("Account token (not shown):", "secret");
    if (typed === undefined) return undefined;

    const token = provider.token(typed.trim());
    if (token !== undefined) return token;

    screen.aside("warning", `that is no account token of ${provider.name}`);
  }
}

/** The token a run that asks nothing was given: the variable's, or the first line of standard input. */
async function givenToken(plan: Extract<Plan, { readonly asking: "never" }>, input: InstallEnds["input"]): Promise<Token | Stop> {
  if (plan.token.from === "environment") return plan.token.token;

  const [line = ""] = (await input()).split("\n");
  const token = plan.provider.token(line.trim());
  if (token !== undefined) return token;

  return { problem: "usage", exit: 2, lines: [`poplin install: standard input does not hold an account token of ${plan.provider.name}`] };
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
    const token = await givenToken(plan, ends.input);
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
