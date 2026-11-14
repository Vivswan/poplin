import { describe, expect, test } from "bun:test";
import { parseDomainLayout, type RawLayout } from "../src/cloudflare/layout";

const BASE: RawLayout = { domain: "example.com", admin_hostname: "admin.example.com", suffix: "-page" };
const CHECKED = { domain: "example.com", adminHostname: "admin.example.com", suffix: "-page" };

describe("parseDomainLayout", () => {
  const accepted: readonly { readonly name: string; readonly changes: Partial<RawLayout>; readonly layout: object }[] = [
    { name: "the default", changes: {}, layout: CHECKED },
    { name: "another suffix", changes: { suffix: "-s1-x" }, layout: { ...CHECKED, suffix: "-s1-x" } },
  ];

  test.each(accepted)("$name is a layout", ({ changes, layout }) => {
    expect(parseDomainLayout({ ...BASE, ...changes })).toEqual({ ok: true, value: layout as never });
  });

  const refused: readonly { readonly name: string; readonly changes: Partial<RawLayout>; readonly refusal: string }[] = [
    { name: "a domain that is no hostname", changes: { domain: "example" }, refusal: "bad-domain" },
    { name: "no suffix: the site route would take every hostname of the zone", changes: { suffix: "" }, refusal: "bad-suffix" },
    { name: "a suffix with no dash in front, which a site's name would run into", changes: { suffix: "page" }, refusal: "bad-suffix" },
    { name: "a suffix that ends in a dash, which no hostname label may", changes: { suffix: "-page-" }, refusal: "bad-suffix" },
    { name: "a suffix with two dashes together, the mark between a name and its id", changes: { suffix: "-a--b" }, refusal: "bad-suffix" },
    { name: "a suffix with a dot", changes: { suffix: "-page.x" }, refusal: "bad-suffix" },
    { name: "a suffix with a wildcard, which a route may hold only in front", changes: { suffix: "-*" }, refusal: "bad-suffix" },
    { name: "a suffix with a quote", changes: { suffix: '-p"' }, refusal: "bad-suffix" },
    { name: "a suffix too long to leave a site address room in one label", changes: { suffix: "-published" }, refusal: "bad-suffix" },
  ];

  test.each(refused)("$name is refused as $refusal: a layout that got through would be written into records, routes, and the rule", ({ changes, refusal }) => {
    expect(parseDomainLayout({ ...BASE, ...changes })).toEqual({ ok: false, refusal: refusal as never });
  });
});

// The OpenTofu module takes the same hostnames, written without the domain: tofu/tests/validation.tftest.hcl holds a run for each row here.
describe("the admin hostname rule: any hostname under the domain that does not end in the suffix and the domain", () => {
  const taken: readonly { readonly name: string; readonly hostname: string }[] = [
    { name: "one label under the domain", hostname: "admin.example.com" },
    { name: "two labels under the domain", hostname: "admin.tools.example.com" },
    { name: "a label that only holds the suffix's letters", hostname: "my-pages.example.com" },
    { name: "a label that ends in the suffix, with another between it and the domain", hostname: "admin-page.tools.example.com" },
  ];

  test.each(taken)("$name is taken: the site route never matches it", ({ hostname }) => {
    expect(parseDomainLayout({ ...BASE, admin_hostname: hostname })).toEqual({ ok: true, value: { ...CHECKED, adminHostname: hostname } as never });
  });

  const refused: readonly { readonly name: string; readonly hostname: string; readonly refusal: string }[] = [
    { name: "the bare domain", hostname: "example.com", refusal: "admin-outside-domain" },
    { name: "a hostname on another domain", hostname: "admin.example.org", refusal: "admin-outside-domain" },
    { name: "a hostname that only ends in the domain's letters", hostname: "admin.badexample.com", refusal: "admin-outside-domain" },
    { name: "a label alone, with no domain", hostname: "admin", refusal: "bad-admin-hostname" },
    { name: "a label with a capital", hostname: "Admin.example.com", refusal: "bad-admin-hostname" },
    { name: "a label that starts with a dash", hostname: "-admin.example.com", refusal: "bad-admin-hostname" },
    { name: "an empty label", hostname: "admin..example.com", refusal: "bad-admin-hostname" },
    { name: "a wildcard label", hostname: "*.example.com", refusal: "bad-admin-hostname" },
    { name: "a label of 64 characters", hostname: `${"a".repeat(64)}.example.com`, refusal: "bad-admin-hostname" },
    { name: "a hostname of 254 characters", hostname: `ab.${"a.".repeat(120)}example.com`, refusal: "bad-admin-hostname" },
    { name: "a hostname that ends in the suffix", hostname: "admin-page.example.com", refusal: "admin-is-site-address" },
    { name: "a hostname under a name that ends in the suffix", hostname: "admin.tools-page.example.com", refusal: "admin-is-site-address" },
  ];

  test.each(refused)("$name is refused as $refusal", ({ hostname, refusal }) => {
    expect(parseDomainLayout({ ...BASE, admin_hostname: hostname })).toEqual({ ok: false, refusal: refusal as never });
  });
});
