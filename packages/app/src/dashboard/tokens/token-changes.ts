// The changes the forms of the Tokens tab ask for. Each calls one action and answers the page to show next, with the result in its address.

import { decideLogin } from "@poplin/core/src/actions/computer-logins";
import { revokeToken } from "@poplin/core/src/actions/manage-tokens";
import { ALLOW_PAGE, CODE_KEY } from "@poplin/core/src/api/routes";

import { withNotice } from "../page/notices";
import type { Change, Form, Visit } from "../records";

/** The path of the Tokens tab. */
const TOKENS_PATH = "/tokens";

/** What the allow form's box sends when it is ticked. */
const CONFIRMED = "yes";

async function decide(visit: Visit, form: Form, allowing: boolean): Promise<string> {
  const code = form.get(CODE_KEY);
  if (code === undefined) return withNotice(TOKENS_PATH, { refused: "missing_field" });

  // Back to the same login, so the box can be ticked: the code in the address is the one the form held.
  if (allowing && form.get("confirm") !== CONFIRMED) return withNotice(`${ALLOW_PAGE}?${new URLSearchParams({ [CODE_KEY]: code })}`, { refused: "not_confirmed" });

  const decided = await decideLogin(visit.install, visit.actor, { code, allow: allowing });
  if (!decided.ok) return withNotice(TOKENS_PATH, { refused: decided.code });

  return withNotice(TOKENS_PATH, { done: allowing ? "allowed" : "denied" });
}

async function revoke(visit: Visit, form: Form): Promise<string> {
  const token = form.get("token");
  if (token === undefined) return withNotice(TOKENS_PATH, { refused: "missing_field" });

  const revoked = await revokeToken(visit.install, visit.actor, token);
  if (!revoked.ok) return withNotice(TOKENS_PATH, { refused: revoked.code === "not_allowed" ? revoked.code : "no_such_token" });

  return withNotice(TOKENS_PATH, { done: "revoked" });
}

/** Every change of the Tokens tab, by the last part of the address its form posts to. */
export const TOKEN_CHANGES: Readonly<Record<string, Change>> = {
  allow: (visit, form) => decide(visit, form, true),
  deny: (visit, form) => decide(visit, form, false),
  revoke,
};
