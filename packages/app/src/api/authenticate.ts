// Who sends a request: the bearer token in its `Authorization` header, checked against the record the install keeps of it. The API reads no cookie.

import { parseToken, type TokenId, type TokenRecord, verifyToken } from "@poplin/core/src/auth/tokens";

/** The one form of the header: the scheme, one space, and the token. */
const BEARER_PATTERN = /^Bearer (\S+)$/i;

/** Finds the record of a token by its id; the install's database, or a cache in front of it. */
export type ReadToken = (id: TokenId) => Promise<TokenRecord | undefined>;

/**
 * Find the live token a request presents.
 *
 * @param now - the clock, in milliseconds since the epoch
 * @returns the token's record, or `undefined` for a missing header, a malformed token, an unknown or revoked one, a wrong secret, or one that ran out; which of them is not told
 */
export async function authenticate(request: Request, readToken: ReadToken, now: number): Promise<TokenRecord | undefined> {
  const presented = BEARER_PATTERN.exec(request.headers.get("Authorization") ?? "")?.[1];
  if (presented === undefined) return undefined;

  const id = parseToken(presented);
  if (!id.ok) return undefined;

  const record = await readToken(id.value);
  if (record === undefined) return undefined;

  const verified = await verifyToken(presented, record, now);

  return verified.ok ? verified.value : undefined;
}
