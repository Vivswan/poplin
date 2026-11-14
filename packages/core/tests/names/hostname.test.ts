import { describe, expect, test } from "bun:test";
import { type Hostname, isUnder, parseHostname } from "../../src/names/hostname";

function hostOf(raw: string): Hostname {
  const hostname = parseHostname(raw);
  if (!hostname.ok) throw new Error(`the test's hostname was refused: ${hostname.refusal}`);

  return hostname.value;
}

describe("parseHostname", () => {
  const accepted: readonly string[] = [
    "example.com",
    "admin.example.com",
    "page-report.example.com",
    "xn--bcher-kva.example.com",
    "0.example.com",
    "poplin.an-account.workers.dev",
    `${"a".repeat(63)}.example.com`,
  ];

  test.each(accepted)("%j is a hostname and comes back unchanged: a record's name must compare equal to what Cloudflare stores", (text) => {
    expect(parseHostname(text)).toEqual({ ok: true, value: hostOf(text) });
    expect(String(hostOf(text))).toBe(text);
  });

  const refused: readonly { readonly text: string; readonly refusal: string }[] = [
    { text: "", refusal: "empty" },
    { text: `${"a.".repeat(126)}example.com`, refusal: "too-long" },
    { text: "localhost", refusal: "single-label" },
    { text: "Admin.example.com", refusal: "bad-label" },
    { text: "admin.example.com.", refusal: "bad-label" },
    { text: "*.example.com", refusal: "bad-label" },
    { text: "_dmarc.example.com", refusal: "bad-label" },
    { text: "a..example.com", refusal: "bad-label" },
    { text: `${"a".repeat(64)}.example.com`, refusal: "bad-label" },
    { text: " admin.example.com", refusal: "bad-label" },
    { text: "admin.example.com\n", refusal: "bad-label" },
  ];

  test.each(refused)("$text is refused as $refusal, never repaired: a repaired name would differ from the one the owner typed", ({ text, refusal }) => {
    expect<unknown>(parseHostname(text)).toEqual({ ok: false, refusal });
  });
});

describe("isUnder", () => {
  const cases: readonly { readonly hostname: string; readonly parent: string; readonly under: boolean }[] = [
    { hostname: "admin.example.com", parent: "example.com", under: true },
    { hostname: "a.b.example.com", parent: "example.com", under: true },
    { hostname: "example.com", parent: "example.com", under: false },
    { hostname: "badexample.com", parent: "example.com", under: false },
    { hostname: "example.com.example.org", parent: "example.com", under: false },
  ];

  test.each(cases)("$hostname under $parent is $under: a name that only ends in the same letters belongs to another domain", ({ hostname, parent, under }) => {
    expect(isUnder(hostOf(hostname), hostOf(parent))).toBe(under);
  });
});
