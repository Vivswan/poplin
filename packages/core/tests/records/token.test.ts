import { describe, expect, test } from "bun:test";

import { mintToken, type TokenRecord } from "../../src/auth/tokens";
import { tokenFromRow } from "../../src/records/token";

const NOW = 1_700_000_000_000;
const PUBLISHER = { id: "00000000000000aa", hash: "ab".repeat(32), scope: "publisher", note: "workspace one", created_at: NOW, expires_at: null };
const ADMIN = { ...PUBLISHER, scope: "admin", expires_at: NOW + 1 };

function rowOf(record: TokenRecord): Record<string, unknown> {
  return {
    id: record.id,
    hash: record.hash,
    scope: record.scope,
    note: record.note,
    created_at: record.createdAt,
    expires_at: record.scope === "admin" ? record.expiresAt : null,
  };
}

describe("tokenFromRow", () => {
  test("drift: the record's fields are defined by the auth module; a field it gains or loses must fail here before a stored token cannot be checked", async () => {
    const minted = await Promise.all([mintToken({ scope: "admin", note: "laptop", now: NOW }), mintToken({ scope: "publisher", note: "", now: NOW })]);
    const records = minted.map(({ record }) => record);

    expect(records.map((record) => tokenFromRow(rowOf(record)))).toEqual(records);
  });

  // Drift: a token row is a credential's only trace; each row would let a token be read that can never be checked or never runs out.
  test.each([
    ["an admin token always expires", { ...ADMIN, expires_at: null }],
    ["a publisher token has no expiry", { ...PUBLISHER, expires_at: NOW }],
    ["the scope is one of two words", { ...PUBLISHER, scope: "owner" }],
    ["the id is 16 hex characters", { ...PUBLISHER, id: "aa" }],
    ["the hash is a SHA-256 in hex, never the token", { ...PUBLISHER, hash: `poplin_${"0".repeat(16)}_${"a".repeat(64)}` }],
    ["times are whole milliseconds", { ...PUBLISHER, created_at: "2026-01-01" }],
    ["no column beyond the record's", { ...PUBLISHER, secret: "a".repeat(64) }],
  ])("refuses a row that breaks: %s", (_rule, row) => {
    expect(() => tokenFromRow(row)).toThrow();
  });
});
