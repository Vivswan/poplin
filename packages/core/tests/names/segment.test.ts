import { describe, expect, test } from "bun:test";

import { type PublicName, parsePublicName, type SiteName } from "../../src/names/names";
import { ID_FORM_NAMES, readSegment, segmentPath } from "../../src/names/segment";
import type { SiteId } from "../../src/sites/ids";
import { siteLabel } from "../../src/sites/labels";

const ID = "k3f9x2ab71qz" as SiteId;
const NAME = "q3-report" as SiteName;
const LONGEST_NAME = "a".repeat(40);

describe("readSegment", () => {
  // Drift: links are written with `segmentPath` and read with this one function; if the two part, every published link is dead.
  test.each([
    ["a label", siteLabel(NAME, ID), "/q3-report--k3f9x2ab71qz", { kind: "site", name: NAME, id: ID }],
    ["an id alone", ID, "/k3f9x2ab71qz", { kind: "site", id: ID }],
    ["a public name", "docs" as PublicName, "/docs", { kind: "public-name", name: "docs" }],
    ["the longest name", siteLabel(LONGEST_NAME as SiteName, ID), `/${LONGEST_NAME}--k3f9x2ab71qz`, { kind: "site", name: LONGEST_NAME, id: ID }],
  ] as const)("the path written for %s reads back as what it names, with nothing after it", (_what, segment, written, parts) => {
    const path = segmentPath(segment);

    expect<unknown>([path, readSegment(path)]).toEqual([written, { ...parts, path: "" }]);
  });

  // Drift: only the id finds a site, so a renamed site's old links and a bare id keep working; a reader that judged the name would break every link on a rename.
  test.each([
    ["another name", "/old-name--k3f9x2ab71qz/a", { kind: "site", id: ID, name: "old-name" }],
    ["a name that ends like a letter of the hostname form", "/plan-p--k3f9x2ab71qz/a", { kind: "site", id: ID, name: "plan-p" }],
    ["twelve letters and digits, which a name may be too", "/abcdefghijkl/a", { kind: "site", id: "abcdefghijkl" }],
  ])("a first segment with %s names a site by its id", (_what, pathname, parts) => {
    expect<unknown>(readSegment(pathname)).toEqual({ ...parts, path: "/a" });
  });

  // Drift: a segment that is no label, id, or name would reach a lookup, or one spelled another way would name the same site at a second address.
  test.each([
    ["no segment", "/"],
    ["an empty first segment", "//docs/"],
    ["no leading slash", "docs/"],
    ["nothing", ""],
    ["a name too short to be one", "/ab/"],
    ["a label whose name is too short", "/ab--k3f9x2ab71qz/"],
    ["a label whose id is too short", "/report--k3f9x2ab71q/"],
    ["a label whose id is too long", "/report--k3f9x2ab71qzz/"],
    ["a label with no name", "/--k3f9x2ab71qz/"],
    ["a label with two separators", "/report--draft--k3f9x2ab71qz/"],
    ["a name longer than a name may be", `/${LONGEST_NAME}a/`],
    ["capitals", "/Docs/"],
    ["an encoded letter", "/%64ocs/"],
    ["an encoded slash", "/docs%2fa"],
    ["a dot", "/docs.html"],
    ["a dot segment", "/../docs/"],
    ["an underscore", "/a_b/"],
  ])("%s names nothing: %j", (_what, pathname) => {
    expect(readSegment(pathname)).toBeUndefined();
  });
});

describe("ID_FORM_NAMES", () => {
  // Drift: a public name in the form of an id would be shadowed by the site, or the missing site, that its twelve characters name as an id; any other kept name would refuse a public name the grammar reads without trouble.
  test.each([
    ["k3f9x2ab71qz", false, { kind: "site", id: ID, path: "/" }],
    ["abcdefghijkl", false, { kind: "site", id: "abcdefghijkl", path: "/" }],
    ["k3f9x2ab71q", true, { kind: "public-name", name: "k3f9x2ab71q", path: "/" }],
    ["k3f9x2ab71qz0", true, { kind: "public-name", name: "k3f9x2ab71qz0", path: "/" }],
    ["docs-p", true, { kind: "public-name", name: "docs-p", path: "/" }],
    ["docs-u", true, { kind: "public-name", name: "docs-u", path: "/" }],
    ["poplin", true, { kind: "public-name", name: "poplin", path: "/" }],
  ])("the public name %j is accepted: %j, and its path reads as %j", (name, accepted, parts) => {
    expect<unknown>([parsePublicName(name, ID_FORM_NAMES).ok, readSegment(`/${name}/`)]).toEqual([accepted, parts]);
  });
});
