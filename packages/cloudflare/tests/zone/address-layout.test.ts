import { describe, expect, test } from "bun:test";
import { parseAccountAddresses } from "../../src/zone/address-layout";

const LONGEST_ACCOUNT = "a".repeat(36);
const CHECKED = {
  account: "example",
  worker: "poplin",
  adminHost: "poplin.example.workers.dev",
  sitesWorker: "poplin-sites",
  sitesHost: "poplin-sites.example.workers.dev",
  privateWorker: "poplin-private",
  privateHost: "poplin-private.example.workers.dev",
};

describe("parseAccountAddresses", () => {
  const taken: readonly { readonly name: string; readonly account: string; readonly worker: string; readonly layout: object }[] = [
    { name: "an account's name under the Worker `poplin`", account: "example", worker: "poplin", layout: CHECKED },
    {
      name: "an account's name of 36 characters, the longest under which the private sites' host fits the 63 characters Access takes",
      account: LONGEST_ACCOUNT,
      worker: "poplin",
      layout: {
        ...CHECKED,
        account: LONGEST_ACCOUNT,
        adminHost: `poplin.${LONGEST_ACCOUNT}.workers.dev`,
        sitesHost: `poplin-sites.${LONGEST_ACCOUNT}.workers.dev`,
        privateHost: `poplin-private.${LONGEST_ACCOUNT}.workers.dev`,
      },
    },
  ];

  test.each(taken)("$name is a layout of three hosts on the free address, each within what a hostname's label and Access take", ({ account, worker, layout }) => {
    expect(parseAccountAddresses({ account_address: account }, worker)).toEqual({ ok: true, value: layout as never });
  });

  const refused: readonly { readonly name: string; readonly account: string; readonly worker: string; readonly refusal: string }[] = [
    { name: "an empty account's name", account: "", worker: "poplin", refusal: "bad-account" },
    { name: "an account's name with a capital", account: "Example", worker: "poplin", refusal: "bad-account" },
    { name: "the whole free address in place of the account's name", account: "example.workers.dev", worker: "poplin", refusal: "bad-account" },
    { name: "an account's name with a slash, which would start a path", account: "example/login", worker: "poplin", refusal: "bad-account" },
    { name: "an account's name with a wildcard", account: "*", worker: "poplin", refusal: "bad-account" },
    { name: "an account's name that ends in a dash", account: "example-", worker: "poplin", refusal: "bad-account" },
    { name: "a Worker's name with an underscore, which no hostname holds", account: "example", worker: "my_poplin", refusal: "bad-worker" },
    { name: "a Worker's name with a dot, whose hosts would sit a level below the free address", account: "example", worker: "my.poplin", refusal: "bad-worker" },
    { name: "a Worker's name of 56 characters: its private forwarder's name would be 64, one past a hostname's label", account: "example", worker: "p".repeat(56), refusal: "bad-worker" },
    { name: "an account's name of 37 characters: `poplin-private.<account>.workers.dev` would be 64, one past what Access takes", account: "a".repeat(37), worker: "poplin", refusal: "account-too-long" },
    { name: "an account's name of 36 characters under a Worker's name one longer than `poplin`", account: LONGEST_ACCOUNT, worker: "poplins", refusal: "account-too-long" },
  ];

  test.each(refused)("$name is refused as $refusal: an address that got through would be written into a Worker's name and the login's application", ({ account, worker, refusal }) => {
    expect(parseAccountAddresses({ account_address: account }, worker)).toEqual({ ok: false, refusal: refusal as never });
  });
});
