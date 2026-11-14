// The stored token record: what `mintToken` makes, with the stamp and the counter every stored record carries.

import * as v from "valibot";

import type { TokenRecord } from "../auth/tokens";
import { MOMENT, REVISION, TOKEN_ID } from "./fields";
import type { RecordKind } from "./kind";

/** The number a token record of the shape below is stamped with. */
const TOKEN_SHAPE = 1;

/** The form of a token's hash: a SHA-256 in lowercase hex. */
const HASH_PATTERN = /^[0-9a-f]{64}$/;

/** What a token record holds whatever its scope. */
const ALWAYS = {
  shape: v.literal(TOKEN_SHAPE),
  revision: REVISION,
  id: TOKEN_ID,
  hash: v.pipe(v.string(), v.regex(HASH_PATTERN)),
  note: v.string(),
  createdAt: MOMENT,
};

/** Every token record. Only an admin token has an expiry. The annotation fails to compile once the fields differ from `TokenRecord`. */
const TOKEN_SCHEMA: v.GenericSchema<unknown, StoredToken> = v.variant("scope", [
  v.strictObject({ ...ALWAYS, scope: v.literal("admin"), expiresAt: MOMENT }),
  v.strictObject({ ...ALWAYS, scope: v.literal("publisher") }),
]);

/** The token record kind. */
export const TOKEN: RecordKind<StoredToken> = { name: "token", shape: TOKEN_SHAPE, schema: TOKEN_SCHEMA };

/** A token record as it is stored: the fields of `TokenRecord`, which stays their one definition. */
export type StoredToken = TokenRecord & { readonly shape: number; readonly revision: number };
