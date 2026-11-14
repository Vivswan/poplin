import { describe, expect, test } from "bun:test";
import { parsePublicName, type PublicName, type SiteName } from "@poplin/core/src/names/names";
import type { SiteId } from "@poplin/core/src/sites/ids";
import { siteLabel } from "@poplin/core/src/sites/labels";
import { ADDRESSES } from "./support/layout";

const NAME = "report" as SiteName;
const ID = "k3f9x2ab71qz" as SiteId;

describe("the hostname layout", () => {
  // Drift: the site object's url comes from `addressOf` and a visitor's request is read by `resolve`; if the two forms part, every action answers with an address that serves nothing.
  test.each([
    ["a site's label", siteLabel(NAME, ID), "https://report--k3f9x2ab71qz-page.example.com", { kind: "site", name: NAME, id: ID, path: "/" }],
    ["a public name", "docs" as PublicName, "https://docs-page.example.com", { kind: "public-name", name: "docs", path: "/" }],
  ] as const)("the address of %s is the one the layout reads back as that site", (_what, site, address, addressed) => {
    expect<unknown>([ADDRESSES.addressOf(site), ADDRESSES.resolve(new URL(ADDRESSES.addressOf(site)))]).toEqual([address, addressed]);
  });

  // Drift: a site holding a name the layout keeps would take the hostname of the install's own page; the rule book refuses exactly the names the layout says it keeps.
  test("every name the layout keeps is refused as a public name, and its address is not a site's", () => {
    const kept = [...ADDRESSES.reservedNames];

    expect(kept.length).toBeGreaterThan(0);
    expect(kept.map((name) => [parsePublicName(name, ADDRESSES.reservedNames), ADDRESSES.resolve(new URL(ADDRESSES.addressOf(name as PublicName))).kind])).toEqual(kept.map(() => [{ ok: false, refusal: "reserved" }, "gallery"]));
  });
});
