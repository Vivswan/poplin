import { describe, expect, test } from "bun:test";

import { type Asked, parseAskedVersion } from "../../src/deploy/asked-version";

describe("parseAskedVersion", () => {
  const read: readonly { readonly name: string; readonly raw: string | undefined; readonly asked: Asked | undefined }[] = [
    { name: "an unset variable", raw: undefined, asked: { kind: "latest" } },
    { name: "an empty variable, which a cleared field of the dashboard leaves", raw: "", asked: { kind: "latest" } },
    { name: "`latest`", raw: "latest", asked: { kind: "latest" } },
    { name: "`latest` pasted with a space after it", raw: "latest ", asked: { kind: "latest" } },
    { name: "a version", raw: "0.2.0", asked: { kind: "exact", version: "0.2.0" } },
    { name: "a version of several digits", raw: "12.30.104", asked: { kind: "exact", version: "12.30.104" } },
    { name: "`this`", raw: "this", asked: { kind: "this" } },
    { name: "a version written as its tag", raw: "v0.2.0", asked: undefined },
    { name: "a version of two numbers", raw: "0.2", asked: undefined },
    { name: "a version before its release", raw: "1.0.0-rc.1", asked: undefined },
    { name: "a branch", raw: "main", asked: undefined },
    { name: "`latest` in capitals", raw: "LATEST", asked: undefined },
    { name: "a version with a command after it", raw: "0.2.0; echo", asked: undefined },
  ];

  // Drift: a value read loosely would deploy something other than what the person typed, and a pin is how an install goes back.
  test.each(read)("$name is read as $asked: the variable is the one place a person says which release an install runs", ({ raw, asked }) => {
    expect(parseAskedVersion(raw)).toEqual(asked);
  });
});
