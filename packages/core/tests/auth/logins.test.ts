import { describe, expect, test } from "bun:test";

import { addLogin, isLogin, type Login, type Logins, parseLogin, parseLogins, removeLogin } from "../../src/auth/logins";

const LONGEST_LOCAL = "a".repeat(64);
const LONG_DOMAIN = `${"d".repeat(63)}.${"d".repeat(63)}.${"d".repeat(63)}.example.com`;

function login(raw: string): Login {
  const parsed = parseLogin(raw);
  if (!parsed.ok) throw new Error(`fixture is not a login: ${raw}`);

  return parsed.value;
}

function logins(...raw: string[]): Logins {
  const parsed = parseLogins(raw);
  if (!parsed.ok) throw new Error(`fixture is not a list of logins: ${parsed.refusal}`);

  return parsed.value;
}

describe("parseLogin", () => {
  // Drift: the list is compared against what the identity provider sends; a repair here would let a near-miss of an owner's address log in.
  test.each([
    ["owner@example.com", { ok: true, value: "owner@example.com" }],
    ["  Owner@Example.COM \n", { ok: true, value: "owner@example.com" }],
    ["first.last+tag@mail.example.com", { ok: true, value: "first.last+tag@mail.example.com" }],
    ["o'neil_1@example-site.org", { ok: true, value: "o'neil_1@example-site.org" }],
    [`${LONGEST_LOCAL}@example.com`, { ok: true, value: `${LONGEST_LOCAL}@example.com` }],
    ["", { ok: false, refusal: "empty" }],
    [" \t\n", { ok: false, refusal: "empty" }],
    [`a@${LONG_DOMAIN}${".com".repeat(20)}`, { ok: false, refusal: "too-long" }],
    [`${LONGEST_LOCAL}a@example.com`, { ok: false, refusal: "not-an-address" }],
    ["owner", { ok: false, refusal: "not-an-address" }],
    ["owner@", { ok: false, refusal: "not-an-address" }],
    ["@example.com", { ok: false, refusal: "not-an-address" }],
    ["owner@localhost", { ok: false, refusal: "not-an-address" }],
    ["owner@example..com", { ok: false, refusal: "not-an-address" }],
    ["owner@-example.com", { ok: false, refusal: "not-an-address" }],
    ["owner@example.com.", { ok: false, refusal: "not-an-address" }],
    [".owner@example.com", { ok: false, refusal: "not-an-address" }],
    ["owner.@example.com", { ok: false, refusal: "not-an-address" }],
    ["first..last@example.com", { ok: false, refusal: "not-an-address" }],
    ["owner@example.com,other@example.com", { ok: false, refusal: "not-an-address" }],
    ["owner@example.com other@example.com", { ok: false, refusal: "not-an-address" }],
    ["owner@other@example.com", { ok: false, refusal: "not-an-address" }],
    ["Owner <owner@example.com>", { ok: false, refusal: "not-an-address" }],
    ["own er@example.com", { ok: false, refusal: "not-an-address" }],
    ["owner@example.com\nother@example.com", { ok: false, refusal: "not-an-address" }],
    ["\u212Aate@example.com", { ok: false, refusal: "not-an-address" }],
    ["owner@\u00e4.example.com", { ok: false, refusal: "not-an-address" }],
    ["owner@example.com\u0000", { ok: false, refusal: "not-an-address" }],
  ] as ReadonlyArray<readonly [string, unknown]>)("decides %j", (raw, outcome) => {
    expect<unknown>(parseLogin(raw)).toEqual(outcome);
  });

  test("drift: a login is parsed again wherever it is read back, so the normal form must parse to itself", () => {
    const once = login("  First.Last+Tag@Mail.Example.COM ");

    expect<unknown>(parseLogin(once)).toEqual({ ok: true, value: once });
  });
});

describe("parseLogins", () => {
  // Drift: a list that loads empty, or loads past a bad entry, either locks the owner out or lets in an address nobody typed.
  test.each([
    [["owner@example.com"], { ok: true, value: new Set(["owner@example.com"]) }],
    [["Owner@Example.com", " owner@example.com", "second@example.com"], { ok: true, value: new Set(["owner@example.com", "second@example.com"]) }],
    [[], { ok: false, refusal: "no-logins" }],
    [["owner@example.com", ""], { ok: false, refusal: "empty" }],
    [["owner@example.com", "second"], { ok: false, refusal: "not-an-address" }],
  ] as ReadonlyArray<readonly [readonly string[], unknown]>)("reads %j", (raw, outcome) => {
    expect<unknown>(parseLogins(raw)).toEqual(outcome);
  });
});

describe("isLogin", () => {
  // Drift: the provider's spelling of an address differs in case and padding from the stored one; an exact comparison would lock the owner out.
  test.each([
    ["owner@example.com", true],
    [" OWNER@example.com ", true],
    ["second@example.com", true],
    ["owner@example.org", false],
    ["owner+tag@example.com", false],
    ["owner@example.com,second@example.com", false],
    ["", false],
  ] as const)("%j may log in: %j", (email, allowed) => {
    expect(isLogin(logins("owner@example.com", "second@example.com"), email)).toBe(allowed);
  });
});

describe("the list's changes", () => {
  test("drift: removing the last login leaves an index nobody can open, and no later request could add one back", () => {
    const one = logins("owner@example.com");
    const two = addLogin(one, login("second@example.com"));

    const outcomes = [
      removeLogin(one, login("owner@example.com")),
      removeLogin(one, login("second@example.com")),
      removeLogin(two, login("owner@example.com")),
      removeLogin(two, login("third@example.com")),
    ];

    expect<unknown>(outcomes).toEqual([
      { ok: false, refusal: "last-login" },
      { ok: false, refusal: "unknown-login" },
      { ok: true, value: new Set(["second@example.com"]) },
      { ok: false, refusal: "unknown-login" },
    ]);
  });

  test("drift: a change that edited the list in place would alter the settings a request already read", () => {
    const one = logins("owner@example.com");
    const two = addLogin(one, login("second@example.com"));
    const again = addLogin(two, login("second@example.com"));

    removeLogin(two, login("owner@example.com"));

    expect<unknown>([one, two, again]).toEqual([
      new Set(["owner@example.com"]),
      new Set(["owner@example.com", "second@example.com"]),
      new Set(["owner@example.com", "second@example.com"]),
    ]);
  });
});
