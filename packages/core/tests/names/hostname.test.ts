import { describe, expect, test } from "bun:test";
import { type Hostname, parseHostname } from "../../src/names/hostname";

function hostOf(raw: string): Hostname {
  const hostname = parseHostname(raw);
  if (!hostname.ok) throw new Error(`the test's hostname was refused: ${hostname.refusal}`);

  return hostname.value;
}

describe("parseHostname", () => {
  const accepted: readonly string[] = [
    "example.com",
    "poplin.example.com",
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
    { text: "poplin.example.com.", refusal: "bad-label" },
    { text: "*.example.com", refusal: "bad-label" },
    { text: "_dmarc.example.com", refusal: "bad-label" },
    { text: "a..example.com", refusal: "bad-label" },
    { text: `${"a".repeat(64)}.example.com`, refusal: "bad-label" },
    { text: " poplin.example.com", refusal: "bad-label" },
    { text: "poplin.example.com\n", refusal: "bad-label" },
  ];

  test.each(refused)("$text is refused as $refusal, never repaired: a repaired name would differ from the one the owner typed", ({ text, refusal }) => {
    expect<unknown>(parseHostname(text)).toEqual({ ok: false, refusal });
  });
});
