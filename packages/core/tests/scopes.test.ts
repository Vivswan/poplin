import { describe, expect, test } from "bun:test";

import { parseScope } from "../src/auth/scopes";

describe("parseScope", () => {
  // Drift: a scope read loosely from a stored record or a form would turn a misspelt or padded word into rights.
  test.each([
    ["publisher", "publisher"],
    ["admin", "admin"],
    ["Admin", undefined],
    ["admin ", undefined],
    ["", undefined],
    ["owner", undefined],
    ["publisher,admin", undefined],
    ["constructor", undefined],
  ] as ReadonlyArray<readonly [string, unknown]>)("reads %j as %j", (raw, scope) => {
    expect<unknown>(parseScope(raw)).toEqual(scope);
  });
});
