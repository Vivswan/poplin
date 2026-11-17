// Who a request to the dashboard is from: the provider's verdict, then the install's users as they are at that request.

import { expect, test } from "bun:test";

import { type Logins, parseLogins } from "@poplin/core/src/auth/logins";

import { admit, type Identify } from "../../src/login/admit";

/** The header the test's provider reads its verdict from: an email it vouches for, or the word of one of its refusals. */
const VERDICT = "Test-Verdict";

/** When the login the test's provider vouches for began. */
const SINCE = 1_700_000_000_000;

/** The moment every request is asked at. */
const NOW = SINCE + 60_000;

/** A provider that vouches for the email its header names, and refuses any other header by its own word. */
const identify: Identify<"missing" | "forged" | "keys-down"> = async (headers) => {
  const verdict = headers.get(VERDICT);
  if (verdict === null) return { ok: false, refusal: "missing" };

  const [email] = verdict.includes("@") ? usersOf(verdict) : [];
  if (email === undefined) return { ok: false, refusal: verdict === "keys-down" ? "keys-down" : "forged" };

  return { ok: true, value: email, since: SINCE };
};

function usersOf(...emails: readonly string[]): Logins {
  const users = parseLogins(emails);
  if (!users.ok) throw new Error(`the test's users were refused: ${users.refusal}`);

  return users.value;
}

function asking(verdict: string | null): Headers {
  return new Headers(verdict === null ? {} : { [VERDICT]: verdict });
}

// Drift: a request with no proof, with a proof the provider refuses, or of a verified email that is no user would be let in; or a refusal would lose the provider's own word, which the host answers and logs by.
test.each([
  ["no proof at all", null, ["ada@example.com"], { ok: false, refusal: "missing" }],
  ["a proof the provider refuses", "not-signed", ["ada@example.com"], { ok: false, refusal: "forged" }],
  ["a proof nobody can check now", "keys-down", ["ada@example.com"], { ok: false, refusal: "keys-down" }],
  ["a verified email that is one of the users", "ada@example.com", ["ada@example.com", "bo@example.com"], { ok: true, actor: { scope: "admin", holder: "ada@example.com" }, since: SINCE }],
  ["the second of the users, who is an admin as the first is", "bo@example.com", ["ada@example.com", "bo@example.com"], { ok: true, actor: { scope: "admin", holder: "bo@example.com" }, since: SINCE }],
  ["a verified email that is no user", "mallory@example.com", ["ada@example.com"], { ok: false, refusal: "not-a-user" }],
  ["a verified email the provider wrote in capitals", "Ada@Example.com", ["ada@example.com"], { ok: true, actor: { scope: "admin", holder: "ada@example.com" }, since: SINCE }],
] as const)("a request with %s is answered whole", async (_case, verdict, users, outcome) => {
  expect<unknown>(await admit(asking(verdict), { identify, users: usersOf(...users), now: NOW })).toEqual(outcome);
});

// Drift: something kept from an earlier request would let a removed user go on, or keep a new user out.
test("the same proof is admitted or refused by the users of each request alone", async () => {
  const proof = asking("bo@example.com");
  const answers = [];
  for (const users of [["ada@example.com"], ["ada@example.com", "bo@example.com"], ["ada@example.com"]]) answers.push((await admit(proof, { identify, users: usersOf(...users), now: NOW })).ok);

  expect(answers).toEqual([false, true, false]);
});
