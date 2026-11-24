// The steps that take a database on from 0.1.2.

import type { VersionSteps } from "./migrate";

/**
 * The tokens table without the check that gave every admin token an expiry and no publisher token one: a token of either scope runs out at `expires_at`, and never where that is NULL.
 * A check cannot be taken off a table, so the table is made again under another name. Every other column and check is as 0.1.2 had it, with STRICT and WITHOUT ROWID; the table has no trigger, and no table refers to it.
 */
const TOKENS_OF_ANY_EXPIRY = `
CREATE TABLE __new_tokens (
  id TEXT NOT NULL PRIMARY KEY,
  hash TEXT NOT NULL,
  scope TEXT NOT NULL CHECK (scope IN ('admin', 'publisher')),
  note TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  expires_at INTEGER,
  allowed_by TEXT NOT NULL,
  removed_at INTEGER,
  removed_by TEXT,
  user_removed INTEGER NOT NULL DEFAULT 0 CHECK (user_removed IN (0, 1)),
  end_at INTEGER GENERATED ALWAYS AS (coalesce(removed_at, expires_at)) VIRTUAL,
  CHECK ((removed_at IS NULL) = (removed_by IS NULL)),
  CHECK (user_removed = 0 OR removed_at IS NOT NULL)
) STRICT, WITHOUT ROWID`;

/** Every token as it is stored, in one statement, whether it works or has ended. `end_at` is not copied: the table works it out. */
const TOKENS_KEPT = `
INSERT INTO __new_tokens (id, hash, scope, note, created_at, expires_at, allowed_by, removed_at, removed_by, user_removed)
SELECT id, hash, scope, note, created_at, expires_at, allowed_by, removed_at, removed_by, user_removed FROM tokens`;

/** When the token of an allowed login runs out, kept with the login until its computer collects the token: NULL for a token that never does, and for every login that is not allowed. */
const LOGINS_KEEP_THE_TOKEN_EXPIRY = "ALTER TABLE logins ADD COLUMN token_expires_at INTEGER CHECK (token_expires_at IS NULL OR state = 'allowed')";

/** An admin login allowed under 0.1.2 and not collected yet keeps its 30 days, counted from when the login itself runs out: the last moment it can be collected at, so no token ends sooner than 0.1.2 had it. */
const ALLOWED_ADMIN_LOGINS_KEEP_30_DAYS = "UPDATE logins SET token_expires_at = expires_at + 2592000000 WHERE state = 'allowed' AND scope = 'admin'";

/** The steps that leave 0.1.2. */
export const V0_1_2: VersionSteps = {
  version: "0.1.2",
  steps: [
    {
      name: "let-any-token-expire-at-a-chosen-moment-or-never",
      description: "let any token expire at a chosen moment or never",
      by: "install",
      statements: [
        TOKENS_OF_ANY_EXPIRY,
        TOKENS_KEPT,
        "DROP TABLE tokens",
        "ALTER TABLE __new_tokens RENAME TO tokens",
        "CREATE INDEX tokens_by_creation ON tokens (created_at DESC, id DESC) WHERE removed_at IS NULL",
        "CREATE INDEX tokens_by_end ON tokens (end_at DESC, id DESC)",
        "CREATE INDEX tokens_by_user ON tokens (allowed_by, expires_at) WHERE removed_at IS NULL",
        LOGINS_KEEP_THE_TOKEN_EXPIRY,
        ALLOWED_ADMIN_LOGINS_KEEP_30_DAYS,
      ],
    },
  ],
};
