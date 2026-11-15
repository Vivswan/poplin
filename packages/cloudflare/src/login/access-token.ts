// The token Cloudflare Access puts on a request it let through, checked here: the header's presence proves nothing.
//
// Rules from Cloudflare's "Validate JWTs" page, https://developers.cloudflare.com/cloudflare-one/access-controls/applications/http-apps/authorization-cookie/validating-json/

import { type Login, parseLogin } from "@poplin/core/src/auth/logins";
import { errors, type JWTPayload, jwtVerify } from "jose";
import { type AccessKeys, KeysUnavailable } from "./keys";
import type { Identify } from "@poplin/app/src/login/login";
import type { RequestHeaders } from "@poplin/app/src/login/session";

const TOKEN_HEADER = "Cf-Access-Jwt-Assertion";
const MAX_TOKEN_LENGTH = 8192;
const ALGORITHMS = ["RS256"];
const REQUIRED_CLAIMS = ["exp", "iat"];
const LEEWAY_SECONDS = 30;
const CLAIM_REFUSALS: Readonly<Record<string, TokenRefusal>> = { aud: "wrong-audience", iss: "wrong-issuer", nbf: "not-yet-valid" };

/** Why a request carries no usable Access token. `keys-unavailable` is the certs address failing; `no-email` is a genuine token that names no person. */
type TokenRefusal =
  | "missing"
  | "malformed"
  | "bad-signature"
  | "wrong-audience"
  | "wrong-issuer"
  | "expired"
  | "not-yet-valid"
  | "unknown-key"
  | "keys-unavailable"
  | "no-email";

type Refused = { readonly ok: false; readonly refusal: TokenRefusal };

type Checked<Value> = { readonly ok: true; readonly value: Value } | Refused;

/** The Access application in front of the login path and of every private site. */
interface AccessApplication {
  /** The team's keys; its team domain is the only issuer accepted. */
  readonly keys: AccessKeys;

  /** The application's audience tag. */
  readonly audience: string;
}

/** What a token is checked against: the application, and the time in milliseconds since the epoch. */
interface AccessCheck extends AccessApplication {
  readonly now: number;
}

function refuse(refusal: TokenRefusal): Refused {
  return { ok: false, refusal };
}

function refusalOf(error: unknown): TokenRefusal {
  if (error instanceof KeysUnavailable) return "keys-unavailable";

  if (error instanceof errors.JWKSNoMatchingKey) return "unknown-key";

  if (error instanceof errors.JWSSignatureVerificationFailed) return "bad-signature";

  if (error instanceof errors.JWTExpired) return "expired";

  if (error instanceof errors.JWTClaimValidationFailed && error.reason === "check_failed") return CLAIM_REFUSALS[error.claim] ?? "malformed";

  return "malformed";
}

async function claimsOf(token: string, check: AccessCheck): Promise<Checked<JWTPayload>> {
  try {
    const { payload, protectedHeader } = await jwtVerify(token, check.keys.find, {
      algorithms: ALGORITHMS,
      issuer: check.keys.teamDomain,
      audience: check.audience,
      requiredClaims: REQUIRED_CLAIMS,
      clockTolerance: LEEWAY_SECONDS,
      currentDate: new Date(check.now),
    });

    // A set of one key matches a header with no key id; Access always names the key.
    if (protectedHeader.kid === undefined) return refuse("malformed");

    return { ok: true, value: payload };
  } catch (error) {
    return refuse(refusalOf(error));
  }
}

async function verifyAccessToken(headers: RequestHeaders, check: AccessCheck): Promise<Checked<Login>> {
  const token = headers.get(TOKEN_HEADER);
  if (token === null || token === "") return refuse("missing");

  if (token.length > MAX_TOKEN_LENGTH) return refuse("malformed");

  const claims = await claimsOf(token, check);
  if (!claims.ok) return claims;

  // The library proves `iat` is a number and leaves its value unread.
  const issuedAt = claims.value.iat ?? Number.POSITIVE_INFINITY;
  if (issuedAt > check.now / 1000 + LEEWAY_SECONDS) return refuse("not-yet-valid");

  const email = claims.value.email;
  if (typeof email !== "string") return refuse("no-email");

  const login = parseLogin(email);
  if (!login.ok) return refuse("no-email");

  return login;
}

/**
 * Make the login of an install behind Cloudflare Access.
 *
 * @returns a check that answers the email of a token this team's Access signed for this application and that is live at the given time, in normal form; it never throws
 */
export function accessIdentity(application: AccessApplication): Identify<TokenRefusal> {
  return (headers, now) => verifyAccessToken(headers, { ...application, now });
}
