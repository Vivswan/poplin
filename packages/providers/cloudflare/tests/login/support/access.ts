// A team's Access, faked: RSA keys made here, tokens signed with them, and a certs address that counts its calls.

import { exportJWK, type JWK, SignJWT } from "jose";
import type { accessKeys } from "../../../src/login/keys";

export const TEAM = "https://team.cloudflareaccess.com";
export const AUDIENCE = "4714c1358e65fe4b408ad6d432a5f878f08194bdb4752441fd56faefa9b2b6f2";
export const NOW = 1_700_000_000_000;
export const NOW_SECONDS = NOW / 1000;

const RSA = { name: "RSASSA-PKCS1-v1_5", modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: "SHA-256" } as const;

/** One signing key of a team: the private half signs, `jwk` is what the certs address lists. */
export interface Signer {
  readonly kid: string;
  readonly pair: CryptoKeyPair;
  readonly jwk: JWK;
}

/** A certs address: `keys` is what it lists now, `calls` every address asked, `down` makes it fail. */
export interface Certs {
  keys: readonly JWK[];
  down: boolean;
  readonly calls: string[];
  readonly fetch: Parameters<typeof accessKeys>[0]["fetch"];
}

export async function signer(kid: string): Promise<Signer> {
  const pair = await crypto.subtle.generateKey(RSA, true, ["sign", "verify"]);
  const jwk = { ...(await exportJWK(pair.publicKey)), kid, alg: "RS256", use: "sig" };

  return { kid, pair, jwk };
}

export function certs(...signers: Signer[]): Certs {
  const served: Certs = {
    keys: signers.map((each) => each.jwk),
    down: false,
    calls: [],
    fetch: async (url) => {
      served.calls.push(url);
      if (served.down) throw new Error("the certs address is down");

      return Response.json({ keys: served.keys });
    },
  };

  return served;
}

/** The claims Access puts in a person's token, live at `NOW`; `changes` replace them and `undefined` drops one. */
export function claims(changes: Record<string, unknown> = {}): Record<string, unknown> {
  const full = { aud: [AUDIENCE], iss: TEAM, email: "owner@example.com", type: "app", sub: "a-person", iat: NOW_SECONDS - 10, nbf: NOW_SECONDS - 10, exp: NOW_SECONDS + 3600, ...changes };

  return Object.fromEntries(Object.entries(full).filter(([, value]) => value !== undefined));
}

export function sign(by: Signer, changes: Record<string, unknown> = {}, kid: string | null = by.kid): Promise<string> {
  return new SignJWT(claims(changes)).setProtectedHeader({ alg: "RS256", ...(kid === null ? {} : { kid }) }).sign(by.pair.privateKey);
}

export function headersOf(token: string | undefined): Headers {
  return new Headers(token === undefined ? {} : { "Cf-Access-Jwt-Assertion": token });
}
