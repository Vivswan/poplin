import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { SETTING_VALUES, settingsFromText } from "@poplin/core/src/records/settings";
import { readInstallBinding, readZoneBinding } from "../../src/zone/zone-binding";

const ROOT = join(import.meta.dir, "..", "..", "..", "..");
const MODULE = join(ROOT, "packages", "cloudflare", "tofu");
const SETTING_KEYS = Object.keys(SETTING_VALUES.entries).sort();
const BOUND = { domain: "example.com" };
const READ = { domain: "example.com", adminHostname: "poplin.example.com", publicWord: "page" };

/** The `key = "text"` lines of the object literal that follows `opening` in a file of the module. */
function literalAfter(file: string, opening: string): Record<string, string> {
  const text = readFileSync(join(MODULE, file), "utf8");
  const start = text.indexOf(opening);
  if (start < 0) throw new Error(`${file} holds no ${opening}`);

  const body = text.slice(start + opening.length, text.indexOf("}", start + opening.length));
  const pairs = [...body.matchAll(/^\s*(\w+)\s*=\s*"(.*)"$/gm)];

  return Object.fromEntries(pairs.map(([, key = "", value = ""]) => [key, value]));
}

/** Every setting the Worker's reader takes as a whole number, bare or as a percent, with the largest one it takes. */
function wholeNumberSettings(): { readonly key: string; readonly most: bigint }[] {
  const pinned = literalAfter("tests/zone.tftest.hcl", "bindings[4].json) == {");
  const found: { readonly key: string; readonly most: bigint }[] = [];

  for (const key of SETTING_KEYS) {
    const unit = pinned[key]?.endsWith("%") ? "%" : "";
    const taken = (count: bigint): boolean => {
      const read = settingsFromText({ ...pinned, [key]: `${count}${unit}` });

      return read.ok && typeof (read.values as Record<string, unknown>)[key] === "number";
    };
    if (!taken(1n)) continue;

    // Halving between a number that is taken and one that is not ends on the largest taken.
    let most = 1n;
    let refused = 2n ** 64n;
    while (refused - most > 1n) {
      const middle = (most + refused) / 2n;
      if (taken(middle)) most = middle;
      else refused = middle;
    }

    found.push({ key, most });
  }

  return found;
}

describe("readZoneBinding", () => {
  test("the domain alone is the layout the routes and rules are written from: the admin hostname is `poplin` under it and the public word `page`, or the word the binding names", () => {
    expect<unknown>([readZoneBinding(BOUND), readZoneBinding({ ...BOUND, public_word: "poplin" })]).toEqual([
      { ok: true, value: READ },
      { ok: true, value: { ...READ, publicWord: "poplin" } },
    ]);
  });

  const refused: readonly { readonly name: string; readonly binding: unknown; readonly refusal: string }[] = [
    { name: "no binding at all", binding: undefined, refusal: "absent" },
    { name: "null", binding: null, refusal: "bad-shape" },
    { name: "the binding still as JSON text", binding: JSON.stringify(BOUND), refusal: "bad-shape" },
    { name: "a list", binding: [BOUND], refusal: "bad-shape" },
    { name: "the domain left out", binding: { public_word: "page" }, refusal: "bad-shape" },
    { name: "a key beyond the two", binding: { ...BOUND, note: "the main zone" }, refusal: "bad-shape" },
    { name: "an admin hostname of the install's own: it is no setting", binding: { ...BOUND, admin_hostname: "dashboard.example.com" }, refusal: "bad-shape" },
    { name: "a value that is no text", binding: { domain: 7 }, refusal: "bad-shape" },
    { name: "a domain that is one label", binding: { domain: "example" }, refusal: "bad-domain" },
    { name: "a public word with a dash", binding: { ...BOUND, public_word: "my-page" }, refusal: "bad-public-word" },
  ];

  test.each(refused)("$name is refused as $refusal and nothing throws: the Worker shows the reason instead of failing on every request", ({ binding, refusal }) => {
    expect<unknown>(readZoneBinding(binding)).toEqual({ ok: false, refusal });
  });
});

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

describe("the bindings the module gives the Worker", () => {
  test("FIRST_SETTINGS in the module, and the literal its test pins, carry exactly the keys of the stored settings: a key missing would stop the Worker storing any", () => {
    const written = [...readFileSync(join(MODULE, "main.tf"), "utf8").matchAll(/^ +(\w+) += .*$/gm)].map(([, key = ""]) => key);
    const first = written.slice(written.indexOf("default_expires"), written.indexOf("auto_update") + 1);
    const pinned = literalAfter("tests/zone.tftest.hcl", "bindings[4].json) == {");

    expect(first.sort()).toEqual(SETTING_KEYS);
    expect(Object.keys(pinned).sort()).toEqual(SETTING_KEYS);
  });

  test("the first settings the module's test pins are read by the reader the Worker stores them with", () => {
    const read = settingsFromText(literalAfter("tests/zone.tftest.hcl", "bindings[4].json) == {"));

    expect(read).toMatchObject({ ok: true, values: { search_engines_allowed: true, block_bots: "auto" } });
  });

  test.each(wholeNumberSettings())("$key: the module refuses a number above $most, the most the Worker's reader takes; one more would leave every first setting unread", ({ key, most }) => {
    const variables = readFileSync(join(MODULE, "variables.tf"), "utf8").replaceAll(/ +/g, " ");
    const [, rules = ""] = new RegExp(`^variable "${key}" \\{\\n(.*?)^\\}`, "ms").exec(variables) ?? [];

    expect(rules).toContain(`var.${key} <= ${most}`);
  });

  test("the ZONE binding the module's test pins is read as a layout", () => {
    const read = readZoneBinding(literalAfter("tests/zone.tftest.hcl", "bindings[3].json) == {"));

    expect<unknown>(read).toEqual({ ok: true, value: READ });
  });
});
