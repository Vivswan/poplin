// The emails allowed to log in: one normal form for comparing them, and a list that is never empty.

const MAX_EMAIL_LENGTH = 254;
const MAX_LOCAL_LENGTH = 64;
const LOCAL_WORD = "[a-z0-9!#$%&'*+/=?^_`{|}~-]+";
const DOMAIN_LABEL = "[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?";
const EMAIL_PATTERN = new RegExp(`^(${LOCAL_WORD}(?:\\.${LOCAL_WORD})*)@${DOMAIN_LABEL}(?:\\.${DOMAIN_LABEL})+$`);

declare const loginBrand: unique symbol;
declare const loginsBrand: unique symbol;

/** An email in its normal form: trimmed, lowercase, ASCII. Made by `parseLogin` alone. */
export type Login = string & { readonly [loginBrand]: true };

/** The emails allowed to log in; it always holds at least one. */
export type Logins = ReadonlySet<Login> & { readonly [loginsBrand]: true };

/** Why an email or a change to the list was refused. `unknown-login` means the email to remove is not listed. */
type LoginRefusal = "empty" | "too-long" | "not-an-address" | "no-logins" | "last-login" | "unknown-login";

/** A checked value, or the reason it was refused. */
export type CheckedLogin<Value> = { readonly ok: true; readonly value: Value } | { readonly ok: false; readonly refusal: LoginRefusal };

function refuse(refusal: LoginRefusal): { readonly ok: false; readonly refusal: LoginRefusal } {
  return { ok: false, refusal };
}

/**
 * Put an email into its normal form: surrounding whitespace goes and capitals are lowered, nothing else.
 *
 * @returns the login, or why the text is not one plain ASCII address with a dotted domain; never throws
 */
export function parseLogin(raw: string): CheckedLogin<Login> {
  const trimmed = raw.trim();
  if (trimmed.length === 0) return refuse("empty");

  if (trimmed.length > MAX_EMAIL_LENGTH) return refuse("too-long");

  // ASCII only: `toLowerCase` on the whole string would turn the Kelvin sign into a valid `k`.
  const lowered = trimmed.replace(/[A-Z]/g, (capital) => capital.toLowerCase());
  const local = EMAIL_PATTERN.exec(lowered)?.[1];

  if (local === undefined || local.length > MAX_LOCAL_LENGTH) return refuse("not-an-address");

  return { ok: true, value: lowered as Login };
}

/**
 * Build the list from stored or typed emails; the same address twice is kept once.
 *
 * @returns the list, the first email's refusal, or `no-logins` when there is none
 */
export function parseLogins(raw: readonly string[]): CheckedLogin<Logins> {
  const logins = new Set<Login>();

  for (const entry of raw) {
    const login = parseLogin(entry);
    if (!login.ok) return login;

    logins.add(login.value);
  }

  if (logins.size === 0) return refuse("no-logins");

  return { ok: true, value: logins as ReadonlySet<Login> as Logins };
}

/**
 * Decide whether an email may log in.
 *
 * @param email - as the identity provider gave it; it is put into normal form before the comparison
 * @returns `false` as well for text that is no address at all
 */
export function isLogin(logins: Logins, email: string): boolean {
  const login = parseLogin(email);
  if (!login.ok) return false;

  return logins.has(login.value);
}

/**
 * Add a login.
 *
 * @returns a new list; the given one is unchanged
 */
export function addLogin(logins: Logins, login: Login): Logins {
  return new Set([...logins, login]) as ReadonlySet<Login> as Logins;
}

/**
 * Remove a login.
 *
 * @returns a new list, `unknown-login` when the email is not listed, or `last-login` when nobody would be left
 */
export function removeLogin(logins: Logins, login: Login): CheckedLogin<Logins> {
  if (!logins.has(login)) return refuse("unknown-login");

  if (logins.size === 1) return refuse("last-login");

  const remaining = [...logins].filter((kept) => kept !== login);

  return { ok: true, value: new Set(remaining) as ReadonlySet<Login> as Logins };
}
