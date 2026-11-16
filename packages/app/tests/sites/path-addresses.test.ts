import { describe, expect, test } from "bun:test";
import type { PublicName, SiteName } from "@poplin/core/src/names/names";
import type { SiteId } from "@poplin/core/src/sites/ids";
import { siteLabel } from "@poplin/core/src/sites/labels";
import { PATH_ADDRESSES } from "./support/layout";

const NAME = "report" as SiteName;
const ID = "k3f9x2ab71qz" as SiteId;
const LABEL = siteLabel(NAME, ID);
const SITES = "https://poplin-sites.example.net";
const PRIVATE = "https://poplin-private.example.net";

function resolved(address: string): unknown {
  return PATH_ADDRESSES.resolve(new URL(address));
}

describe("the path layout", () => {
  // Drift: these are the addresses people share and the install's login is set up over: a private site written on the host no login stands in front of, or an address without the slash a page's relative links need, is a published link that is wrong.
  test("the addresses of a site are paths of the two hosts: a private site on the private host, every other on the sites host, each ending in a slash", () => {
    const written = [PATH_ADDRESSES.addressOf(LABEL, "private"), PATH_ADDRESSES.addressOf(LABEL, "unlisted"), PATH_ADDRESSES.addressOf(LABEL, "public"), PATH_ADDRESSES.publicAddressOf("docs" as PublicName)];

    expect(written).toEqual([`${PRIVATE}/report--k3f9x2ab71qz/`, `${SITES}/report--k3f9x2ab71qz/`, `${SITES}/report--k3f9x2ab71qz/`, `${SITES}/docs/`]);
  });

  // Drift: the hostname is all that tells a private address from an open one; a letter read from anything else would put a private site's address where no login stands.
  test.each([
    ["a label on the sites host", `${SITES}/report--k3f9x2ab71qz/a`, { kind: "site", id: ID, name: "report", letter: "u", path: "/a" }],
    ["a label on the private host", `${PRIVATE}/report--k3f9x2ab71qz/a`, { kind: "site", id: ID, name: "report", letter: "p", path: "/a" }],
    ["another name", `${SITES}/old-name--k3f9x2ab71qz/a`, { kind: "site", id: ID, name: "old-name", letter: "u", path: "/a" }],
    ["the id alone", `${PRIVATE}/k3f9x2ab71qz/a`, { kind: "site", id: ID, letter: "p", path: "/a" }],
    [
      "a name that ends like a letter of the hostname form",
      `${SITES}/plan-p--k3f9x2ab71qz/a`,
      { kind: "site", id: ID, name: "plan-p", letter: "u", path: "/a" },
    ],
    ["a public name", `${SITES}/docs/a`, { kind: "public-name", name: "docs", path: "/a" }],
    ["no slash after the label", `${SITES}/report--k3f9x2ab71qz`, { kind: "site", id: ID, name: "report", letter: "u", path: "" }],
    ["no slash after the public name, and a query", `${SITES}/docs?x=1`, { kind: "public-name", name: "docs", path: "" }],
    ["another port and scheme, which are not read", "http://poplin-sites.example.net:8443/docs/", { kind: "public-name", name: "docs", path: "/" }],
    ["capitals in the hostname, which a URL lowers", "https://POPLIN-SITES.example.net/docs/", { kind: "public-name", name: "docs", path: "/" }],
  ] as const)("%s reads as what it names", (_what, address, parts) => {
    expect(resolved(address)).toEqual(parts);
  });

  // Drift: an address outside the two hosts, or a first segment that is no label, id, or name, would reach a lookup; a public name on the private host would put an open site behind the login.
  test.each([
    `${SITES}/`,
    `${SITES}`,
    `${SITES}//docs/`,
    `${SITES}/Docs/`,
    `${SITES}/%64ocs/`,
    `${SITES}/ab/`,
    `${SITES}/re--k3f9x2ab71qz/`,
    `${SITES}/report--k3f9x2ab71q/`,
    `${SITES}/favicon.ico`,
    `${PRIVATE}/docs/`,
    `${PRIVATE}/`,
    "https://poplin.example.net/docs/",
    "https://poplin.example.net/report--k3f9x2ab71qz/",
    "https://example.net/docs/",
    "https://a.poplin-sites.example.net/docs/",
    "https://poplin-sites.example.net./docs/",
    "https://poplin-sites.example.org/docs/",
    "https://xpoplin-sites.example.net/docs/",
  ])("%s names nothing of the install", (address) => {
    expect(resolved(address)).toEqual({ kind: "none" });
  });

  // Drift: a page of the install's own dashboard, or of a hostname that only looks like a site's, would pass as a site of the install and load a site's files while outside pages are blocked.
  test("only the two hosts are a site's, and the frame rule names exactly them", () => {
    const hosts = [
      "poplin-sites.example.net",
      "poplin-private.example.net",
      "poplin.example.net",
      "example.net",
      "a.poplin-sites.example.net",
      "xpoplin-sites.example.net",
      "poplin-sites.example.org",
    ];

    expect([hosts.filter(PATH_ADDRESSES.isSiteHost), PATH_ADDRESSES.frameAncestors]).toEqual([
      ["poplin-sites.example.net", "poplin-private.example.net"],
      `${SITES} ${PRIVATE}`,
    ]);
  });
});
