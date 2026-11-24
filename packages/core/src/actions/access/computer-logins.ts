// A computer logged in from the dashboard: a terminal asks, an admin allows or denies it, typing or pasting the code the terminal alone shows, and the terminal collects its token once.
//
//   beginLogin    anyone      a pending login: a code to show and a secret to keep. It grants nothing, and no visitor's logins keep another's out
//   listLogins    an admin    every login that waits to be decided
//   showLogin     an admin    what one waiting login asks for: never a part of its code
//   decideLogin   an admin    allowed or denied, once
//   redeemLogin   the secret  pending, denied, expired, or the token, which is made at this moment and handed out once

import * as v from "valibot";

import { type ComputerLogin, holdsSecret, isShownUserCode, type LoginId, mintComputerLogin, parseLoginId, parseLoginSecret, sameUserCode, showUserCode } from "../../auth/computer-logins";
import type { Login } from "../../auth/logins";
import type { Actor } from "../../auth/scopes";
import { mintToken } from "../../auth/tokens";
import { LOGIN } from "../../records/fields";
import { TOKEN_OBJECT, tokenObject } from "./manage-tokens";
import { type Install, type Refused, refuse } from "../records";

/** The longest name a computer gives itself, in characters. */
const MAX_COMPUTER_LENGTH = 100;

/** The longest secret that is read at all, in characters: longer than any secret a login is given. */
const MAX_SECRET_LENGTH = 200;

/** What no name holds, so that a name reads as it is written, on one line: a control character, a line or paragraph separator, half of a pair, and a character that is not drawn, which is how text is hidden or turned around. */
const NOT_PLAIN = /[\p{Cc}\p{Cf}\p{Cs}\p{Zl}\p{Zp}]/gu;

/** The most logins that may wait at one moment: three of one visitor, so no visitor holds the places of the rest, and fifty of all. */
const ROOM = { perVisitor: 3, all: 50 } as const;

/** How many codes are tried for one login before giving up; a code is one of 25 billion, so a second try is already a rare event. */
const MINT_ATTEMPTS = 3;

/** How long a terminal waits between two questions, in milliseconds. */
const INTERVAL_MS = 5000;

/** How many milliseconds a second holds: the API speaks of waits in seconds. */
const MS_PER_SECOND = 1000;

/** The note of a token whose computer gave no name. */
const UNNAMED = "poplin login";

/** What a login is asked with: the scope of the token it wants, and the name the computer gives itself. */
export const LOGIN_REQUEST = v.strictObject({
  scope: v.picklist(["publisher", "admin"]),
  computer: v.pipe(
    v.string(),
    v.check((name) => plainComputerName(name) === name),
  ),
});

/** What a terminal asks for its token with. */
export const LOGIN_SECRET = v.strictObject({ secret: v.pipe(v.string(), v.maxLength(MAX_SECRET_LENGTH)) });

/** What an admin decides about one waiting login, named by its id. To let it in they name its scope, so none is let in with a scope nobody chose, and give its `code`, which the terminal alone shows. */
const LOGIN_DECISION = v.variant("allow", [
  v.strictObject({ login: v.string(), allow: v.literal(false) }),
  v.strictObject({ login: v.string(), allow: v.literal(true), scope: v.picklist(["publisher", "admin"]), code: v.string() }),
]);

/**
 * Write a text as a name a login takes: every character no name holds is left out, and what is left is cut to 100 characters.
 *
 * @returns the name, which `beginLogin` takes as it is; a name `beginLogin` takes comes back unchanged
 */
export function plainComputerName(text: string): string {
  // A cut can leave half of a pair at the end, which is left out too.
  return text.replace(NOT_PLAIN, "").slice(0, MAX_COMPUTER_LENGTH).replace(NOT_PLAIN, "");
}

/** A login begun: the code to show a person, the secret to keep, the seconds until the login runs out, and the seconds to wait between two questions. A terminal copies the code, so no other text is taken for one. */
const BEGUN_LOGIN = v.object({ code: v.pipe(v.string(), v.check(isShownUserCode)), secret: v.string(), expires_in: v.number(), interval: v.number() });

/** What the API answers a login begun: with `verify_url`, the address of the page where an admin allows it. */
export const BEGUN_LOGIN_ANSWER = v.object({ ...BEGUN_LOGIN.entries, verify_url: v.string() });

/** What a terminal is answered: wait, give up, or the token, which is shown this once. */
export const REDEEMED_LOGIN = v.variant("state", [
  v.object({ state: v.picklist(["pending", "denied", "expired"]) }),
  v.object({ state: v.literal("allowed"), token: v.string(), record: TOKEN_OBJECT }),
]);

/**
 * A pending login as an admin sees it: never its secret, nor the secret's hash. Times are milliseconds since the epoch.
 *
 * `id` names the login and proves nothing. No part of its code is here: a person brings the code from the terminal to allow it. `computer` is what the computer called itself, which nobody checked.
 */
export interface LoginObject {
  readonly id: LoginId;
  readonly scope: ComputerLogin["scope"];
  readonly computer: string;
  readonly asked: number;
  readonly expires: number;
}

/** What a terminal is answered: wait, give up, or the token, which is shown this once. */
export type Redeemed = Readonly<v.InferOutput<typeof REDEEMED_LOGIN>>;

function loginObject(login: ComputerLogin): LoginObject {
  return { id: login.id, scope: login.scope, computer: login.computer, asked: login.createdAt, expires: login.expiresAt };
}

/** The email of an admin in a browser. A token allows no computer in, so no token outlives its own expiry through a login it allowed. */
function personOf(actor: Actor): Login | undefined {
  if (actor.scope !== "admin" || !v.is(LOGIN, actor.holder)) return undefined;

  return actor.holder;
}

/** The login a person may still decide, by its id: pending, and not run out. */
async function waitingLogin(install: Install, named: string): Promise<ComputerLogin | undefined> {
  const id = parseLoginId(named);
  if (id === undefined) return undefined;

  const login = await install.database.getComputerLogin(id);
  if (login?.state !== "pending" || login.expiresAt <= install.now()) return undefined;

  return login;
}

/**
 * Begin a login. Anyone may: it grants nothing until an admin allows it, and it is gone ten minutes later.
 *
 * No login is refused for the ones that wait. A visitor's fourth takes the place of their oldest, and the fifty-first of all that of the oldest one of the visitor with the most. One that lost its place answers `expired`.
 *
 * @param request - the scope and the computer's name, which is at most 100 characters that are all drawn, on one line; anything is taken and checked
 * @param visitor - the key the entry counts the asking visitor by, which the visitor cannot choose
 * @returns the code to show a person, the secret to keep, the seconds until the login runs out, and the seconds to wait between two questions
 * @throws {Error} the database failed
 */
export async function beginLogin(
  install: Install,
  request: v.InferInput<typeof LOGIN_REQUEST>,
  visitor: string,
): Promise<({ readonly ok: true } & Readonly<v.InferOutput<typeof BEGUN_LOGIN>>) | Refused<"bad_argument">> {
  const asked = v.safeParse(LOGIN_REQUEST, request);
  if (!asked.success) return refuse("bad_argument", v.getDotPath(asked.issues[0])?.split(".")[0] ?? "request");

  for (let attempt = 0; attempt < MINT_ATTEMPTS; attempt += 1) {
    const { secret, login } = await mintComputerLogin({ ...asked.output, visitor, now: install.now() });
    const added = await install.database.addComputerLogin(login, ROOM);
    if (added.kind === "taken") continue;

    return { ok: true, code: showUserCode(login.code), secret, expires_in: (login.expiresAt - login.createdAt) / MS_PER_SECOND, interval: INTERVAL_MS / MS_PER_SECOND };
  }

  throw new Error(`no free login code in ${MINT_ATTEMPTS} tries`);
}

/**
 * List every login that waits to be allowed or denied, the newest first.
 *
 * @returns the logins, at most as many as may wait at one moment, or `not_allowed` for anyone but an admin in a browser
 */
export async function listLogins(install: Install, actor: Actor): Promise<{ readonly ok: true; readonly logins: readonly LoginObject[] } | Refused<"not_allowed">> {
  if (personOf(actor) === undefined) return refuse("not_allowed");

  return { ok: true, logins: (await install.database.listWaitingComputerLogins(install.now())).map(loginObject) };
}

/**
 * Show one waiting login.
 *
 * @param id - the login's id, as an address or a request carried it
 * @returns the login, `not_allowed` for anyone but an admin in a browser, or `no_such_login` for an id of no login and for a login that was decided or ran out
 */
export async function showLogin(install: Install, actor: Actor, id: string): Promise<{ readonly ok: true; readonly login: LoginObject } | Refused<"not_allowed" | "no_such_login">> {
  if (personOf(actor) === undefined) return refuse("not_allowed");

  const login = await waitingLogin(install, id);
  if (login === undefined) return refuse("no_such_login");

  return { ok: true, login: loginObject(login) };
}

/**
 * Allow or deny one waiting login. The decision is made once and writes one audit entry; an allowed login gives its token to the terminal that holds its secret.
 *
 * An admin may allow a computer for less than it asked, never for more. Only one who has the terminal's code allows it: the code is in no answer and no address.
 *
 * @param decision - the login's id and whether the computer is let in; for one that is, its scope and its code, as typed or pasted; anything is taken and checked
 * @returns the login as it was decided, `not_allowed` for anyone but an admin in a browser, `not_confirmed` for anything but the whole code, `bad_argument` about `scope` for more than was asked, or `no_such_login`
 * @throws {Error} the database failed
 */
export async function decideLogin(
  install: Install,
  actor: Actor,
  decision: v.InferInput<typeof LOGIN_DECISION>,
): Promise<{ readonly ok: true; readonly login: LoginObject } | Refused<"not_allowed" | "bad_argument" | "no_such_login" | "not_confirmed">> {
  const admin = personOf(actor);
  if (admin === undefined) return refuse("not_allowed");

  const asked = v.safeParse(LOGIN_DECISION, decision);
  if (!asked.success) return refuse("bad_argument", v.getDotPath(asked.issues[0])?.split(".")[0] ?? "decision");

  const login = await waitingLogin(install, asked.output.login);
  if (login === undefined) return refuse("no_such_login");

  const scope = asked.output.allow ? asked.output.scope : undefined;
  if (asked.output.allow && !(await sameUserCode(asked.output.code, login.code))) return refuse("not_confirmed", "code");

  if (scope === "admin" && login.scope !== "admin") return refuse("bad_argument", "scope");

  const decided = await install.database.decideComputerLogin(login.code, { state: asked.output.allow ? "allowed" : "denied", asPublisher: scope === "publisher", by: admin, at: install.now() });
  if (decided.kind !== "done") return refuse("no_such_login");

  return { ok: true, login: loginObject(decided.login) };
}

/**
 * Answer the terminal that holds a login's secret.
 *
 * The token of an allowed login is made here, stored as its hash alone, and answered once: the login is removed in the same step, so a second question finds none.
 *
 * @param request - the secret; anything is taken and checked
 * @returns `expired` for a secret of no login as for one that ran out, so the answer tells nothing of which
 * @throws {Error} the database failed
 */
export async function redeemLogin(install: Install, request: v.InferInput<typeof LOGIN_SECRET>): Promise<({ readonly ok: true } & Redeemed) | Refused<"bad_argument">> {
  const asked = v.safeParse(LOGIN_SECRET, request);
  if (!asked.success) return refuse("bad_argument", v.getDotPath(asked.issues[0])?.split(".")[0] ?? "request");

  const { secret } = asked.output;
  const id = parseLoginSecret(secret);
  const login = id === undefined ? undefined : await install.database.getComputerLogin(id);
  const now = install.now();
  if (login === undefined || !(await holdsSecret(secret, login)) || login.expiresAt <= now) return { ok: true, state: "expired" };

  if (login.state !== "allowed") return { ok: true, state: login.state };

  const minted = await mintToken({ scope: login.scope, note: login.computer === "" ? UNNAMED : login.computer, now });
  const redeemed = await install.database.redeemComputerLogin(login.id, minted.record);
  if (redeemed.kind !== "done") return { ok: true, state: "expired" };

  return { ok: true, state: "allowed", token: minted.token, record: tokenObject(minted.record) };
}
