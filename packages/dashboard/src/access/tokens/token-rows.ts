// The rows of the Tokens list: the logins that wait to be allowed and the tokens of the allowed ones, as one list with the waiting ones first.

import type { Token, WaitingLogin } from "@/access/access-queries";

/** One row of the list: a login that waits for its review, or a token that is allowed. `key` tells the two kinds apart, so a row is named once. */
export type TokenRow =
  | { readonly kind: "waiting"; readonly key: string; readonly name: string; readonly scope: WaitingLogin["scope"]; readonly login: WaitingLogin }
  | { readonly kind: "allowed"; readonly key: string; readonly name: string; readonly scope: Token["scope"]; readonly token: Token };

/**
 * Join the waiting logins and the tokens into the rows of one list.
 *
 * The waiting ones stand first, as the server listed them, since each needs a decision; the tokens follow in the order the server gave them.
 */
export function tokenRows(waiting: readonly WaitingLogin[], tokens: readonly Token[]): readonly TokenRow[] {
  return [
    ...waiting.map((login) => ({ kind: "waiting" as const, key: `waiting-${login.id}`, name: login.computer, scope: login.scope, login })),
    ...tokens.map((token) => ({ kind: "allowed" as const, key: `allowed-${token.id}`, name: token.note, scope: token.scope, token })),
  ];
}
