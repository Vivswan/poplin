import { describe, expect, test } from "bun:test";

import { holdsSecret, mintComputerLogin, parseLoginSecret, parseUserCode, type UserCode } from "../../src/auth/computer-logins";
import { parseToken } from "../../src/auth/tokens";

const NOW = 1_700_000_000_000;
const TEN_MINUTES_MS = 10 * 60 * 1000;
const CODE = "WDJBMJHT" as UserCode;

describe("mintComputerLogin", () => {
  // Drift: the record is all that is stored, so it must hold the hash and the facts and no part of the secret; and a secret that passed for a token would be taken where a token goes.
  test("the record holds the secret's SHA-256 and no part of the secret, runs out ten minutes on, and its secret is no token", async () => {
    const { secret, login } = await mintComputerLogin({ scope: "publisher", computer: "laptop", visitor: "one-visitor", now: NOW });
    const [, id = "", random = ""] = /^poplin_login_([0-9a-f]{16})_([0-9a-f]{64})$/.exec(secret) ?? [];

    const hash = new Bun.CryptoHasher("sha256").update(secret).digest("hex");

    expect(login).toEqual({ id, code: login.code, hash, scope: "publisher", computer: "laptop", visitor: "one-visitor", createdAt: NOW, expiresAt: NOW + TEN_MINUTES_MS, state: "pending" } as typeof login);
    expect([JSON.stringify(login).includes(random), parseToken(secret).ok, parseLoginSecret(secret)]).toEqual([false, false, login.id]);
  });

  // Drift: the code is read aloud and typed; a vowel would spell words, and a digit or a letter that looks like another would be mistyped.
  test("codes are eight letters of the twenty consonants that no vowel, digit, or look-alike is among, and all twenty are drawn", async () => {
    const codes = await Promise.all(Array.from({ length: 500 }, async () => (await mintComputerLogin({ scope: "admin", computer: "", visitor: "one-visitor", now: NOW })).login.code));

    expect(codes.filter((code) => !/^[BCDFGHJKLMNPQRSTVWXZ]{8}$/.test(code))).toEqual([]);
    expect(new Set(codes.join("")).size).toBe(20);
  });
});

describe("parseUserCode", () => {
  // Drift: a person types the code from a terminal; the dash, the capitals, and a stray space are theirs to choose, and nothing else is a code.
  test.each([
    ["WDJB-MJHT", CODE],
    ["wdjb-mjht", CODE],
    ["WDJBMJHT", CODE],
    [" wdjb mjht\n", CODE],
    ["WDJB-MJH", undefined],
    ["WDJB-MJHTT", undefined],
    ["WDJB-MJHA", undefined],
    ["WDJB-MJH1", undefined],
    ["WDJB_MJHT", undefined],
    ["", undefined],
    [`WDJB${"-".repeat(40)}MJHT`, undefined],
    ["\u{1D4E6}DJB-MJHT", undefined],
    ["WDJB-MJH\u017f", undefined],
    ["WDJB\u00a0MJHT", undefined],
  ])("%j is read as %j", (typed, code) => {
    expect(parseUserCode(typed)).toBe(code);
  });
});

describe("holdsSecret", () => {
  // Drift: the secret is the one thing that tells the terminal that asked from anyone else; a near miss that passed would hand its token to a stranger.
  test("only the secret a login was made with is its secret", async () => {
    const { secret, login } = await mintComputerLogin({ scope: "admin", computer: "laptop", visitor: "one-visitor", now: NOW });
    const other = await mintComputerLogin({ scope: "admin", computer: "laptop", visitor: "one-visitor", now: NOW });
    const flipped = `${secret.slice(0, -1)}${secret.endsWith("a") ? "b" : "a"}`;
    const presented = [secret, flipped, other.secret, secret.toUpperCase(), ` ${secret}`, `${secret}\n`, login.hash, login.id, "", "x".repeat(1_000_000)];

    expect(await Promise.all(presented.map((text) => holdsSecret(text, login)))).toEqual([true, false, false, false, false, false, false, false, false, false]);
    expect(await holdsSecret(secret, { ...login, hash: other.login.hash })).toBe(false);
  });
});
