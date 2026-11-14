import { expect, test } from "bun:test";

import { isSameOrigin } from "../../../src/dashboard/security/same-origin";

/** The address every request of the table is sent to. */
const URL_ASKED = "https://poplin.example.com/settings/save";

/** The origin of that address. */
const OWN = "https://poplin.example.com";

/** A hostname beside the dashboard's under the same registrable domain, as a served site has. */
const SIBLING = "https://shop-page.example.com";

// Drift: a check that asks for a real `Origin` refuses every form of a browser whose page withholds it, and one that trusts `null` or `same-site` lets a served site post as the owner.
test("a request counts as the dashboard's own only when its Origin is the origin it was sent to, or is withheld and the browser itself marks it same-origin", () => {
  const cases: readonly (readonly [origin: string | undefined, fetchSite: string | undefined, same: boolean])[] = [
    [OWN, "same-origin", true],
    [OWN, undefined, true],
    ["null", "same-origin", true],
    [undefined, "same-origin", true],

    [undefined, undefined, false],
    ["null", undefined, false],
    ["null", "same-site", false],
    ["null", "cross-site", false],
    ["null", "none", false],
    ["null", "", false],
    ["null", "SAME-ORIGIN", false],
    ["null", "same-origin, same-origin", false],
    [undefined, "same-site", false],
    [undefined, "cross-site", false],
    [undefined, "none", false],

    [OWN, "same-site", false],
    [OWN, "cross-site", false],
    [OWN, "none", false],
    [OWN, "", false],

    ["", "same-origin", false],
    ["NULL", "same-origin", false],
    [SIBLING, "same-origin", false],
    [SIBLING, "same-site", false],
    [SIBLING, undefined, false],
    ["https://example.com", "same-site", false],
    ["https://evil.example.net", "cross-site", false],
    ["https://evil.example.net", "same-origin", false],
    ["http://poplin.example.com", "same-origin", false],
    ["https://poplin.example.com:8443", "same-origin", false],
    ["https://poplin.example.com/", "same-origin", false],
    ["https://POPLIN.example.com", "same-origin", false],
    ["https://poplin.example.com.evil.example", "same-origin", false],
    [`${OWN}, ${OWN}`, "same-origin", false],
  ];

  for (const [origin, fetchSite, same] of cases) {
    const headers = new Headers();
    if (origin !== undefined) headers.set("Origin", origin);
    if (fetchSite !== undefined) headers.set("Sec-Fetch-Site", fetchSite);

    expect([origin, fetchSite, isSameOrigin({ url: URL_ASKED, headers })]).toEqual([origin, fetchSite, same]);
  }
});
