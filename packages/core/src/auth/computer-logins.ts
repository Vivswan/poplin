// A computer's login: asked for from a terminal, then allowed or denied by an admin on the dashboard.
//
//   the code     WDJB-MJHT, shown in the terminal alone; the dashboard is given no part of it and asks for the whole of it, so only one who has the terminal's code allows the login
//   the secret   poplin_login_<id>_<256 random bits>, held by the terminal alone; only its SHA-256 is stored

import { RANDOM_SHAPES, randomText } from "../records/random-text";
import type { Login } from "./logins";
import type { Scope } from "./scopes";
import { randomHex, sameText, sha256Hex } from "./util";

const SECRET_PREFIX = "poplin_login_";
const ID_BYTES = 8;
const SECRET_BYTES = 32;
const ID_PATTERN = new RegExp(`^[0-9a-f]{${ID_BYTES * 2}}$`);
const SECRET_PATTERN = new RegExp(`^${SECRET_PREFIX}([0-9a-f]{${ID_BYTES * 2}})_[0-9a-f]{${SECRET_BYTES * 2}}$`);
const { alphabet: CODE_ALPHABET, length: CODE_LENGTH } = RANDOM_SHAPES["login-code"];
const HALF_LENGTH = CODE_LENGTH / 2;
const CODE_PATTERN = new RegExp(`^[${CODE_ALPHABET}]{${CODE_LENGTH}}$`);
const CODE_SEPARATORS = /[ \t\r\n-]/g;
const SMALL_LETTERS = /[a-z]/g;
const LIFETIME_MS = 10 * 60 * 1000;

/** The most characters that are read where a code is typed: a code, its dash, and the spaces a paste brings with it. */
export const MAX_TYPED_LENGTH = 32;

/** The half no login's code holds: a page shows the shape of a code with it. */
const SHAPE_HALF = "X".repeat(HALF_LENGTH);

/** The shape of a code as a page shows it, `XXXX-XXXX`: the code of no login and neither half of one, so the page still shows no part of a code. */
export const USER_CODE_SHAPE = `${SHAPE_HALF}-${SHAPE_HALF}`;

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

/** What a person typed or pasted where a code goes, written as a code is stored: with no dash and no space, and ASCII small letters as capitals. Whether it is a code, `parseUserCode` says. */
function typedCharacters(typed: string): string {
  // ASCII only: `toUpperCase` on the whole string would turn the long s into a valid `S`.
  return typed.replace(CODE_SEPARATORS, "").replace(SMALL_LETTERS, (letter) => letter.toUpperCase());
}

/**
 * Decide whether what a person typed so far is as long as a code, which is when a page that knows no code sends it.
 *
 * @returns `true` once it holds as many characters as a code has, its dashes and spaces not counted; whether they are the code is left to who knows the code
 */
export function fillsUserCode(typed: string): boolean {
  return typedCharacters(typed).length >= CODE_LENGTH;
}

/**
 * Read a code as a person typed or pasted it.
 *
 * @returns the code, or `undefined` for anything else; ASCII capitals, dashes, and spaces are the typist's to choose
 */
export function parseUserCode(typed: string): UserCode | undefined {
  if (typed.length > MAX_TYPED_LENGTH) return undefined;

  const characters = typedCharacters(typed);

  return CODE_PATTERN.test(characters) ? (characters as UserCode) : undefined;
}

/**
 * Read the id of a login out of an address or a request.
 *
 * @returns the id, or `undefined` for any text that is not shaped like one
 */
export function parseLoginId(text: string): LoginId | undefined {
  return ID_PATTERN.test(text) ? (text as LoginId) : undefined;
}

/**
 * Decide whether what a person typed or pasted is the code of a login: the whole of it, and no part alone.
 *
 * @param typed - as typed: ASCII capitals, dashes, and spaces are the typist's to choose
 * @returns `true` for the code alone; the two are compared in constant time and nothing throws
 */
export async function sameUserCode(typed: string, code: UserCode): Promise<boolean> {
  const read = parseUserCode(typed);

  return read !== undefined && (await sameText(read, code));
}

/** Write a code for a person: two groups of four, such as `WDJB-MJHT`. */
export function showUserCode(code: UserCode): string {
  return `${code.slice(0, HALF_LENGTH)}-${code.slice(HALF_LENGTH)}`;
}

/**
 * Decide whether a text is a code as `showUserCode` writes one, with nothing before, after, or in place of it.
 *
 * @returns `true` for such a text alone, which is all a terminal prints or copies as the code of an install's answer
 */
export function isShownUserCode(text: string): boolean {
  const code = parseUserCode(text);

  return code !== undefined && showUserCode(code) === text;
}

/**
 * Read the id out of a presented secret, to find its record.
 *
 * @returns the id, or `undefined` for any string that is not shaped like a login's secret; never throws
 */
export function parseLoginSecret(presented: string): LoginId | undefined {
  return SECRET_PATTERN.exec(presented)?.[1] as LoginId | undefined;
}

/** Draw the code of a new login: any but one that holds the half a page shows the shape of a code with. */
function drawUserCode(draw: () => UserCode): UserCode {
  let code = draw();
  while (code.slice(0, HALF_LENGTH) === SHAPE_HALF || code.slice(HALF_LENGTH) === SHAPE_HALF) code = draw();

  return code;
}

/**
 * Make a new login, pending, which runs out ten minutes after `now`.
 *
 * @param draw - what draws a code; the random text of a login's code when absent
 * @returns the secret and the record. `secret` exists only here: hand it to the terminal once and store the record
 */
export async function mintComputerLogin(request: LoginRequest, draw: () => UserCode = () => randomText("login-code") as UserCode): Promise<{ readonly secret: string; readonly login: PendingLogin }> {
  const id = randomHex(ID_BYTES) as LoginId;
  const secret = `${SECRET_PREFIX}${id}_${randomHex(SECRET_BYTES)}`;
  const code = drawUserCode(draw);
  const { scope, computer, visitor, now } = request;

  return { secret, login: { id, code, hash: await sha256Hex(secret), scope, computer, visitor, createdAt: now, expiresAt: now + LIFETIME_MS, state: "pending" } };
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
