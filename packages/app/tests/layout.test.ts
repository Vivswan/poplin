import { describe, expect, test } from "bun:test";
import { parseDomainLayout, type RawLayout } from "../src/cloudflare/layout";

const BASE: RawLayout = { names: "domain", domain: "example.com", adminHostname: "admin.example.com", pagesHostname: "pages.example.com", prefix: "page-" };

describe("parseDomainLayout", () => {
  const accepted: readonly { readonly name: string; readonly changes: Partial<RawLayout>; readonly layout: object }[] = [
    { name: "the default", changes: {}, layout: { ...BASE } },
    { name: "the gallery off", changes: { pagesHostname: undefined }, layout: { ...BASE, pagesHostname: undefined } },
    { name: "the gallery on the bare domain", changes: { pagesHostname: "example.com" }, layout: { ...BASE, pagesHostname: "example.com" } },
    { name: "an empty prefix", changes: { prefix: "" }, layout: { ...BASE, prefix: "" } },
    {
      name: "a subdomain layout, which drops the prefix it never reads",
      changes: { names: "subdomain-per-site", prefix: 'never read"' },
      layout: { names: "subdomain-per-site", domain: "example.com", adminHostname: "admin.example.com", pagesHostname: "pages.example.com" },
    },
  ];

  test.each(accepted)("$name is a layout", ({ changes, layout }) => {
    expect(parseDomainLayout({ ...BASE, ...changes })).toEqual({ ok: true, value: layout as never });
  });

  const refused: readonly { readonly name: string; readonly changes: Partial<RawLayout>; readonly refusal: string }[] = [
    { name: "a domain that is no hostname", changes: { domain: "example" }, refusal: "bad-domain" },
    { name: "an admin hostname that is no hostname", changes: { adminHostname: "admin" }, refusal: "bad-admin-hostname" },
    { name: "an admin hostname on another domain", changes: { adminHostname: "admin.example.org" }, refusal: "admin-outside-domain" },
    { name: "an admin hostname that only ends in the domain's letters", changes: { adminHostname: "admin.badexample.com" }, refusal: "admin-outside-domain" },
    { name: "the bare domain as the admin hostname", changes: { adminHostname: "example.com" }, refusal: "admin-outside-domain" },
    { name: "a pages hostname that is no hostname", changes: { pagesHostname: "pages" }, refusal: "bad-pages-hostname" },
    { name: "a pages hostname on another domain", changes: { pagesHostname: "pages.example.org" }, refusal: "pages-outside-domain" },
    { name: "one hostname for the index and the gallery", changes: { pagesHostname: "admin.example.com" }, refusal: "admin-is-pages" },
    { name: "a prefix that starts with a dash", changes: { prefix: "-page" }, refusal: "bad-prefix" },
    { name: "a prefix with a dot", changes: { prefix: "page." }, refusal: "bad-prefix" },
    { name: "a prefix too long to leave a secret address room in one label", changes: { prefix: "a".repeat(10) }, refusal: "bad-prefix" },
    { name: "a subdomain layout with no pages hostname", changes: { names: "subdomain-wildcard", pagesHostname: undefined }, refusal: "pages-required" },
    {
      name: "a subdomain layout whose admin hostname would be a site address",
      changes: { names: "subdomain-per-site", adminHostname: "admin.pages.example.com" },
      refusal: "admin-under-pages",
    },
    {
      name: "a subdomain layout with sites under the bare domain, where the admin hostname is one",
      changes: { names: "subdomain-wildcard", pagesHostname: "example.com" },
      refusal: "admin-under-pages",
    },
  ];

  test.each(refused)("$name is refused as $refusal: a layout that got through would be written into records, routes, and rules", ({ changes, refusal }) => {
    expect(parseDomainLayout({ ...BASE, ...changes })).toEqual({ ok: false, refusal: refusal as never });
  });
});
