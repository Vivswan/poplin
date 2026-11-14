import { describe, expect, test } from "bun:test";
import { createHmac } from "node:crypto";

import { buildSession, importSessionKey, verifySession } from "../src/auth/cookie";
import { type Login, parseLogin } from "../src/auth/logins";

const NOW = 1_700_000_000_000;
const ONE_DAY_MS = 24 * 60 * 60 * 1000;
const THIRTY_DAYS_MS = 30 * ONE_DAY_MS;
const SECRET = new Uint8Array(32).fill(1);
const OTHER_SECRET = new Uint8Array(32).fill(2);
const BASE64URL = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";
const SIGNATURE_FILLER = "A".repeat(43);
const BYTE_ORDER_MARKED = Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from("owner@example.com")]);
const BROKEN_UTF8 = Buffer.concat([Buffer.from([0xff]), Buffer.from("owner@example.com")]);
const NASTY_INPUTS: readonly string[] = [
  "",
  " ",
  ".",
  "..",
  "...",
  "....",
  "a.b",
  "a.b.c",
  "a.1.c",
  `.1.${SIGNATURE_FILLER}`,
  `a..${SIGNATURE_FILLER}`,
  `a.00.${SIGNATURE_FILLER}`,
  `a.01.${SIGNATURE_FILLER}`,
  `a.-1.${SIGNATURE_FILLER}`,
  `a.1e3.${SIGNATURE_FILLER}`,
  `a.1.5.${SIGNATURE_FILLER}`,
  `a.${"9".repeat(16)}.${SIGNATURE_FILLER}`,
  `a.${"9".repeat(400)}.${SIGNATURE_FILLER}`,
  `a.1.${SIGNATURE_FILLER}=`,
  `a.1.${SIGNATURE_FILLER} `,
  `a.1.${SIGNATURE_FILLER}\n`,
  `a+/=.1.${SIGNATURE_FILLER}`,
  `a.1.${"+".repeat(43)}`,
  `a.1.${"_".repeat(43)}`,
  `\u00e9.1.${SIGNATURE_FILLER}`,
  `a.\u0661.${SIGNATURE_FILLER}`,
  "\u{1F600}",
  "\ud800",
  "\u0000",
  "%2E%2E",
  'a"; Path=/',
  "{}",
  "x".repeat(1_000_000),
  ".".repeat(1_000_000),
  `${"a".repeat(1_000_000)}.1.${SIGNATURE_FILLER}`,
];

function login(raw: string): Login {
  const parsed = parseLogin(raw);
  if (!parsed.ok) throw new Error(`fixture is not a login: ${raw}`);

  return parsed.value;
}

function expected(secret: Uint8Array, email: string | Buffer, issuedAt: number): string {
  const signed = `${Buffer.from(email).toString("base64url")}.${issuedAt}`;

  return `${signed}.${createHmac("sha256", secret).update(signed).digest("base64url")}`;
}

async function fixture(): Promise<{ key: CryptoKey; value: string }> {
  const key = await importSessionKey(SECRET);

  return { key, value: await buildSession({ email: login("owner@example.com"), issuedAt: NOW, key }) };
}

describe("buildSession", () => {
  test("drift: the value's layout is shared with every browser holding one; a changed layout signs every owner out with no error anywhere", async () => {
    const { value } = await fixture();

    expect(value).toBe(expected(SECRET, "owner@example.com", NOW));
    expect(value).toMatch(/^[A-Za-z0-9._-]+$/);
  });
});

describe("verifySession", () => {
  test("drift: a session opens every private site, so each way of presenting one that was not issued must be refused, and for its own reason", async () => {
    const { key, value } = await fixture();
    const otherKey = await importSessionKey(OTHER_SECRET);
    const [email = "", issued = "", signature = ""] = value.split(".");
    const strangerEmail = Buffer.from("stranger@example.com").toString("base64url");
    const lastSymbol = BASE64URL.indexOf(signature.slice(-1));
    const respelled = `${signature.slice(0, -1)}${BASE64URL[lastSymbol ^ 1]}`;

    const outcomes = {
      genuine: await verifySession(value, { key, now: NOW }),
      "another email under the old signature": await verifySession(`${strangerEmail}.${issued}.${signature}`, { key, now: NOW }),
      "a later issue time under the old signature": await verifySession(`${email}.${NOW + 1}.${signature}`, { key, now: NOW }),
      "one signature symbol changed": await verifySession(`${email}.${issued}.${signature.replace(/^./, (first) => (first === "A" ? "B" : "A"))}`, { key, now: NOW }),
      "the same signature bytes spelled another way": await verifySession(`${email}.${issued}.${respelled}`, { key, now: NOW }),
      "signed with another key": await verifySession(value, { key: otherKey, now: NOW }),
      "built with another key": await verifySession(expected(OTHER_SECRET, "owner@example.com", NOW), { key, now: NOW }),
      "truncated by one symbol": await verifySession(value.slice(0, -1), { key, now: NOW }),
      "truncated to the signed part": await verifySession(`${email}.${issued}`, { key, now: NOW }),
      "truncated mid-way": await verifySession(value.slice(0, 20), { key, now: NOW }),
      "given twice": await verifySession(`${value}.${value}`, { key, now: NOW }),
      "a signed address not in normal form": await verifySession(expected(SECRET, "Owner@Example.com", NOW), { key, now: NOW }),
      "a signed text that is no address": await verifySession(expected(SECRET, "owner", NOW), { key, now: NOW }),
      "a signed address behind a byte-order mark": await verifySession(expected(SECRET, BYTE_ORDER_MARKED, NOW), { key, now: NOW }),
      "a signed address in broken UTF-8": await verifySession(expected(SECRET, BROKEN_UTF8, NOW), { key, now: NOW }),
      "issued at the epoch": await verifySession(await buildSession({ email: login("owner@example.com"), issuedAt: 0, key }), { key, now: 0 }),
    };

    expect<unknown>(outcomes).toEqual({
      genuine: { ok: true, value: "owner@example.com" },
      "another email under the old signature": { ok: false, refusal: "bad-signature" },
      "a later issue time under the old signature": { ok: false, refusal: "bad-signature" },
      "one signature symbol changed": { ok: false, refusal: "bad-signature" },
      "the same signature bytes spelled another way": { ok: false, refusal: "malformed" },
      "signed with another key": { ok: false, refusal: "bad-signature" },
      "built with another key": { ok: false, refusal: "bad-signature" },
      "truncated by one symbol": { ok: false, refusal: "malformed" },
      "truncated to the signed part": { ok: false, refusal: "malformed" },
      "truncated mid-way": { ok: false, refusal: "malformed" },
      "given twice": { ok: false, refusal: "malformed" },
      "a signed address not in normal form": { ok: false, refusal: "malformed" },
      "a signed text that is no address": { ok: false, refusal: "malformed" },
      "a signed address behind a byte-order mark": { ok: false, refusal: "malformed" },
      "a signed address in broken UTF-8": { ok: false, refusal: "malformed" },
      "issued at the epoch": { ok: true, value: "owner@example.com" },
    });
  });

  // Drift: the age limit is the only thing that ends a session short of rotating the key; an off-by-one or a wrong unit leaves stolen values good for ever.
  test.each([
    ["on the default limit", { now: NOW + THIRTY_DAYS_MS }, { ok: true, value: "owner@example.com" }],
    ["past the default limit", { now: NOW + THIRTY_DAYS_MS + 1 }, { ok: false, refusal: "expired" }],
    ["on a given limit", { now: NOW + ONE_DAY_MS, maxAgeMs: ONE_DAY_MS }, { ok: true, value: "owner@example.com" }],
    ["past a given limit", { now: NOW + ONE_DAY_MS + 1, maxAgeMs: ONE_DAY_MS }, { ok: false, refusal: "expired" }],
    ["a limit of nothing", { now: NOW + 1, maxAgeMs: 0 }, { ok: false, refusal: "expired" }],
    ["issued a moment after now", { now: NOW - 1000 }, { ok: true, value: "owner@example.com" }],
    ["a clock that is no number", { now: Number.NaN }, { ok: false, refusal: "expired" }],
    ["a limit that is no number", { now: NOW, maxAgeMs: Number.NaN }, { ok: false, refusal: "expired" }],
  ] as ReadonlyArray<readonly [string, { now: number; maxAgeMs?: number }, unknown]>)("%s", async (_label, clock, outcome) => {
    const { key, value } = await fixture();

    expect<unknown>(await verifySession(value, { key, ...clock })).toEqual(outcome);
  });

  // Drift: this parser reads the Cookie header of every request to every site; one input that throws is a 500 anyone can cause.
  test.each(NASTY_INPUTS.map((input) => [input.slice(0, 40), input] as const))("refuses %j as malformed without throwing", async (_label, input) => {
    const key = await importSessionKey(SECRET);

    expect<unknown>(await verifySession(input, { key, now: NOW })).toEqual({ ok: false, refusal: "malformed" });
  });
});
