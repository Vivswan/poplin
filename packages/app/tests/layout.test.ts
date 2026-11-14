import { describe, expect, test } from "bun:test";
import { parseDomainLayout, type RawLayout } from "../src/cloudflare/layout";

const BASE: RawLayout = { domain: "example.com", adminHostname: "admin.example.com", suffix: "-page" };

describe("parseDomainLayout", () => {
  const accepted: readonly { readonly name: string; readonly changes: Partial<RawLayout>; readonly layout: object }[] = [
    { name: "the default", changes: {}, layout: { ...BASE } },
    { name: "another suffix", changes: { suffix: "-s1-x" }, layout: { ...BASE, suffix: "-s1-x" } },
    {
      name: "an admin hostname deeper under the domain",
      changes: { adminHostname: "admin.tools.example.com" },
      layout: { ...BASE, adminHostname: "admin.tools.example.com" },
    },
    {
      name: "an admin hostname that only holds the suffix's letters",
      changes: { adminHostname: "my-pages.example.com" },
      layout: { ...BASE, adminHostname: "my-pages.example.com" },
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
    { name: "no suffix: the site route would take every hostname of the zone", changes: { suffix: "" }, refusal: "bad-suffix" },
    { name: "a suffix with no dash in front, which a site's name would run into", changes: { suffix: "page" }, refusal: "bad-suffix" },
    { name: "a suffix that ends in a dash, which no hostname label may", changes: { suffix: "-page-" }, refusal: "bad-suffix" },
    { name: "a suffix with two dashes together, the mark between a name and its id", changes: { suffix: "-a--b" }, refusal: "bad-suffix" },
    { name: "a suffix with a dot", changes: { suffix: "-page.x" }, refusal: "bad-suffix" },
    { name: "a suffix with a wildcard, which a route may hold only in front", changes: { suffix: "-*" }, refusal: "bad-suffix" },
    { name: "a suffix with a quote", changes: { suffix: '-p"' }, refusal: "bad-suffix" },
    { name: "a suffix too long to leave a site address room in one label", changes: { suffix: "-published" }, refusal: "bad-suffix" },
    { name: "an admin hostname that ends in the suffix", changes: { adminHostname: "admin-page.example.com" }, refusal: "admin-is-site-address" },
    {
      name: "an admin hostname under a name that ends in the suffix",
      changes: { adminHostname: "admin.tools-page.example.com" },
      refusal: "admin-is-site-address",
    },
  ];

  test.each(refused)("$name is refused as $refusal: a layout that got through would be written into records, routes, and the rule", ({ changes, refusal }) => {
    expect(parseDomainLayout({ ...BASE, ...changes })).toEqual({ ok: false, refusal: refusal as never });
  });
});
