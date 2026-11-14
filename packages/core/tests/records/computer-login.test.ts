import { describe, expect, test } from "bun:test";

import { type ComputerLogin, mintComputerLogin } from "../../src/auth/computer-logins";
import type { Login } from "../../src/auth/logins";
import { computerLoginFromRow } from "../../src/records/computer-login";

const NOW = 1_700_000_000_000;
const ADA = "ada@example.com" as Login;
const PENDING = {
  id: "00000000000000aa",
  code: "WDJBMJHT",
  hash: "ab".repeat(32),
  scope: "publisher",
  computer: "laptop",
  state: "pending",
  decided_by: null,
  created_at: NOW,
  expires_at: NOW + 1,
  polled_at: null,
};

function rowOf(login: ComputerLogin): Record<string, unknown> {
  return {
    id: login.id,
    code: login.code,
    hash: login.hash,
    scope: login.scope,
    computer: login.computer,
    state: login.state,
    decided_by: login.state === "pending" ? null : login.decidedBy,
    created_at: login.createdAt,
    expires_at: login.expiresAt,
    polled_at: login.polledAt,
  };
}

describe("computerLoginFromRow", () => {
  // Drift: the record's fields are defined by the auth module; a field it gains or loses must fail here before a stored login cannot be checked or decided.
  test("a minted login, pending and decided, reads back from its row as it was", async () => {
    const { login } = await mintComputerLogin({ scope: "admin", computer: "laptop", now: NOW });
    const logins: ComputerLogin[] = [login, { ...login, polledAt: NOW + 5, state: "allowed", decidedBy: ADA }, { ...login, state: "denied", decidedBy: ADA }];

    expect(logins.map((each) => computerLoginFromRow(rowOf(each)))).toEqual(logins);
  });

  // Drift: a login row is a credential in waiting; each row would let one be read that nobody decided, that cannot be checked, or that carries its secret.
  test.each([
    ["an allowed login names who allowed it", { ...PENDING, state: "allowed" }],
    ["a pending login was decided by nobody", { ...PENDING, decided_by: ADA }],
    ["who decided is an email, never a token's id", { ...PENDING, state: "allowed", decided_by: "00000000000000aa" }],
    ["the state is one of three words", { ...PENDING, state: "redeemed" }],
    ["the scope is one of two words", { ...PENDING, scope: "owner" }],
    ["the id is 16 hex characters", { ...PENDING, id: "aa" }],
    ["the code is 8 letters of the code alphabet, with no dash", { ...PENDING, code: "WDJB-MJHT" }],
    ["the hash is a SHA-256 in hex, never the secret", { ...PENDING, hash: `poplin_login_${"0".repeat(16)}_${"a".repeat(64)}` }],
    ["times are whole milliseconds", { ...PENDING, expires_at: "2026-01-01" }],
    ["no column beyond the record's", { ...PENDING, secret: "a".repeat(64) }],
  ])("refuses a row that breaks: %s", (_rule, row) => {
    expect(() => computerLoginFromRow(row)).toThrow();
  });
});
