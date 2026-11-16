import { describe, expect, test } from "bun:test";
import { parseDomainLayout, type RawLayout } from "../../src/with-domain/layout";

const LONGEST_DOMAIN = `${"a".repeat(48)}.com`;
const CHECKED = { domain: "example.com", adminHostname: "poplin.example.com", publicWord: "page" };

describe("parseDomainLayout", () => {
  const taken: readonly { readonly name: string; readonly raw: RawLayout; readonly layout: object }[] = [
    { name: "a domain alone: the public word is `page`", raw: { domain: "example.com" }, layout: CHECKED },
    { name: "the public word `poplin`", raw: { domain: "example.com", public_word: "poplin" }, layout: { ...CHECKED, publicWord: "poplin" } },
    { name: "a public word of the install's own", raw: { domain: "example.com", public_word: "site" }, layout: { ...CHECKED, publicWord: "site" } },
    { name: "a domain several labels deep", raw: { domain: "tools.example.co.uk" }, layout: { ...CHECKED, domain: "tools.example.co.uk", adminHostname: "poplin.tools.example.co.uk" } },
    { name: "a domain of 52 characters, the longest whose API address and private pattern fit Access's 63 characters", raw: { domain: LONGEST_DOMAIN }, layout: { ...CHECKED, domain: LONGEST_DOMAIN, adminHostname: `poplin.${LONGEST_DOMAIN}` } },
  ];

  test.each(taken)("$name is a layout whose admin hostname is `poplin` under the domain: routes, records, and the login all read that one hostname", ({ raw, layout }) => {
    expect(parseDomainLayout(raw)).toEqual({ ok: true, value: layout as never });
  });

  const refused: readonly { readonly name: string; readonly raw: RawLayout; readonly refusal: string }[] = [
    { name: "a domain that is no hostname", raw: { domain: "example" }, refusal: "bad-domain" },
    { name: "a domain with a quote", raw: { domain: 'example".com' }, refusal: "bad-domain" },
    { name: "a domain with a capital", raw: { domain: "Example.com" }, refusal: "bad-domain" },
    { name: "a wildcard domain", raw: { domain: "*.example.com" }, refusal: "bad-domain" },
    { name: "a domain of 53 characters: `poplin.<domain>/api` and `*-p-poplin.<domain>` would each be 64, one past what Access takes", raw: { domain: `${"a".repeat(49)}.com` }, refusal: "domain-too-long" },
    { name: "an empty public word", raw: { domain: "example.com", public_word: "" }, refusal: "bad-public-word" },
    { name: "a public word of one letter", raw: { domain: "example.com", public_word: "p" }, refusal: "bad-public-word" },
    { name: "a public word of ten letters", raw: { domain: "example.com", public_word: "publishing" }, refusal: "bad-public-word" },
    { name: "a public word with a dash, which a public name would run into", raw: { domain: "example.com", public_word: "my-page" }, refusal: "bad-public-word" },
    { name: "a public word with a digit", raw: { domain: "example.com", public_word: "page2" }, refusal: "bad-public-word" },
    { name: "a public word with a capital", raw: { domain: "example.com", public_word: "Page" }, refusal: "bad-public-word" },
    { name: "a public word with a wildcard, which a route may hold only in front", raw: { domain: "example.com", public_word: "pa*" }, refusal: "bad-public-word" },
    { name: "a public word with a quote", raw: { domain: "example.com", public_word: 'pa"' }, refusal: "bad-public-word" },
  ];

  test.each(refused)("$name is refused as $refusal: a layout that got through would be written into records, routes, and the rule", ({ raw, refusal }) => {
    expect(parseDomainLayout(raw)).toEqual({ ok: false, refusal: refusal as never });
  });
});
