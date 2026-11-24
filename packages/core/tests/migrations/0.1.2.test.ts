// The step that lets a token of either scope expire at any moment or never, run on the rows an install of 0.1.2 holds.

import { describe, expect, test } from "bun:test";

import type { Statement } from "../../src/database/driver";
import { migrate } from "../../src/migrations/migrate";
import { STEPS } from "../../src/migrations/registry";
import { BunSqliteDriver } from "../database/support/bun-sqlite-driver";

/** The moment the first row is made at. */
const NOW = 1_700_000_000_000;

/** What an admin token lasted under 0.1.2, and how long a login waits, in milliseconds. */
const [THIRTY_DAYS_MS, TEN_MINUTES_MS] = [2_592_000_000, 600_000];

/** Who allowed every token and decided every login. */
const ADA = "ada@example.com";

/** Where the step stands among all steps: every step before it is one an install of 0.1.2 has applied. */
const PLACE = STEPS.findIndex((step) => step.version === "0.1.2" && step.name === "let-any-token-expire-at-a-chosen-moment-or-never");

/** Every column of the tokens, the generated one too. */
const TOKENS_HELD: Statement = { sql: "SELECT id, hash, scope, note, created_at, expires_at, allowed_by, removed_at, removed_by, user_removed, end_at FROM tokens ORDER BY id", params: [] };

/** When the token of each login runs out, as the step left it. */
const LOGINS_HELD: Statement = { sql: "SELECT id, token_expires_at FROM logins ORDER BY id", params: [] };

/** The tokens 0.1.2 can hold: an admin token with its 30 days and a publisher token with none, and one of each that was removed, the second with its user. */
const TOKENS: readonly (readonly [id: string, scope: string, note: string, createdAt: number, expiresAt: number | null, removedAt: number | null, userRemoved: number])[] = [
  ["00000000000000a1", "admin", "laptop", NOW, NOW + THIRTY_DAYS_MS, null, 0],
  ["00000000000000a2", "publisher", "ci", NOW + 1, null, null, 0],
  ["00000000000000a3", "admin", "old laptop", NOW + 2, NOW + 2 + THIRTY_DAYS_MS, NOW + 9, 0],
  ["00000000000000a4", "publisher", "agent", NOW + 3, null, NOW + 9, 1],
];

/** The logins 0.1.2 can hold: one that waits, an admin's and a publisher's that were allowed and not collected, and one that was denied. */
const LOGINS: readonly (readonly [id: string, scope: string, state: string])[] = [
  ["login-a", "admin", "pending"],
  ["login-b", "admin", "allowed"],
  ["login-c", "publisher", "allowed"],
  ["login-d", "admin", "denied"],
];

function tokenRow([id, scope, note, createdAt, expiresAt, removedAt, userRemoved]: (typeof TOKENS)[number]): Statement {
  const sql = "INSERT INTO tokens (id, hash, scope, note, created_at, expires_at, allowed_by, removed_at, removed_by, user_removed) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)";

  return { sql, params: [id, "ab".repeat(32), scope, note, createdAt, expiresAt, ADA, removedAt, removedAt === null ? null : ADA, userRemoved] };
}

function loginRow([id, scope, state]: (typeof LOGINS)[number]): Statement {
  const sql = "INSERT INTO logins (id, code, hash, scope, computer, visitor, state, decided_by, created_at, expires_at) VALUES (?1, ?2, ?3, ?4, 'laptop', 'one-visitor', ?5, ?6, ?7, ?8)";

  return { sql, params: [id, `code of ${id}`, "cd".repeat(32), scope, state, state === "pending" ? null : ADA, NOW, NOW + TEN_MINUTES_MS] };
}

describe("0.1.2/let-any-token-expire-at-a-chosen-moment-or-never", () => {
  // Drift: the step makes the tokens table again, so a column its copy leaves out is lost in every token of every install.
  // An admin login allowed before the update and collected after it would give a token that never runs out, which nobody chose.
  test("keeps every token as it was, column for column, and gives an admin login that was allowed and not collected 30 days from when the login runs out", async () => {
    const driver = new BunSqliteDriver();
    await migrate(driver, STEPS.slice(0, PLACE), NOW);
    await driver.batch([...TOKENS.map(tokenRow), ...LOGINS.map(loginRow)]);
    const [before] = await driver.batch([TOKENS_HELD]);

    const stepped = await migrate(driver, STEPS.slice(0, PLACE + 1), NOW + 20);
    const [after, logins] = await driver.batch([TOKENS_HELD, LOGINS_HELD]);

    expect([stepped.kind, before?.rows.map((row) => row.id)]).toEqual(["current", TOKENS.map(([id]) => id)]);
    expect(after?.rows).toEqual(before?.rows);
    expect(logins?.rows).toEqual([
      { id: "login-a", token_expires_at: null },
      { id: "login-b", token_expires_at: NOW + TEN_MINUTES_MS + THIRTY_DAYS_MS },
      { id: "login-c", token_expires_at: null },
      { id: "login-d", token_expires_at: null },
    ]);
  });
});
