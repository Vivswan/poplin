// A login: the install's address and the token presented to it, as the login file and the environment both state it.

import * as v from "valibot";

import { isLoopback } from "../../../core/src/api/loopback";

const SECURE = "https:";
const PLAIN = "http:";
const TOKEN_PATTERN = /^[\x21-\x7e]+$/;
const NOT_AN_OBJECT = "it must hold a server and a token and nothing else";
const NOT_A_SERVER = "the server must be an https:// address with nothing after the host, such as https://poplin.example.com";
const NOT_A_TOKEN = "the token must be printable ASCII with no spaces";
const LOGIN_SCHEMA = v.pipe(
  v.strictObject(
    {
      server: v.pipe(v.string(NOT_A_SERVER), v.check(isServer, NOT_A_SERVER)),
      token: v.pipe(v.string(NOT_A_TOKEN), v.regex(TOKEN_PATTERN, NOT_A_TOKEN)),
    },
    NOT_AN_OBJECT,
  ),
  v.readonly(),
  v.brand("Login"),
);

/** A checked login. `server` is an origin `isServer` takes; `token` is printable ASCII with no whitespace. */
export type Login = v.InferOutput<typeof LOGIN_SCHEMA>;

/** A login, or what is wrong with the value in words that never quote it, since it may hold a token. */
type ParsedLogin = { readonly ok: true; readonly login: Login } | { readonly ok: false; readonly problem: string };

/**
 * Decide whether a text is the address of an install.
 *
 * A token is sent to the server, so plain `http://` is taken only for this machine itself: `127.0.0.1`, `localhost`, or `[::1]`, where nothing crosses a network.
 *
 * @returns `true` for an `https://` origin, or an `http://` origin of this machine, with nothing after the host
 */
export function isServer(server: string): boolean {
  if (!URL.canParse(server)) return false;

  const url = new URL(server);

  // An origin has no credentials, path, query, or fragment, so any of them makes the text differ from it.
  if (url.origin !== server) return false;

  return url.protocol === SECURE || (url.protocol === PLAIN && isLoopback(url.hostname));
}

/**
 * Read a login out of a value of any shape, such as parsed JSON.
 *
 * @returns the login, or the first problem; a value with any field beyond `server` and `token` is refused whole, and nothing throws
 */
export function parseLogin(value: unknown): ParsedLogin {
  const parsed = v.safeParse(LOGIN_SCHEMA, value);

  if (!parsed.success) return { ok: false, problem: parsed.issues[0].message };

  return { ok: true, login: parsed.output };
}
