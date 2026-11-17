// One login added or removed by an admin, in one step of the database: no list is read and written back, so two admins changing people at the same moment both land.

import * as v from "valibot";

import { type Login, parseLogin } from "../../auth/logins";
import type { Actor } from "../../auth/scopes";
import type { SettingValues } from "../../records/settings";
import { signedBy } from "./reach";
import { type Install, type Refused, refuse } from "../records";

/** What a change of one login is asked with: the email, as it was typed. */
const LOGIN_REQUEST = v.strictObject({ login: v.string() });

/** The login that was added or removed, in its normal form, and every setting after the change. */
interface Changed {
  readonly ok: true;
  readonly login: Login;
  readonly values: SettingValues;
}

/** The email a request names, in its normal form, or the refusal of a request that names none. */
function loginIn(request: unknown): Login | Refused<"bad_argument"> {
  const asked = v.safeParse(LOGIN_REQUEST, request);
  if (!asked.success) return refuse("bad_argument", v.getDotPath(asked.issues[0])?.split(".")[0] ?? "request");

  const login = parseLogin(asked.output.login);

  return login.ok ? login.value : refuse("bad_argument", "login");
}

/**
 * Let one more email log in.
 *
 * @param request - `{ login }`, the email as typed; anything is taken and checked
 * @returns the login in its normal form and every setting after the change. `bad_argument` about `login` for text that is no email, and `already_a_user` for one that is a login already.
 *   `not_allowed` for a token whose user was removed while it asked, and for a person removed while they asked. A refusal changes nothing
 */
export async function addLogin(install: Install, actor: Actor, request: unknown): Promise<Changed | Refused<"not_allowed" | "not_set_up" | "bad_argument" | "already_a_user">> {
  if (actor.scope !== "admin") return refuse("not_allowed");

  const login = loginIn(request);
  if (typeof login !== "string") return login;

  const added = await install.database.addLogin(login, signedBy(actor, install.now()));
  if (added.kind === "done") return { ok: true, login, values: added.values };

  if (added.kind === "unchanged") return refuse("already_a_user", "login");

  return refuse(added.kind === "signer_gone" ? "not_allowed" : "not_set_up");
}

/**
 * Stop one email from logging in.
 *
 * A login that works always stays: an admin who is a login cannot remove their own email, and a token cannot remove the last login.
 *
 * @param request - `{ login }`, the email as typed; anything is taken and checked
 * @returns the login in its normal form and every setting after the change. `bad_argument` about `login` for text that is no email, `not_a_user` for an email that is no login, and `no_working_user` when no login that works would stay.
 *   `not_allowed` for a token whose user was removed while it asked, and for a person removed while they asked
 */
export async function removeLogin(install: Install, actor: Actor, request: unknown): Promise<Changed | Refused<"not_allowed" | "not_set_up" | "bad_argument" | "not_a_user" | "no_working_user">> {
  if (actor.scope !== "admin") return refuse("not_allowed");

  const login = loginIn(request);
  if (typeof login !== "string") return login;

  const removed = await install.database.removeLogin(login, signedBy(actor, install.now()));
  if (removed.kind === "done") return { ok: true, login, values: removed.values };

  if (removed.kind === "not_set_up") return refuse("not_set_up");

  if (removed.kind === "signer_gone") return refuse("not_allowed");

  return refuse(removed.kind === "unchanged" ? "not_a_user" : "no_working_user", "login");
}
