import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { SETTING_VALUES, settingsFromText } from "@poplin/core/src/records/settings";
import { readZoneBinding } from "../../src/zone/zone-binding";

const ROOT = join(import.meta.dir, "..", "..", "..", "..");
const MODULE = join(ROOT, "packages", "cloudflare", "tofu");
const SETTING_KEYS = Object.keys(SETTING_VALUES.entries).sort();
const BOUND = { domain: "example.com", admin_hostname: "admin.example.com", suffix: "-page" };

/** The `key = "text"` lines of the object literal that follows `opening` in a file of the module. */
function literalAfter(file: string, opening: string): Record<string, string> {
  const text = readFileSync(join(MODULE, file), "utf8");
  const start = text.indexOf(opening);
  if (start < 0) throw new Error(`${file} holds no ${opening}`);

  const body = text.slice(start + opening.length, text.indexOf("}", start + opening.length));
  const pairs = [...body.matchAll(/^\s*(\w+)\s*=\s*"(.*)"$/gm)];

  return Object.fromEntries(pairs.map(([, key = "", value = ""]) => [key, value]));
}

describe("readZoneBinding", () => {
  test("the three texts, with the whole admin hostname, are the layout the routes and rules are written from", () => {
    expect<unknown>(readZoneBinding(BOUND)).toEqual({ ok: true, value: { domain: "example.com", adminHostname: "admin.example.com", suffix: "-page" } });
  });

  const refused: readonly { readonly name: string; readonly binding: unknown; readonly refusal: string }[] = [
    { name: "no binding at all", binding: undefined, refusal: "absent" },
    { name: "null", binding: null, refusal: "bad-shape" },
    { name: "the binding still as JSON text", binding: JSON.stringify(BOUND), refusal: "bad-shape" },
    { name: "a list", binding: [BOUND], refusal: "bad-shape" },
    { name: "a key left out", binding: { domain: "example.com", suffix: "-page" }, refusal: "bad-shape" },
    { name: "a key beyond the three", binding: { ...BOUND, note: "the main zone" }, refusal: "bad-shape" },
    { name: "the admin hostname under another key", binding: { domain: "example.com", adminHostname: "admin.example.com", suffix: "-page" }, refusal: "bad-shape" },
    { name: "a value that is no text", binding: { ...BOUND, suffix: 7 }, refusal: "bad-shape" },
    { name: "the admin hostname as a label alone", binding: { ...BOUND, admin_hostname: "admin" }, refusal: "bad-admin-hostname" },
    { name: "an admin hostname on another domain", binding: { ...BOUND, admin_hostname: "admin.example.org" }, refusal: "admin-outside-domain" },
    { name: "a suffix with a quote", binding: { ...BOUND, suffix: '-p"' }, refusal: "bad-suffix" },
  ];

  test.each(refused)("$name is refused as $refusal and nothing throws: the Worker shows the reason instead of failing on every request", ({ binding, refusal }) => {
    expect<unknown>(readZoneBinding(binding)).toEqual({ ok: false, refusal });
  });
});

describe("the bindings the module gives the Worker", () => {
  test("FIRST_SETTINGS in the module, and the literal its test pins, carry exactly the keys of the stored settings: a key missing would stop the Worker storing any", () => {
    const written = [...readFileSync(join(MODULE, "main.tf"), "utf8").matchAll(/^ +(\w+) += .*$/gm)].map(([, key = ""]) => key);
    const first = written.slice(written.indexOf("default_expires"), written.indexOf("visitor_requests_per_minute") + 1);
    const pinned = literalAfter("tests/zone.tftest.hcl", "bindings[4].json) == {");

    expect(first.sort()).toEqual(SETTING_KEYS);
    expect(Object.keys(pinned).sort()).toEqual(SETTING_KEYS);
  });

  test("the first settings the module's test pins are read by the reader the Worker stores them with", () => {
    const read = settingsFromText(literalAfter("tests/zone.tftest.hcl", "bindings[4].json) == {"));

    expect(read).toMatchObject({ ok: true, values: { search_engines_allowed: true, zone_bots: "auto", dashboard_title: "admin.tools.example.com" } });
  });

  test("the ZONE binding the module's test pins is read as a layout, with the whole admin hostname", () => {
    const read = readZoneBinding(literalAfter("tests/zone.tftest.hcl", "bindings[3].json) == {"));

    expect<unknown>(read).toEqual({ ok: true, value: { domain: "example.com", adminHostname: "admin.tools.example.com", suffix: "-page" } });
  });

  test("the Worker's own example values for local runs are read the same way", () => {
    const config = Bun.JSONC.parse(readFileSync(join(ROOT, "packages", "cloudflare", "wrangler.jsonc"), "utf8")) as { vars: { ZONE: unknown; FIRST_SETTINGS: Record<string, string> } };

    expect(readZoneBinding(config.vars.ZONE).ok).toBe(true);
    expect(settingsFromText(config.vars.FIRST_SETTINGS).ok).toBe(true);
  });
});
