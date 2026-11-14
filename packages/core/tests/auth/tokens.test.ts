import { describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";

import { isExpired, mintToken, parseToken, type TokenId, type TokenRecord, verifyToken } from "../../src/auth/tokens";

const NOW = 1_700_000_000_000;
const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000;
const TOKEN_SHAPE = /^poplin_[0-9a-f]{16}_[0-9a-f]{64}$/;
const WELL_FORMED = `poplin_${"0".repeat(16)}_${"a".repeat(64)}`;
const NASTY_INPUTS: readonly string[] = [
  "",
  " ",
  "poplin_",
  "poplin__",
  `poplin_${"0".repeat(16)}`,
  `poplin_${"0".repeat(16)}_`,
  `poplin_${"0".repeat(16)}_${"a".repeat(63)}`,
  `${WELL_FORMED}a`,
  `${WELL_FORMED}\n`,
  ` ${WELL_FORMED}`,
  `Bearer ${WELL_FORMED}`,
  WELL_FORMED.toUpperCase(),
  WELL_FORMED.replace("poplin_", "POPLIN_"),
  WELL_FORMED.replaceAll("_", "."),
  WELL_FORMED.replace("a", "\u00e9"),
  WELL_FORMED.replace("a", "g"),
  "poplin_\u0000",
  "\u{1F600}",
  "\ud800",
  "___",
  "...",
  "%00%00",
  "x".repeat(1_000_000),
  `poplin_${"0".repeat(1_000_000)}`,
];
const ADMIN: TokenRecord = { id: "0000000000000000" as TokenId, hash: "", note: "", createdAt: NOW, scope: "admin", expiresAt: NOW };
const PUBLISHER: TokenRecord = { id: "0000000000000000" as TokenId, hash: "", note: "", createdAt: NOW, scope: "publisher" };

describe("mintToken", () => {
  test("drift: the record is all that is stored, so it must hold the hash and the facts and no part of the token's secret", async () => {
    const admin = await mintToken({ scope: "admin", note: "laptop", now: NOW });
    const publisher = await mintToken({ scope: "publisher", note: "workspace one", now: NOW });
    const [, adminId = "", adminSecret = "missing"] = admin.token.split("_");
    const [, publisherId = ""] = publisher.token.split("_");

    expect([admin.token, publisher.token].map((token) => TOKEN_SHAPE.test(token))).toEqual([true, true]);
    expect<unknown>([admin.record, publisher.record]).toEqual([
      { id: adminId, hash: createHash("sha256").update(admin.token).digest("hex"), note: "laptop", createdAt: NOW, scope: "admin", expiresAt: NOW + THIRTY_DAYS_MS },
      { id: publisherId, hash: createHash("sha256").update(publisher.token).digest("hex"), note: "workspace one", createdAt: NOW, scope: "publisher" },
    ]);
    expect(JSON.stringify(admin.record)).not.toContain(adminSecret);
  });
});

describe("verifyToken", () => {
  test("drift: a token must open its own record and no other, whichever way the two are crossed", async () => {
    const first = await mintToken({ scope: "publisher", note: "first", now: NOW });
    const second = await mintToken({ scope: "publisher", note: "second", now: NOW });
    const forgedId = first.token.replace(first.record.id, second.record.id);

    const outcomes = [
      await verifyToken(first.token, first.record, NOW),
      await verifyToken(second.token, second.record, NOW),
      await verifyToken(first.token, second.record, NOW),
      await verifyToken(second.token, first.record, NOW),
      await verifyToken(forgedId, second.record, NOW),
      await verifyToken(first.record.hash, first.record, NOW),
      await verifyToken(`poplin_${first.record.id}_${first.record.hash}`, first.record, NOW),
    ];

    expect<unknown>(outcomes).toEqual([
      { ok: true, value: first.record },
      { ok: true, value: second.record },
      { ok: false, refusal: "mismatch" },
      { ok: false, refusal: "mismatch" },
      { ok: false, refusal: "mismatch" },
      { ok: false, refusal: "malformed" },
      { ok: false, refusal: "mismatch" },
    ]);
  });

  test("drift: an admin token is good for 30 days and not a millisecond more, by the caller's clock alone", async () => {
    const admin = await mintToken({ scope: "admin", note: "laptop", now: NOW });

    const outcomes = [
      await verifyToken(admin.token, admin.record, NOW + THIRTY_DAYS_MS - 1),
      await verifyToken(admin.token, admin.record, NOW + THIRTY_DAYS_MS),
      await verifyToken(admin.token, admin.record, Number.NaN),
    ];

    expect<unknown>(outcomes).toEqual([
      { ok: true, value: admin.record },
      { ok: false, refusal: "expired" },
      { ok: false, refusal: "expired" },
    ]);
  });

  // Drift: this parser reads the Authorization header of every request; one input that throws is a 500 anyone can cause.
  test.each(NASTY_INPUTS.map((input) => [input.slice(0, 40), input] as const))("refuses %j as malformed without throwing", async (_label, input) => {
    const { record } = await mintToken({ scope: "publisher", note: "", now: NOW });

    expect<unknown>([parseToken(input), await verifyToken(input, record, NOW)]).toEqual([
      { ok: false, refusal: "malformed" },
      { ok: false, refusal: "malformed" },
    ]);
  });
});

describe("parseToken", () => {
  test("drift: the id read from a token is the key its record is stored under, so it must be the record's id exactly", async () => {
    const { token, record } = await mintToken({ scope: "publisher", note: "", now: NOW });

    expect<unknown>(parseToken(token)).toEqual({ ok: true, value: record.id });
  });
});

describe("isExpired", () => {
  // Drift: publisher tokens live until revoked and admin tokens do not; mixing the two either strands agents or leaves admin rights open for good.
  test.each([
    [ADMIN, NOW - 1, false],
    [ADMIN, NOW, true],
    [ADMIN, Number.NaN, true],
    [PUBLISHER, NOW, false],
    [PUBLISHER, Number.MAX_SAFE_INTEGER, false],
  ] as const)("%j at %d: %j", (record, now, expired) => {
    expect(isExpired(record, now)).toBe(expired);
  });
});
