import { describe, expect, test } from "bun:test";
import type { Hostname } from "@poplin/core/src/names/hostname";
import { parsePublicWord } from "@poplin/core/src/names/marker";
import { parsePublicName, type PublicName, type SiteName } from "@poplin/core/src/names/names";
import type { SiteId } from "@poplin/core/src/sites/ids";
import { siteLabel } from "@poplin/core/src/sites/labels";
import { hostnameAddresses } from "../../src/sites/hostname-addresses";
import { ADDRESSES } from "./support/layout";

const NAME = "report" as SiteName;
const ID = "k3f9x2ab71qz" as SiteId;
const LABEL = siteLabel(NAME, ID);

/** The addresses of `example.com` under a public word a test names. */
function under(word: string): ReturnType<typeof hostnameAddresses> {
  const publicWord = parsePublicWord(word);
  if (publicWord === undefined) throw new Error(`the test's public word ${word} was refused`);

  return hostnameAddresses({ domain: "example.com" as Hostname, publicWord });
}

function resolved(addresses: ReturnType<typeof hostnameAddresses>, host: string): unknown {
  return addresses.resolve(new URL(`https://${host}/a`));
}

describe("the hostname layout", () => {
  // Drift: the site object's url comes from `addressOf` and a visitor's request is read by `resolve`; if the two forms part, every action answers with an address that serves nothing.
  test.each([
    ["private", "https://report--k3f9x2ab71qz-p-poplin.example.com", "p"],
    ["unlisted", "https://report--k3f9x2ab71qz-u-poplin.example.com", "u"],
    ["public", "https://report--k3f9x2ab71qz-u-poplin.example.com", "u"],
  ] as const)("the label address of a %s site is the one the layout reads back as that site and letter", (access, address, letter) => {
    expect<unknown>([ADDRESSES.addressOf(LABEL, access), ADDRESSES.resolve(new URL(address))]).toEqual([address, { kind: "site", name: NAME, id: ID, letter, path: "/" }]);
  });

  test("the public address ends in the public word and reads back as the public name", () => {
    const address = ADDRESSES.publicAddressOf("docs" as PublicName);

    expect<unknown>([address, ADDRESSES.resolve(new URL(address))]).toEqual(["https://docs-page.example.com", { kind: "public-name", name: "docs", path: "/" }]);
  });

  // Drift: only the id finds a site, so a renamed site's old links and a bare id keep working; a resolver that judged the name would break every link on a rename.
  test.each([
    ["another name", "old-name--k3f9x2ab71qz-u-poplin.example.com", { kind: "site", id: ID, name: "old-name", letter: "u" }],
    ["no letter", "report--k3f9x2ab71qz-poplin.example.com", { kind: "site", id: ID, name: "report" }],
    ["the id alone", "k3f9x2ab71qz-poplin.example.com", { kind: "site", id: ID }],
    ["the id and a letter", "k3f9x2ab71qz-p-poplin.example.com", { kind: "site", id: ID, letter: "p" }],
    ["a name that ends like a letter", "plan-p--k3f9x2ab71qz-u-poplin.example.com", { kind: "site", id: ID, name: "plan-p", letter: "u" }],
  ] as const)("a label address with %s names the same site, and reports what it carried", (_what, host, parts) => {
    expect(resolved(ADDRESSES, host)).toEqual({ ...parts, path: "/a" });
  });

  // Drift: a redirect between the letters keeps what the visitor typed; one that filled in the stored name would tell a stranger a private site's name.
  test.each([
    [{ id: ID, name: "old-name" as SiteName }, "p", "https://old-name--k3f9x2ab71qz-p-poplin.example.com"],
    [{ id: ID }, "p", "https://k3f9x2ab71qz-p-poplin.example.com"],
    [{ id: ID }, "u", "https://k3f9x2ab71qz-u-poplin.example.com"],
  ] as const)("the letter form of %j under %s is %s, and reads back as the same id and letter", (typed, letter, address) => {
    expect<unknown>([ADDRESSES.letterFormOf(typed, letter), ADDRESSES.resolve(new URL(address))]).toEqual([address, { kind: "site", ...typed, letter, path: "/" }]);
  });

  test.each([
    "report--k3f9x2ab71qz-x-poplin.example.com",
    "report--k3f9x2ab71qz-pu-poplin.example.com",
    "report--k3f9x2ab71q-u-poplin.example.com",
    "re--k3f9x2ab71qz-u-poplin.example.com",
    "report--k3f9x2ab71qz-u-page.example.com",
    "docs-poplin.example.com",
    "docs-u-poplin.example.com",
    "docs-pages.example.com",
    "docs.example.com",
    "poplin.example.com",
    "docs-page.example.org",
    "a.docs-page.example.com",
  ])("%s names nothing of the install", (host) => {
    expect(resolved(ADDRESSES, host)).toEqual({ kind: "none" });
  });
});

describe("the public word `poplin`, under which a public address ends like a label address", () => {
  const SAME_WORD = under("poplin");

  // Drift: a public name that reads as a label address would be gated by the login of private sites, or shadowed by a bare id; the layout keeps exactly those names, and only under this word.
  test.each([
    ["docs", true, true],
    ["docs-p", false, true],
    ["docs-u", false, true],
    ["k3f9x2ab71qz", false, true],
  ] as const)("the public name %j is accepted under `poplin`: %j, and under `page`: %j", (name, underPoplin, underPage) => {
    expect([parsePublicName(name, SAME_WORD.reservedNames).ok, parsePublicName(name, ADDRESSES.reservedNames).ok]).toEqual([underPoplin, underPage]);
  });

  test.each([
    ["docs-poplin.example.com", { kind: "public-name", name: "docs", path: "/a" }],
    ["k3f9x2ab71qz-poplin.example.com", { kind: "site", id: ID, path: "/a" }],
    ["docs-p-poplin.example.com", { kind: "none" }],
    ["docs-u-poplin.example.com", { kind: "none" }],
    ["docs-page.example.com", { kind: "none" }],
  ] as const)("%s reads as %j: twelve letters and digits are always an id, never a public name", (host, addressed) => {
    expect(resolved(SAME_WORD, host)).toEqual(addressed);
  });

  test("under a word of the install's own, the same twelve characters are a public name at the public address and an id at the label address", () => {
    const own = under("site");

    expect([resolved(own, "k3f9x2ab71qz-site.example.com"), resolved(own, "k3f9x2ab71qz-poplin.example.com")]).toEqual([
      { kind: "public-name", name: "k3f9x2ab71qz", path: "/a" },
      { kind: "site", id: ID, path: "/a" },
    ]);
  });
});
