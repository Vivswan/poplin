import { describe, expect, test } from "vitest";

import { allowanceSpent } from "../../../src/shared/database/allowance";

describe("allowanceSpent", () => {
  // Drift: D1 says which daily limit is used up only in the words of its error, which its error reference prints. Words read too loosely would pause an install over a passing failure, and too tightly would leave the bare 503.
  test.each([
    ["the read limit", new Error("D1_ERROR: Your account has exceeded D1's free tier daily row read limit. Upgrade to a paid plan or wait until midnight UTC."), "reading"],
    ["the write limit", new Error("D1_ERROR: Your account has exceeded D1's free tier daily row write limit."), "writing"],
    ["the write limit, in the cause of the error", new Error("D1_ERROR", { cause: new Error("Your account has exceeded D1's free tier daily row write limit.") }), "writing"],
    ["a database that is overloaded", new Error("D1_ERROR: D1 DB is overloaded. Too many requests queued."), undefined],
    ["a database that is full", new Error("D1_ERROR: Exceeded maximum DB size."), undefined],
    ["a statement that failed", new Error("D1_ERROR: UNIQUE constraint failed: logins.code: SQLITE_CONSTRAINT"), undefined],
    ["something that is no error", "exceeded D1's free tier daily row read limit", undefined],
  ])("%s", (_name, error, spent) => {
    const read = allowanceSpent(error);

    expect([read?.spent, read?.cause]).toEqual(spent === undefined ? [undefined, undefined] : [spent, error]);
  });
});
