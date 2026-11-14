import { describe, expect, test } from "bun:test";

import { mintToken } from "../src/auth/tokens";
import { checkRecord } from "../src/records/kind";
import { TOKEN } from "../src/records/token";

const NOW = 1_700_000_000_000;
const PUBLISHER = { shape: 1, revision: 1, id: "00000000000000aa", hash: "ab".repeat(32), note: "workspace one", createdAt: NOW, scope: "publisher" };
const ADMIN = { ...PUBLISHER, scope: "admin", expiresAt: NOW + 1 };

describe("TOKEN", () => {
  test("drift: the record's fields are defined by the auth module; a field it gains or loses must fail here before a minted token cannot be stored", async () => {
    const minted = await Promise.all([mintToken({ scope: "admin", note: "laptop", now: NOW }), mintToken({ scope: "publisher", note: "", now: NOW })]);
    const stamped = minted.map(({ record }) => ({ ...record, shape: 1, revision: 1 }));

    expect<unknown>(stamped.map((record) => checkRecord(TOKEN, record))).toEqual(stamped.map((record) => ({ ok: true, record })));
  });

  // Drift: a token record is a credential's only trace; each row would let a token be stored that can never be checked or never runs out.
  test.each([
    ["an admin token always expires", { ...ADMIN, expiresAt: undefined }, "expiresAt"],
    ["a publisher token has no expiry", { ...PUBLISHER, expiresAt: NOW }, "expiresAt"],
    ["the scope is one of two words", { ...PUBLISHER, scope: "owner" }, "scope"],
    ["the id is 16 hex characters", { ...PUBLISHER, id: "aa" }, "id"],
    ["the hash is a SHA-256 in hex, never the token", { ...PUBLISHER, hash: `poplin_${"0".repeat(16)}_${"a".repeat(64)}` }, "hash"],
    ["times are whole milliseconds", { ...PUBLISHER, createdAt: "2026-01-01" }, "createdAt"],
    ["the stamp is this shape's number", { ...PUBLISHER, shape: 0 }, "shape"],
    ["no field beyond the shape", { ...PUBLISHER, secret: "a".repeat(64) }, "secret"],
  ])("refuses a record that breaks: %s", (_, record, field) => {
    const checked = checkRecord(TOKEN, JSON.parse(JSON.stringify(record)));

    expect(checked.ok ? undefined : checked.issues[0]?.split(":")[0]).toBe(field);
  });
});
