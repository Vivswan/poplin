// The field rules more than one record kind states: each is written once here and used by every schema that holds such a field.

import * as v from "valibot";

import { type Login, parseLogin } from "../auth/logins";
import type { TokenId } from "../auth/tokens";
import { type PublicName, parseSiteName, type SiteName } from "../names/names";
import { parseSiteId, type SiteId } from "../sites/ids";

/** The form `mintToken` gives a token's id. */
const TOKEN_ID_PATTERN = /^[0-9a-f]{16}$/;

/** A point in time, in whole milliseconds since the epoch. */
export const MOMENT = v.pipe(v.number(), v.safeInteger(), v.minValue(0));

/** A whole number from 1 up: a count, a version number, a limit. */
export const POSITIVE = v.pipe(v.number(), v.safeInteger(), v.minValue(1));

/** The public half of a token. */
export const TOKEN_ID = v.custom<TokenId>(isTokenId, "a token id is 16 lowercase hex characters");

/** An email in the normal form `parseLogin` gives. */
export const LOGIN = v.custom<Login>(isLogin, "a login is an email in its normal form");

/** A site name by the rules of `parseSiteName`. */
export const SITE_NAME = v.custom<SiteName>(isSiteName, "a site name is 3 to 40 lowercase letters, digits, and single dashes");

/** A stored public name, checked for its form alone: the names an install keeps for itself are refused where a public name is chosen. */
export const PUBLIC_NAME = v.custom<PublicName>(isSiteName, "a public name is 3 to 40 lowercase letters, digits, and single dashes");

/** A site's id. */
export const SITE_ID = v.custom<SiteId>(isSiteId, "a site id is 12 lowercase base36 characters");

/** Whoever holds a credential: a token's id, or the email of an admin acting through the dashboard. */
export const HOLDER = v.union([TOKEN_ID, LOGIN]);

/** A token's id, or an admin's email. */
export type Holder = v.InferOutput<typeof HOLDER>;

function isTokenId(value: unknown): boolean {
  return typeof value === "string" && TOKEN_ID_PATTERN.test(value);
}

function isLogin(value: unknown): boolean {
  if (typeof value !== "string") return false;

  const login = parseLogin(value);

  return login.ok && login.value === value;
}

function isSiteName(value: unknown): boolean {
  return typeof value === "string" && parseSiteName(value).ok;
}

function isSiteId(value: unknown): boolean {
  return typeof value === "string" && parseSiteId(value).ok;
}
