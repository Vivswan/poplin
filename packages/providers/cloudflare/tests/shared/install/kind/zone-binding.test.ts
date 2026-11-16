import { describe, expect, test } from "bun:test";
import { readInstallBinding } from "../../../../src/shared/install/kind/zone-binding";

const BOUND = { domain: "example.com" };
const READ = { domain: "example.com", adminHostname: "poplin.example.com", publicWord: "page" };

describe("readInstallBinding", () => {
  const ADDRESSES = {
    account: "example",
    worker: "poplin",
    adminHost: "poplin.example.workers.dev",
    sitesWorker: "poplin-sites",
    sitesHost: "poplin-sites.example.workers.dev",
    privateWorker: "poplin-private",
    privateHost: "poplin-private.example.workers.dev",
  };

  // Drift: a binding read as the wrong kind would route every request by the other kind's addresses, and every site would answer 404.
  test("each of the two values names its own kind: a domain gives the domain's layout, and an account's address the three hosts made from the Worker's name", () => {
    expect<unknown>([readInstallBinding(BOUND, "poplin"), readInstallBinding({ ...BOUND, public_word: "poplin" }, "poplin"), readInstallBinding({ account_address: "example" }, "poplin")]).toEqual([
      { ok: true, value: { kind: "domain", layout: READ } },
      { ok: true, value: { kind: "domain", layout: { ...READ, publicWord: "poplin" } } },
      { ok: true, value: { kind: "account address", layout: ADDRESSES } },
    ]);
  });

  const refused: readonly { readonly name: string; readonly binding: unknown; readonly refusal: string }[] = [
    { name: "no binding at all", binding: undefined, refusal: "absent" },
    { name: "null", binding: null, refusal: "bad-shape" },
    { name: "a list", binding: [BOUND], refusal: "bad-shape" },
    { name: "the domain left out", binding: { public_word: "page" }, refusal: "bad-shape" },
    { name: "a key beyond a domain's two", binding: { ...BOUND, note: "the main zone" }, refusal: "bad-shape" },
    { name: "an admin hostname of the install's own: it is no setting", binding: { ...BOUND, admin_hostname: "dashboard.example.com" }, refusal: "bad-shape" },
    { name: "a domain that is no text", binding: { domain: 7 }, refusal: "bad-shape" },
    { name: "a public word with a dash", binding: { ...BOUND, public_word: "my-page" }, refusal: "bad-public-word" },
    { name: "a value holding both a domain and an account's address", binding: { ...BOUND, account_address: "example" }, refusal: "bad-shape" },
    { name: "a value holding neither", binding: {}, refusal: "bad-shape" },
    { name: "an account's address beside a public word, which only a domain has", binding: { account_address: "example", public_word: "page" }, refusal: "bad-shape" },
    { name: "an account's address that is no text", binding: { account_address: 7 }, refusal: "bad-shape" },
    { name: "the binding still as JSON text", binding: JSON.stringify({ account_address: "example" }), refusal: "bad-shape" },
    { name: "a domain that is one label", binding: { domain: "example" }, refusal: "bad-domain" },
    { name: "the whole free address in place of the account's name", binding: { account_address: "example.workers.dev" }, refusal: "bad-account" },
    { name: "an account's name of 37 characters", binding: { account_address: "a".repeat(37) }, refusal: "account-too-long" },
  ];

  test.each(refused)("$name is refused as $refusal and nothing throws: exactly one of the two values is an install", ({ binding, refusal }) => {
    expect<unknown>(readInstallBinding(binding, "poplin")).toEqual({ ok: false, refusal });
  });

  test("a Worker's name no hostname can start with refuses an account's address and leaves a domain as it is: only the free address is made from that name", () => {
    expect<unknown>([readInstallBinding({ account_address: "example" }, "my_poplin"), readInstallBinding(BOUND, "my_poplin")]).toEqual([
      { ok: false, refusal: "bad-worker" },
      { ok: true, value: { kind: "domain", layout: READ } },
    ]);
  });
});
