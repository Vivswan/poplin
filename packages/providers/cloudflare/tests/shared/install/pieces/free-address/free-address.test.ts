// The account's free address against the fake API.
// Without these an install could take an account that has no subdomain for one Cloudflare gave no answer of, or tell a person their name is taken where the token lacks a permission.

import { expect, test } from "bun:test";
import { makeFreeAddress, readFreeAddress } from "../../../../../src/shared/install/pieces/free-address/free-address";
import { withFake } from "../../support/fake-cloudflare";
import { ACCOUNT, type Account, answer, emptyAccount, TOKEN } from "../../support/fake-install";

/** The path of the account's free address. */
const PATH = `/accounts/${ACCOUNT}/workers/subdomain`;

/** How an account stands when its free address is read, and what the read answers of it. A reply that names nothing is the other shape an account with none can come in: no reference documents its reply. */
const READS: readonly (readonly [what: string, change: Partial<Account>, read: unknown])[] = [
  ["has none, which Cloudflare refuses the read of", { subdomain: undefined }, { ok: true, value: undefined }],
  ["is answered with a reply that names nothing", { trails: { [PATH]: [{ subdomain: null }] } }, { ok: true, value: undefined }],
  ["is read with a token that lacks the permission", { refuse: `GET ${PATH}`, refuseMessage: "Authentication error" }, { ok: false, failure: "refused", status: 403, errors: [{ code: 10000, message: "Authentication error" }] }],
];

/** Run one call against an account at the fake API, and count what it sent that is no read. */
async function called<Answer>(account: Account, call: (connection: Parameters<typeof readFreeAddress>[0]) => Promise<Answer>): Promise<{ readonly answer: Answer; readonly writes: number }> {
  let result: { readonly answer: Answer; readonly writes: number } | undefined;

  await withFake(
    (asked) => answer(account, asked),
    async (connection, asked) => {
      const answered = await call({ ...connection, key: TOKEN });
      result = { answer: answered, writes: asked.filter((entry) => entry.method !== "GET").length };
    },
  );
  if (result === undefined) throw new Error("the call did not run");

  return result;
}

// Drift: Cloudflare's own command line reads an account with no subdomain by the code 10007 of the refusal. Taken for any other refusal, a new account would be told that Cloudflare gave no answer.
test.each(READS)("the read of an account that %s answers none, or the refusal, and changes nothing", async (_what, change, read) => {
  const { answer: name, writes } = await called({ ...emptyAccount(), ...change }, (connection) => readFreeAddress(connection, ACCOUNT));

  expect<unknown>([name, writes]).toEqual([read, 0]);
});

// Drift: only the code 10031 says that a name is taken. A refusal for anything else told as taken would ask a person for another name where their token lacks a permission.
test("a refusal of the call that is not for the name stays a refusal, with its status and its code, and sets no name", async () => {
  const barred: Account = { ...emptyAccount(), subdomain: undefined, refuse: `PUT ${PATH}`, refuseMessage: "Authentication error" };
  const refused = await called(barred, (connection) => makeFreeAddress(connection, ACCOUNT, "your-name"));

  expect([refused.answer, barred.subdomain]).toMatchObject([{ ok: false, failure: "refused", status: 403, errors: [{ code: 10000 }] }, undefined]);
});
