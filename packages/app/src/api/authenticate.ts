// Who sends a request: the bearer token in its `Authorization` header, checked against the record the install keeps of it. The API reads no cookie.

import type { Actor } from "@poplin/core/src/auth/scopes";
import { parseToken, type TokenId, type TokenRecord, verifyToken } from "@poplin/core/src/auth/tokens";
import type { Context, MiddlewareHandler } from "hono";
import { bearerAuth } from "hono/bearer-auth";

import { refusal } from "./respond";

/** How a 401 says to authenticate when the request held no token in the header's one form. */
const CHALLENGE = "Bearer";

/** Finds the record of a token by its id; the install's database, or a cache in front of it. */
export type ReadToken = (id: TokenId) => Promise<TokenRecord | undefined>;

/** What a request holds once its token is found live: the token's record under `token`, and whoever it stands for under `actor`. */
export interface Authenticated {
  readonly Variables: { readonly token: TokenRecord; readonly actor: Actor };
}

/** What every request that presents no live token is answered, whatever is wrong with it. */
function refused(): Response {
  return refusal("not_logged_in");
}

/**
 * Build the step that lets a request on only when it presents a live token.
 *
 * It ends any other request with the 401 of `not_logged_in` and a `WWW-Authenticate` of the `Bearer` scheme. That header says `invalid_token` for a token that is malformed, unknown, revoked, run out, or of a wrong secret; which of them is not told.
 *
 * @param now - the clock, in milliseconds since the epoch
 * @returns the step that sets `token` to the token's record, and `actor` to whoever the token stands for
 */
export function authenticate(readToken: ReadToken, now: () => number): MiddlewareHandler<Authenticated> {
  const isLive = async (presented: string, context: Context<Authenticated>): Promise<boolean> => {
    const id = parseToken(presented);
    if (!id.ok) return false;

    const record = await readToken(id.value);
    if (record === undefined) return false;

    const verified = await verifyToken(presented, record, now());
    if (!verified.ok) return false;

    context.set("token", verified.value);
    context.set("actor", { scope: verified.value.scope, holder: verified.value.id });

    return true;
  };

  return bearerAuth({
    verifyToken: isLive,
    noAuthenticationHeader: { message: refused, wwwAuthenticateHeader: CHALLENGE },
    invalidAuthenticationHeader: { message: refused, wwwAuthenticateHeader: CHALLENGE },
    invalidToken: { message: refused },
  });
}
