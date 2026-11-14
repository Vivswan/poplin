// A computer's login: asked for from a terminal, then allowed or denied by an admin on the dashboard.
//
//   the code     WDJB-MJHT, shown in the terminal and on the dashboard, so a person can see the two match; it proves nothing
//   the secret   poplin_login_<id>_<256 random bits>, held by the terminal alone; only its SHA-256 is stored

import type { Login } from "./logins";
import type { Scope } from "./scopes";
import { randomHex, sameText, sha256Hex } from "./util";

const SECRET_PREFIX = "poplin_login_";
const ID_BYTES = 8;
const SECRET_BYTES = 32;
const SECRET_PATTERN = new RegExp(`^${SECRET_PREFIX}([0-9a-f]{${ID_BYTES * 2}})_[0-9a-f]{${SECRET_BYTES * 2}}$`);
const CODE_ALPHABET = "BCDFGHJKLMNPQRSTVWXZ";
const CODE_LENGTH = 8;
const CODE_PATTERN = new RegExp(`^[${CODE_ALPHABET}]{${CODE_LENGTH}}$`);
const CODE_SEPARATORS = /[ \t\r\n-]/g;
const SMALL_LETTERS = /[a-z]/g;
const MAX_TYPED_LENGTH = 32;
const UNBIASED_BYTES = 256 - (256 % CODE_ALPHABET.length);
const LIFETIME_MS = 10 * 60 * 1000;

declare const loginIdBrand: unique symbol;
declare const userCodeBrand: unique symbol;

/** The public half of a login's secret: it names the stored record and proves nothing. */
export type LoginId = string & { readonly [loginIdBrand]: true };

/** Eight consonants with no dash, from an alphabet without vowels and without two letters that look alike. */
export type UserCode = string & { readonly [userCodeBrand]: true };

/** What a login holds whatever its state. `hash` is the SHA-256 of the whole secret in hex; times are milliseconds since the epoch. `visitor` is the key of whoever asked. */
interface LoginFacts {
  readonly id: LoginId;
  readonly code: UserCode;
  readonly hash: string;
  readonly scope: Scope;
  readonly computer: string;
  readonly visitor: string;
  readonly createdAt: number;
  readonly expiresAt: number;
}

/** A login nobody decided yet: the only kind that is made, and the only kind that is stored as new. */
export type PendingLogin = LoginFacts & { readonly state: "pending" };

/** What is stored of a computer's login: pending, or decided by an admin. */
export type ComputerLogin = PendingLogin | (LoginFacts & { readonly state: "allowed" | "denied"; readonly decidedBy: Login });

/** What a new login asks for. `computer` is the name the terminal gave itself, stored as given; `visitor` is the key of whoever asks. */
type LoginRequest = { readonly scope: Scope; readonly computer: string; readonly visitor: string; readonly now: number };

function mintCode(): UserCode {
  let code = "";

  while (code.length < CODE_LENGTH) {
    // A byte past the last whole run of the alphabet is drawn again, so every letter is as likely as any other.
    for (const byte of crypto.getRandomValues(new Uint8Array(CODE_LENGTH))) {
      if (byte < UNBIASED_BYTES && code.length < CODE_LENGTH) code += CODE_ALPHABET[byte % CODE_ALPHABET.length];
    }
  }

  return code as UserCode;
}

/**
 * Read a code as a person typed it or an address carried it.
 *
 * @returns the code, or `undefined` for anything else; ASCII capitals, dashes, and spaces are the typist's to choose
 */
export function parseUserCode(typed: string): UserCode | undefined {
  if (typed.length > MAX_TYPED_LENGTH) return undefined;

  // ASCII only: `toUpperCase` on the whole string would turn the long s into a valid `S`.
  const code = typed.replace(CODE_SEPARATORS, "").replace(SMALL_LETTERS, (letter) => letter.toUpperCase());

  return CODE_PATTERN.test(code) ? (code as UserCode) : undefined;
}

/** Write a code for a person: two groups of four, such as `WDJB-MJHT`. */
export function showUserCode(code: UserCode): string {
  return `${code.slice(0, CODE_LENGTH / 2)}-${code.slice(CODE_LENGTH / 2)}`;
}

/**
 * Read the id out of a presented secret, to find its record.
 *
 * @returns the id, or `undefined` for any string that is not shaped like a login's secret; never throws
 */
export function parseLoginSecret(presented: string): LoginId | undefined {
  return SECRET_PATTERN.exec(presented)?.[1] as LoginId | undefined;
}

/**
 * Make a new login, pending, which runs out ten minutes after `now`.
 *
 * @returns the secret and the record. `secret` exists only here: hand it to the terminal once and store the record
 */
export async function mintComputerLogin(request: LoginRequest): Promise<{ readonly secret: string; readonly login: PendingLogin }> {
  const id = randomHex(ID_BYTES) as LoginId;
  const secret = `${SECRET_PREFIX}${id}_${randomHex(SECRET_BYTES)}`;
  const { scope, computer, visitor, now } = request;

  return { secret, login: { id, code: mintCode(), hash: await sha256Hex(secret), scope, computer, visitor, createdAt: now, expiresAt: now + LIFETIME_MS, state: "pending" } };
}

/**
 * Decide whether a presented secret is the secret of a login.
 *
 * @returns `true` for the one secret the login was made with; the hashes are compared in constant time and nothing throws
 */
export async function holdsSecret(presented: string, login: ComputerLogin): Promise<boolean> {
  if (parseLoginSecret(presented) !== login.id) return false;

  return sameText(login.hash, await sha256Hex(presented));
}
