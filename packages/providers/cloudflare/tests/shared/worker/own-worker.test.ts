import { describe, expect, test } from "vitest";
import { readOwnWorker } from "../../../src/shared/worker/own-worker";

const ACCOUNT = "0123456789abcdef0123456789abcdef";

describe("readOwnWorker", () => {
  const refused: readonly { readonly name: string; readonly variables: Parameters<typeof readOwnWorker>[0]; readonly refusals: readonly string[] }[] = [
    { name: "neither variable", variables: { accountId: undefined, script: undefined }, refusals: ["ACCOUNT_ID absent", "WORKER_NAME absent"] },
    { name: "an account id in capitals", variables: { accountId: ACCOUNT.toUpperCase(), script: "poplin" }, refusals: ["ACCOUNT_ID bad-shape"] },
    { name: "an account id with a path in it", variables: { accountId: `${ACCOUNT.slice(0, 29)}/..`, script: "poplin" }, refusals: ["ACCOUNT_ID bad-shape"] },
    { name: "an account id that is a number", variables: { accountId: 12, script: "poplin" }, refusals: ["ACCOUNT_ID bad-shape"] },
    { name: "a name with a slash", variables: { accountId: ACCOUNT, script: "poplin/settings" }, refusals: ["WORKER_NAME bad-shape"] },
    { name: "a name with a query", variables: { accountId: ACCOUNT, script: "poplin?x=1" }, refusals: ["WORKER_NAME bad-shape"] },
    { name: "an empty name", variables: { accountId: ACCOUNT, script: "" }, refusals: ["WORKER_NAME bad-shape"] },
  ];

  // Drift: both texts go into the path of a call that carries the owner's token; one with a slash would send that token to another address of the API.
  test.each(refused)("$name is refused, by name and never by value", ({ variables, refusals }) => {
    const read = readOwnWorker(variables);

    expect(read.ok ? [] : read.refused.map(({ binding, refusal }) => `${binding} ${refusal}`)).toEqual(refusals);
  });

  test("an account id and a Worker's name as Cloudflare writes them are read as they are", () => {
    expect(readOwnWorker({ accountId: ACCOUNT, script: "poplin_2-test" })).toEqual({ ok: true, value: { accountId: ACCOUNT, script: "poplin_2-test" } });
  });
});
