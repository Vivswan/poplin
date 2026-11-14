// The one place a row of the logins table becomes the record `mintComputerLogin` makes.

import * as v from "valibot";

import { type ComputerLogin, type LoginId, parseUserCode, type UserCode } from "../auth/computer-logins";
import { LOGIN, MOMENT } from "./fields";

/** The form of a secret's hash: a SHA-256 in lowercase hex. */
const HASH_PATTERN = /^[0-9a-f]{64}$/;

/** The form `mintComputerLogin` gives a login's id. */
const LOGIN_ID_PATTERN = /^[0-9a-f]{16}$/;

/** The public half of a login's secret. */
const LOGIN_ID = v.custom<LoginId>(isLoginId, "a login id is 16 lowercase hex characters");

/** The code a person compares, as it is stored: eight letters with no dash. */
const USER_CODE = v.custom<UserCode>(isUserCode, "a code is 8 letters of the code alphabet");

/** What a row holds whatever its state. */
const ALWAYS = {
  id: LOGIN_ID,
  code: USER_CODE,
  hash: v.pipe(v.string(), v.regex(HASH_PATTERN)),
  scope: v.picklist(["admin", "publisher"]),
  computer: v.string(),
  visitor: v.string(),
  created_at: MOMENT,
  expires_at: MOMENT,
};

/** A row of the logins table. Only a login that was decided names who decided it. */
const LOGIN_ROW = v.variant("state", [
  v.strictObject({ ...ALWAYS, state: v.literal("pending"), decided_by: v.null() }),
  v.strictObject({ ...ALWAYS, state: v.picklist(["allowed", "denied"]), decided_by: LOGIN }),
]);

function isLoginId(value: unknown): boolean {
  return typeof value === "string" && LOGIN_ID_PATTERN.test(value);
}

function isUserCode(value: unknown): boolean {
  return typeof value === "string" && parseUserCode(value) === value;
}

/**
 * Turn a row of the logins table into a login record.
 *
 * @returns the record in the fields of `ComputerLogin`, which stays their one definition
 * @throws {Error} the row is no login record
 */
export function computerLoginFromRow(row: unknown): ComputerLogin {
  const parsed = v.safeParse(LOGIN_ROW, row);
  if (!parsed.success) throw new Error(`a stored login is not a login: ${v.summarize(parsed.issues)}`);

  const { id, code, hash, scope, computer, visitor, created_at: createdAt, expires_at: expiresAt } = parsed.output;
  const facts = { id, code, hash, scope, computer, visitor, createdAt, expiresAt };
  if (parsed.output.state === "pending") return { ...facts, state: "pending" };

  return { ...facts, state: parsed.output.state, decidedBy: parsed.output.decided_by };
}
