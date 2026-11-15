import { describe, expect, test } from "bun:test";
import { createHmac } from "node:crypto";

import { buildSession, importSessionKey, verifySession } from "../../src/auth/cookie";
import { type Login, parseLogin } from "../../src/auth/logins";

const NOW = 1_700_000_000_000;
const NOW_SECONDS = NOW / 1000;
const ONE_DAY_MS = 24 * 60 * 60 * 1000;
const ONE_DAY_SECONDS = ONE_DAY_MS / 1000;
const SECRET = new Uint8Array(32).fill(1);
const OTHER_SECRET = new Uint8Array(32).fill(2);
const HS256 = { alg: "HS256" };
const CLAIMS = { sub: "owner@example.com", iat: NOW_SECONDS, exp: NOW_SECONDS + ONE_DAY_SECONDS };
const NASTY_INPUTS: readonly string[] = [
  "",
  " ",
  ".",
  "..",
  "...",
  "....",
  "a.b",
  "a.b.c",
  "e30.e30.",
  "e30.e30.AAAA",
  "eyJhbGciOiJIUzI1NiJ9.e30",
  "\u00e9.e30.AAAA",
  "\u{1F600}",
  "\ud800",
  "\u0000",
  "%2E%2E",
  'a"; Path=/',
  "{}",
  "owner@example.com",
  "x".repeat(1_000_000),
  ".".repeat(1_000_000),
  `${"a".repeat(1_000_000)}.e30.AAAA`,
];

function login(raw: string): Login {
  const parsed = parseLogin(raw);
  if (!parsed.ok) throw new Error(`fixture is not a login: ${raw}`);

  return parsed.value;
}

function part(json: unknown): string {
  return Buffer.from(JSON.stringify(json)).toString("base64url");
}

// A token made with no help from the code under test: the layout and the signature of RFC 7515, by `node:crypto`.
function token(secret: Uint8Array, header: unknown, claims: unknown, hash = "sha256"): string {
  const signed = `${part(header)}.${part(claims)}`;

  return `${signed}.${createHmac(hash, secret).update(signed).digest("base64url")}`;
}

async function fixture(): Promise<{ key: CryptoKey; value: string }> {
  const key = await importSessionKey(SECRET);

  return { key, value: await buildSession({ email: login("owner@example.com"), issuedAt: NOW, maxAgeMs: ONE_DAY_MS, key }) };
}

describe("buildSession", () => {
  test("drift: the value is a standard HS256 token carrying the email, the issue time, and the end time, and nothing else; a claim added here rides in every cookie", async () => {
    const { value } = await fixture();

    expect(value).toBe(token(SECRET, HS256, CLAIMS));
    expect(value).toMatch(/^[A-Za-z0-9._-]+$/);
  });
});

describe("verifySession", () => {
  test("drift: a session opens every private site, so each way of presenting one that was not issued must be refused, and for its own reason", async () => {
    const { key, value } = await fixture();
    const [header = "", claims = "", signature = ""] = value.split(".");
    const check = { key, now: NOW };

    const outcomes = {
      genuine: await verifySession(value, check),
      "another email under the old signature": await verifySession(`${header}.${part({ ...CLAIMS, sub: "stranger@example.com" })}.${signature}`, check),
      "a later end under the old signature": await verifySession(`${header}.${part({ ...CLAIMS, exp: CLAIMS.exp + 1 })}.${signature}`, check),
      "one signature symbol changed": await verifySession(`${header}.${claims}.${signature.replace(/^./, (first) => (first === "A" ? "B" : "A"))}`, check),
      "checked under another key": await verifySession(value, { key: await importSessionKey(OTHER_SECRET), now: NOW }),
      "built with another key": await verifySession(token(OTHER_SECRET, HS256, CLAIMS), check),
      "truncated by one symbol": await verifySession(value.slice(0, -1), check),
      "truncated to the signed part": await verifySession(`${header}.${claims}`, check),
      "truncated mid-way": await verifySession(value.slice(0, 20), check),
      "given twice": await verifySession(`${value}.${value}`, check),
      "no signature and the algorithm `none`": await verifySession(`${part({ alg: "none" })}.${claims}.`, check),
      "the same key under another algorithm": await verifySession(token(SECRET, { alg: "HS512" }, CLAIMS, "sha512"), check),
      "a header that names no algorithm": await verifySession(token(SECRET, {}, CLAIMS), check),
      "a header that demands an extension": await verifySession(token(SECRET, { ...HS256, crit: ["x"], x: 1 }, CLAIMS), check),
      "signed claims that are no object": await verifySession(token(SECRET, HS256, ["owner@example.com"]), check),
      "signed without an email": await verifySession(token(SECRET, HS256, { iat: CLAIMS.iat, exp: CLAIMS.exp }), check),
      "signed without an end": await verifySession(token(SECRET, HS256, { sub: CLAIMS.sub, iat: CLAIMS.iat }), check),
      "signed without an issue time": await verifySession(token(SECRET, HS256, { sub: CLAIMS.sub, exp: CLAIMS.exp }), check),
      "a signed end that is no number": await verifySession(token(SECRET, HS256, { ...CLAIMS, exp: "never" }), check),
      "a signed email that is no text": await verifySession(token(SECRET, HS256, { ...CLAIMS, sub: 7 }), check),
      "a signed address not in normal form": await verifySession(token(SECRET, HS256, { ...CLAIMS, sub: "Owner@Example.com" }), check),
      "a signed text that is no address": await verifySession(token(SECRET, HS256, { ...CLAIMS, sub: "owner" }), check),
      "a signed address behind a byte-order mark": await verifySession(token(SECRET, HS256, { ...CLAIMS, sub: "\ufeffowner@example.com" }), check),
      "issued at the epoch": await verifySession(await buildSession({ email: login("owner@example.com"), issuedAt: 0, maxAgeMs: ONE_DAY_MS, key }), { key, now: 0 }),
    };

    expect<unknown>(outcomes).toEqual({
      genuine: { ok: true, value: "owner@example.com" },
      "another email under the old signature": { ok: false, refusal: "bad-signature" },
      "a later end under the old signature": { ok: false, refusal: "bad-signature" },
      "one signature symbol changed": { ok: false, refusal: "bad-signature" },
      "checked under another key": { ok: false, refusal: "bad-signature" },
      "built with another key": { ok: false, refusal: "bad-signature" },
      "truncated by one symbol": { ok: false, refusal: "bad-signature" },
      "truncated to the signed part": { ok: false, refusal: "malformed" },
      "truncated mid-way": { ok: false, refusal: "malformed" },
      "given twice": { ok: false, refusal: "malformed" },
      "no signature and the algorithm `none`": { ok: false, refusal: "malformed" },
      "the same key under another algorithm": { ok: false, refusal: "malformed" },
      "a header that names no algorithm": { ok: false, refusal: "malformed" },
      "a header that demands an extension": { ok: false, refusal: "malformed" },
      "signed claims that are no object": { ok: false, refusal: "malformed" },
      "signed without an email": { ok: false, refusal: "malformed" },
      "signed without an end": { ok: false, refusal: "malformed" },
      "signed without an issue time": { ok: false, refusal: "malformed" },
      "a signed end that is no number": { ok: false, refusal: "malformed" },
      "a signed email that is no text": { ok: false, refusal: "malformed" },
      "a signed address not in normal form": { ok: false, refusal: "malformed" },
      "a signed text that is no address": { ok: false, refusal: "malformed" },
      "a signed address behind a byte-order mark": { ok: false, refusal: "malformed" },
      "issued at the epoch": { ok: true, value: "owner@example.com" },
    });
  });

  // Drift: the end time is the only thing that ends a session short of rotating the key; an off-by-one or a wrong unit leaves stolen values good for ever.
  test.each([
    ["the last millisecond of the lifetime", { issuedAt: NOW, maxAgeMs: ONE_DAY_MS, now: NOW + ONE_DAY_MS - 1 }, { ok: true, value: "owner@example.com" }],
    ["the lifetime to the second", { issuedAt: NOW, maxAgeMs: ONE_DAY_MS, now: NOW + ONE_DAY_MS }, { ok: false, refusal: "expired" }],
    ["the lifetime, issued between two seconds", { issuedAt: NOW + 999, maxAgeMs: ONE_DAY_MS + 999, now: NOW + 999 + ONE_DAY_MS + 999 }, { ok: false, refusal: "expired" }],
    ["a lifetime of nothing", { issuedAt: NOW, maxAgeMs: 0, now: NOW }, { ok: false, refusal: "expired" }],
    ["issued a moment after now", { issuedAt: NOW, maxAgeMs: ONE_DAY_MS, now: NOW - 1000 }, { ok: true, value: "owner@example.com" }],
    ["a clock that is no number", { issuedAt: NOW, maxAgeMs: ONE_DAY_MS, now: Number.NaN }, { ok: false, refusal: "expired" }],
    ["a clock past the last date", { issuedAt: NOW, maxAgeMs: ONE_DAY_MS, now: 1e300 }, { ok: false, refusal: "expired" }],
  ] as ReadonlyArray<readonly [string, { issuedAt: number; maxAgeMs: number; now: number }, unknown]>)("%s", async (_label, { now, ...lifetime }, outcome) => {
    const key = await importSessionKey(SECRET);
    const value = await buildSession({ email: login("owner@example.com"), ...lifetime, key });

    expect<unknown>(await verifySession(value, { key, now })).toEqual(outcome);
  });

  // Drift: this parser reads the Cookie header of every request to every site; one input that throws is a 500 anyone can cause.
  test.each(NASTY_INPUTS.map((input) => [input.slice(0, 40), input] as const))("refuses %j as malformed without throwing", async (_label, input) => {
    const key = await importSessionKey(SECRET);

    expect<unknown>(await verifySession(input, { key, now: NOW })).toEqual({ ok: false, refusal: "malformed" });
  });
});
