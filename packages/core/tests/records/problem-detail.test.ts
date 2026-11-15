import { describe, expect, test } from "bun:test";

import { problemDetail } from "../../src/records/problem-detail";

/** A token of the product's shape, made up. */
const TOKEN = `poplin_${"0123456789abcdef"}_${"a1".repeat(32)}`;

describe("problemDetail", () => {
  // Drift: the message is copied into a bug report by a person who trusts it holds nothing of the install. Each row is a value a failure's message can carry, and what must be left of it.
  test.each<readonly [what: string, message: string, kept: string | null]>([
    ["plain words stay", "the store did not answer in time", "the store did not answer in time"],
    ["an apostrophe is no quote", "the day's allowance of the database is used up", "the day's allowance of the database is used up"],
    ["a status and a code of letters stay", "D1_ERROR: the batch failed with 503 (SQLITE_BUSY)", "... the batch failed with 503 (SQLITE_BUSY)"],
    ["a token", `no record of ${TOKEN} was found`, "no record of ... was found"],
    ["a token's id", "token 0123456789abcdef ran out", "token ... ran out"],
    ["an id of hex letters alone, bare, in brackets, and before a full stop", "token deadbeefdeadbeef or (deadbeefdeadbeef) or deadbeefdeadbeef.", "token ... or ... or ..."],
    ["an id of hex letters inside a word of underscores", "token_id_deadbeefdeadbeef and deadbeefdeadbeef_token are gone", "... and ... are gone"],
    ["an email", "ada@example.com is no login", "... is no login"],
    ["an address with a query", "fetch of https://example.com/a/b?key=secret&x=1 failed", "fetch of ... failed"],
    ["a hostname and a path", "report--k3f9x2ab71qz-p-poplin.example.com/index.html was not found", "... was not found"],
    ["a visitor's address", "too many requests from 203.0.113.7 and 2001:db8::1 today", "too many requests from ... and ... today"],
    ["a site's label", "the site q3-sales--k3f9x2ab71qz is gone", "the site ... is gone"],
    ["a quoted value, whatever it holds", 'the path "private notes.html" of `my site` is no key', "the path ... of ... is no key"],
    ["a single-quoted value", "no column named 'secret plan' here", "no column named ... here"],
    ["a file's bytes", "unexpected bytes <html><body>Salary: 100</body></html> in body", "unexpected bytes ... in body"],
    ["nothing but values", `${TOKEN} ada@example.com`, null],
  ])("%s", (_what, message, kept) => {
    expect(problemDetail(new Error(message))).toEqual({ name: "Error", message: kept });
  });

  // Drift: the row's column holds 200 characters and the database refuses more, so a long message would lose the whole note.
  test("a long message is cut to 200 characters, the last three saying so", () => {
    const { message } = problemDetail(new Error("word ".repeat(400)));

    expect([message?.length, message?.endsWith("word wo..."), problemDetail(new Error("x".repeat(5000))).message]).toEqual([200, true, null]);
  });

  // Drift: a name is kept beside the message, so it is held to the same rule: a class's name stays, and anything a caller could put a value in does not.
  test.each<readonly [what: string, failure: unknown, kept: { name: string | null; message: string | null }]>([
    ["control: a class's name stays", new TypeError("bad call"), { name: "TypeError", message: "bad call" }],
    ["a name that holds a value", Object.assign(new Error("failed"), { name: TOKEN }), { name: null, message: "failed" }],
    ["a name with a digit", Object.assign(new Error("failed"), { name: "k3f9x2ab71qz" }), { name: null, message: "failed" }],
    ["a name of hex letters", Object.assign(new Error("failed"), { name: "deadbeefdeadbeef" }), { name: null, message: "failed" }],
    ["a name that ends in hex letters", Object.assign(new Error("failed"), { name: "Token_deadbeefdeadbeef" }), { name: null, message: "failed" }],
    ["a name with punctuation", Object.assign(new Error("failed"), { name: "(Error)" }), { name: null, message: "failed" }],
    ["a thrown string", "the bucket said no to ada@example.com", { name: null, message: "the bucket said no to ..." }],
    ["a thrown object", { message: "ada@example.com", token: TOKEN }, { name: null, message: null }],
  ])("%s", (_what, failure, kept) => {
    expect(problemDetail(failure)).toEqual(kept);
  });
});
