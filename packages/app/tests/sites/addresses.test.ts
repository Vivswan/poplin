import { describe, expect, test } from "bun:test";
import { letterOf } from "@poplin/core/src/names/marker";
import { type PublicName, parsePublicName, type SiteName } from "@poplin/core/src/names/names";
import type { SiteId } from "@poplin/core/src/sites/ids";
import { siteLabel } from "@poplin/core/src/sites/labels";
import { LAYOUTS } from "./support/layout";

const NAME = "report" as SiteName;
const ID = "k3f9x2ab71qz" as SiteId;
const LABEL = siteLabel(NAME, ID);
const ACCESSES = ["private", "unlisted", "public"] as const;
const LETTERS = ["p", "u"] as const;
const TYPED = [{ id: ID, name: NAME }, { id: ID, name: "old-name" as SiteName }, { id: ID }] as const;
const PUBLIC_NAMES = ["docs", "docs-p", "docs-u", "poplin", "page", "k3f9x2ab71qz", "abcdefghijkl"];

describe.each(LAYOUTS)("%s", (_layout, addresses) => {
  // Drift: a site's url comes from `addressOf` and a visitor's request is read by `resolve`; if the two forms part under one layout, every action there answers with an address that serves nothing.
  test.each(ACCESSES)("the address written for a %s site reads back as that site, under the letter of its access, at its home page", (access) => {
    expect(addresses.resolve(new URL(addresses.addressOf(LABEL, access)))).toEqual({ kind: "site", name: NAME, id: ID, letter: letterOf(access), path: "/" });
  });

  // Drift: a public name the layout takes would read as a label address or as nothing, so a public site would be published at an address that never serves it.
  test.each(PUBLIC_NAMES)("the public name %j is kept by the layout, or its address reads back as that name", (raw) => {
    const name = parsePublicName(raw, addresses.reservedNames);
    const read = name.ok ? addresses.resolve(new URL(addresses.publicAddressOf(name.value))) : "kept";

    expect<unknown>(read).toEqual(name.ok ? { kind: "public-name", name: raw, path: "/" } : "kept");
  });

  // Drift: a move between the letters is written by `letterFormOf` with the request's path after it; a form that already held a path, or dropped the typed name, would send a visitor to another file or tell a stranger a site's stored name.
  test.each(TYPED.flatMap((typed) => LETTERS.map((letter) => [typed, letter] as const)))(
    "the letter form of %j under %s, with a path after it, reads back as the same id, name, letter, and path",
    (typed, letter) => {
      expect<unknown>(addresses.resolve(new URL(`${addresses.letterFormOf(typed, letter)}/a/b.html?x=1`))).toEqual({
        kind: "site",
        ...typed,
        letter,
        path: "/a/b.html",
      });
    },
  );

  // Drift: a request of one site's page for a file of another is let through by the requester's hostname; a hostname the layout writes and does not own up to would have every such request refused.
  test("every address the layout writes sits on a hostname it calls a site's", () => {
    const written = [
      ...ACCESSES.map((access) => addresses.addressOf(LABEL, access)),
      addresses.publicAddressOf("docs" as PublicName),
      ...LETTERS.map((letter) => addresses.letterFormOf({ id: ID }, letter)),
    ];

    expect(written.filter((address) => !addresses.isSiteHost(new URL(address).hostname))).toEqual([]);
  });
});
